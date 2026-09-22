/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

/* Minimal A2S (Steam server browser protocol) client, focused on A2S_PLAYERS.
   gamedig parses only {name, score, time} and throws away the extra string Rust
   appends per player, which carries the player's SteamID64 — that string is what
   makes player tracking survive in-game name changes, so the parsing lives here.
   Only A2S_PLAYERS is implemented; anything unrecognized (bzip2 packets, malformed
   entries) throws and the caller falls back to name-only matching. */

const Dgram = require('dgram');
const Zlib = require('zlib');

const HEADER_SPLIT = 0x01;   /* Newer multi-package format marker. */
const FLAGS_SINGLE_ZLIB = 0x01;
const FLAGS_MULTI_ZLIB = 0x02;
const FLAGS_SINGLE = 0x03;

const S2C_CHALLENGE = 0x41;  /* 'A' - challenge response */
const S2C_PLAYERS = 0x44;    /* 'D' - players reply */
const A2S_PLAYERS = 0x55;    /* 'U' */

const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 8000;

function Reader(buffer) {
    this._buffer = buffer;
    this._offset = 0;

    this.byte = () => this._buffer.readUInt8(this._offset++);
    this.int32 = () => { const v = this._buffer.readInt32LE(this._offset); this._offset += 4; return v; };
    this.uint32 = () => { const v = this._buffer.readUInt32LE(this._offset); this._offset += 4; return v; };
    this.float = () => { const v = this._buffer.readFloatLE(this._offset); this._offset += 4; return v; };
    this.cstring = () => {
        const end = this._buffer.indexOf('\0', this._offset);
        if (end === -1) throw new Error('Unterminated string in A2S packet');
        const v = this._buffer.toString('utf8', this._offset, end);
        this._offset = end + 1;
        return v;
    };
    this.remaining = () => this._buffer.length - this._offset;
}

/* Reassembles single/multi A2S replies into the raw payload after all headers. */
function packetCollector(onComplete, onError) {
    const fragments = {};
    let total = 0;
    let got = 0;
    let compressed = false;
    let done = false;

    const finish = () => {
        if (done || total <= 0 || got < total) return;
        done = true;

        const ordered = [];
        for (let i = 0; i < total; i++) ordered.push(fragments[i] ?? Buffer.alloc(0));
        let payload = Buffer.concat(ordered);
        try {
            if (compressed) payload = Zlib.inflateSync(payload);
            onComplete(payload);
        }
        catch (e) {
            onError(e);
        }
    };

    return function (msg) {
        try {
            if (msg.length < 6 || msg.readInt32LE(0) !== -1) return; /* Not an A2S reply. */

            if (msg[4] === HEADER_SPLIT) {
                /* Newer format: [0x01][flags][reqid:4] single, plus [total][number]
                   when split over several datagrams. Payload starts after those. */
                const flags = msg[5];
                compressed = (flags === FLAGS_SINGLE_ZLIB || flags === FLAGS_MULTI_ZLIB);
                if (flags === FLAGS_SINGLE || flags === FLAGS_SINGLE_ZLIB) {
                    fragments[0] = msg.slice(10);
                    total = 1;
                    got = 1;
                }
                else {
                    total = msg[10];
                    const number = msg[11];
                    fragments[number] = msg.slice(12);
                    got += 1;
                }
            }
            else if (msg[4] & 0x80) {
                /* Old single-package format: bit 7 set, payload follows directly. */
                fragments[0] = msg.slice(5);
                total = 1;
                got = 1;
            }
            else {
                /* Old multi-package format: lower 7 bits are the index, total at [5],
                   payload from [6]. */
                const number = msg[4] & 0x7F;
                total = msg[5];
                fragments[number] = msg.slice(6);
                got += 1;
            }
        }
        catch (e) {
            onError(e);
            return;
        }

        finish();
    };
}

/* Parses the players reply: 'D', count, then per player:
   index(byte) name(cstring) score(int32) time(float) [extra(cstring) = SteamID64 on Rust]. */
function parsePlayers(payload) {
    const r = new Reader(payload);
    if (r.byte() !== S2C_PLAYERS) throw new Error('Unexpected A2S reply type');

    const count = r.byte();
    const players = [];
    for (let i = 0; i < count; i++) {
        r.byte(); /* player index */
        const name = r.cstring();
        r.int32(); /* score */
        const time = r.float(); /* seconds on server */

        let steamId = null;
        if (r.remaining() > 0) {
            const extra = r.cstring();
            if (/^\d{17}$/.test(extra)) steamId = extra;
        }
        players.push({ name, steamId, time });
    }
    return players;
}

/* One socket attempt; resolves with the players array or rejects. */
function attempt(host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        let socket = null;
        let timer = null;
        let settled = false;
        let challengeSent = false;

        const settle = (fn, arg) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (socket) {
                try { socket.close(); }
                catch (e) { /* already closing */ }
            }
            fn(arg);
        };

        const fail = (e) => settle(reject, e instanceof Error ? e : new Error(String(e)));

        const collector = packetCollector(
            (payload) => {
                try {
                    settle(resolve, parsePlayers(payload));
                }
                catch (e) {
                    fail(e);
                }
            },
            fail
        );

        const send = (withChallenge) => {
            const req = Buffer.alloc(9);
            req.writeInt32LE(-1, 0);
            req.writeUInt8(A2S_PLAYERS, 4);
            req.writeInt32LE(withChallenge ? challenge : -1, 5);
            socket.send(req, 0, req.length, port, host);
        };

        let challenge = null;

        const onData = (msg) => {
            if (msg.length >= 9 && msg.readInt32LE(0) === -1 && msg[4] === S2C_CHALLENGE) {
                challenge = msg.readInt32LE(5);
                if (challengeSent) return; /* Echo already sent, more replies coming. */
                challengeSent = true;
                send(true);
                return;
            }
            collector(msg);
        };

        timer = setTimeout(() => fail(new Error(`No A2S players reply from ${host}:${port}`)), timeoutMs);

        try {
            socket = Dgram.createSocket('udp4');
            socket.on('message', onData);
            socket.on('error', fail);
            send(false);
        }
        catch (e) {
            fail(e);
        }
    });
}

module.exports = {
    /* Resolves to [{ name, steamId }] (steamId null when the server hides it).
       Throws after MAX_ATTEMPTS so the caller can fall back to name-only data. */
    queryPlayers: async function (host, port, timeoutMs = ATTEMPT_TIMEOUT_MS) {
        let lastError = null;
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            try {
                return await attempt(host, port, timeoutMs);
            }
            catch (e) {
                lastError = e;
            }
        }
        throw lastError ?? new Error(`A2S query to ${host}:${port} failed`);
    },

    parsePlayers,
};

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

const Dgram = require('dgram');
const EventEmitter = require('events');

/* Watches whether a Rust game server can be joined, by sending Steam server queries (A2S_INFO)
   to its query port. Rust only answers them once it has finished loading and opened up for
   players, so the first answer marks the moment players can connect. Independent of Rust+.

   Online:  the first answer, i.e. within one fast poll interval + one round trip.
   Offline: the host reports the query port closed twice in a row (the server process is gone:
            ICMP port unreachable, surfacing as ECONNREFUSED on the connected UDP socket), or
            no answer for offlineAfterMs (host down, packets dropped), or no answer for
            confirmedOfflineAfterMs while isConfirmedDown() agrees (e.g. Rust+ also dropped).

   Polls every intervalMs while answers arrive on time, else every fastIntervalMs. The
   challenge Steam hands out is reused, so a poll normally costs a single round trip.

   Emits 'change' (online, reason) on every verdict change, the first verdict included. */

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const A2S_INFO_REQUEST = Buffer.concat([HEADER, Buffer.from([0x54]), Buffer.from('Source Engine Query\0')]);
const S2A_INFO = 0x49;
const S2C_CHALLENGE = 0x41;
const REFUSED_TO_OFFLINE = 2;

class GameServerMonitor extends EventEmitter {
    constructor(host, port, options = {}) {
        super();

        this.host = host;
        this.port = parseInt(port);
        this.intervalMs = options.intervalMs ?? 1000;
        this.fastIntervalMs = options.fastIntervalMs ?? 250;
        this.offlineAfterMs = options.offlineAfterMs ?? 10000;
        this.confirmedOfflineAfterMs = options.confirmedOfflineAfterMs ?? 3000;
        this.isConfirmedDown = options.isConfirmedDown ?? (() => false);

        this.online = null;             /* Current verdict, null until the first one. */
        this.changedAt = null;          /* When the verdict last changed. */
        this.lastAnswerAt = null;
        this.info = null;               /* { name, map, gamePort } from the last answer. */

        this.socket = null;
        this.timeout = null;
        this.startedAt = null;
        this.refused = 0;               /* Consecutive port-unreachable reports since the last answer. */
        this.challenge = null;
        this.challengeRetried = false;  /* One challenge retry per poll, never a ping-pong loop. */
        this.stopped = false;
    }

    start() {
        this.startedAt = Date.now();
        this.socket = Dgram.createSocket('udp4');
        this.socket.on('message', (message) => this.onMessage(message));
        this.socket.on('error', (e) => this.onError(e));
        /* Connected, so the kernel delivers port-unreachable reports and drops foreign packets. */
        this.socket.connect(this.port, this.host, () => {
            if (!this.stopped) this.poll();
        });
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.timeout);
        this.timeout = null;
        if (this.socket) {
            try {
                this.socket.close();
            }
            catch (e) { /* already closed */ }
            this.socket = null;
        }
        this.removeAllListeners();
    }

    silenceMs() {
        return Date.now() - (this.lastAnswerAt ?? this.startedAt);
    }

    poll() {
        if (this.stopped) return;

        this.evaluate();
        this.send();

        const onTime = this.online === true && this.refused === 0 && this.silenceMs() < this.intervalMs + 500;
        this.timeout = setTimeout(() => this.poll(), onTime ? this.intervalMs : this.fastIntervalMs);
    }

    evaluate() {
        if (this.online === false) return;

        const silence = this.silenceMs();
        if (this.refused >= REFUSED_TO_OFFLINE) {
            this.setOnline(false, 'refused');
        }
        else if (silence >= this.offlineAfterMs) {
            this.setOnline(false, 'timeout');
        }
        else if (silence >= this.confirmedOfflineAfterMs && this.isConfirmedDown()) {
            this.setOnline(false, 'confirmed');
        }
    }

    send() {
        if (!this.socket) return;
        this.challengeRetried = false;
        this.sendQuery();
    }

    sendQuery() {
        const packet = this.challenge ? Buffer.concat([A2S_INFO_REQUEST, this.challenge]) : A2S_INFO_REQUEST;
        this.socket.send(packet, (e) => {
            if (e) this.onError(e);
        });
    }

    onMessage(message) {
        if (this.stopped || message.length < 5 || message.readInt32LE(0) !== -1) return;

        const type = message[4];
        if (type === S2C_CHALLENGE && message.length >= 9) {
            this.challenge = Buffer.from(message.subarray(5, 9));
            if (!this.challengeRetried) {
                this.challengeRetried = true;
                this.sendQuery();
            }
            return;
        }
        if (type !== S2A_INFO) return;

        this.lastAnswerAt = Date.now();
        this.refused = 0;
        const info = GameServerMonitor.parseInfo(message);
        if (info) this.info = info;
        this.setOnline(true, 'answer');
    }

    onError(e) {
        if (this.stopped) return;
        if (e && e.code === 'ECONNREFUSED') {
            this.refused += 1;
            /* Confirm right away instead of waiting for the next regular poll. */
            if (this.online !== false && this.refused < REFUSED_TO_OFFLINE && this.socket) {
                clearTimeout(this.timeout);
                this.timeout = setTimeout(() => this.poll(), this.fastIntervalMs);
            }
            else {
                this.evaluate();
            }
            return;
        }
        this.emit('socketError', e);
    }

    setOnline(online, reason) {
        if (this.online === online) return;
        this.online = online;
        this.changedAt = Date.now();
        this.emit('change', online, reason);
    }

    /* S2A_INFO: name, map, folder, game, id, players, max, bots, type, env, visibility, vac,
       version, extra data flags (0x80: game port). Returns null when malformed. */
    static parseInfo(message) {
        try {
            let offset = 6;
            const readString = () => {
                const end = message.indexOf(0, offset);
                if (end === -1) throw new Error('unterminated string');
                const value = message.toString('utf8', offset, end);
                offset = end + 1;
                return value;
            };

            const name = readString();
            const map = readString();
            readString();   /* folder */
            readString();   /* game */
            offset += 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1;   /* id, players, max, bots, type, env, visibility, vac */
            readString();   /* version */

            let gamePort = null;
            if (offset < message.length) {
                const edf = message[offset];
                offset += 1;
                if ((edf & 0x80) && offset + 2 <= message.length) gamePort = message.readUInt16LE(offset);
            }
            return { name, map, gamePort };
        }
        catch (e) {
            return null;
        }
    }
}

module.exports = GameServerMonitor;

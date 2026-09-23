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

const Axios = require('axios');
const { GameDig } = require('gamedig');

/* Steam server browser (A2S) access for the free player tracking.

   Rust's A2S player list carries only name, score and time on server — no SteamIDs
   (verified against a live server: the reply parses exactly per spec with nothing
   appended). Presence tracking is therefore by name.

   Rust+ pairing only yields the app port (default game port + 67), which does not answer
   A2S. The query port defaults to max(game port, RCON port) + 1, i.e. usually 28017, but
   hosts vary it, so it is looked up via Steam's keyless GetServersAtAddress, which lists
   every server on an IP with its query port and game port. */

const STEAM_SERVERS_AT_ADDRESS = 'https://api.steampowered.com/ISteamApps/GetServersAtAddress/v1/';
const RUST_APPID = 252490;
const APP_PORT_OFFSET = 67;         /* Rust+ app port default: game port + 67. */
const DEFAULT_QUERY_PORT = 28017;
const STEAM_CACHE_MS = 60 * 60 * 1000;

const steamCache = {};  /* ip -> { ts, servers } */

module.exports = {
    DEFAULT_QUERY_PORT: DEFAULT_QUERY_PORT,

    /* Resolves to [{ name, time }] (time = seconds on server), rejects when the server does
       not answer within timeoutMs twice (UDP: a single reply occasionally gets lost). */
    queryPlayers: async function (host, port, timeoutMs = 5000) {
        const data = await GameDig.query({
            type: 'rust',
            host: host,
            port: parseInt(port),
            givenPortOnly: true,
            maxRetries: 2,
            socketTimeout: timeoutMs,
            attemptTimeout: timeoutMs
        });
        return (data.players ?? []).map(e => ({ name: e.name ?? '', time: e.raw?.time ?? 0 }));
    },

    /* Every Rust server Steam lists on this IP: [{ address: 'ip:queryPort', gamePort }]. */
    rustServersAt: async function (ip) {
        const cached = steamCache[ip];
        if (cached && Date.now() - cached.ts < STEAM_CACHE_MS) return cached.servers;

        const response = await Axios.get(STEAM_SERVERS_AT_ADDRESS, { params: { addr: ip }, timeout: 5000 });
        const servers = (response.data?.response?.servers ?? [])
            .filter(e => e.appid === RUST_APPID && e.addr)
            .map(e => ({ address: e.addr, gamePort: e.gameport }));

        steamCache[ip] = { ts: Date.now(), servers: servers };
        return servers;
    },

    /* Query address ('ip:port') of a Rust+ paired server, or null when it cannot be told
       apart: the only server on its IP, else the one whose game port fits the app port. */
    forPairedServer: async function (ip, appPort) {
        let servers;
        try {
            servers = await module.exports.rustServersAt(ip);
        }
        catch (e) {
            return null;
        }
        if (servers.length === 1) return servers[0].address;
        const match = servers.find(e => e.gamePort + APP_PORT_OFFSET === parseInt(appPort));
        return match ? match.address : null;
    },
};

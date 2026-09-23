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

const ServerQuery = require('./serverQuery.js');

/* Finds players by (part of) their in-game name on the paired servers and tracker servers.
   Rust's server query only lists names (no SteamIDs), so this cannot tell who someone is —
   it shows who with that name is online right now, spelled exactly as the server lists it,
   so they can be put into a tracker by name. */

const QUERY_TIMEOUT_MS = 4000;
const MAX_CANDIDATES = 15;

module.exports = {
    resolveName: async function (client, guildId, name) {
        const instance = client.getInstance(guildId);
        const query = `${name}`.trim().toLowerCase();

        const addresses = [];
        const seen = new Set();
        const addAddress = (ip, port, title) => {
            if (!ip || !port) return;
            const key = `${ip}:${port}`;
            if (seen.has(key)) return;
            seen.add(key);
            addresses.push({ ip, port: parseInt(port), title });
        };
        const addPairedServer = async (server) => {
            const address = await ServerQuery.forPairedServer(server.serverIp, server.appPort);
            const [ip, port] = (address ?? `${server.serverIp}:${ServerQuery.DEFAULT_QUERY_PORT}`).split(':');
            addAddress(ip, port, server.title);
        };

        /* Tracker addresses first: they are set/confirmed by the user, so their title wins. */
        for (const tracker of Object.values(instance.trackers)) {
            if (!tracker.queryAddress) continue;
            const parts = `${tracker.queryAddress}`.split(':');
            addAddress(parts[0], parts[1] || ServerQuery.DEFAULT_QUERY_PORT, tracker.title);
        }
        await Promise.all(Object.values(instance.serverList).map(addPairedServer));

        const candidates = [];
        const errors = [];

        const results = await Promise.allSettled(addresses.map(address =>
            ServerQuery.queryPlayers(address.ip, address.port, QUERY_TIMEOUT_MS)));

        results.forEach((result, i) => {
            const address = addresses[i];
            if (result.status === 'rejected') {
                errors.push(`${address.ip}:${address.port} (${result.reason?.message ?? result.reason})`);
                return;
            }
            for (const player of result.value) {
                const lower = player.name.toLowerCase();
                if (lower === '' || !lower.includes(query)) continue;
                candidates.push({
                    server: address.title ?? `${address.ip}:${address.port}`,
                    name: player.name,
                    time: Math.round(player.time ?? 0)
                });
            }
        });

        /* Exact name matches first, then partial ones; cap the list. */
        candidates.sort((a, b) => {
            const aExact = a.name.toLowerCase() === query ? 0 : 1;
            const bExact = b.name.toLowerCase() === query ? 0 : 1;
            return aExact - bExact || a.name.localeCompare(b.name);
        });

        return { candidates: candidates.slice(0, MAX_CANDIDATES), errors, serversQueried: addresses.length };
    },
};

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

const A2S = require('./a2s.js');

/* Name -> SteamID candidates. In-game names are not unique and mutable, so when someone
   is met in-game and only their name is known, this queries the A2S player lists (which
   carry the SteamID64 per entry) of all known servers / tracker addresses and returns
   every player whose name matches, so the right SteamID can be picked for the tracker. */

const QUERY_TIMEOUT_MS = 6000;
const MAX_CANDIDATES = 15;

module.exports = {
    resolveName: async function (client, guildId, name, onlyAddress = null) {
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

        if (onlyAddress) {
            const parts = `${onlyAddress}`.split(':');
            addAddress(parts[0], parts[1] || 28015, instance.activeServer !== null
                ? instance.serverList[instance.activeServer]?.title : null);
        }
        else {
            for (const server of Object.values(instance.serverList)) {
                addAddress(server.serverIp, server.appPort, server.title);
            }
            for (const tracker of Object.values(instance.trackers)) {
                if (!tracker.queryAddress) continue;
                const parts = `${tracker.queryAddress}`.split(':');
                addAddress(parts[0], parts[1] || 28015, tracker.title);
            }
        }

        const candidates = [];
        const errors = [];

        for (const address of addresses) {
            try {
                const players = await A2S.queryPlayers(address.ip, address.port, QUERY_TIMEOUT_MS);
                for (const player of players) {
                    const lower = (player.name ?? '').toLowerCase();
                    if (lower === query || lower.includes(query) || query.includes(lower)) {
                        candidates.push({
                            server: address.title ?? `${address.ip}:${address.port}`,
                            name: player.name,
                            steamId: player.steamId,
                            time: Math.round(player.time ?? 0)
                        });
                    }
                }
            }
            catch (e) {
                errors.push(`${address.ip}:${address.port} (${e.message})`);
            }
        }

        /* Exact name matches first, then partial ones; cap the list. */
        candidates.sort((a, b) => {
            const aExact = a.name.toLowerCase() === query ? 0 : 1;
            const bExact = b.name.toLowerCase() === query ? 0 : 1;
            return aExact - bExact || a.name.localeCompare(b.name);
        });

        return { candidates: candidates.slice(0, MAX_CANDIDATES), errors, serversQueried: addresses.length };
    },
};

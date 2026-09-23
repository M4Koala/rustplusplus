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

const Constants = require('./constants.js');
const Scrape = require('./scrape.js');

/* Steam community status of tracked players, without an API key.

   Rust's server query cannot identify players: the A2S player list carries a random
   pseudonym per connection (verified: a player reconnecting comes back under a new name).
   Whether someone is playing therefore comes from their Steam profile XML, which says
   whether they are in-game and in which game — not on which server.

   Profiles that are not public report "offline" to everyone, so they are marked hidden
   instead of offline.

   steamcommunity answers 429 when requests come too often, and its limit is not fixed
   (measured: refusals at 3-6 s spacing after earlier traffic from the same IP). Profiles
   are checked one at a time, least recently checked first, with an adaptive gap: doubled
   after every refusal (up to 5 min), shrunk by 10 % after every success (down to 10 s). */

const RUST_APPID = '252490';
const START_GAP_MS = 15000;
const MIN_GAP_MS = 10000;
const MAX_GAP_MS = 5 * 60 * 1000;
const ROUND_BUDGET_MS = 45000;      /* The handler runs every 60 s. */

/* state: 'rust' | 'othergame' | 'online' | 'offline' | 'hidden' */
function parseProfileXml(xml) {
    const text = `${xml}`;
    if (!/<steamID64>\d{17}<\/steamID64>/.test(text)) return null;

    const tag = (name) => {
        const match = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`).exec(text);
        return match ? match[1].trim() : null;
    };

    const name = tag('steamID');
    const privacy = tag('privacyState');
    const online = tag('onlineState');
    const game = tag('gameName') ?? (tag('stateMessage') ?? '').split('<br/>')[1] ?? null;
    const appId = (/steamcommunity\.com\/app\/(\d+)/.exec(tag('gameLink') ?? '') ?? [])[1] ?? null;

    let state;
    if (privacy !== 'public') state = 'hidden';
    else if (online === 'in-game') {
        const isRust = appId === RUST_APPID || `${game}`.trim().toLowerCase() === 'rust';
        state = isRust ? 'rust' : 'othergame';
    }
    else if (online === 'online') state = 'online';
    else state = 'offline';

    return { state: state, name: name, game: game };
}

module.exports = {
    parseProfileXml: parseProfileXml,

    /* Resolves to { state, name, game } or null for an unknown profile; throws when Steam
       does not answer. */
    fetchStatus: async function (steamId) {
        const response = await Scrape.scrape(`${Constants.STEAM_PROFILES_URL}${steamId}/?xml=1`);
        if (response.status !== 200) throw new Error('Steam community did not answer');
        return parseProfileXml(response.data);
    },

    /* Checks as many of the given SteamIDs as the pacing allows within one round, least
       recently checked first, and stores the results in
       client.steamStatus[steamId] = { state, name, game, checkedAt }. */
    refresh: async function (client, steamIds) {
        if (!client.steamStatus) client.steamStatus = {};
        const pace = client.steamStatusPace ??= { gapMs: START_GAP_MS, nextAt: 0 };

        const due = [...new Set(steamIds)].sort((a, b) =>
            (client.steamStatus[a]?.checkedAt ?? 0) - (client.steamStatus[b]?.checkedAt ?? 0));
        const deadline = Date.now() + ROUND_BUDGET_MS;

        for (const steamId of due) {
            const wait = Math.max(pace.nextAt - Date.now(), 0);
            if (Date.now() + wait > deadline) break;
            if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));

            let status;
            try {
                status = await module.exports.fetchStatus(steamId);
            }
            catch (e) {
                const previousGap = pace.gapMs;
                pace.gapMs = Math.min(pace.gapMs * 2, MAX_GAP_MS);
                pace.nextAt = Date.now() + pace.gapMs;
                if (pace.gapMs !== previousGap) {
                    client.log(client.intlGet(null, 'warningCap'), `Steam refused a profile check ` +
                        `(${e.message}); next check in ${Math.round(pace.gapMs / 1000)} s`);
                }
                return;
            }

            client.steamStatus[steamId] = { ...(status ?? { state: 'unknown', name: null, game: null }),
                checkedAt: Date.now() };
            pace.gapMs = Math.max(Math.round(pace.gapMs * 0.9), MIN_GAP_MS);
            pace.nextAt = Date.now() + pace.gapMs;
        }
    },
};

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

const Fs = require('fs');
const Path = require('path');

const { GameDig } = require('gamedig');

const A2S = require('../util/a2s.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const Timer = require('../util/timer');

/* Free replacement for the (paid) Battlemetrics player tracking: query the Rust server
   directly over the Steam server browser protocol (A2S) and watch for specific players
   being on the server. Works for any player regardless of their profile privacy.
   Players are matched by SteamID (Rust embeds them in its A2S player entries, parsed by
   util/a2s.js), which survives in-game renames — names are repaired from the live list.
   Name matching is only the fallback when a server hides the SteamIDs. */

const POLL_TIMEOUT_MS = 15000;
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; /* Keep 30 days of sessions. */

module.exports = {
    handler: async function (client) {
        if (!client.serverQueryState) client.serverQueryState = {};
        if (!client.serverQueryHistory) client.serverQueryHistory = {};

        for (const guildItem of client.guilds.cache) {
            const guildId = guildItem[0];

            /* One failing server/tracker must not stop the others. */
            try {
                const instance = client.getInstance(guildId);

                for (const [trackerId, tracker] of Object.entries(instance.trackers)) {
                    if (!tracker.queryAddress) continue;

                    try {
                        await module.exports.pollTracker(client, guildId, trackerId);
                    }
                    catch (e) {
                        client.log(client.intlGet(null, 'warningCap'),
                            `Server query failed for tracker ${trackerId}: ${e.message}`);
                        const state = client.serverQueryState[trackerId];
                        if (state) state.lastError = e.message;
                    }
                }
            }
            catch (e) {
                client.log(client.intlGet(null, 'warningCap'), `Server query handler error: ${e.message}`);
            }
        }
    },

    pollTracker: async function (client, guildId, trackerId) {
        if (!client.serverQueryState) client.serverQueryState = {};
        if (!client.serverQueryHistory) client.serverQueryHistory = {};

        const instance = client.getInstance(guildId);
        const tracker = instance.trackers[trackerId];
        if (!tracker || !tracker.queryAddress) return;

        const [host, port] = module.exports.parseAddress(tracker.queryAddress);
        if (!host) return;

        const state = client.serverQueryState[trackerId] ??= {
            online: {},     /* watched key -> { connectedSince } */
            absent: {},     /* watched key -> consecutive polls missing from a successful query */
            knownNames: {}, /* watched key -> resolved lower name used for matching */
            prevLowers: null, /* null until first successful query (baseline) */
            lastOk: null,
            lastError: null,
            playerCount: 0
        };

        /* Rust appends the SteamID64 of every player to the A2S player entries; parsing that
           ourselves (util/a2s.js) is what makes presence tracking immune to name changes.
           gamedig stays as a name-only fallback for servers that don't expose the SteamIDs
           (or confuse our parser). */
        let players;
        try {
            players = (await A2S.queryPlayers(host, port)).map(e =>
                ({ name: e.name, lower: (e.name ?? '').toLowerCase(), steamId: e.steamId }));
        }
        catch (e) {
            try {
                const data = await GameDig.query({ type: 'rust', host, port, timeout: POLL_TIMEOUT_MS });
                players = (data.players ?? []).map(e =>
                    ({ name: e.name, lower: (e.name ?? '').toLowerCase(), steamId: null }));
            }
            catch (e2) {
                /* Server unreachable (down, hidden from browser). Do not synthesize
                   disconnects — keep last known state and surface the error on the embed. */
                state.lastError = e2.message;
                await DiscordMessages.sendTrackerMessage(guildId, trackerId);
                return;
            }
        }

        state.lastError = null;
        state.lastOk = Math.floor(Date.now() / 1000);
        state.playerCount = players.length;

        const firstPoll = state.prevLowers === null;

        /* Watched players are keyed by steamId when present, else by lower name. */
        let renamed = false;
        for (const player of tracker.players) {
            const key = player.steamId !== null ? `${player.steamId}` : (player.name ?? '').toLowerCase();
            if (key === '' || key === 'null') continue;

            const lower = (player.name ?? '').toLowerCase();
            const wasKnown = state.knownNames.hasOwnProperty(key);
            state.knownNames[key] = lower;
            if (!state.online.hasOwnProperty(key)) state.online[key] = null;
            if (!state.absent.hasOwnProperty(key)) state.absent[key] = 0;

            /* SteamID match wins (immune to renames); name match is the fallback for
               entries without a SteamID or servers that do not expose player SteamIDs. */
            const watchedSteamId = player.steamId !== null ? `${player.steamId}` : null;
            let matched;
            if (watchedSteamId) matched = players.find(e => e.steamId === watchedSteamId);
            if (!matched) matched = players.find(e => e.lower === lower);
            const onServer = matched !== undefined;

            /* Player renamed in-game: repair the tracked name from the live server list. */
            if (matched && matched.name !== player.name) {
                player.name = matched.name;
                renamed = true;
            }

            if (onServer) {
                state.absent[key] = 0;
                if (!state.online[key]) {
                    if (wasKnown && !firstPoll) {
                        /* Reconnect: close previous session and open a new one. */
                        module.exports.logSession(client, guildId, key, player, null, Date.now());
                        await module.exports.alert(client, guildId, tracker,
                            client.intlGet(guildId, 'sqAlertConnected',
                                { name: player.name, server: tracker.title }));
                    }
                    state.online[key] = Date.now();
                    module.exports.logSession(client, guildId, key, player, Date.now(), null);
                }
            }
            else {
                state.absent[key] = (state.absent[key] ?? 0) + 1;
                /* Two consecutive absences before declaring a disconnect: tolerates a dropped
                   poll while someone is reconnecting, and one failed A2S reply. */
                if (state.online[key] !== null && state.absent[key] >= 2) {
                    const connectedSince = state.online[key];
                    state.online[key] = null;
                    module.exports.logSession(client, guildId, key, player, null, Date.now());

                    if (wasKnown && !firstPoll) {
                        const duration = Timer.secondsToFullScale(
                            Math.floor((Date.now() - connectedSince) / 1000));
                        await module.exports.alert(client, guildId, tracker,
                            client.intlGet(guildId, 'sqAlertDisconnected',
                                { name: player.name, server: tracker.title, duration: duration }));
                    }
                }
            }
        }

        /* Prune state of players removed from the tracker. */
        const trackedKeys = new Set(tracker.players.map(player =>
            player.steamId !== null ? `${player.steamId}` : (player.name ?? '').toLowerCase()));
        for (const key of Object.keys(state.online)) {
            if (!trackedKeys.has(key)) {
                delete state.online[key];
                delete state.absent[key];
                delete state.knownNames[key];
            }
        }

        state.prevLowers = new Set(players.map(e => e.lower));

        if (renamed) {
            /* Persist repaired names on a fresh read, merged so entries removed via the
               Discord modal while we polled are not resurrected. */
            const BattlemetricsHandler = require('./battlemetricsHandler.js');
            const fresh = client.getInstance(guildId);
            if (fresh.trackers.hasOwnProperty(trackerId)) {
                fresh.trackers[trackerId].players = BattlemetricsHandler.mergeTrackerPlayers(
                    fresh.trackers[trackerId].players, tracker.players);
                client.setInstance(guildId, fresh);
            }
        }

        await DiscordMessages.sendTrackerMessage(guildId, trackerId);
    },

    parseAddress: function (queryAddress) {
        /* Accepts 'ip:port' or 'ip port'. */
        const parts = `${queryAddress}`.trim().split(/[ :]/);
        if (parts.length < 2) return [parts[0] !== '' ? parts[0] : null, parts[0] ? 28015 : null];
        return [parts[0], parseInt(parts[1])];
    },

    /***********************************************************************************
     *  Session history (per player on/offline times on this server)
     **********************************************************************************/

    historyPath: function (guildId) {
        return Path.join(__dirname, '..', '..', 'instances', `${guildId}_serverQueryHistory.json`);
    },

    loadHistory: function (client, guildId) {
        if (client.serverQueryHistory.hasOwnProperty(guildId)) return client.serverQueryHistory[guildId];

        let history = {};
        try {
            history = JSON.parse(Fs.readFileSync(module.exports.historyPath(guildId), 'utf8'));
        }
        catch (e) {
            history = {};
        }
        client.serverQueryHistory[guildId] = history;
        return history;
    },

    logSession: function (client, guildId, key, player, inTs, outTs) {
        const history = module.exports.loadHistory(client, guildId);
        if (!history.hasOwnProperty(key)) history[key] = { name: player.name, sessions: [] };
        history[key].name = player.name;

        if (inTs !== null) {
            /* Close any dangling session (e.g. bot restarted while the player was on). */
            const open = history[key].sessions.find(e => e.out === null);
            if (open) open.out = inTs;
            history[key].sessions.push({ in: inTs, out: null });
        }
        else if (outTs !== null) {
            const open = history[key].sessions.filter(e => e.out === null).pop();
            if (open) open.out = outTs;
        }

        /* Bound the file: drop sessions that ended more than the retention ago. */
        const cutoff = Date.now() - HISTORY_RETENTION_MS;
        history[key].sessions = history[key].sessions.filter(e => (e.out ?? e.in) >= cutoff);

        try {
            Fs.writeFileSync(module.exports.historyPath(guildId), JSON.stringify(history));
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'), `Could not write server query history: ${e.message}`);
        }
    },

    /* Hours the player spent on the server over the last N days (for the embed). */
    hoursLastDays: function (client, guildId, key, days) {
        const history = module.exports.loadHistory(client, guildId);
        if (!history.hasOwnProperty(key)) return null;

        const from = Date.now() - days * 24 * 60 * 60 * 1000;
        let ms = 0;
        for (const session of history[key].sessions) {
            const start = Math.max(session.in, from);
            const end = Math.min(session.out ?? Date.now(), Date.now());
            if (end > start) ms += end - start;
        }
        return Math.round((ms / 3600000) * 10) / 10;
    },

    alert: async function (client, guildId, tracker, text) {
        const instance = client.getInstance(guildId);
        await DiscordMessages.sendMessage(guildId, {
            content: `${tracker.everyone ? '@everyone ' : ''}${text}`
        }, null, instance.channelId?.trackers);
    },
};

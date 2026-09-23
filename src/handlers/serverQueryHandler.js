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

const DiscordMessages = require('../discordTools/discordMessages.js');
const ServerQuery = require('../util/serverQuery.js');
const SteamStatus = require('../util/steamStatus.js');
const Timer = require('../util/timer');

/* Free replacement for the (paid) Battlemetrics player tracking.

   Rust's server query (A2S) cannot identify players: its player list only carries a random
   pseudonym per connection. It is still used for the server line of the tracker (online,
   player count). Whether a tracked player is playing comes from their Steam profile
   (util/steamStatus.js): "playing Rust" on any server, only for public profiles. */

const POLL_TIMEOUT_MS = 15000;
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; /* Keep 30 days of sessions. */

module.exports = {
    handler: async function (client) {
        /* Steam requests are spaced out, so a round can take a while; never overlap them. */
        if (client.serverQueryRunning) return;
        client.serverQueryRunning = true;
        try {
            await module.exports.round(client);
        }
        finally {
            client.serverQueryRunning = false;
        }
    },

    round: async function (client) {
        if (!client.serverQueryState) client.serverQueryState = {};
        if (!client.serverQueryHistory) client.serverQueryHistory = {};

        const trackers = [];
        for (const guildItem of client.guilds.cache) {
            const guildId = guildItem[0];
            const instance = client.getInstance(guildId);
            if (!instance) continue;
            for (const [trackerId, tracker] of Object.entries(instance.trackers)) {
                if (tracker.queryAddress) trackers.push({ guildId, trackerId });
            }
        }

        /* One failing server/tracker must not stop the others. */
        for (const { guildId, trackerId } of trackers) {
            try {
                await module.exports.pollServer(client, guildId, trackerId);
            }
            catch (e) {
                client.log(client.intlGet(null, 'warningCap'),
                    `Server query failed for tracker ${trackerId}: ${e.message}`);
            }
        }

        /* A player watched by several trackers is checked on Steam once. */
        const steamIds = [];
        for (const { guildId, trackerId } of trackers) {
            const tracker = client.getInstance(guildId).trackers[trackerId];
            if (!tracker) continue;
            for (const player of tracker.players) {
                if (player.steamId !== null) steamIds.push(`${player.steamId}`);
            }
        }
        try {
            await SteamStatus.refresh(client, steamIds);
        }
        catch (e) {
            client.log(client.intlGet(null, 'warningCap'), `Steam status round failed: ${e.message}`);
        }

        for (const { guildId, trackerId } of trackers) {
            try {
                await module.exports.applyPlayerStatus(client, guildId, trackerId);
                await DiscordMessages.sendTrackerMessage(guildId, trackerId);
            }
            catch (e) {
                client.log(client.intlGet(null, 'warningCap'),
                    `Tracker ${trackerId} update failed: ${e.message}`);
            }
        }
    },

    getState: function (client, trackerId) {
        if (!client.serverQueryState) client.serverQueryState = {};
        return client.serverQueryState[trackerId] ??= {
            online: {},     /* steamId -> playing-since timestamp, null when not playing */
            applied: {},    /* steamId -> checkedAt of the Steam status last applied */
            lastOk: null,
            lastError: null,
            playerCount: 0
        };
    },

    /* Server line of the tracker: online and player count, from A2S. */
    pollServer: async function (client, guildId, trackerId) {
        const instance = client.getInstance(guildId);
        const tracker = instance.trackers[trackerId];
        if (!tracker || !tracker.queryAddress) return;

        /* Trackers created before the query-port lookup got the Rust+ app port, which never
           answers A2S; swap in the real query address once Steam can tell it. */
        const server = instance.serverList[tracker.serverId];
        if (server && tracker.queryAddress === `${server.serverIp}:${server.appPort}`) {
            const address = await ServerQuery.forPairedServer(server.serverIp, server.appPort);
            const fresh = client.getInstance(guildId);
            if (address && fresh.trackers.hasOwnProperty(trackerId)) {
                fresh.trackers[trackerId].queryAddress = address;
                client.setInstance(guildId, fresh);
                client.log(client.intlGet(null, 'infoCap'),
                    `Tracker ${trackerId}: query address changed from app port to ${address}`);
            }
        }

        const [host, port] = module.exports.parseAddress(tracker.queryAddress);
        if (!host) return;

        const state = module.exports.getState(client, trackerId);
        try {
            const players = await ServerQuery.queryPlayers(host, port, POLL_TIMEOUT_MS);
            state.lastError = null;
            state.lastOk = Math.floor(Date.now() / 1000);
            state.playerCount = players.length;
        }
        catch (e) {
            /* Server unreachable (down, hidden from browser, wrong query port). */
            state.lastError = e.message;
        }
    },

    /* Applies fresh Steam statuses to the tracker: playing sessions, alerts, name updates. */
    applyPlayerStatus: async function (client, guildId, trackerId) {
        const tracker = client.getInstance(guildId).trackers[trackerId];
        if (!tracker) return;

        const state = module.exports.getState(client, trackerId);
        const statuses = client.steamStatus ?? {};

        let renamed = false;
        for (const player of tracker.players) {
            if (player.steamId === null) continue;
            const key = `${player.steamId}`;
            const status = statuses[key];
            if (!status || state.applied[key] === status.checkedAt) continue;

            /* First status since startup is the baseline: sessions are logged, no alerts. */
            const firstSeen = !state.applied.hasOwnProperty(key);
            state.applied[key] = status.checkedAt;
            if (!state.online.hasOwnProperty(key)) state.online[key] = null;

            if (status.name && status.name !== player.name) {
                player.name = status.name;
                renamed = true;
            }

            const playing = status.state === 'rust';
            if (playing && !state.online[key]) {
                state.online[key] = Date.now();
                module.exports.logSession(client, guildId, key, player, Date.now(), null);
                if (!firstSeen) {
                    await module.exports.alert(client, guildId, tracker,
                        client.intlGet(guildId, 'trackerAlertStartedRust', { name: player.name }));
                }
            }
            else if (!playing && state.online[key]) {
                const since = state.online[key];
                state.online[key] = null;
                module.exports.logSession(client, guildId, key, player, null, Date.now());
                const duration = Timer.secondsToFullScale(Math.floor((Date.now() - since) / 1000));
                await module.exports.alert(client, guildId, tracker,
                    client.intlGet(guildId, 'trackerAlertStoppedRust', { name: player.name, duration: duration }));
            }
            else if (!playing && firstSeen) {
                /* Close a session left open when the bot stopped while they were playing. */
                module.exports.logSession(client, guildId, key, player, null, Date.now());
            }
        }

        /* Prune state of players removed from the tracker. */
        const trackedKeys = new Set(tracker.players.filter(e => e.steamId !== null).map(e => `${e.steamId}`));
        for (const key of Object.keys(state.applied)) {
            if (!trackedKeys.has(key)) {
                delete state.online[key];
                delete state.applied[key];
            }
        }

        if (renamed) {
            /* Persist updated names on a fresh read, merged so entries removed via the
               Discord modal while we polled are not resurrected. */
            const BattlemetricsHandler = require('./battlemetricsHandler.js');
            const fresh = client.getInstance(guildId);
            if (fresh.trackers.hasOwnProperty(trackerId)) {
                fresh.trackers[trackerId].players = BattlemetricsHandler.mergeTrackerPlayers(
                    fresh.trackers[trackerId].players, tracker.players);
                client.setInstance(guildId, fresh);
            }
        }
    },

    parseAddress: function (queryAddress) {
        /* Accepts 'ip:port' or 'ip port'. */
        const parts = `${queryAddress}`.trim().split(/[ :]/);
        if (parts.length < 2) return [parts[0] !== '' ? parts[0] : null, parts[0] ? 28015 : null];
        return [parts[0], parseInt(parts[1])];
    },

    /***********************************************************************************
     *  Session history (per player times playing Rust, from Steam status)
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

    /* Hours the player spent playing Rust over the last N days (for the embed). */
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

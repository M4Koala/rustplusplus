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

const Config = require('../../config');
const DiscordMessages = require('../discordTools/discordMessages.js');
const GameServerMonitor = require('../structures/GameServerMonitor.js');
const ServerQuery = require('../util/serverQuery.js');
const Timer = require('../util/timer');

/* Online/offline status of each guild's active server, taken from the game server itself
   (Steam server queries, structures/GameServerMonitor.js) instead of the Rust+ connection:
   #activity says the server went up/down the moment players can (no longer) join, while Rust+
   drops with the game server still up stay a Rust+ matter (grace period, state stash, see
   rustplusEvents/disconnected.js). This is the second status source Battlemetrics used to be.

   The query address is looked up via Steam once and kept in the server entry (queryAddress).
   Without one, or while it looks stale (Rust+ connected for a while, yet the query port never
   answered), the Rust+ based announcements take over again. The last announced state is kept
   in the server entry too (gameServerState), so bot restarts neither repeat nor miss one. */

const SYNC_INTERVAL_MS = 2000;
const RESOLVE_RETRY_MS = 60 * 1000;
const STALE_AFTER_MS = 30 * 1000;
const CONFIRMED_OFFLINE_AFTER_MS = 3000;    /* No answer + Rust+ dropped as well. */
const FAST_RECONNECT_WINDOW_MS = 60 * 1000;
const FAST_RECONNECT_INTERVAL_MS = 3000;
const PURGE_KEEP_ONLINE_MESSAGE_MS = 30 * 60 * 1000;

module.exports = {
    SYNC_INTERVAL_MS: SYNC_INTERVAL_MS,

    /* Runs a monitor for the active server of every guild with an active Rust+ instance. */
    sync: function (client) {
        for (const guildItem of client.guilds.cache) {
            const guildId = guildItem[0];
            const instance = client.getInstance(guildId);
            if (!instance) continue;
            let serverId = client.activeRustplusInstances[guildId] ? instance.activeServer : null;
            if (serverId !== null && !instance.serverList.hasOwnProperty(serverId)) serverId = null;

            let entry = client.gameServerStatus[guildId];
            if (entry && entry.serverId !== serverId) {
                stopMonitor(entry);
                delete client.gameServerStatus[guildId];
                entry = undefined;
            }

            /* A state recorded before a server was deactivated is stale by the next time it
               gets connected (a "went online, was offline for 3 weeks" message). */
            clearInactiveStates(client, guildId, serverId);

            if (serverId === null || !Config.general.gameServerMonitor) continue;

            if (!entry) {
                entry = {
                    serverId: serverId,
                    address: instance.serverList[serverId].queryAddress ?? null,
                    monitor: null,
                    trusted: true,
                    resolving: false,
                    lastResolveAt: 0,
                    rustplusUpSince: null,
                    loggedSocketError: false
                };
                client.gameServerStatus[guildId] = entry;
            }

            if (entry.address === null || !entry.trusted) resolveAddress(client, guildId, entry);
            if (entry.address !== null && entry.monitor === null) startMonitor(client, guildId, entry);
            checkStale(client, guildId, entry).catch(e => client.log(client.intlGet(null, 'errorCap'),
                `Game server stale check failed: ${e}`, 'error'));
        }
    },

    /* True while the game server monitor decides online/offline for this server. */
    isAuthoritative: function (client, guildId, serverId) {
        const entry = client.gameServerStatus[guildId];
        return !!(entry && entry.serverId === serverId && entry.monitor && entry.trusted &&
            entry.monitor.online !== null);
    },

    isOnline: function (client, guildId) {
        const entry = client.gameServerStatus[guildId];
        return !!(entry && entry.monitor && entry.monitor.online === true);
    },

    /* Rust+ retries faster right after the game server came up (wipe day). */
    reconnectDelayMs: function (client, guildId) {
        const entry = client.gameServerStatus[guildId];
        if (entry && entry.monitor && entry.monitor.online === true &&
            Date.now() - entry.monitor.changedAt < FAST_RECONNECT_WINDOW_MS) {
            return Math.min(FAST_RECONNECT_INTERVAL_MS, Config.general.reconnectIntervalMs);
        }
        return Config.general.reconnectIntervalMs;
    },

    /* Where a wipe purge of #activity has to stop: the "server went online" message that
       just announced the new wipe is kept. */
    purgeBoundary: function (client, guildId, serverId) {
        const instance = client.getInstance(guildId);
        const state = instance.serverList[serverId] ? instance.serverList[serverId].gameServerState : null;
        if (state && state.online && Date.now() - state.since < PURGE_KEEP_ONLINE_MESSAGE_MS) return state.since;
        return Date.now();
    },

    /* Records and announces the game server state. No-op when it is unchanged, so every
       source (monitor, Rust+ fallback) can report without duplicate messages. */
    setState: async function (client, guildId, serverId, online, since = Date.now()) {
        const instance = client.getInstance(guildId);
        const server = instance.serverList[serverId];
        if (!server) return;

        const previous = server.gameServerState ?? null;
        if (previous && previous.online === online) return;
        server.gameServerState = { online: online, since: since };
        client.setInstance(guildId, instance);

        if (online) kickRustplusReconnect(client, guildId, serverId);

        /* First state ever known: an online server is the baseline, not news. */
        if (previous !== null || !online) {
            const lines = [];
            if (online && previous) {
                const seconds = Math.max(0, Math.floor((since - previous.since) / 1000));
                lines.push(client.intlGet(guildId, 'gameServerWasOfflineFor', {
                    duration: Timer.secondsToFullScale(seconds)
                }));
            }
            if (online && server.connect) lines.push(`\`${server.connect}\``);
            await DiscordMessages.sendServerChangeStateMessage(guildId, serverId, online ? 0 : 1,
                lines.length !== 0 ? lines.join('\n') : null);
        }

        await DiscordMessages.sendServerMessage(guildId, serverId, client.rustplusReconnecting[guildId] ? 2 : null);
    },
};

function startMonitor(client, guildId, entry) {
    const [host, port] = entry.address.split(':');
    const monitor = new GameServerMonitor(host, port, {
        intervalMs: Config.general.gameServerPollIntervalMs,
        fastIntervalMs: Config.general.gameServerFastPollIntervalMs,
        offlineAfterMs: Config.general.gameServerOfflineAfterMs,
        confirmedOfflineAfterMs: CONFIRMED_OFFLINE_AFTER_MS,
        isConfirmedDown: () => !isRustplusOpen(client, guildId, entry.serverId)
    });

    monitor.on('change', (online, reason) => {
        onMonitorChange(client, guildId, entry, monitor, online, reason).catch(e => client.log(
            client.intlGet(null, 'errorCap'), `Game server status update failed: ${e}`, 'error'));
    });
    monitor.on('socketError', (e) => {
        if (entry.loggedSocketError) return;
        entry.loggedSocketError = true;
        client.log(client.intlGet(null, 'warningCap'), `Game server query ${entry.address}: ${e.message}`);
    });

    entry.monitor = monitor;
    monitor.start();
}

function stopMonitor(entry) {
    if (entry.monitor) entry.monitor.stop();
    entry.monitor = null;
}

async function onMonitorChange(client, guildId, entry, monitor, online, reason) {
    if (client.gameServerStatus[guildId] !== entry || entry.monitor !== monitor) return;

    if (online) {
        entry.trusted = true;
        fillConnect(client, guildId, entry.serverId, monitor);
    }
    else if (!entry.trusted) {
        return;
    }

    client.log(client.intlGet(null, 'infoCap'),
        `Game server ${entry.address} ${online ? 'online' : 'offline'} (${reason})`);

    /* Offline since the last answer, the best estimate of when it went down. */
    const since = online ? monitor.changedAt : (monitor.lastAnswerAt ?? monitor.changedAt);
    await module.exports.setState(client, guildId, entry.serverId, online, since);
}

/* Steam lists the query port of every server on an IP; retried while unknown or stale. */
function resolveAddress(client, guildId, entry) {
    if (entry.resolving || Date.now() - entry.lastResolveAt < RESOLVE_RETRY_MS) return;

    const server = client.getInstance(guildId).serverList[entry.serverId];
    entry.resolving = true;
    entry.lastResolveAt = Date.now();

    ServerQuery.forPairedServer(server.serverIp, server.appPort, RESOLVE_RETRY_MS).then(address => {
        entry.resolving = false;
        if (client.gameServerStatus[guildId] !== entry || !address || address === entry.address) return;

        client.log(client.intlGet(null, 'infoCap'), `Game server query address: ${address}`);
        stopMonitor(entry);
        entry.address = address;
        entry.trusted = true;
        entry.loggedSocketError = false;

        const instance = client.getInstance(guildId);
        if (instance.serverList.hasOwnProperty(entry.serverId)) {
            instance.serverList[entry.serverId].queryAddress = address;
            client.setInstance(guildId, instance);
        }
        startMonitor(client, guildId, entry);
    }).catch(() => {
        entry.resolving = false;
    });
}

/* Rust+ connected means the server is up. If the query port stayed silent all along, the
   address is wrong or our queries are blocked: stop trusting it until it answers. */
async function checkStale(client, guildId, entry) {
    if (!entry.monitor || !entry.trusted) return;

    if (!isRustplusOpen(client, guildId, entry.serverId)) {
        entry.rustplusUpSince = null;
        return;
    }
    entry.rustplusUpSince ??= Date.now();
    if (Date.now() - entry.rustplusUpSince < STALE_AFTER_MS || entry.monitor.silenceMs() < STALE_AFTER_MS) return;

    entry.trusted = false;
    entry.lastResolveAt = 0;
    client.log(client.intlGet(null, 'warningCap'),
        `Game server query ${entry.address} does not answer while Rust+ is connected, falling back to Rust+`);
    await module.exports.setState(client, guildId, entry.serverId, true);
}

function clearInactiveStates(client, guildId, activeServerId) {
    const instance = client.getInstance(guildId);
    let changed = false;
    for (const [serverId, server] of Object.entries(instance.serverList)) {
        if (serverId !== activeServerId && server.gameServerState) {
            delete server.gameServerState;
            changed = true;
        }
    }
    if (changed) client.setInstance(guildId, instance);
}

function isRustplusOpen(client, guildId, serverId) {
    const rustplus = client.rustplusInstances[guildId];
    return !!(rustplus && rustplus.serverId === serverId && rustplus.websocket &&
        rustplus.websocket.readyState === 1);
}

/* Rust+ waits out its retry interval; the game server being up is reason to try now. */
function kickRustplusReconnect(client, guildId, serverId) {
    if (!client.rustplusReconnecting[guildId] || !client.rustplusReconnectTimers[guildId]) return;
    require('../rustplusEvents/disconnected.js').scheduleReconnect(client, guildId, serverId, 0);
}

/* Without Battlemetrics the server card has no connect command; the query answer has the port. */
function fillConnect(client, guildId, serverId, monitor) {
    const gamePort = monitor.info ? monitor.info.gamePort : null;
    if (!gamePort) return;

    const instance = client.getInstance(guildId);
    const server = instance.serverList[serverId];
    if (!server || server.connect) return;
    server.connect = `connect ${monitor.host}:${gamePort}`;
    client.setInstance(guildId, instance);
}

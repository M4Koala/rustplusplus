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

const DiscordMessages = require('../discordTools/discordMessages.js');
const GameServerStatusHandler = require('../handlers/gameServerStatusHandler.js');

const Config = require('../../config');

module.exports = {
    name: 'disconnected',
    async execute(rustplus, client) {
        if (!rustplus.isServerAvailable() && !rustplus.isDeleted) {
            rustplus.deleteThisRustplusInstance();
        }

        rustplus.log(client.intlGet(null, 'disconnectedCap'), client.intlGet(null, 'disconnectedFromServer'));

        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;
        const wasOperational = rustplus.isOperational;
        rustplus.isOperational = false;

        if (rustplus.leaderRustPlusInstance !== null) {
            if (client.rustplusLiteReconnectTimers[guildId]) {
                clearTimeout(client.rustplusLiteReconnectTimers[guildId]);
                client.rustplusLiteReconnectTimers[guildId] = null;
            }
            rustplus.leaderRustPlusInstance.isActive = false;
            rustplus.leaderRustPlusInstance.disconnect();
            rustplus.leaderRustPlusInstance = null;
        }

        /* Stop current tasks */
        clearInterval(rustplus.pollingTaskId);
        clearInterval(rustplus.tokensReplenishTaskId);
        clearTimeout(rustplus.inGameChatTimeout);
        rustplus.inGameChatTimeout = null;

        /* Will the bot try to reconnect to this server? */
        const isReconnecting = !rustplus.isDeleted && client.activeRustplusInstances[guildId];

        if (isReconnecting && wasOperational) {
            /* Unexpected disconnect of an operational session. Stash the runtime state (team
               AFK-timers, locked crate/cargo timers, custom timers, in-game time tracking, ...)
               so it can be carried over when the reconnection succeeds. The timers are kept
               running, their discord notifications still work while disconnected. */
            if (client.rustplusStashes[guildId] && client.rustplusStashes[guildId].rustplus !== rustplus) {
                client.discardRustplusStash(guildId);
            }
            client.rustplusStashes[guildId] = {
                serverId: serverId,
                stashedAt: Date.now(),
                rustplus: rustplus
            };
        }
        else {
            /* Deliberate disconnect. Reset map markers, timers & arrays. */
            if (rustplus.mapMarkers) rustplus.mapMarkers.reset();

            /* Stop all custom timers */
            for (const [id, timer] of Object.entries(rustplus.timers)) timer.timer.stop();
        }

        if (rustplus.isDeleted) return;

        /* Was the disconnection unexpected? */
        if (client.activeRustplusInstances[guildId]) {
            if (!client.rustplusReconnecting[guildId]) {
                client.rustplusReconnecting[guildId] = true;
                client.rustplusFirstDisconnectTime[guildId] = Date.now();

                /* Show RECONNECTING on the server embed immediately, but delay the announcement
                   by the grace period to avoid spam on short connection blips. */
                await DiscordMessages.sendServerMessage(guildId, serverId, 2);
            }

            const firstDisconnectTime = client.rustplusFirstDisconnectTime[guildId] ?? Date.now();
            const graceOver = (Date.now() - firstDisconnectTime) >= Config.general.offlineGracePeriodMs;
            if (!client.rustplusOfflineAnnounced[guildId]) {
                if (GameServerStatusHandler.isAuthoritative(client, guildId, serverId)) {
                    /* The game server monitor announces real outages the moment they happen.
                       Left to report here: Rust+ down while the game server stays up. */
                    if (graceOver && GameServerStatusHandler.isOnline(client, guildId)) {
                        client.rustplusOfflineAnnounced[guildId] = 'lost';
                        await DiscordMessages.sendServerChangeStateMessage(guildId, serverId, 2);
                    }
                }
                else {
                    /* No game server status: announce offline immediately when battlemetrics
                       confirms the server is down, otherwise after the grace period so that pure
                       connection blips stay silent. Battlemetrics refreshes every 60 seconds. */
                    const bmOnline = module.exports.isServerOnlineBattlemetrics(client, guildId, serverId);
                    if (bmOnline === true && graceOver) {
                        client.rustplusOfflineAnnounced[guildId] = 'lost';
                        await DiscordMessages.sendServerChangeStateMessage(guildId, serverId, 2);
                    }
                    else if (bmOnline === false || graceOver) {
                        client.rustplusOfflineAnnounced[guildId] = 'offline';
                        await GameServerStatusHandler.setState(client, guildId, serverId, false, firstDisconnectTime);
                    }
                }
            }

            rustplus.log(client.intlGet(null, 'reconnectingCap'), client.intlGet(null, 'reconnectingToServer'));

            delete client.rustplusInstances[guildId];

            module.exports.scheduleReconnect(client, guildId, serverId,
                GameServerStatusHandler.reconnectDelayMs(client, guildId));
        }
    },

    scheduleReconnect: function (client, guildId, serverId, delayMs) {
        if (client.rustplusReconnectTimers[guildId]) {
            clearTimeout(client.rustplusReconnectTimers[guildId]);
            client.rustplusReconnectTimers[guildId] = null;
        }

        client.rustplusReconnectTimers[guildId] = setTimeout(() => {
            client.rustplusReconnectTimers[guildId] = null;

            /* Read the current server data at reconnect time, the playerToken might have
               been refreshed by a new pairing while offline (e.g. after a wipe). */
            const currentInstance = client.getInstance(guildId);
            if (!currentInstance || !currentInstance.serverList.hasOwnProperty(serverId)) return;

            const server = currentInstance.serverList[serverId];
            client.createRustplusInstance(
                guildId, server.serverIp, server.appPort, server.steamId, server.playerToken);
        }, delayMs);
    },

    isServerOnlineBattlemetrics: function (client, guildId, serverId) {
        /* Returns true/false based on battlemetrics server status, or null when unknown. */
        const instance = client.getInstance(guildId);
        const server = instance ? instance.serverList[serverId] : null;
        if (!server || server.battlemetricsId === null) return null;

        const bmInstance = client.battlemetricsInstances[server.battlemetricsId];
        if (!bmInstance || !bmInstance.lastUpdateSuccessful) return null;

        return bmInstance.server_status === 'online';
    },
};

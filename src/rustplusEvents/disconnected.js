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

                /* Show RECONNECTING on the server embed immediately, but delay the offline
                   announcement by the grace period to avoid spam on short connection blips. */
                await DiscordMessages.sendServerMessage(guildId, serverId, 2);
            }

            /* Announce offline once the connection stayed down past the grace period. */
            const firstDisconnectTime = client.rustplusFirstDisconnectTime[guildId] ?? Date.now();
            if (!client.rustplusOfflineAnnounced[guildId] &&
                (Date.now() - firstDisconnectTime) >= Config.general.offlineGracePeriodMs) {
                client.rustplusOfflineAnnounced[guildId] = true;

                /* Use battlemetrics as a second opinion on the server status. If the server is
                   reported as online, the rust+ connection is broken rather than the server. */
                const state = (module.exports.isServerOnlineBattlemetrics(client, guildId, serverId) === true) ?
                    2 : 1;
                await DiscordMessages.sendServerChangeStateMessage(guildId, serverId, state);
            }

            rustplus.log(client.intlGet(null, 'reconnectingCap'), client.intlGet(null, 'reconnectingToServer'));

            delete client.rustplusInstances[guildId];

            if (client.rustplusReconnectTimers[guildId]) {
                clearTimeout(client.rustplusReconnectTimers[guildId]);
                client.rustplusReconnectTimers[guildId] = null;
            }

            client.rustplusReconnectTimers[guildId] = setTimeout(
                client.createRustplusInstance.bind(client),
                Config.general.reconnectIntervalMs,
                guildId,
                rustplus.server,
                rustplus.port,
                rustplus.playerId,
                rustplus.playerToken
            );
        }
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

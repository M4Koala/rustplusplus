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

const Constants = require('../util/constants.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const DiscordTools = require('../discordTools/discordTools.js');
const Info = require('../structures/Info');
const InGameChatHandler = require('../handlers/inGameChatHandler.js');
const Map = require('../structures/Map');
const PollingHandler = require('../handlers/pollingHandler.js');

module.exports = {
    name: 'connected',
    async execute(rustplus, client) {
        if (!rustplus.isServerAvailable()) return rustplus.deleteThisRustplusInstance();

        rustplus.log(client.intlGet(null, 'connectedCap'), client.intlGet(null, 'connectedToServer'));

        const instance = client.getInstance(rustplus.guildId);
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;

        rustplus.uptimeServer = new Date();

        /* Handle the reconnection bookkeeping immediately at socket connect, so that the
           online announcement is as fast as possible (before the slow map request). Important
           to be among the first to join after a wipe/server restart. */
        if (client.rustplusReconnecting[guildId]) {
            client.rustplusReconnecting[guildId] = false;

            if (client.rustplusReconnectTimers[guildId]) {
                clearTimeout(client.rustplusReconnectTimers[guildId]);
                client.rustplusReconnectTimers[guildId] = null;
            }

            /* Only announce online when offline was announced, short connection blips within
               the grace period stay silent. */
            if (client.rustplusOfflineAnnounced[guildId]) {
                await DiscordMessages.sendServerChangeStateMessage(guildId, serverId, 0);
            }
        }
        client.rustplusOfflineAnnounced[guildId] = false;
        client.rustplusFirstDisconnectTime[guildId] = null;

        /* Start the token replenish task */
        rustplus.tokensReplenishTaskId = setInterval(rustplus.replenishTokens.bind(rustplus), 1000);

        /* Request the map. Act as a check to see if connection is truly operational. */
        const map = await rustplus.getMapAsync(3 * 60 * 1000); /* 3 min timeout */
        if (!(await rustplus.isResponseValid(map))) {
            rustplus.log(client.intlGet(null, 'errorCap'),
                client.intlGet(null, 'somethingWrongWithConnection'), 'error');

            /* During an automatic reconnect, keep the reconnect loop alive unless the server
               explicitly rejected the request (e.g. invalid playerToken after a full wipe),
               the server might just still be flaky or restarting. Actively selected
               connections (CONNECT button) always abort so a bad server setup is reported. */
            const isRejected = (map !== undefined && typeof map === 'object' && map.hasOwnProperty('error'));
            if (!rustplus.isNewConnection && client.activeRustplusInstances[guildId] && !isRejected) {
                rustplus.disconnect();
                return;
            }

            instance.activeServer = null;
            client.setInstance(guildId, instance);

            await DiscordMessages.sendServerConnectionInvalidMessage(guildId, serverId);
            await DiscordMessages.sendServerMessage(guildId, serverId, null);

            client.resetRustplusVariables(guildId);

            rustplus.disconnect();
            delete client.rustplusInstances[guildId];
            return;
        }
        rustplus.log(client.intlGet(null, 'connectedCap'), client.intlGet(null, 'rustplusOperational'));

        const info = await rustplus.getInfoAsync();
        if (await rustplus.isResponseValid(info)) rustplus.info = new Info(info.info)

        const wipeDetected = client.rustplusMaps.hasOwnProperty(guildId) &&
            client.isJpgImageChanged(guildId, map.map);

        /* Restore the state stashed at the previous unexpected disconnect, so that AFK-timers,
           locked crate/cargo timers, custom timers and in-game time tracking survive. */
        const stash = client.rustplusStashes[guildId];
        if (stash && stash.serverId === serverId && !rustplus.isNewConnection && !wipeDetected &&
            (Date.now() - stash.stashedAt) < Constants.MAX_STATE_STASH_AGE_MS) {
            restoreStashedState(client, rustplus, stash);
            delete client.rustplusStashes[guildId];

            rustplus.log(client.intlGet(null, 'connectedCap'), client.intlGet(null, 'reconnectedStateRestored'));
        }
        else if (stash) {
            client.discardRustplusStash(guildId);
        }

        /* On a fresh wipe (connected to another server than last time, or a map wipe was
           detected) throw out the previous wipe's history from the events, teamchat, activity
           and information channels. The channels are purged in place (never replaced), so
           their ids, positions and permissions survive the wipe. The purges run in the
           background and only touch messages from before this point in time, so the new
           wipe's messages posted below are safe. */
        if (wipeDetected || (rustplus.isNewConnection && instance.lastConnectedServerId !== serverId)) {
            DiscordTools.purgeTextChannel(guildId, 'events');
            DiscordTools.purgeTextChannel(guildId, 'teamchat');
            DiscordTools.purgeTextChannel(guildId, 'activity');
            await DiscordTools.clearInformationChannel(guildId);
        }
        if (instance.lastConnectedServerId !== serverId) {
            instance.lastConnectedServerId = serverId;
            client.setInstance(guildId, instance);
        }

        rustplus.map = new Map(map.map, rustplus);
        await rustplus.map.writeMap(false, true);
        if (wipeDetected) await DiscordMessages.sendServerWipeDetectedMessage(guildId, serverId);
        await DiscordMessages.sendInformationMapMessage(guildId);

        await DiscordMessages.sendServerMessage(guildId, serverId, null);

        /* Setup Smart Devices */
        await require('../discordTools/SetupSwitches')(client, rustplus);
        await require('../discordTools/SetupSwitchGroups')(client, rustplus);
        await require('../discordTools/SetupAlarms')(client, rustplus);
        await require('../discordTools/SetupStorageMonitors')(client, rustplus);
        rustplus.isNewConnection = false;
        rustplus.loadMarkers();

        await PollingHandler.pollingHandler(rustplus, client);
        rustplus.pollingTaskId = setInterval(PollingHandler.pollingHandler, client.pollingIntervalMs, rustplus, client);
        rustplus.isOperational = true;

        /* Flush in-game messages that were queued while disconnected. */
        if (rustplus.inGameChatQueue.length !== 0 && rustplus.inGameChatTimeout === null) {
            InGameChatHandler.inGameChatHandler(rustplus, client);
        }

        rustplus.updateLeaderRustPlusLiteInstance();
    },
};

function restoreStashedState(client, rustplus, stash) {
    const old = stash.rustplus;

    /* Take over the runtime structures of the previous instance and re-bind their internal
       rustplus references to the new instance. Their timers are still running. */
    if (old.time) {
        rustplus.time = old.time;
        rustplus.time.rustplus = rustplus;
    }
    if (old.team) {
        rustplus.team = old.team;
        rustplus.team.rustplus = rustplus;
        for (const player of rustplus.team.players) {
            player.rustplus = rustplus;
        }
    }
    if (old.mapMarkers) {
        rustplus.mapMarkers = old.mapMarkers;
        rustplus.mapMarkers.rustplus = rustplus;
    }

    /* In-game time tracking */
    rustplus.passedFirstSunriseOrSunset = old.passedFirstSunriseOrSunset;
    rustplus.startTimeObject = old.startTimeObject;
    rustplus.stateRestoredAt = stash.stashedAt;

    /* Histories & misc state */
    rustplus.storageMonitors = old.storageMonitors;
    rustplus.events = old.events;
    rustplus.allConnections = old.allConnections;
    rustplus.playerConnections = old.playerConnections;
    rustplus.allDeaths = old.allDeaths;
    rustplus.playerDeaths = old.playerDeaths;
    rustplus.firstPollItems = old.firstPollItems;
    rustplus.foundSubscriptionItems = old.foundSubscriptionItems;
    rustplus.inGameChatQueue = old.inGameChatQueue;
    rustplus.messagesSentByBot = old.messagesSentByBot;
    rustplus.uptimeServer = old.uptimeServer;

    /* Re-create the custom timers on the new instance with their remaining time. Timers that
       expired while disconnected already queued their message in inGameChatQueue. */
    for (const [id, content] of Object.entries(old.timers)) {
        if (!content.timer.getStateRunning()) continue;

        const remainingMs = content.timer.getTimeLeft();
        content.timer.stop();
        if (remainingMs <= 0) continue;
        rustplus.addCustomTimer(parseInt(id), content.message, remainingMs);
    }
    old.timers = new Object();
}

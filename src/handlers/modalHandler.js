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

const Discord = require('discord.js');

const Battlemetrics = require('../structures/Battlemetrics');
const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const Keywords = require('../util/keywords.js');
const Scrape = require('../util/scrape.js');

module.exports = async (client, interaction) => {
    const instance = client.getInstance(interaction.guildId);
    const guildId = interaction.guildId;

    const verifyId = Math.floor(100000 + Math.random() * 900000);
    client.logInteraction(interaction, verifyId, 'userModal');

    if (instance.blacklist['discordIds'].includes(interaction.user.id) &&
        !interaction.member.permissions.has(Discord.PermissionsBitField.Flags.Administrator)) {
        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userPartOfBlacklist', {
            id: `${verifyId}`,
            user: `${interaction.user.username} (${interaction.user.id})`
        }));
        return;
    }

    if (interaction.customId.startsWith('CustomTimersEdit')) {
        const ids = JSON.parse(interaction.customId.replace('CustomTimersEdit', ''));
        const server = instance.serverList[ids.serverId];
        const cargoShipEgressTime = parseInt(interaction.fields.getTextInputValue('CargoShipEgressTime'));
        const oilRigCrateUnlockTime = parseInt(interaction.fields.getTextInputValue('OilRigCrateUnlockTime'));

        if (!server) {
            interaction.deferUpdate();
            return;
        }

        if (cargoShipEgressTime && ((cargoShipEgressTime * 1000) !== server.cargoShipEgressTimeMs)) {
            server.cargoShipEgressTimeMs = cargoShipEgressTime * 1000;
        }
        if (oilRigCrateUnlockTime && ((oilRigCrateUnlockTime * 1000) !== server.oilRigLockedCrateUnlockTimeMs)) {
            server.oilRigLockedCrateUnlockTimeMs = oilRigCrateUnlockTime * 1000;
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${server.cargoShipEgressTimeMs}, ${server.oilRigLockedCrateUnlockTimeMs}`
        }));
    }
    else if (interaction.customId.startsWith('ServerEdit')) {
        const ids = JSON.parse(interaction.customId.replace('ServerEdit', ''));
        const server = instance.serverList[ids.serverId];
        const battlemetricsId = interaction.fields.getTextInputValue('ServerBattlemetricsId');

        if (battlemetricsId !== server.battlemetricsId) {
            if (battlemetricsId === '') {
                server.battlemetricsId = null;
            }
            else if (client.battlemetricsInstances.hasOwnProperty(battlemetricsId)) {
                const bmInstance = client.battlemetricsInstances[battlemetricsId];
                server.battlemetricsId = battlemetricsId;
                server.connect = `connect ${bmInstance.server_ip}:${bmInstance.server_port}`;
            }
            else {
                const bmInstance = new Battlemetrics(battlemetricsId);
                await bmInstance.setup();
                if (bmInstance.lastUpdateSuccessful) {
                    client.battlemetricsInstances[battlemetricsId] = bmInstance;
                    server.battlemetricsId = battlemetricsId;
                    server.connect = `connect ${bmInstance.server_ip}:${bmInstance.server_port}`;
                }
            }
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${server.battlemetricsId}`
        }));

        await DiscordMessages.sendServerMessage(interaction.guildId, ids.serverId);

        /* To force search of player name via scrape */
        client.battlemetricsIntervalCounter = 0;
    }
    else if (interaction.customId.startsWith('SmartSwitchEdit')) {
        const ids = JSON.parse(interaction.customId.replace('SmartSwitchEdit', ''));
        const server = instance.serverList[ids.serverId];
        const smartSwitchName = interaction.fields.getTextInputValue('SmartSwitchName');
        const smartSwitchCommand = interaction.fields.getTextInputValue('SmartSwitchCommand');
        let smartSwitchProximity = null;
        try {
            smartSwitchProximity = parseInt(interaction.fields.getTextInputValue('SmartSwitchProximity'));
        }
        catch (e) {
            smartSwitchProximity = null;
        }
        let smartSwitchPulse = null;
        try {
            smartSwitchPulse = parseInt(interaction.fields.getTextInputValue('SmartSwitchPulse'));
        }
        catch (e) {
            smartSwitchPulse = null;
        }

        if (!server || (server && !server.switches.hasOwnProperty(ids.entityId))) {
            interaction.deferUpdate();
            return;
        }

        server.switches[ids.entityId].name = smartSwitchName;

        if (smartSwitchCommand !== server.switches[ids.entityId].command &&
            !Keywords.getListOfUsedKeywords(client, guildId, ids.serverId).includes(smartSwitchCommand)) {
            server.switches[ids.entityId].command = smartSwitchCommand;
        }

        if (smartSwitchProximity !== null && smartSwitchProximity >= 0) {
            server.switches[ids.entityId].proximity = smartSwitchProximity;
        }

        if (smartSwitchPulse !== null && smartSwitchPulse >= 0) {
            server.switches[ids.entityId].pulseSeconds = smartSwitchPulse;
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${smartSwitchName}, ${server.switches[ids.entityId].command}`
        }));

        await DiscordMessages.sendSmartSwitchMessage(guildId, ids.serverId, ids.entityId);
    }
    else if (interaction.customId.startsWith('GroupEdit')) {
        const ids = JSON.parse(interaction.customId.replace('GroupEdit', ''));
        const server = instance.serverList[ids.serverId];
        const groupName = interaction.fields.getTextInputValue('GroupName');
        const groupCommand = interaction.fields.getTextInputValue('GroupCommand');

        if (!server || (server && !server.switchGroups.hasOwnProperty(ids.groupId))) {
            interaction.deferUpdate();
            return;
        }

        server.switchGroups[ids.groupId].name = groupName;

        if (groupCommand !== server.switchGroups[ids.groupId].command &&
            !Keywords.getListOfUsedKeywords(client, interaction.guildId, ids.serverId).includes(groupCommand)) {
            server.switchGroups[ids.groupId].command = groupCommand;
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${groupName}, ${server.switchGroups[ids.groupId].command}`
        }));

        await DiscordMessages.sendSmartSwitchGroupMessage(interaction.guildId, ids.serverId, ids.groupId);
    }
    else if (interaction.customId.startsWith('GroupAddSwitch')) {
        const ids = JSON.parse(interaction.customId.replace('GroupAddSwitch', ''));
        const server = instance.serverList[ids.serverId];
        const switchId = interaction.fields.getTextInputValue('GroupAddSwitchId');

        if (!server || (server && !server.switchGroups.hasOwnProperty(ids.groupId))) {
            interaction.deferUpdate();
            return;
        }

        if (!Object.keys(server.switches).includes(switchId) ||
            server.switchGroups[ids.groupId].switches.includes(switchId)) {
            interaction.deferUpdate();
            return;
        }

        server.switchGroups[ids.groupId].switches.push(switchId);
        client.setInstance(interaction.guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${switchId}`
        }));

        await DiscordMessages.sendSmartSwitchGroupMessage(interaction.guildId, ids.serverId, ids.groupId);
    }
    else if (interaction.customId.startsWith('GroupRemoveSwitch')) {
        const ids = JSON.parse(interaction.customId.replace('GroupRemoveSwitch', ''));
        const server = instance.serverList[ids.serverId];
        const switchId = interaction.fields.getTextInputValue('GroupRemoveSwitchId');

        if (!server || (server && !server.switchGroups.hasOwnProperty(ids.groupId))) {
            interaction.deferUpdate();
            return;
        }

        server.switchGroups[ids.groupId].switches =
            server.switchGroups[ids.groupId].switches.filter(e => e !== switchId);
        client.setInstance(interaction.guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${switchId}`
        }));

        await DiscordMessages.sendSmartSwitchGroupMessage(interaction.guildId, ids.serverId, ids.groupId);
    }
    else if (interaction.customId.startsWith('SmartAlarmEdit')) {
        const ids = JSON.parse(interaction.customId.replace('SmartAlarmEdit', ''));
        const server = instance.serverList[ids.serverId];
        const smartAlarmName = interaction.fields.getTextInputValue('SmartAlarmName');
        const smartAlarmMessage = interaction.fields.getTextInputValue('SmartAlarmMessage');
        const smartAlarmCommand = interaction.fields.getTextInputValue('SmartAlarmCommand');

        if (!server || (server && !server.alarms.hasOwnProperty(ids.entityId))) {
            interaction.deferUpdate();
            return;
        }

        server.alarms[ids.entityId].name = smartAlarmName;
        server.alarms[ids.entityId].message = smartAlarmMessage;

        if (smartAlarmCommand !== server.alarms[ids.entityId].command &&
            !Keywords.getListOfUsedKeywords(client, guildId, ids.serverId).includes(smartAlarmCommand)) {
            server.alarms[ids.entityId].command = smartAlarmCommand;
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${smartAlarmName}, ${smartAlarmMessage}, ${server.alarms[ids.entityId].command}`
        }));

        await DiscordMessages.sendSmartAlarmMessage(interaction.guildId, ids.serverId, ids.entityId);
    }
    else if (interaction.customId.startsWith('StorageMonitorEdit')) {
        const ids = JSON.parse(interaction.customId.replace('StorageMonitorEdit', ''));
        const server = instance.serverList[ids.serverId];
        const storageMonitorName = interaction.fields.getTextInputValue('StorageMonitorName');

        if (!server || (server && !server.storageMonitors.hasOwnProperty(ids.entityId))) {
            interaction.deferUpdate();
            return;
        }

        server.storageMonitors[ids.entityId].name = storageMonitorName;
        client.setInstance(interaction.guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${storageMonitorName}`
        }));

        await DiscordMessages.sendStorageMonitorMessage(interaction.guildId, ids.serverId, ids.entityId);
    }
    else if (interaction.customId.startsWith('TrackerEdit')) {
        const ids = JSON.parse(interaction.customId.replace('TrackerEdit', ''));
        const tracker = instance.trackers[ids.trackerId];
        const trackerName = interaction.fields.getTextInputValue('TrackerName');
        const trackerBattlemetricsId = interaction.fields.getTextInputValue('TrackerBattlemetricsId');
        const trackerClanTag = interaction.fields.getTextInputValue('TrackerClanTag');

        if (!tracker) {
            interaction.deferUpdate();
            return;
        }

        tracker.name = trackerName;
        if (trackerClanTag !== tracker.clanTag) {
            tracker.clanTag = trackerClanTag;
            client.battlemetricsIntervalCounter = 0;
        }

        const trackerQueryAddress = (interaction.fields.getTextInputValue('TrackerQueryAddress') ?? '').trim();
        if (trackerQueryAddress !== '') {
            if (/^[A-Za-z0-9_.:-]+$/.test(trackerQueryAddress)) {
                const normalized = trackerQueryAddress.includes(':') ?
                    trackerQueryAddress : `${trackerQueryAddress}:28015`;
                if (normalized !== (tracker.queryAddress ?? null)) {
                    tracker.queryAddress = normalized;
                    /* Reset live state so the next poll re-baselines against the new server. */
                    if (client.serverQueryState) delete client.serverQueryState[ids.trackerId];
                }
            }
        }
        else if (tracker.queryAddress) {
            tracker.queryAddress = null;
        }

        if (trackerBattlemetricsId !== tracker.battlemetricsId) {
            if (client.battlemetricsInstances.hasOwnProperty(trackerBattlemetricsId)) {
                const bmInstance = client.battlemetricsInstances[trackerBattlemetricsId];
                tracker.battlemetricsId = trackerBattlemetricsId;
                tracker.serverId = `${bmInstance.server_ip}-${bmInstance.server_port}`;
                tracker.img = Constants.DEFAULT_SERVER_IMG;
                tracker.title = bmInstance.server_name;
            }
            else {
                const bmInstance = new Battlemetrics(trackerBattlemetricsId);
                await bmInstance.setup();
                if (bmInstance.lastUpdateSuccessful) {
                    client.battlemetricsInstances[trackerBattlemetricsId] = bmInstance;
                    tracker.battlemetricsId = trackerBattlemetricsId;
                    tracker.serverId = `${bmInstance.server_ip}-${bmInstance.server_port}`;
                    tracker.img = Constants.DEFAULT_SERVER_IMG;
                    tracker.title = bmInstance.server_name;
                }
            }
        }
        client.setInstance(guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${trackerName}, ${tracker.battlemetricsId}, ${tracker.clanTag}`
        }));

        await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
    }
    else if (interaction.customId === 'TrackerResolver') {
        const PlayerResolver = require('../util/playerResolver.js');
        const DiscordButtons = require('../discordTools/discordButtons.js');

        const name = (interaction.fields.getTextInputValue('TrackerResolveName') ?? '').trim();
        if (name === '') {
            interaction.deferUpdate();
            return;
        }

        /* Querying the servers takes seconds; Discord drops a modal not answered within 3 s. */
        await interaction.deferReply({ ephemeral: true });

        const { candidates, errors } = await PlayerResolver.resolveName(client, interaction.guildId, name);

        if (candidates.length === 0) {
            let str = client.intlGet(interaction.guildId, 'lookupNotFound', { name: name });
            if (errors.length !== 0) {
                str += `\n${client.intlGet(interaction.guildId, 'lookupErrors')}: ${errors.join(', ')}`;
            }
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            return;
        }

        const shown = candidates.slice(0, 10);
        if (!client.resolverPending) client.resolverPending = {};
        client.resolverPending[interaction.user.id] = { ts: Date.now(), candidates: shown };

        const lines = shown.map((e, i) =>
            `**${i + 1}. ${e.name}** — ${e.server}, ${Math.round(e.time / 60)} min`);

        const buttons = shown.map((e, i) => DiscordButtons.getButton({
            label: `#${i + 1} ${`${e.name}`.slice(0, 40)}`,
            style: Discord.ButtonStyle.Primary,
            customId: `TrackerResolveAdd${JSON.stringify({ u: interaction.user.id, i: i })}`
        }));

        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new Discord.ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }

        await client.interactionEditReply(interaction, {
            embeds: [DiscordEmbeds.getEmbed({
                color: Constants.COLOR_SETTINGS,
                title: client.intlGet(interaction.guildId, 'lookupTitle', { name: name }),
                description: `${lines.join('\n')}\n\n${client.intlGet(interaction.guildId, 'lookupHowTo')}`
            })],
            components: rows
        });
    }
    else if (interaction.customId.startsWith('TrackerAddPlayer')) {
        const ids = JSON.parse(interaction.customId.replace('TrackerAddPlayer', ''));
        const tracker = instance.trackers[ids.trackerId];
        const input = interaction.fields.getTextInputValue('TrackerAddPlayerId').trim();

        if (!tracker) {
            interaction.deferUpdate();
            return;
        }

        /* The Steam lookups below can take longer than Discord's 3 s modal window. */
        await interaction.deferUpdate();

        const bmInstance = client.battlemetricsInstances[tracker.battlemetricsId];

        /* Steam links and custom URL names are resolved to the SteamID64. With Battlemetrics,
           any other value that is not a SteamID64 is taken as a BM player ID. */
        const isLink = /steamcommunity\.com\//i.test(input);
        let profile = null;
        if (isLink || !bmInstance || /^\d{17}$/.test(input)) {
            try {
                profile = await Scrape.resolveSteamProfile(input);
            }
            catch (e) {
                await interaction.followUp({
                    embeds: DiscordEmbeds.getActionInfoEmbed(1,
                        client.intlGet(guildId, 'trackerAddPlayerSteamDown')).embeds,
                    ephemeral: true
                });
                return;
            }
        }
        const isSteamId64 = profile !== null;
        const id = profile ? profile.steamId : input;

        if (!isSteamId64 && (isLink || !bmInstance)) {
            await interaction.followUp({
                embeds: DiscordEmbeds.getActionInfoEmbed(1,
                    client.intlGet(guildId, 'trackerAddPlayerNotSteamId', { id: input })).embeds,
                ephemeral: true
            });
            return;
        }

        if ((isSteamId64 && tracker.players.some(e => e.steamId === id)) ||
            (!isSteamId64 && tracker.players.some(e => e.playerId === id && e.steamId === null))) {
            return;
        }

        let name = null;
        let steamId = null;
        let playerId = null;

        if (isSteamId64) {
            steamId = id;
            name = profile.name ?? await Scrape.scrapeSteamProfileName(client, id);

            /* Server-query trackers match by name, so an entry without one could never be seen. */
            if (!name && tracker.queryAddress) {
                await interaction.followUp({
                    embeds: DiscordEmbeds.getActionInfoEmbed(1,
                        client.intlGet(guildId, 'trackerAddPlayerSteamDown')).embeds,
                    ephemeral: true
                });
                return;
            }

            if (name && bmInstance) {
                playerId = Object.keys(bmInstance.players).find(e => bmInstance.players[e]['name'] === name);
                if (!playerId) playerId = null;
            }
        }
        else {
            playerId = id;
            if (bmInstance.players.hasOwnProperty(id)) {
                name = bmInstance.players[id]['name'];
            }
            else {
                name = '-';
            }
        }

        tracker.players.push({
            name: name,
            steamId: steamId,
            playerId: playerId
        });
        client.setInstance(interaction.guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${id}`
        }));

        await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
    }
    else if (interaction.customId.startsWith('TrackerRemovePlayer')) {
        const ids = JSON.parse(interaction.customId.replace('TrackerRemovePlayer', ''));
        const tracker = instance.trackers[ids.trackerId];
        const id = interaction.fields.getTextInputValue('TrackerRemovePlayerId');

        const isSteamId64 = id.length === Constants.STEAMID64_LENGTH ? true : false;

        if (!tracker) {
            interaction.deferUpdate();
            return;
        }

        if (isSteamId64) {
            tracker.players = tracker.players.filter(e => e.steamId !== id);
        }
        else {
            tracker.players = tracker.players.filter(e => e.playerId !== id);
        }
        client.setInstance(interaction.guildId, instance);

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'modalValueChange', {
            id: `${verifyId}`,
            value: `${id}`
        }));

        await DiscordMessages.sendTrackerMessage(interaction.guildId, ids.trackerId);
    }

    client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userModalInteractionSuccess', {
        id: `${verifyId}`
    }));

    /* Branches that do slow work acknowledge the modal themselves up front. */
    if (!interaction.deferred && !interaction.replied) interaction.deferUpdate();
}
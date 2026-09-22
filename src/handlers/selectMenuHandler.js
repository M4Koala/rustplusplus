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

const DiscordMessages = require('../discordTools/discordMessages.js');
const DiscordSelectMenus = require('../discordTools/discordSelectMenus.js');
const DiscordTools = require('../discordTools/discordTools.js');

module.exports = async (client, interaction) => {
    const instance = client.getInstance(interaction.guildId);
    const guildId = interaction.guildId;
    const rustplus = client.rustplusInstances[guildId];

    const verifyId = Math.floor(100000 + Math.random() * 900000);
    client.logInteraction(interaction, verifyId, 'userSelectMenu');

    if (instance.blacklist['discordIds'].includes(interaction.user.id) &&
        !interaction.member.permissions.has(Discord.PermissionsBitField.Flags.Administrator)) {
        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userPartOfBlacklist', {
            id: `${verifyId}`,
            user: `${interaction.user.username} (${interaction.user.id})`
        }));
        return;
    }

    if (interaction.customId === 'language') {
        instance.generalSettings.language = interaction.values[0];
        client.setInstance(guildId, instance);

        if (rustplus) rustplus.generalSettings.language = interaction.values[0];

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'selectMenuValueChange', {
            id: `${verifyId}`,
            value: `${instance.generalSettings.language}`
        }));

        await interaction.deferUpdate();

        client.loadGuildIntl(guildId);

        await client.interactionEditReply(interaction, {
            components: [DiscordSelectMenus.getLanguageSelectMenu(guildId, interaction.values[0])]
        });

        const guild = DiscordTools.getGuild(guildId);
        await require('../discordTools/RegisterSlashCommands')(client, guild);
    }
    else if (interaction.customId === 'Prefix') {
        instance.generalSettings.prefix = interaction.values[0];
        client.setInstance(guildId, instance);

        if (rustplus) rustplus.generalSettings.prefix = interaction.values[0];

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'selectMenuValueChange', {
            id: `${verifyId}`,
            value: `${instance.generalSettings.prefix}`
        }));

        await client.interactionUpdate(interaction, {
            components: [DiscordSelectMenus.getPrefixSelectMenu(guildId, interaction.values[0])]
        });
    }
    else if (interaction.customId === 'Trademark') {
        instance.generalSettings.trademark = interaction.values[0];
        client.setInstance(guildId, instance);

        if (rustplus) {
            rustplus.generalSettings.trademark = interaction.values[0];
            rustplus.trademarkString = (instance.generalSettings.trademark === 'NOT SHOWING') ?
                '' : `${instance.generalSettings.trademark} | `;
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'selectMenuValueChange', {
            id: `${verifyId}`,
            value: `${instance.generalSettings.trademark}`
        }));

        await client.interactionUpdate(interaction, {
            components: [DiscordSelectMenus.getTrademarkSelectMenu(guildId, interaction.values[0])]
        });
    }
    else if (interaction.customId === 'CommandDelay') {
        instance.generalSettings.commandDelay = interaction.values[0];
        client.setInstance(guildId, instance);

        if (rustplus) rustplus.generalSettings.commandDelay = interaction.values[0];

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'selectMenuValueChange', {
            id: `${verifyId}`,
            value: `${instance.generalSettings.commandDelay}`
        }));

        await client.interactionUpdate(interaction, {
            components: [DiscordSelectMenus.getCommandDelaySelectMenu(guildId, interaction.values[0])]
        });
    }
    else if (interaction.customId === 'VoiceGender') {
        instance.generalSettings.voiceGender = interaction.values[0];
        client.setInstance(guildId, instance);

        if (rustplus) rustplus.generalSettings.voiceGender = interaction.values[0];

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'selectMenuValueChange', {
            id: `${verifyId}`,
            value: `${instance.generalSettings.voiceGender}`
        }));

        await client.interactionUpdate(interaction, {
            components: [DiscordSelectMenus.getVoiceGenderSelectMenu(guildId, interaction.values[0])]
        });
    }
    else if (interaction.customId.startsWith('AutoDayNightOnOff')) {
        const ids = JSON.parse(interaction.customId.replace('AutoDayNightOnOff', ''));
        const server = instance.serverList[ids.serverId];

        if (!server || (server && !server.switches.hasOwnProperty(ids.entityId))) {
            await interaction.message.delete();
            return;
        }

        const value = parseInt(interaction.values[0]);
        if ((value !== 5 && value !== 6) ||
            ((value === 5 || value === 6) && server.switches[ids.entityId].location !== null)) {
            server.switches[ids.entityId].autoDayNightOnOff = value;
            client.setInstance(guildId, instance);
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'selectMenuValueChange', {
            id: `${verifyId}`,
            value: `${server.switches[ids.entityId].autoDayNightOnOff}`
        }));

        DiscordMessages.sendSmartSwitchMessage(guildId, ids.serverId, ids.entityId, interaction);
    }
    else if (interaction.customId.startsWith('TrackerResolveTracker')) {
        const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
        const ids = JSON.parse(interaction.customId.replace('TrackerResolveTracker', ''));

        const pending = client.resolverPending ? client.resolverPending[ids.u] : null;
        if (!pending || Date.now() - pending.ts > 5 * 60 * 1000 || !pending.candidates[ids.i]) {
            await interaction.update({
                embeds: [DiscordEmbeds.getActionInfoEmbed(1, client.intlGet(guildId, 'resolverExpired'))],
                components: []
            });
            return;
        }
        const candidate = pending.candidates[ids.i];
        const trackerId = interaction.values[0];
        const tracker = instance.trackers[trackerId];

        if (!tracker || !tracker.queryAddress || candidate.steamId === null) {
            await interaction.update({
                embeds: [DiscordEmbeds.getActionInfoEmbed(1, client.intlGet(guildId, 'resolverExpired'))],
                components: []
            });
            return;
        }

        if (tracker.players.some(p => p.steamId === candidate.steamId)) {
            await interaction.update({
                embeds: [DiscordEmbeds.getActionInfoEmbed(1, client.intlGet(guildId, 'resolverAlreadyTracked',
                    { name: candidate.name, tracker: tracker.name }))],
                components: []
            });
            return;
        }

        tracker.players.push({
            name: candidate.name,
            steamId: candidate.steamId,
            playerId: null
        });
        client.setInstance(guildId, instance);
        delete client.resolverPending[ids.u];

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'selectMenuValueChange', {
            id: `${verifyId}`,
            value: `resolver add ${candidate.steamId} -> ${trackerId}`
        }));

        await DiscordMessages.sendTrackerMessage(guildId, trackerId);

        await interaction.update({
            embeds: [DiscordEmbeds.getActionInfoEmbed(0, client.intlGet(guildId, 'resolverAdded',
                { name: candidate.name, steamId: candidate.steamId, tracker: tracker.name }))],
            components: []
        });
    }
    else if (interaction.customId.startsWith('SmartAlarmType')) {
        const ids = JSON.parse(interaction.customId.replace('SmartAlarmType', ''));
        const server = instance.serverList[ids.serverId];

        if (!server || (server && !server.alarms.hasOwnProperty(ids.entityId))) {
            await interaction.message.delete();
            return;
        }

        const type = interaction.values[0];
        if (['normal', 'small', 'large'].includes(type)) {
            server.alarms[ids.entityId].type = type;
            client.setInstance(guildId, instance);
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'selectMenuValueChange', {
            id: `${verifyId}`,
            value: `${server.alarms[ids.entityId].type}`
        }));

        await DiscordMessages.sendSmartAlarmMessage(guildId, ids.serverId, ids.entityId, interaction);
    }

    client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'userSelectMenuInteractionSuccess', {
        id: `${verifyId}`
    }));
}
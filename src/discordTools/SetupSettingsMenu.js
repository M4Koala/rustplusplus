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
const Path = require('path');

const Config = require('../../config');
const Constants = require('../util/constants.js');
const DiscordButtons = require('./discordButtons.js');
const DiscordEmbeds = require('./discordEmbeds.js');
const DiscordSelectMenus = require('./discordSelectMenus.js');
const DiscordTools = require('./discordTools.js');

module.exports = async (client, guild, forced = false) => {
    const instance = client.getInstance(guild.id);
    const channel = DiscordTools.getTextChannelById(guild.id, instance.channelId.settings);

    if (!channel) {
        client.log(client.intlGet(null, 'errorCap'), 'SetupSettingsMenu: ' +
            client.intlGet(null, 'invalidGuildOrChannel'), 'error');
        return;
    }

    let shouldPopulate = instance.firstTime || forced;
    let existingMessages = null;

    if (!shouldPopulate) {
        /* Repopulate automatically when the settings channel is empty, e.g. when the channel
           was recreated or adopted after the original channel was lost. */
        try {
            existingMessages = await channel.messages.fetch({ limit: 100 });
            if (existingMessages.size === 0) shouldPopulate = true;
        }
        catch (e) {
            /* Ignore */
        }
    }

    if (shouldPopulate) {
        await DiscordTools.clearTextChannel(guild.id, instance.channelId.settings, 100);

        await setupGeneralSettings(client, guild.id, channel);
        await setupNotificationSettings(client, guild.id, channel);

        instance.firstTime = false;
        client.setInstance(guild.id, instance);
    }
    else if (existingMessages !== null) {
        /* Notification settings added by a bot update have no message in an already
           populated settings channel. Append them, so an update does not require
           /reset settings. Present settings are recognized via their button customIds. */
        const presentSettings = new Set();
        for (const message of existingMessages.values()) {
            for (const row of message.components ?? []) {
                for (const component of row.components ?? []) {
                    const customId = component.customId ?? '';
                    if (customId.startsWith('DiscordNotification')) {
                        try {
                            presentSettings.add(JSON.parse(customId.replace('DiscordNotification', '')).setting);
                        }
                        catch (e) {
                            /* Ignore */
                        }
                    }
                }
            }
        }

        for (const setting in instance.notificationSettings) {
            if (!presentSettings.has(setting)) {
                await sendNotificationSetting(client, guild.id, channel, setting);
            }
        }

        /* Deprecated marker-event settings keep their months-old message (posted before the
           Rust+ Power Trip change) with green toggles and no warning. Rewrite those in place
           once: 🚫 title + note, buttons rendered off. Identified via their button customIds;
           messages whose title already carries the marker are left alone. */
        for (const message of existingMessages.values()) {
            let messageSetting = null;
            for (const row of message.components ?? []) {
                for (const component of row.components ?? []) {
                    const customId = component.customId ?? '';
                    if (customId.startsWith('DiscordNotification')) {
                        try {
                            messageSetting = JSON.parse(customId.replace('DiscordNotification', '')).setting;
                        }
                        catch (e) { /* Ignore */ }
                    }
                }
            }
            if (!messageSetting || !Constants.DEPRECATED_MARKER_EVENTS.includes(messageSetting)) continue;

            const currentTitle = message.embeds?.[0]?.title ?? '';
            const expectedNote = client.intlGet(guild.id,
                ['heavyScientistCalledSetting', 'lockedCrateOilRigUnlockedSetting'].includes(messageSetting)
                    ? 'markerEventsOilRigWorkaroundNote' : 'markerEventsUnsupportedNote');
            const currentNote = message.embeds?.[0]?.fields?.find(
                f => f.name === client.intlGet(guild.id, 'noteCap'))?.value ?? '';
            if (currentTitle.startsWith('🚫') && currentNote === expectedNote) continue;

            try {
                const settingEntry = instance.notificationSettings[messageSetting];
                await message.edit({
                    embeds: [DiscordEmbeds.getEmbed({
                        color: Constants.COLOR_SETTINGS,
                        title: '🚫 ' + client.intlGet(guild.id, messageSetting),
                        thumbnail: `attachment://${settingEntry.image}`,
                        fields: [{
                            name: client.intlGet(guild.id, 'noteCap'),
                            value: client.intlGet(guild.id,
                                ['heavyScientistCalledSetting', 'lockedCrateOilRigUnlockedSetting']
                                    .includes(messageSetting)
                                    ? 'markerEventsOilRigWorkaroundNote' : 'markerEventsUnsupportedNote'),
                            inline: false
                        }]
                    })],
                    components: [DiscordButtons.getNotificationButtons(
                        guild.id, messageSetting,
                        settingEntry.discord, settingEntry.inGame, settingEntry.voice)],
                    files: [new Discord.AttachmentBuilder(
                        Path.join(__dirname, '..', `resources/images/events/${settingEntry.image}`))]
                });
            }
            catch (e) {
                client.log(client.intlGet(null, 'warningCap'),
                    `Could not refresh deprecated setting message for ${messageSetting}: ${e.message}`);
            }
        }
    }

};

async function setupGeneralSettings(client, guildId, channel) {
    const instance = client.getInstance(guildId);

    await client.messageSend(channel, {
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..',
                `resources/images/settings/general_settings_logo_${instance.generalSettings.language}.png`))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'selectLanguageSetting'),
            thumbnail: `attachment://settings_logo.png`,
            fields: [
                {
                    name: client.intlGet(guildId, 'noteCap'),
                    value: client.intlGet(guildId, 'selectLanguageExtendSetting'),
                    inline: true
                }]
        })],
        components: [DiscordSelectMenus.getLanguageSelectMenu(guildId, instance.generalSettings.language)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'commandsVoiceGenderDesc'),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordSelectMenus.getVoiceGenderSelectMenu(guildId, instance.generalSettings.voiceGender)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'selectInGamePrefixSetting'),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordSelectMenus.getPrefixSelectMenu(guildId, instance.generalSettings.prefix)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'selectTrademarkSetting'),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordSelectMenus.getTrademarkSelectMenu(guildId, instance.generalSettings.trademark)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldCommandsEnabledSetting'),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordButtons.getInGameCommandsEnabledButton(guildId,
            instance.generalSettings.inGameCommandsEnabled)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldBotBeMutedSetting'),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordButtons.getBotMutedInGameButton(guildId, instance.generalSettings.muteInGameBotMessages)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'inGameTeamNotificationsSetting'),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordButtons.getInGameTeammateNotificationsButtons(guildId)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'commandDelaySetting'),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordSelectMenus.getCommandDelaySelectMenu(guildId, instance.generalSettings.commandDelay)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldSmartAlarmNotifyNotConnectedSetting'),
            thumbnail: `attachment://settings_logo.png`,
            fields: [
                {
                    name: client.intlGet(guildId, 'noteCap'),
                    value: client.intlGet(guildId, 'smartAlarmNotifyExtendSetting'),
                    inline: true
                }]
        })],
        components: [
            DiscordButtons.getFcmAlarmNotificationButtons(
                guildId,
                instance.generalSettings.fcmAlarmNotificationEnabled,
                instance.generalSettings.fcmAlarmNotificationEveryone)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldSmartAlarmsNotifyInGameSetting'),
            thumbnail: `attachment://settings_logo.png`,
        })],
        components: [DiscordButtons.getSmartAlarmNotifyInGameButton(guildId,
            instance.generalSettings.smartAlarmNotifyInGame)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldWakeupCallEnabledSetting'),
            thumbnail: `attachment://settings_logo.png`,
            fields: [
                {
                    name: client.intlGet(guildId, 'noteCap'),
                    value: client.intlGet(guildId, 'wakeupCallEnabledExtendSetting'),
                    inline: true
                }]
        })],
        components: [DiscordButtons.getWakeupCallEnabledButton(guildId,
            instance.generalSettings.wakeupCallEnabled)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldMarkerEventsEnabledSetting'),
            thumbnail: `attachment://settings_logo.png`,
            fields: [
                {
                    name: client.intlGet(guildId, 'noteCap'),
                    value: client.intlGet(guildId, 'markerEventsEnabledExtendSetting'),
                    inline: true
                }]
        })],
        components: [DiscordButtons.getMarkerEventsEnabledButton(
            guildId, instance.generalSettings.markerEventsEnabled)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldSmartSwitchNotifyInGameWhenChangedFromDiscord'),
            thumbnail: `attachment://settings_logo.png`,
        })],
        components: [DiscordButtons.getSmartSwitchNotifyInGameWhenChangedFromDiscordButton(guildId,
            instance.generalSettings.smartSwitchNotifyInGameWhenChangedFromDiscord)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldLeaderCommandEnabledSetting'),
            thumbnail: `attachment://settings_logo.png`,
        })],
        components: [DiscordButtons.getLeaderCommandEnabledButton(guildId,
            instance.generalSettings.leaderCommandEnabled)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'shouldLeaderCommandOnlyForPairedSetting'),
            thumbnail: `attachment://settings_logo.png`,
        })],
        components: [DiscordButtons.getLeaderCommandOnlyForPairedButton(guildId,
            instance.generalSettings.leaderCommandOnlyForPaired)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'mapWipeDetectedNotifySetting', { group: '@everyone' }),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordButtons.getMapWipeNotifyEveryoneButton(instance.generalSettings.mapWipeNotifyEveryone)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: client.intlGet(guildId, 'itemAvailableNotifyInGameSetting'),
            thumbnail: `attachment://settings_logo.png`
        })],
        components: [DiscordButtons.getItemAvailableNotifyInGameButton(guildId,
            instance.generalSettings.itemAvailableInVendingMachineNotifyInGame)],
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
    });

    if (Config.battlemetrics.token !== '') {
        await client.messageSend(channel, {
            embeds: [DiscordEmbeds.getEmbed({
                color: Constants.COLOR_SETTINGS,
                title: client.intlGet(guildId, 'displayInformationBattlemetricsAllOnlinePlayers'),
                thumbnail: `attachment://settings_logo.png`
            })],
            components: [DiscordButtons.getDisplayInformationBattlemetricsAllOnlinePlayersButton(guildId,
                instance.generalSettings.displayInformationBattlemetricsAllOnlinePlayers)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
        });

        await client.messageSend(channel, {
            embeds: [DiscordEmbeds.getEmbed({
                color: Constants.COLOR_SETTINGS,
                title: client.intlGet(guildId, 'subscribeToChangesBattlemetrics'),
                thumbnail: `attachment://settings_logo.png`
            })],
            components: DiscordButtons.getSubscribeToChangesBattlemetricsButtons(guildId),
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
        });
    }
}

async function setupNotificationSettings(client, guildId, channel) {
    const instance = client.getInstance(guildId);

    await client.messageSend(channel, {
        files: [new Discord.AttachmentBuilder(
            Path.join(__dirname, '..',
                `resources/images/settings/notification_settings_logo_${instance.generalSettings.language}.png`))]
    });

    for (const setting in instance.notificationSettings) {
        await sendNotificationSetting(client, guildId, channel, setting);
    }
}

async function sendNotificationSetting(client, guildId, channel, setting) {
    const instance = client.getInstance(guildId);

    const deprecated = Constants.DEPRECATED_MARKER_EVENTS.includes(setting);
    /* The oil rig events are deprecated as marker data but reachable via RF (typed alarms). */
    const oilRigWorkaround = ['heavyScientistCalledSetting', 'lockedCrateOilRigUnlockedSetting'].includes(setting);

    await client.messageSend(channel, {
        embeds: [DiscordEmbeds.getEmbed({
            color: Constants.COLOR_SETTINGS,
            title: (deprecated ? '🚫 ' : '') + client.intlGet(guildId, setting),
            thumbnail: `attachment://${instance.notificationSettings[setting].image}`,
            fields: deprecated ? [{
                name: client.intlGet(guildId, 'noteCap'),
                value: client.intlGet(guildId, oilRigWorkaround
                    ? 'markerEventsOilRigWorkaroundNote' : 'markerEventsUnsupportedNote'),
                inline: false
            }] : []
        })],
        components: [
            DiscordButtons.getNotificationButtons(
                guildId, setting,
                instance.notificationSettings[setting].discord,
                instance.notificationSettings[setting].inGame,
                instance.notificationSettings[setting].voice)],
        files: [
            new Discord.AttachmentBuilder(
                Path.join(__dirname, '..',
                    `resources/images/events/${instance.notificationSettings[setting].image}`))]
    });
}
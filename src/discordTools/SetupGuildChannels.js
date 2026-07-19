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

const Config = require('../../config');
const DiscordTools = require('../discordTools/discordTools.js');
const PermissionHandler = require('../handlers/permissionHandler.js');

module.exports = async (client, guild, category) => {
    if (!category) {
        client.log(client.intlGet(null, 'errorCap'),
            client.intlGet(null, 'couldNotCreateCategory', { name: 'rustplusplus' }), 'error');
        return;
    }

    /* Canonical channel order, [language key, channelId key, permissionWrite] */
    const channels = [
        [client.intlGet(guild.id, 'channelNameInformation'), 'information', false],
        [client.intlGet(guild.id, 'channelNameServers'), 'servers', false],
        [client.intlGet(guild.id, 'channelNameSettings'), 'settings', false],
        [client.intlGet(guild.id, 'channelNameCommands'), 'commands', true],
        [client.intlGet(guild.id, 'channelNameEvents'), 'events', false],
        [client.intlGet(guild.id, 'channelNameTeamchat'), 'teamchat', true],
        [client.intlGet(guild.id, 'channelNameSwitches'), 'switches', false],
        [client.intlGet(guild.id, 'channelNameSwitchGroups'), 'switchGroups', false],
        [client.intlGet(guild.id, 'channelNameAlarms'), 'alarms', false],
        [client.intlGet(guild.id, 'channelNameStorageMonitors'), 'storageMonitors', false],
        [client.intlGet(guild.id, 'channelNameActivity'), 'activity', false],
        [client.intlGet(guild.id, 'channelNameTrackers'), 'trackers', false]];

    for (const [name, idName, permissionWrite] of channels) {
        await addTextChannel(name, idName, client, guild, category, permissionWrite);
    }

    await reorderChannels(client, guild, category, channels.map(e => e[1]));
};

async function addTextChannel(name, idName, client, guild, parent, permissionWrite = false) {
    const instance = client.getInstance(guild.id);

    let channel = undefined;
    if (instance.channelId[idName] !== null) {
        channel = DiscordTools.getTextChannelById(guild.id, instance.channelId[idName]);
    }
    if (channel === undefined) {
        /* The stored channel id is stale. Adopt an already existing channel with the expected
           name to avoid creating duplicates, preferring channels inside the category. */
        const usedIds = Object.values(instance.channelId);
        const candidates = guild.channels.cache.filter(c =>
            c.type === Discord.ChannelType.GuildText &&
            c.name.toLowerCase() === name.toLowerCase().replace(/\s+/g, '-') &&
            !usedIds.includes(c.id));
        channel = candidates.find(c => c.parentId === parent.id) ?? candidates.first();
    }
    let created = false;
    if (channel === undefined) {
        channel = await DiscordTools.addTextChannel(guild.id, name, parent.id);

        if (channel === undefined) {
            client.log(client.intlGet(null, 'errorCap'),
                client.intlGet(null, 'couldNotCreateTextChannel', { name: name }), 'error');
            return;
        }
        created = true;
    }

    if (instance.channelId[idName] !== channel.id) {
        instance.channelId[idName] = channel.id;
        client.setInstance(guild.id, instance);
    }

    /* Make sure the channel is grouped under the rustplusplus category. */
    if (channel.parentId !== parent.id) {
        try {
            channel = await channel.setParent(parent.id);
        }
        catch (e) {
            client.log(client.intlGet(null, 'errorCap'),
                client.intlGet(null, 'couldNotSetParent', { channelId: channel.id }), 'error');
        }
    }

    /* A freshly created channel has no permission overwrites of its own. Sync it with the
       category, so it gets the same permission set as its already existing siblings, even
       when permission management is turned off. Adopted channels are left untouched, they
       may carry manually configured permissions. */
    if (created && !Config.discord.manageChannelPermissions) {
        try {
            await channel.lockPermissions();
        }
        catch (e) {
            /* Ignore */
        }
    }

    if (Config.discord.manageChannelPermissions) {
        const perms = PermissionHandler.getPermissionsReset(client, guild, permissionWrite);

        try {
            await channel.permissionOverwrites.set(perms);
        }
        catch (e) {
            /* Ignore */
        }

        /* Currently, this halts the entire application... Too lazy to fix...
           It is possible to just remove the channels and let the bot recreate them with correct name language */
        //channel.setName(name);

        channel.lockPermissions();
    }
}

async function reorderChannels(client, guild, category, idNamesInOrder) {
    const instance = client.getInstance(guild.id);

    /* Collect the channels that live inside the category, in canonical order. */
    const channels = [];
    for (const idName of idNamesInOrder) {
        if (instance.channelId[idName] === null) continue;

        const channel = DiscordTools.getTextChannelById(guild.id, instance.channelId[idName]);
        if (!channel || channel.parentId !== category.id) continue;

        channels.push(channel);
    }
    if (channels.length === 0) return;

    /* Only reorder when the current order differs from the canonical order. */
    const currentOrder = channels.slice().sort((a, b) => a.rawPosition - b.rawPosition);
    if (channels.every((channel, index) => channel.id === currentOrder[index].id)) return;

    try {
        await guild.channels.setPositions(channels.map((channel, index) => ({
            channel: channel.id,
            position: index
        })));
    }
    catch (e) {
        client.log(client.intlGet(null, 'errorCap'),
            client.intlGet(null, 'couldNotReorderChannels', { guildId: guild.id }), 'error');
    }
}
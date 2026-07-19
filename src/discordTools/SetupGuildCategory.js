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
const DiscordTools = require('../discordTools/discordTools.js');
const PermissionHandler = require('../handlers/permissionHandler.js');

module.exports = async (client, guild) => {
    const instance = client.getInstance(guild.id);

    let category = undefined;
    if (instance.channelId.category !== null) {
        category = DiscordTools.getCategoryById(guild.id, instance.channelId.category);
    }
    if (category === undefined) {
        /* The stored category id is stale. Adopt an already existing rustplusplus category
           to avoid creating duplicates. */
        category = DiscordTools.getCategoryByName(guild.id, 'rustplusplus');
    }
    if (category === undefined) {
        /* Still nothing (e.g. the category was renamed): adopt the category that holds the
           tracked channels, so an existing setup with custom permissions is reused instead
           of being recreated. */
        for (const [idName, channelId] of Object.entries(instance.channelId)) {
            if (idName === 'category' || channelId === null) continue;

            const channel = DiscordTools.getTextChannelById(guild.id, channelId);
            if (channel === undefined || channel.parentId === null) continue;

            category = DiscordTools.getCategoryById(guild.id, channel.parentId);
            if (category !== undefined) break;
        }
    }
    if (category === undefined) {
        category = await DiscordTools.addCategory(guild.id, 'rustplusplus');
    }
    if (category !== undefined && instance.channelId.category !== category.id) {
        instance.channelId.category = category.id;
        client.setInstance(guild.id, instance);
    }

    if (Config.discord.manageChannelPermissions) {
        const perms = PermissionHandler.getPermissionsReset(client, guild, false);

        try {
            await category.permissionOverwrites.set(perms);
        }
        catch (e) {
            /* Ignore */
        }
    }

    return category;
};
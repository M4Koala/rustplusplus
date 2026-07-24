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

module.exports = {
    getPermissionsReset: function (client, guild, permissionWrite = false) {
        const instance = client.getInstance(guild.id);

        const perms = [];
        const everyoneAllow = [];
        const everyoneDeny = [];
        const roleAllow = [];
        const roleDeny = [];

        if (instance.role !== null) {
            if (permissionWrite) {
                roleAllow.push(Discord.PermissionFlagsBits.SendMessages);
            }
            else {
                roleDeny.push(Discord.PermissionFlagsBits.SendMessages);
            }

            everyoneDeny.push(Discord.PermissionFlagsBits.ViewChannel);
            everyoneDeny.push(Discord.PermissionFlagsBits.SendMessages);
            roleAllow.push(Discord.PermissionFlagsBits.ViewChannel);

            perms.push({ id: guild.roles.everyone.id, deny: everyoneDeny });
            perms.push({ id: instance.role, allow: roleAllow, deny: roleDeny });
        }
        else {
            if (permissionWrite) {
                everyoneAllow.push(Discord.PermissionFlagsBits.SendMessages);
            }
            else {
                everyoneDeny.push(Discord.PermissionFlagsBits.SendMessages);
            }

            everyoneAllow.push(Discord.PermissionFlagsBits.ViewChannel);

            perms.push({ id: guild.roles.everyone.id, allow: everyoneAllow, deny: everyoneDeny });
        }

        for (const discordId of instance.blacklist['discordIds']) {
            perms.push({
                id: discordId,
                deny: [Discord.PermissionFlagsBits.ViewChannel, Discord.PermissionFlagsBits.SendMessages]
            });
        }

        return perms;
    },

    getPermissionsRemoved: function (client, guild) {
        const instance = client.getInstance(guild.id);

        const perms = [];

        if (instance.role !== null) {
            perms.push({
                id: instance.role,
                deny: [Discord.PermissionFlagsBits.ViewChannel, Discord.PermissionFlagsBits.SendMessages]
            });
        }

        perms.push({
            id: guild.roles.everyone.id,
            deny: [Discord.PermissionFlagsBits.ViewChannel, Discord.PermissionFlagsBits.SendMessages]
        });

        return perms;
    },

    /**
     *  Build the (target id, PermissionOverwriteOptions) pairs the bot needs on a channel:
     *  @everyone, the configured access role (if any), and each blacklisted Discord id. Meant
     *  for permissionOverwrites.edit(), which only touches the given target's overwrite and
     *  leaves every other target's overwrite (a manually added role/user) untouched - unlike
     *  permissionOverwrites.set(), which replaces the entire overwrite list.
     *  @param {object} client The Discord client.
     *  @param {object} guild The guild.
     *  @param {bool} permissionWrite True if the role/@everyone should be allowed to send messages.
     *  @return {Array} Array of { id, options } targets.
     */
    getPermissionEditTargets: function (client, guild, permissionWrite = false) {
        const instance = client.getInstance(guild.id);

        const targets = [];

        if (instance.role !== null) {
            targets.push({
                id: guild.roles.everyone.id,
                options: { ViewChannel: false, SendMessages: false }
            });
            targets.push({
                id: instance.role,
                options: { ViewChannel: true, SendMessages: permissionWrite }
            });
        }
        else {
            targets.push({
                id: guild.roles.everyone.id,
                options: { ViewChannel: true, SendMessages: permissionWrite }
            });
        }

        for (const discordId of instance.blacklist['discordIds']) {
            targets.push({
                id: discordId,
                options: { ViewChannel: false, SendMessages: false }
            });
        }

        return targets;
    },

    /**
     *  Apply the bot-managed permission targets (@everyone, access role, blacklist) to the
     *  category and every known channel, editing each target's overwrite in place instead of
     *  replacing the whole list - so manually added overwrites for other roles/users survive.
     *  @param {object} client The Discord client.
     *  @param {object} guild The guild.
     *  @param {Array} removedTargetIds Ids whose overwrite should be deleted entirely (e.g. the
     *      previous access role after /role changes it, or a user removed from the blacklist).
     */
    resetPermissionsAllChannels: async function (client, guild, removedTargetIds = []) {
        if (!Config.discord.manageChannelPermissions) return;

        const instance = client.getInstance(guild.id);

        if (instance.channelId.category === null) return;

        const category = await DiscordTools.getCategoryById(guild.id, instance.channelId.category);
        if (category) {
            await module.exports.applyPermissionTargets(category,
                module.exports.getPermissionEditTargets(client, guild), removedTargetIds);
        }

        for (const [name, id] of Object.entries(instance.channelId)) {
            const writePerm = (name !== 'commands' && name !== 'teamchat') ? false : true;

            const channel = DiscordTools.getTextChannelById(guild.id, id);
            if (channel) {
                await module.exports.applyPermissionTargets(channel,
                    module.exports.getPermissionEditTargets(client, guild, writePerm), removedTargetIds);
            }
        }
    },

    /**
     *  Edit each target's overwrite on a channel/category, then delete the overwrite for any
     *  removedTargetIds. Each call is independently try/caught so one stale/invalid id (a
     *  deleted role, a member who left) can't stop the rest from being applied.
     *  @param {object} channelOrCategory The channel or category to edit overwrites on.
     *  @param {Array} targets Array of { id, options } as returned by getPermissionEditTargets.
     *  @param {Array} removedTargetIds Ids whose overwrite should be deleted entirely.
     */
    applyPermissionTargets: async function (channelOrCategory, targets, removedTargetIds = []) {
        for (const target of targets) {
            try {
                await channelOrCategory.permissionOverwrites.edit(target.id, target.options);
            }
            catch (e) {
                /* Ignore */
            }
        }

        for (const id of removedTargetIds) {
            try {
                await channelOrCategory.permissionOverwrites.delete(id);
            }
            catch (e) {
                /* Ignore */
            }
        }
    },

    /**
     *  Non-destructively hide a channel/category from @everyone (and the access role, if set)
     *  by editing just those two overwrites, instead of replacing the whole overwrite list.
     *  Used where the bot used to fully lock a category down before rebuilding it.
     *  @param {object} client The Discord client.
     *  @param {object} guild The guild.
     *  @param {object} channelOrCategory The channel or category to hide.
     */
    hidePermissions: async function (client, guild, channelOrCategory) {
        if (!Config.discord.manageChannelPermissions) return;
        if (!channelOrCategory) return;

        const instance = client.getInstance(guild.id);
        const deny = { ViewChannel: false, SendMessages: false };

        try {
            await channelOrCategory.permissionOverwrites.edit(guild.roles.everyone.id, deny);
        }
        catch (e) {
            /* Ignore */
        }

        if (instance.role !== null) {
            try {
                await channelOrCategory.permissionOverwrites.edit(instance.role, deny);
            }
            catch (e) {
                /* Ignore */
            }
        }
    },
}
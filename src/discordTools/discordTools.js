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

const Client = require('../../index.ts');
const Config = require('../../config');

module.exports = {
    getGuild: function (guildId) {
        try {
            return Client.client.guilds.cache.get(guildId);
        }
        catch (e) {
            Client.client.log(Client.client.intlGet(null, 'errorCap'),
                Client.client.intlGet(null, 'couldNotFindGuild', { guildId: guildId }), 'error');
        }
        return undefined;
    },

    getRole: function (guildId, roleId) {
        let guild = module.exports.getGuild(guildId);

        if (guild) {
            try {
                return guild.roles.cache.get(roleId);
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotFindRole', { roleId: roleId }), 'error');
            }
        }
        return undefined;
    },

    getUserById: async function (guildId, userId) {
        let guild = module.exports.getGuild(guildId);

        if (guild) {
            try {
                const user = await guild.members.fetch(userId);
                if (user instanceof Map) return await user.get(userId);
                return user;
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotFindUser', { userId: userId }), 'error');
            }
        }
        return undefined;
    },

    getTextChannelById: function (guildId, channelId) {
        const guild = module.exports.getGuild(guildId);

        if (guild) {
            let channel = undefined;
            try {
                channel = guild.channels.cache.get(channelId);
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotFindChannel', { channel: channelId }), 'error');
            }

            if (channel && channel.type === Discord.ChannelType.GuildText) {
                return channel;
            }
        }
        return undefined;
    },

    getTextChannelByName: function (guildId, name) {
        const guild = module.exports.getGuild(guildId);

        if (guild) {
            let channel = undefined;
            try {
                channel = guild.channels.cache.find(c =>
                    c.type === Discord.ChannelType.GuildText && c.name === name);
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotFindChannel', { channel: name }), 'error');
            }

            if (channel && channel.type === Discord.ChannelType.GuildText) {
                return channel;
            }
        }
        return undefined;
    },

    getCategoryById: function (guildId, categoryId) {
        const guild = module.exports.getGuild(guildId);

        if (guild) {
            let category = undefined;
            try {
                category = guild.channels.cache.get(categoryId);
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotFindCategory', { category: categoryId }), 'error');
            }

            if (category && category.type === Discord.ChannelType.GuildCategory) {
                return category;
            }
        }
        return undefined;
    },

    getCategoryByName: function (guildId, name) {
        const guild = module.exports.getGuild(guildId);

        if (guild) {
            let category = undefined;
            try {
                category = guild.channels.cache.find(c =>
                    c.type === Discord.ChannelType.GuildCategory && c.name === name);
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotFindCategory', { category: name }), 'error');
            }

            if (category && category.type === Discord.ChannelType.GuildCategory) {
                return category;
            }
        }
        return undefined;
    },

    getMessageById: async function (guildId, channelId, messageId) {
        const guild = module.exports.getGuild(guildId);

        if (guild) {
            const channel = module.exports.getTextChannelById(guildId, channelId);

            if (channel) {
                try {
                    const message = await channel.messages.fetch(messageId);
                    if (message instanceof Map) return await message.get(messageId);
                    return message;
                }
                catch (e) {
                    Client.client.log(Client.client.intlGet(null, 'errorCap'),
                        Client.client.intlGet(null, 'couldNotFindMessage', { message: messageId }), 'error');
                }
            }
        }
        return undefined;
    },

    deleteMessageById: async function (guildId, channelId, messageId) {
        const message = await module.exports.getMessageById(guildId, channelId, messageId);

        try {
            await message.delete();
        }
        catch (e) {
            Client.client.log(Client.client.intlGet(null, 'errorCap'),
                Client.client.intlGet(null, 'couldNotDeleteMessage', { message: messageId }), 'error');

        }
        return undefined;
    },

    addCategory: async function (guildId, name) {
        const guild = module.exports.getGuild(guildId);

        if (guild) {
            try {
                return await guild.channels.create({
                    name: name,
                    type: Discord.ChannelType.GuildCategory,
                    permissionOverwrites: !Config.discord.manageChannelPermissions ? [] : [{
                        id: guild.roles.everyone.id,
                        deny: [Discord.PermissionFlagsBits.SendMessages]
                    }]
                });
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotCreateCategory', { name: name }) + ` (${e})`, 'error');
            }
        }
        return undefined;
    },

    removeCategory: async function (guildId, categoryId) {
        const category = module.exports.getCategoryById(guildId, categoryId);

        try {
            await category.delete();
        }
        catch (e) {
            Client.client.log(Client.client.intlGet(null, 'errorCap'),
                Client.client.intlGet(null, 'couldNotDeleteCategory', { categoryId: categoryId }), 'error');
            return false;
        }
        return true;
    },

    addTextChannel: async function (guildId, name, parentId = null) {
        const guild = module.exports.getGuild(guildId);

        if (guild) {
            try {
                return await guild.channels.create({
                    name: name,
                    type: Discord.ChannelType.GuildText,
                    parent: parentId ?? undefined,
                    permissionOverwrites: !Config.discord.manageChannelPermissions ? [] : [{
                        id: guild.roles.everyone.id,
                        deny: [Discord.PermissionFlagsBits.SendMessages]
                    }],
                });
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotCreateTextChannel', { name: name }) + ` (${e})`, 'error');
            }
        }
        return undefined;
    },

    removeTextChannel: async function (guildId, channelId) {
        const channel = module.exports.getTextChannelById(guildId, channelId);

        try {
            await channel.delete();
        }
        catch (e) {
            Client.client.log(Client.client.intlGet(null, 'errorCap'),
                Client.client.intlGet(null, 'couldNotDeleteChannel', { channelId: channelId }), 'error');
            return false;
        }
        return true;
    },

    purgeTextChannel: async function (guildId, idName) {
        /* Deletes the entire message history of a channel in place. The channel itself is
           reused, so its id, position and permission overwrites all stay untouched. Only
           messages that existed when the purge started are deleted, anything posted afterwards
           (the new wipe's messages) is safe, which also makes it safe to run this in the
           background without awaiting it. Messages younger than 14 days are removed in bulk,
           older ones have to go one by one. */
        const instance = Client.client.getInstance(guildId);
        const channel = module.exports.getTextChannelById(guildId, instance.channelId[idName]);
        if (!channel) return;

        const boundaryId = Discord.SnowflakeUtil.generate({ timestamp: Date.now() }).toString();

        let totalDeleted = 0;
        for (let pass = 0; pass < 200; pass++) {
            let messages = null;
            try {
                messages = await channel.messages.fetch({ limit: 100, before: boundaryId });
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotPerformMessagesFetch', { channel: channel.id }), 'error');
                break;
            }
            if (messages.size === 0) break;

            let deleted = 0;

            /* bulkDelete with filterOld=true silently skips the messages older than 14 days. */
            let bulkDeleted = null;
            try {
                bulkDeleted = await channel.bulkDelete(messages, true);
                deleted += bulkDeleted.size;
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotPerformBulkDelete', { channel: channel.id }), 'error');
            }

            for (const message of messages.values()) {
                if (bulkDeleted !== null && bulkDeleted.has(message.id)) continue;
                try {
                    await message.delete();
                    deleted += 1;
                }
                catch (e) {
                    Client.client.log(Client.client.intlGet(null, 'errorCap'),
                        Client.client.intlGet(null, 'couldNotPerformMessageDelete'), 'error');
                }
            }

            totalDeleted += deleted;
            if (deleted === 0) break; /* Nothing left that can be deleted, don't spin. */
        }

        if (totalDeleted !== 0) {
            Client.client.log(Client.client.intlGet(null, 'infoCap'),
                Client.client.intlGet(null, 'purgedChannelMessages',
                    { amount: `${totalDeleted}`, channel: channel.name }));
        }
    },

    deleteUntrackedBotMessages: async function (guildId, idName, trackedMessageIds) {
        /* Removes messages of this bot that are not tracked in the instance file. Such orphans
           appear when a tracked message id gets lost while the message itself remains (an
           earlier crash, a state reset, or a second bot process running with the same token),
           and they would otherwise sit in the channel stale forever. Recently posted messages
           are spared to not race an in-flight send whose id has not been stored yet. */
        const instance = Client.client.getInstance(guildId);
        const channel = module.exports.getTextChannelById(guildId, instance.channelId[idName]);
        if (!channel) return;

        let messages = null;
        try {
            messages = await channel.messages.fetch({ limit: 100 });
        }
        catch (e) {
            return;
        }

        const tracked = trackedMessageIds.filter(e => e !== null);
        let removed = 0;
        for (const message of messages.values()) {
            if (message.author.id !== Client.client.user.id) continue;
            if (tracked.includes(message.id)) continue;
            if (Date.now() - message.createdTimestamp < 5 * 60 * 1000) continue;

            try {
                await message.delete();
                removed += 1;
            }
            catch (e) {
                /* Ignore */
            }
        }

        if (removed !== 0) {
            Client.client.log(Client.client.intlGet(null, 'warningCap'),
                Client.client.intlGet(null, 'removedUntrackedMessages',
                    { amount: `${removed}`, channel: channel.name }));
        }
    },

    clearTextChannel: async function (guildId, channelId, numberOfMessages) {
        const channel = module.exports.getTextChannelById(guildId, channelId);

        if (channel) {
            for (let messagesLeft = numberOfMessages; messagesLeft > 0; messagesLeft -= 100) {
                try {
                    if (messagesLeft >= 100) {
                        await channel.bulkDelete(100, true);
                    }
                    else {
                        await channel.bulkDelete(messagesLeft, true);
                    }
                }
                catch (e) {
                    Client.client.log(Client.client.intlGet(null, 'errorCap'),
                        Client.client.intlGet(null, 'couldNotPerformBulkDelete', { channel: channelId }), 'error');
                }
            }

            /* Fix for messages older than 14 days, those cannot be bulk deleted. Note: the
               upstream version iterated the fetched Collection via Object.keys() which is
               always empty for a Map, so old messages were never actually deleted. */
            let messages = null;
            try {
                messages = await channel.messages.fetch({ limit: 100 });
            }
            catch (e) {
                Client.client.log(Client.client.intlGet(null, 'errorCap'),
                    Client.client.intlGet(null, 'couldNotPerformMessagesFetch', { channel: channelId }), 'error');
            }

            if (messages === null || messages.size === 0) {
                return;
            }

            let deleted = 0;
            for (const message of messages.values()) {
                if (deleted >= numberOfMessages) break;
                if (!message.author.bot) continue;

                try {
                    await message.delete();
                    deleted += 1;
                }
                catch (e) {
                    Client.client.log(Client.client.intlGet(null, 'errorCap'),
                        Client.client.intlGet(null, 'couldNotPerformMessageDelete'), 'error');
                }
            }
        }
    },

    clearInformationChannel: async function (guildId) {
        /* Forget the tracked message ids first so that fresh information messages get posted,
           then purge the old ones in the background (the purge only touches messages from
           before this point in time, so the fresh ones are safe). */
        const instance = Client.client.getInstance(guildId);
        for (const key of Object.keys(instance.informationMessageId)) {
            instance.informationMessageId[key] = null;
        }
        Client.client.setInstance(guildId, instance);

        module.exports.purgeTextChannel(guildId, 'information');
    },

    getDiscordFormattedDate: function (unixtime) {
        return `<t:${unixtime}:d>`;
    },
}
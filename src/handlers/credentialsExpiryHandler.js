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
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const InstanceUtils = require('../util/instanceUtils.js');

const EXPIRY_WARNING_THRESHOLD_SECONDS = 3 * 24 * 60 * 60; /* Warn 3 days before expiry. */

module.exports = {
    handler: async function (client) {
        for (const guildItem of client.guilds.cache) {
            try {
                await module.exports.checkGuildCredentials(client, guildItem[0]);
            }
            catch (e) {
                client.log(client.intlGet(null, 'errorCap'), `credentialsExpiryHandler: ${e}`, 'error');
            }
        }
    },

    checkGuildCredentials: async function (client, guildId) {
        const instance = client.getInstance(guildId);
        if (!instance) return;

        const credentials = InstanceUtils.readCredentialsFile(guildId);
        const nowSeconds = Math.floor(Date.now() / 1000);
        let changed = false;

        for (const steamId of Object.keys(credentials)) {
            if (steamId === 'hoster') continue;

            const expireTimestamp = InstanceUtils.getCredentialExpireTimestamp(credentials[steamId]);
            if (expireTimestamp === null) continue;

            if (!credentials[steamId].expiry_notified) credentials[steamId].expiry_notified = {};
            const notified = credentials[steamId].expiry_notified;

            if (nowSeconds >= expireTimestamp) {
                if (notified.expired) continue;

                await module.exports.sendExpiryMessage(client, guildId, steamId, credentials[steamId],
                    expireTimestamp, true, credentials.hoster === steamId);
                notified.expired = true;
                changed = true;
            }
            else if ((expireTimestamp - nowSeconds) <= EXPIRY_WARNING_THRESHOLD_SECONDS) {
                if (notified.expiring) continue;

                await module.exports.sendExpiryMessage(client, guildId, steamId, credentials[steamId],
                    expireTimestamp, false, credentials.hoster === steamId);
                notified.expiring = true;
                changed = true;
            }
        }

        if (changed) InstanceUtils.writeCredentialsFile(guildId, credentials);
    },

    sendExpiryMessage: async function (client, guildId, steamId, credential, expireTimestamp, isExpired, isHoster) {
        const instance = client.getInstance(guildId);

        const str = client.intlGet(guildId, isExpired ? 'credentialsExpired' : 'credentialsExpireSoon', {
            steamId: steamId,
            time: `<t:${expireTimestamp}:R>`
        });

        const content = {
            embeds: [DiscordEmbeds.getEmbed({
                color: isExpired ? Constants.COLOR_INACTIVE : Constants.COLOR_DEFAULT,
                title: client.intlGet(guildId, 'fcmCredentials'),
                description: `${isExpired ? '⚠️ ' : ''}${str}` +
                    (isHoster ? `\n${client.intlGet(guildId, 'credentialsExpireHosterNote')}` : ''),
                timestamp: true
            })],
            content: `<@${credential.discord_user_id}>`
        };

        await DiscordMessages.sendMessage(guildId, content, null, instance.channelId.activity);
        client.log(client.intlGet(null, 'warningCap'), str);
    },
}

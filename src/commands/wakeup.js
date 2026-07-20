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

const Builder = require('@discordjs/builders');

const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const Ntfy = require('../util/ntfy.js');

module.exports = {
    name: 'wakeup',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('wakeup')
            .setDescription(client.intlGet(guildId, 'commandsWakeupDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('set')
                .setDescription(client.intlGet(guildId, 'commandsWakeupSetDesc'))
                .addStringOption(option => option
                    .setName('topic')
                    .setDescription(client.intlGet(guildId, 'commandsWakeupSetTopicDesc'))
                    .setRequired(true))
                .addStringOption(option => option
                    .setName('server')
                    .setDescription(client.intlGet(guildId, 'commandsWakeupSetServerDesc'))
                    .setRequired(false)))
            .addSubcommand(subcommand => subcommand
                .setName('test')
                .setDescription(client.intlGet(guildId, 'commandsWakeupTestDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('show')
                .setDescription(client.intlGet(guildId, 'commandsWakeupShowDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('clear')
                .setDescription(client.intlGet(guildId, 'commandsWakeupClearDesc')));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;
        const instance = client.getInstance(guildId);

        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        if (!instance.hasOwnProperty('ntfy')) instance.ntfy = { topic: null, server: null };

        switch (interaction.options.getSubcommand()) {
            case 'set': {
                const topic = interaction.options.getString('topic').trim();
                let server = interaction.options.getString('server');

                if (!/^[-_A-Za-z0-9]{1,64}$/.test(topic)) {
                    const str = client.intlGet(guildId, 'wakeupInvalidTopic');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    client.log(client.intlGet(null, 'warningCap'), str);
                    return;
                }

                if (server !== null) {
                    server = server.trim().replace(/\/+$/, '');
                    if (!/^https?:\/\/.+/.test(server)) {
                        const str = client.intlGet(guildId, 'wakeupInvalidServer');
                        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                        client.log(client.intlGet(null, 'warningCap'), str);
                        return;
                    }
                }

                instance.ntfy = { topic: topic, server: server };
                client.setInstance(guildId, instance);

                const str = client.intlGet(guildId, 'wakeupTopicSet', { topic: topic });
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str));
                client.log(client.intlGet(null, 'infoCap'), str);
            } break;

            case 'test': {
                if (!Ntfy.isConfigured(guildId)) {
                    const str = client.intlGet(guildId, 'wakeupNotConfigured');
                    await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
                    return;
                }

                const successful = await Ntfy.sendAlarmNotification(guildId,
                    client.intlGet(guildId, 'wakeupTestTitle'),
                    client.intlGet(guildId, 'wakeupTestMessage'));

                const str = successful ?
                    client.intlGet(guildId, 'wakeupTestSent') :
                    client.intlGet(guildId, 'wakeupTestFailed');
                await client.interactionEditReply(interaction,
                    DiscordEmbeds.getActionInfoEmbed(successful ? 0 : 1, str));
                client.log(client.intlGet(null, 'infoCap'), str);
            } break;

            case 'show': {
                let str = '';
                if (!Ntfy.isConfigured(guildId)) {
                    str = client.intlGet(guildId, 'wakeupNotConfigured');
                }
                else {
                    str = client.intlGet(guildId, 'wakeupShow', {
                        topic: instance.ntfy.topic,
                        server: instance.ntfy.server ?? 'https://ntfy.sh'
                    });
                    if (!instance.generalSettings.wakeupCallEnabled) {
                        str += ' ' + client.intlGet(guildId, 'wakeupShowDisabledViaSettings');
                    }
                }
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str));
            } break;

            case 'clear': {
                instance.ntfy = { topic: null, server: null };
                client.setInstance(guildId, instance);

                const str = client.intlGet(guildId, 'wakeupCleared');
                await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(0, str));
                client.log(client.intlGet(null, 'infoCap'), str);
            } break;

            default: {
            } break;
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `${interaction.options.getSubcommand()}`
        }));
    },
};

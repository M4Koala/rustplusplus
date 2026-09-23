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

const Constants = require('../util/constants.js');
const DiscordEmbeds = require('../discordTools/discordEmbeds.js');
const PlayerResolver = require('../util/playerResolver.js');

module.exports = {
    name: 'lookup',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('lookup')
            .setDescription(client.intlGet(guildId, 'commandsLookupDesc'))
            .addStringOption(option => option
                .setName('name')
                .setDescription(client.intlGet(guildId, 'commandsLookupNameDesc'))
                .setRequired(true));
    },

    async execute(client, interaction) {
        const guildId = interaction.guildId;

        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        const name = interaction.options.getString('name');
        const { candidates, errors } = await PlayerResolver.resolveName(client, guildId, name);

        let str;
        if (candidates.length === 0) {
            str = client.intlGet(guildId, 'lookupNotFound', { name: name });
            if (errors.length !== 0) {
                str += `\n${client.intlGet(guildId, 'lookupErrors')}: ${errors.join(', ')}`;
            }
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, str));
            return;
        }

        const lines = candidates.map(e =>
            `**${e.name}** — ${e.server}, ${Math.round(e.time / 60)} min`);

        await client.interactionEditReply(interaction, {
            embeds: [DiscordEmbeds.getEmbed({
                color: Constants.COLOR_SETTINGS,
                title: client.intlGet(guildId, 'lookupTitle', { name: name }),
                description: `${lines.slice(0, 15).join('\n')}\n\n` +
                    client.intlGet(guildId, 'lookupHowTo') +
                    (errors.length !== 0 ? `\n_${client.intlGet(guildId, 'lookupErrors')}: ${errors.join(', ')}_` : '')
            })]
        });
    },
};

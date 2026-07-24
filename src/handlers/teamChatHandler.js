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

const DiscordMessages = require('../discordTools/discordMessages.js');

module.exports = async function (rustplus, client, message) {
    /* Never relay a prefixed message (a recognized command, a mistyped one, or anything else
       starting with the command prefix) to Discord team chat. */
    const prefix = rustplus.generalSettings.prefix;
    if (prefix !== '' && message.message.startsWith(prefix)) {
        rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'teamChatRelaySuppressed', {
            message: message.message
        }));
        return;
    }

    await DiscordMessages.sendTeamChatMessage(rustplus.guildId, message);
}
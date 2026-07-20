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

const Client = require('../../index.ts');

const DEFAULT_SERVER = 'https://ntfy.sh';

module.exports = {
    isConfigured: function (guildId) {
        const instance = Client.client.getInstance(guildId);
        return instance.ntfy && instance.ntfy.topic !== null;
    },

    /* Send a max priority ntfy notification. Subscribers with insistent alarm enabled in the ntfy
       app get woken up even through Do Not Disturb. Never throws. Returns true on success. */
    sendAlarmNotification: async function (guildId, title, message) {
        const instance = Client.client.getInstance(guildId);
        if (!instance.ntfy || instance.ntfy.topic === null) return false;

        const server = instance.ntfy.server ?? DEFAULT_SERVER;

        try {
            /* JSON publishing, plain POST to the topic would require latin1-only headers for
               title. https://docs.ntfy.sh/publish/#publish-as-json */
            const response = await fetch(server, {
                method: 'POST',
                body: JSON.stringify({
                    topic: instance.ntfy.topic,
                    title: title,
                    message: message,
                    priority: 5,
                    tags: ['rotating_light']
                })
            });

            if (!response.ok) {
                Client.client.log(Client.client.intlGet(null, 'warningCap'),
                    Client.client.intlGet(null, 'ntfySendFailed', {
                        error: `${response.status} ${response.statusText}`
                    }));
                return false;
            }
            return true;
        }
        catch (e) {
            Client.client.log(Client.client.intlGet(null, 'warningCap'),
                Client.client.intlGet(null, 'ntfySendFailed', { error: e }));
            return false;
        }
    },
}

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

const Fs = require('fs');
const Path = require('path');

const Client = require('../../index.ts');

module.exports = {
    getSmartDevice: function (guildId, entityId) {
        /* Temporary function till discord modals gets more functional */
        const instance = Client.client.getInstance(guildId);

        for (const serverId in instance.serverList) {
            for (const switchId in instance.serverList[serverId].switches) {
                if (entityId === switchId) return { type: 'switch', serverId: serverId }
            }
            for (const alarmId in instance.serverList[serverId].alarms) {
                if (entityId === alarmId) return { type: 'alarm', serverId: serverId }
            }
            for (const storageMonitorId in instance.serverList[serverId].storageMonitors) {
                if (entityId === storageMonitorId) return { type: 'storageMonitor', serverId: serverId }
            }
        }
        return null;
    },

    readInstanceFile: function (guildId) {
        const path = Path.join(__dirname, '..', '..', 'instances', `${guildId}.json`);
        return JSON.parse(Fs.readFileSync(path, 'utf8'));
    },

    writeInstanceFile: function (guildId, instance) {
        const path = Path.join(__dirname, '..', '..', 'instances', `${guildId}.json`);
        Fs.writeFileSync(path, JSON.stringify(instance, null, 2));
    },

    readCredentialsFile: function (guildId) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        return JSON.parse(Fs.readFileSync(path, 'utf8'));
    },

    writeCredentialsFile: function (guildId, credentials) {
        const path = Path.join(__dirname, '..', '..', 'credentials', `${guildId}.json`);
        Fs.writeFileSync(path, JSON.stringify(credentials, null, 2));
    },

    parseDateToUnixTimestamp: function (value) {
        /* Parses a date of unknown format (unix seconds, unix milliseconds or a Date-parseable
           string) into unix seconds. Returns null if the date could not be parsed. */
        if (value === null || value === undefined) return null;
        const str = `${value}`.trim();
        if (str === '') return null;

        if (/^\d+$/.test(str)) {
            const num = parseInt(str);
            /* Values above 100000000000 are unix milliseconds (year >5138 in seconds). */
            return num > 100000000000 ? Math.floor(num / 1000) : num;
        }

        const ms = Date.parse(str);
        if (!isNaN(ms)) return Math.floor(ms / 1000);

        return null;
    },

    getCredentialExpireTimestamp: function (credential) {
        /* Returns the expire date of a credential entry as unix seconds, or null if unknown. */
        if (!credential) return null;
        return module.exports.parseDateToUnixTimestamp(credential.expire_date);
    },
}

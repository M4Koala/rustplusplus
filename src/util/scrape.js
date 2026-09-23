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

const Axios = require('axios');

const Constants = require('../util/constants.js');
const Utils = require('../util/utils.js');

module.exports = {
    scrape: async function (url) {
        try {
            return await Axios.get(url);
        }
        catch (e) {
            return {};
        }
    },

    scrapeSteamProfilePicture: async function (client, steamId) {
        const response = await module.exports.scrape(`${Constants.STEAM_PROFILES_URL}${steamId}`);

        if (response.status !== 200) {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'failedToScrapeProfilePicture', {
                link: `${Constants.STEAM_PROFILES_URL}${steamId}`
            }), 'error');
            return null;
        }

        let png = response.data.match(/<img src="(.*_full.jpg)(.*?(?="))/);
        if (png) {
            return png[1];
        }

        return null;
    },

    /* { steamId, name } from what people copy off Steam: the SteamID64 itself, a
       /profiles/<id> link, or a custom /id/<name> link (or the bare custom name, which can
       look like a long number). Custom URLs are resolved via the profile's public XML, which
       also carries the profile name (otherwise name is null). Null when no profile matches;
       throws when Steam does not answer (steamcommunity throttles bursts). */
    resolveSteamProfile: async function (input) {
        const text = `${input}`.trim();
        if (/^\d{17}$/.test(text)) return { steamId: text, name: null };

        const profileLink = text.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
        if (profileLink) return { steamId: profileLink[1], name: null };

        const customLink = text.match(/steamcommunity\.com\/id\/([^/?#\s]+)/i);
        const customName = customLink ? customLink[1] : text;
        if (!/^[A-Za-z0-9_-]{2,32}$/.test(customName)) return null;

        const response = await module.exports.scrape(`${Constants.STEAM_CUSTOM_URL}${customName}/?xml=1`);
        if (response.status !== 200) throw new Error('Steam community did not answer');
        const steamId = /<steamID64>(\d{17})<\/steamID64>/.exec(response.data);
        if (!steamId) return null;
        const name = /<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/s.exec(response.data);
        return { steamId: steamId[1], name: name && name[1] !== '' ? name[1] : null };
    },

    scrapeSteamProfileName: async function (client, steamId) {
        const response = await module.exports.scrape(`${Constants.STEAM_PROFILES_URL}${steamId}`);

        if (response.status !== 200) {
            client.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'failedToScrapeProfileName', {
                link: `${Constants.STEAM_PROFILES_URL}${steamId}`
            }), 'error');
            return null;
        }

        let regex = new RegExp(`class="actual_persona_name">(.+?)</span>`, 'gm');
        let data = regex.exec(response.data);
        if (data) {
            return Utils.decodeHtml(data[1]);
        }

        return null;
    },
}
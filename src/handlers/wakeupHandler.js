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

const Ntfy = require('../util/ntfy.js');

const WAKEUP_GRACE_TIME_SECONDS = 60;   /* Time an online teammate has to stand down the wake-up. */
const WAKEUP_MUTE_TIME_MINUTES = 5;     /* Default mute duration when the stand-down command is used bare. */
const WAKEUP_MUTE_TIME_MAX_MINUTES = 1440; /* Cap on a custom duration, a fat-fingered digit shouldn't mute wake-ups for days. */

module.exports = {
    /* Request a phone wake-up for a triggered alarm. If a teammate is online in-game, the wake-up
       is delayed by a grace period and announced in team chat so the teammate can stand it down
       (accidental trigger, trolling). Otherwise it is sent immediately. */
    requestWakeup: function (client, rustplus, guildId, title, message) {
        if (!Ntfy.isConfigured(guildId)) return;

        /* Fetched fresh rather than trusting rustplus.generalSettings, since rustplus can be
           null (alarm on a server the bot isn't currently connected to). */
        const instance = client.getInstance(guildId);
        if (!instance.generalSettings.wakeupCallEnabled) return;

        if (rustplus && rustplus.wakeupMutedUntil !== null) {
            if (Date.now() < rustplus.wakeupMutedUntil) {
                client.log(client.intlGet(null, 'infoCap'),
                    client.intlGet(null, 'wakeupSkippedMuted', { title: title }));
                return;
            }
            rustplus.wakeupMutedUntil = null;
        }

        /* A countdown is already running, this trigger is covered by it. */
        if (rustplus && rustplus.wakeupGraceTimeout !== null) return;

        const anyoneOnline = rustplus && rustplus.team !== null &&
            rustplus.team.players.some(e => e.isOnline);
        if (!anyoneOnline) {
            /* No one in-game to stand it down, send right away. */
            Ntfy.sendAlarmNotification(guildId, title, message);
            return;
        }

        const prefix = rustplus.generalSettings.prefix;
        rustplus.sendInGameMessage(client.intlGet(guildId, 'wakeupGraceWarning', {
            title: title,
            seconds: WAKEUP_GRACE_TIME_SECONDS,
            command: `${prefix}${client.intlGet(guildId, 'commandSyntaxNo')}`,
            minutes: WAKEUP_MUTE_TIME_MINUTES
        }));

        rustplus.wakeupGraceTimeout = setTimeout(() => {
            rustplus.wakeupGraceTimeout = null;
            Ntfy.sendAlarmNotification(guildId, title, message);
        }, WAKEUP_GRACE_TIME_SECONDS * 1000);
    },

    /* The in-game/discord stand-down command: cancel a pending wake-up and mute wake-ups for a
       while. `command` is the raw command text, e.g. "!no" or "!no 20" for a custom duration in
       minutes (defaults to WAKEUP_MUTE_TIME_MINUTES, invalid or missing numbers fall back to the
       default). Returns the response message. */
    standDown: function (client, rustplus, command) {
        const wasPending = rustplus.wakeupGraceTimeout !== null;
        if (wasPending) {
            clearTimeout(rustplus.wakeupGraceTimeout);
            rustplus.wakeupGraceTimeout = null;
        }

        let muteMinutes = WAKEUP_MUTE_TIME_MINUTES;
        if (command) {
            const words = command.trim().split(/\s+/);
            const arg = words[words.length - 1];
            const parsed = parseInt(arg, 10);
            if (String(parsed) === arg && parsed > 0) {
                muteMinutes = Math.min(parsed, WAKEUP_MUTE_TIME_MAX_MINUTES);
            }
        }

        rustplus.wakeupMutedUntil = Date.now() + muteMinutes * 60 * 1000;

        return client.intlGet(rustplus.guildId, wasPending ? 'wakeupStoodDown' : 'wakeupMuted', {
            minutes: muteMinutes
        });
    },
}

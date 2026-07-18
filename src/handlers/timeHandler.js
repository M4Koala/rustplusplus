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

const _ = require('lodash');

const Constants = require('../util/constants.js');

module.exports = {
    handler: function (rustplus, client, time) {
        /* Check time changes */
        module.exports.checkChanges(rustplus, client, time);
    },

    checkChanges: function (rustplus, client, time) {
        if (rustplus.time.timeTillActive) return;

        const prevTime = rustplus.time.time;
        const newTime = time.time;

        if (rustplus.isFirstPoll) {
            if (rustplus.stateRestoredAt !== null) {
                /* The time tracking state was restored from before a disconnect, compensate
                   for the offline gap instead of restarting the learning. */
                module.exports.handleReconnectGap(rustplus, client, time, prevTime, newTime);
            }
            else {
                rustplus.time.startTime = newTime;
                rustplus.startTimeObject[newTime] = 0;
            }
            return;
        }

        const distance = (prevTime > newTime) ? (24 - prevTime) + newTime : newTime - prevTime;
        if (distance > 1) {
            /* Too big of a jump for a normal server, might have been a skip night server */
            rustplus.log(client.intlGet(null, 'errorCap'), client.intlGet(null, 'invalidTimeDistance', {
                distance: distance,
                prevTime: prevTime,
                newTime: newTime
            }), 'error');
            rustplus.passedFirstSunriseOrSunset = false;
            rustplus.time.startTime = newTime;
            rustplus.time.timeTillDay = new Object();
            rustplus.time.timeTillNight = new Object();
            rustplus.startTimeObject = new Object();
            rustplus.startTimeObject[newTime] = 0;
            return;
        }

        if (!rustplus.passedFirstSunriseOrSunset) {
            const a = (rustplus.time.startTime >= time.sunrise && rustplus.time.startTime < time.sunset) &&
                (newTime >= time.sunset || newTime < time.sunrise);
            const b = (rustplus.time.startTime >= time.sunset || rustplus.time.startTime < time.sunrise) &&
                (newTime >= time.sunrise && newTime < time.sunset);

            for (const id in rustplus.startTimeObject) {
                rustplus.startTimeObject[id] += (client.pollingIntervalMs / 1000);
            }

            if (a || b) {
                rustplus.passedFirstSunriseOrSunset = true;
            }
            else {
                rustplus.startTimeObject[newTime] = 0;
                return;
            }
        }

        const a = newTime > rustplus.time.startTime && prevTime < rustplus.time.startTime && newTime > prevTime;
        const b = newTime < rustplus.time.startTime && prevTime < rustplus.time.startTime && newTime < prevTime;
        const c = newTime > rustplus.time.startTime && prevTime > rustplus.time.startTime && newTime < prevTime;

        /* If 24 hours in-game time have passed */
        if (a || b || c) {
            /* Merge startTimeObject with correct object */
            let highestValue = 0;
            for (const id in rustplus.startTimeObject) {
                if (rustplus.startTimeObject[id] > highestValue) {
                    highestValue = rustplus.startTimeObject[id];
                }
            }

            if (rustplus.time.startTime >= time.sunrise && rustplus.time.startTime < time.sunset) {
                for (const id in rustplus.time.timeTillNight) {
                    rustplus.time.timeTillNight[id] += highestValue;
                }

                rustplus.time.timeTillNight = _.merge(rustplus.startTimeObject, rustplus.time.timeTillNight);
            }
            else {
                for (const id in rustplus.time.timeTillDay) {
                    rustplus.time.timeTillDay[id] += highestValue;
                }

                rustplus.time.timeTillDay = _.merge(rustplus.startTimeObject, rustplus.time.timeTillDay);
            }

            rustplus.time.timeTillActive = true;

            const instance = client.getInstance(rustplus.guildId);

            instance.serverList[rustplus.serverId].timeTillDay = rustplus.time.timeTillDay;
            instance.serverList[rustplus.serverId].timeTillNight = rustplus.time.timeTillNight;
            client.setInstance(rustplus.guildId, instance);

            rustplus.log(client.intlGet(null, 'timeCap'), client.intlGet(null, '24HoursInGameTimePassed'));
            return;
        }

        if (newTime >= time.sunrise && newTime < time.sunset) { /* It's Day */
            for (const id in rustplus.time.timeTillNight) {
                rustplus.time.timeTillNight[id] += (client.pollingIntervalMs / 1000);
            }

            rustplus.time.timeTillNight[newTime] = 0;
        }
        else { /* It's Night */
            for (const id in rustplus.time.timeTillDay) {
                rustplus.time.timeTillDay[id] += (client.pollingIntervalMs / 1000);
            }

            rustplus.time.timeTillDay[newTime] = 0;
        }
    },

    handleReconnectGap: function (rustplus, client, time, prevTime, newTime) {
        /* prevTime is the last in-game time seen before the disconnect. The learning
           accumulators count real seconds, so a short offline gap can be compensated by
           adding the offline wall-clock time to them. */
        const gapSeconds = (Date.now() - rustplus.stateRestoredAt) / 1000;
        const wasDay = (prevTime >= time.sunrise) && (prevTime < time.sunset);
        const isDay = (newTime >= time.sunrise) && (newTime < time.sunset);
        const crossedStartTime = module.exports.crossedTimePoint(prevTime, newTime, rustplus.time.startTime);

        if (gapSeconds > Constants.MAX_TIME_LEARNING_GAP_SECONDS || wasDay !== isDay || crossedStartTime) {
            /* Too much happened while offline. Restart the in-progress learning cycle, but
               keep the already learned timeTillDay/timeTillNight tables (when active). */
            rustplus.passedFirstSunriseOrSunset = false;
            rustplus.time.startTime = newTime;
            rustplus.time.timeTillDay = new Object();
            rustplus.time.timeTillNight = new Object();
            rustplus.startTimeObject = new Object();
            rustplus.startTimeObject[newTime] = 0;
            return;
        }

        /* Short gap within the same day/night phase, compensate the accumulators. */
        for (const id in rustplus.startTimeObject) {
            rustplus.startTimeObject[id] += gapSeconds;
        }

        if (rustplus.passedFirstSunriseOrSunset) {
            if (isDay) {
                for (const id in rustplus.time.timeTillNight) {
                    rustplus.time.timeTillNight[id] += gapSeconds;
                }
                rustplus.time.timeTillNight[newTime] = 0;
            }
            else {
                for (const id in rustplus.time.timeTillDay) {
                    rustplus.time.timeTillDay[id] += gapSeconds;
                }
                rustplus.time.timeTillDay[newTime] = 0;
            }
        }
        else {
            rustplus.startTimeObject[newTime] = 0;
        }
    },

    crossedTimePoint: function (from, to, point) {
        /* Whether the in-game clock passed a time point while moving from -> to (with
           midnight wrap-around). */
        if (from === to) return false;
        if (from < to) return point > from && point <= to;
        return point > from || point <= to;
    }
}
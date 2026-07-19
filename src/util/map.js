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

module.exports = {
    /* One in-game map grid cell is 146.3 world units (the constant in the game's decompiled
       MapHelpers, also used by community grid plugins). 146.25 (used upstream) and 1024/7
       (146.2857..., used by some companion tools) put the cell borders slightly west of the
       in-game ones, verified on a live server: a shop just west of an in-game border was
       reported one column too far east with 1024/7. */
    gridDiameter: 146.3,

    getPos: function (x, y, mapSize, rustplus) {
        const pos = { location: null, monument: null, string: null, x: x, y: y }

        if (module.exports.isOutsideGridSystem(x, y, mapSize)) {
            if (module.exports.isOutsideRowOrColumn(x, y, mapSize)) {
                if (x < 0 && y > mapSize) {
                    pos.location = Client.client.intlGet(rustplus.guildId, 'northWest');
                }
                else if (x < 0 && y < 0) {
                    pos.location = Client.client.intlGet(rustplus.guildId, 'southWest');
                }
                else if (x > mapSize && y > mapSize) {
                    pos.location = Client.client.intlGet(rustplus.guildId, 'northEast');
                }
                else {
                    pos.location = Client.client.intlGet(rustplus.guildId, 'southEast');
                }
            }
            else {
                let str = '';
                if (x < 0 || x > mapSize) {
                    str += (x < 0) ? Client.client.intlGet(rustplus.guildId, 'westOfGrid') :
                        Client.client.intlGet(rustplus.guildId, 'eastOfGrid');
                    str += ` ${module.exports.getGridPosNumberY(y, mapSize)}`;
                }
                else {
                    str += (y < 0) ? Client.client.intlGet(rustplus.guildId, 'southOfGrid') :
                        Client.client.intlGet(rustplus.guildId, 'northOfGrid');
                    str += ` ${module.exports.getGridPosLettersX(x, mapSize)}`;
                }
                pos.location = str;
            }
        }
        else {
            pos.location = module.exports.getGridPos(x, y, mapSize);
        }

        for (const monument of rustplus.map.monuments) {
            if (monument.token === 'DungeonBase' || !(monument.token in rustplus.map.monumentInfo)) continue;
            if (module.exports.getDistance(x, y, monument.x, monument.y) <=
                rustplus.map.monumentInfo[monument.token].radius) {
                pos.monument = rustplus.map.monumentInfo[monument.token].clean;
                break;
            }
        }

        pos.string = `${pos.location}${pos.monument !== null ? ` (${pos.monument})` : ''}`;

        return pos;
    },

    getGridPos: function (x, y, mapSize) {
        /* Outside the grid system */
        if (module.exports.isOutsideGridSystem(x, y, mapSize)) {
            return null;
        }

        const gridPosLetters = module.exports.getGridPosLettersX(x, mapSize);
        const gridPosNumber = module.exports.getGridPosNumberY(y, mapSize);

        return gridPosLetters + gridPosNumber;
    },

    /* The in-game grid is anchored at the top-left of the world: column A starts at the west
       edge, row 0 at the north edge (y = mapSize). When the world size is not a multiple of
       the cell size, the partial cells are the east-most column and the south-most row —
       they still count as their own grid on the in-game map, so no size "correction". */

    getGridPosLettersX: function (x, mapSize) {
        const numberOfGrids = Math.ceil(mapSize / module.exports.gridDiameter);
        let grid = Math.floor(x / module.exports.gridDiameter);
        grid = Math.max(0, Math.min(grid, numberOfGrids - 1));
        return module.exports.numberToLetters(grid + 1);
    },

    getGridPosNumberY: function (y, mapSize) {
        const numberOfGrids = Math.ceil(mapSize / module.exports.gridDiameter);
        let grid = Math.floor((mapSize - y) / module.exports.gridDiameter);
        grid = Math.max(0, Math.min(grid, numberOfGrids - 1));
        return grid;
    },

    numberToLetters: function (num) {
        const mod = num % 26;
        let pow = num / 26 | 0;
        const out = mod ? String.fromCharCode(64 + mod) : (pow--, 'Z');
        return pow ? module.exports.numberToLetters(pow) + out : out;
    },

    getCorrectedMapSize: function (mapSize) {
        /* The in-game grid uses the raw world size (partial edge cells included), so no
           rounding is done anymore. Kept so existing correctedMapSize consumers keep
           working — it is simply the actual map size now. */
        return mapSize;
    },

    getAngleBetweenPoints: function (x1, y1, x2, y2) {
        let angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;

        if (angle < 0) {
            angle = 360 + angle;
        }

        return Math.floor((Math.abs(angle - 360) + 90) % 360);
    },

    getDistance: function (x1, y1, x2, y2) {
        /* Pythagoras is the man! */
        const a = x1 - x2;
        const b = y1 - y2;
        return Math.sqrt(a * a + b * b);
    },

    isOutsideGridSystem: function (x, y, mapSize, offset = 0) {
        if (x < -offset || x > (mapSize + offset) || y < -offset || y > (mapSize + offset)) {
            return true;
        }
        return false;
    },

    isOutsideRowOrColumn: function (x, y, mapSize) {
        if ((x < 0 && y > mapSize) || (x < 0 && y < 0) || (x > mapSize && y > mapSize) || (x > mapSize && y < 0)) {
            return true;
        }
        return false;
    },
}
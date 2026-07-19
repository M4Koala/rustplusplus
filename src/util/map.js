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
    /* Nominal grid cell size. Only used to derive the number of grid cells of a map — the
       real cell size is mapSize / numberOfGrids: the in-game grid stretches so that a whole
       number of cells exactly fills the map, there are no partial edge cells. Verified by
       on-map border measurements on a live 3750 server: 25 cells of exactly 150.0 each
       (borders at x=300.0 for B/C and x=3150 for U/V), while every fixed cell size
       (146.25, 1024/7, 146.3) put the borders in the wrong place. */
    gridDiameter: 146.25,

    getNumberOfGrids: function (mapSize) {
        /* The 120 threshold for rounding the cell count up/down matches the long-standing
           upstream heuristic (its "corrected map size"), which produced the correct cell
           count — just not the correct cell size/anchoring. */
        const remainder = mapSize % module.exports.gridDiameter;
        const count = Math.floor(mapSize / module.exports.gridDiameter);
        return Math.max(1, (remainder < 120) ? count : count + 1);
    },

    getGridCellSize: function (mapSize) {
        return mapSize / module.exports.getNumberOfGrids(mapSize);
    },

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

    /* The grid covers the map exactly: column A starts at the west edge, row 0 at the north
       edge (y = mapSize), and the last column/row ends exactly at the opposite edge. */

    getGridPosLettersX: function (x, mapSize) {
        const numberOfGrids = module.exports.getNumberOfGrids(mapSize);
        let grid = Math.floor(x / module.exports.getGridCellSize(mapSize));
        grid = Math.max(0, Math.min(grid, numberOfGrids - 1));
        return module.exports.numberToLetters(grid + 1);
    },

    getGridPosNumberY: function (y, mapSize) {
        const numberOfGrids = module.exports.getNumberOfGrids(mapSize);
        let grid = Math.floor((mapSize - y) / module.exports.getGridCellSize(mapSize));
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
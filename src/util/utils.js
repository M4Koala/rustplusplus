/*
    Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)

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

module.exports = {
    parseArgs: function (str) {
        return str.trim().split(/[ ]+/);
    },

    getArgs: function (str, n = 0) {
        const args = this.parseArgs(str);
        if (isNaN(n)) n = 0;
        if (n < 1) return args;
        const newArgs = [];

        let remain = str;
        let counter = 1;
        for (const arg of args) {
            if (counter === n) {
                newArgs.push(remain);
                break;
            }
            remain = remain.slice(arg.length).trim();
            newArgs.push(arg);
            counter += 1;
        }

        return newArgs;
    },

    decodeHtml: function (str) {
        const htmlReservedSymbols = JSON.parse(Fs.readFileSync(
            Path.join(__dirname, '..', 'staticFiles', 'htmlReservedSymbols.json'), 'utf8'));

        for (const [key, value] of Object.entries(htmlReservedSymbols)) {
            str = str.replace(key, value);
        }

        return str;
    },

    removeInvisibleCharacters: function (str) {
        str = str.replace(/[\u200B-\u200D\uFEFF]/g, '');
        return str.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
    },

    findClosestString: function (string, array, threshold = 2) {
        let minDistance = Infinity;
        let closestString = null;

        for (let i = 0; i < array.length; i++) {
            const currentString = array[i];
            const distance = levenshteinDistance(string, currentString);

            if (distance < minDistance) {
                minDistance = distance;
                closestString = currentString;
            }

            if (minDistance === 0) break;
        }

        if (minDistance <= threshold) return closestString;

        /* No close-enough match. Try partial matching, e.g. 'blueprint fragment' should
           match 'Basic Blueprint Fragment'. The shortest matching entry wins (most specific). */
        const searchLower = string.toLowerCase().trim();
        if (searchLower === '') return null;

        /* Entries that contain the search string as a substring. */
        let substringMatch = null;
        for (const currentString of array) {
            if (currentString.toLowerCase().includes(searchLower)) {
                if (substringMatch === null || currentString.length < substringMatch.length) {
                    substringMatch = currentString;
                }
            }
        }
        if (substringMatch !== null) return substringMatch;

        /* Entries that contain every word of the search string, e.g. 'adv blueprint frag'
           should match 'Advanced Blueprint Fragment'. */
        const searchWords = searchLower.split(/\s+/);
        let wordsMatch = null;
        for (const currentString of array) {
            const currentLower = currentString.toLowerCase();
            if (searchWords.every(word => currentLower.includes(word))) {
                if (wordsMatch === null || currentString.length < wordsMatch.length) {
                    wordsMatch = currentString;
                }
            }
        }
        return wordsMatch;
    },
}

/* Function to calculate Levenshtein distance between two strings */
function levenshteinDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const m = s1.length;
    const n = s2.length;
    const dp = [];

    for (let i = 0; i <= m; i++) {
        dp[i] = [i];
    }
    for (let j = 0; j <= n; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            }
            else {
                dp[i][j] = 1 + Math.min(
                    dp[i - 1][j],
                    dp[i][j - 1],
                    dp[i - 1][j - 1]
                );
            }
        }
    }

    return dp[m][n];
}
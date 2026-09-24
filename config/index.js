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

module.exports = {
    general: {
        language: process.env.RPP_LANGUAGE || 'en',
        pollingIntervalMs: process.env.RPP_POLLING_INTERVAL || 10000,
        showCallStackError: process.env.RPP_LOG_CALL_STACK || false,
        reconnectIntervalMs: process.env.RPP_RECONNECT_INTERVAL || 15000,
        /* How long the Rust+ connection must stay down before it is announced: as "connection
           lost" while the game server is up, as offline when no game server status is known. */
        offlineGracePeriodMs: process.env.RPP_OFFLINE_GRACE_PERIOD || 60000,
        /* Game server online/offline from direct Steam server queries of the active server
           (handlers/gameServerStatusHandler.js). Polls every POLL_INTERVAL while it answers,
           every FAST_POLL_INTERVAL while it is down or late; offline after OFFLINE_AFTER
           without an answer (sooner when the host reports the port closed). */
        gameServerMonitor: (process.env.RPP_GAME_SERVER_MONITOR ?? 'true') !== 'false',
        gameServerPollIntervalMs: parseInt(process.env.RPP_GAME_SERVER_POLL_INTERVAL) || 1000,
        gameServerFastPollIntervalMs: parseInt(process.env.RPP_GAME_SERVER_FAST_POLL_INTERVAL) || 250,
        gameServerOfflineAfterMs: parseInt(process.env.RPP_GAME_SERVER_OFFLINE_AFTER) || 10000,
    },
    discord: {
        username: process.env.RPP_DISCORD_USERNAME || 'rustplusplus',
        clientId: process.env.RPP_DISCORD_CLIENT_ID || '',
        token: process.env.RPP_DISCORD_TOKEN || '',
        needAdminPrivileges: process.env.RPP_NEED_ADMIN_PRIVILEGES || true, /* If true, only admins can delete (server, switch..), manage credentials and reset a channel */
        /* If false, the bot never touches channel/category permission overwrites, so manually
           configured permissions on the rustplusplus category/channels are left alone. */
        manageChannelPermissions: (process.env.RPP_MANAGE_CHANNEL_PERMISSIONS ?? 'true') !== 'false',
    },
    battlemetrics: {
        /* Personal access token from https://www.battlemetrics.com/developers, required since
           Battlemetrics started rejecting unauthenticated API requests. Empty = requests are sent
           without an Authorization header (Battlemetrics features will be unavailable). */
        token: process.env.RPP_BATTLEMETRICS_TOKEN || '',
    }
};

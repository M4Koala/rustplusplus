# Battlemetrics and Trackers

## Authentication Token

Since 19/07/2026, Battlemetrics has discontinued free usage of its service and now requires an active subscription to use the API ([source](https://discord.com/channels/202199157224636417/270701413972049921/1528494637675708417)).

Because the tracker functionality relies heavily on the Battlemetrics API, you are required to [obtain an API key](https://www.battlemetrics.com/subscription). The Basic plan should be sufficient. It was never the intention for people to have to pay to use rustplusplus, so this is unfortunate. This will remain the solution until a more permanent one is in place.

Once you've obtained your Battlemetrics token, copy it into the config file located at `config/index.js`.

The config file should look something like this (NOTE: key below is invalid):

    battlemetrics: {
        token: process.env.RPP_BATTLEMETRICS_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbiI6IjM5NzE4MDE2ZjZlYjY1NmMiLCJpYXQiOjE0NzgwMzc1MjQsIm5iZiI6MTQ3ODAzNzUyNCwiaXNzIjoiaHR0cHM6Ly93d3cuYmF0dGxlbWV0cmljcy5jb20iLCJzdWIiOiJ1cm46dXNlcjoxIn0.iwwHt2lvBxlBqcEm7HrX1b1Rb9MXcMghUY5xspluWgw'
    }

If no token is obtained, tracker functionality will be disabled.
## Free alternative: direct server query tracking (this fork)

Without a Battlemetrics token, trackers still work — they query the Rust server directly over
the Steam server browser protocol (A2S), for free:

- Every server you pair gets a tracker-capable **query address** (`ip:port`). The Rust+ app
  port does not answer queries, so the query port is looked up via Steam (keyless
  `GetServersAtAddress`); if Steam cannot tell, the default 28017 is used. Editable in the
  tracker edit modal.
- Add watched players by **SteamID64** (the bot reads their Steam profile name, which works
  for private profiles too) or by name via **Find player by name**.
- The tracker embed shows **on server / not on server**, connected-for and **hours on server
  over the last 7 days**; connect/disconnect are announced in the trackers channel.
- Limitations vs Battlemetrics: Rust's A2S player list contains **only names** (plus score
  and time on server), no SteamIDs. Matching is therefore by name, also for entries added
  by SteamID64 (their Steam name is used). Name changes need a manual rename of the
  watched entry, and servers hidden from the server browser cannot be queried.

## Find player by name

When you met someone and only know their in-game name:

- **#trackers channel**: press **Find player by name** (posted once in the channel; it comes
  back if deleted), enter (part of) the name, and every matching player online right now on
  your paired and tracker servers is listed with the server and time on it. Press the
  number button on the right one and pick the tracker. The player is added by name.
- **Discord**: `/lookup name:<name>` lists the same matches.

A SteamID cannot be looked up this way: Rust servers do not publish them. To track by
SteamID64, get it from the player's Steam profile link (`steamcommunity.com/profiles/<id>`).
Teammates' SteamIDs are available in-game via `!steamid <name>`.

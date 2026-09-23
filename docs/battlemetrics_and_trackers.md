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
## Free alternative: Steam status tracking (this fork)

Without a Battlemetrics token, trackers still work, for free, with one big limitation:
**they show whether a player is playing Rust, not on which server.**

Why: Rust servers do not reveal who is online. The public player list of a server (A2S,
the Steam server browser query) only contains a **random pseudonym per connection**
(names like "gena" or "tyrone"; a player who reconnects comes back under a new one) plus
the time on the server. No real names, no SteamIDs. So player status comes from Steam:

- Add watched players via the tracker's **Add player** by pasting their **Steam profile
  link**: both `steamcommunity.com/profiles/<SteamID64>` and custom
  `steamcommunity.com/id/<name>` links work, as do the bare SteamID64 or custom URL name.
  A custom link shows a chosen name, not the SteamID64, even when that name is a long
  number; the bot resolves it.
- The bot reads each player's public Steam profile (no API key) and shows
  :green_circle: **playing Rust** (any server) with since-when, :red_circle: not playing
  (last seen), and **hours in Rust over the last 7 days**. Start/stop is announced in the
  trackers channel. The Steam profile name is kept up to date automatically.
- **Only public profiles work.** Steam shows non-public profiles as offline to everyone;
  those players are marked :lock: private. A player can make their status visible by
  setting their Steam profile (game details) to public.
- steamcommunity refuses requests that come too often, so profiles are checked one after
  another with an adaptive gap (10 s at best; doubled after every refusal, up to 5 min).
  With 3 watched players each is checked roughly every 30-45 s when Steam is not busy.
- The tracker still queries its server directly for the server line (online, player
  count). Every paired server gets a **query address** (`ip:port`). The Rust+ app port
  does not answer queries, so the query port is looked up via Steam (keyless
  `GetServersAtAddress`); if Steam cannot tell, the default 28017 is used. Editable in the
  tracker edit modal.

Teammates' SteamIDs are available in-game via `!steamid <name>`.

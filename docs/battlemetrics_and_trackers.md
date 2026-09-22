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

- Every server you pair gets a tracker-capable **query address** (`ip:port`), editable in the
  tracker edit modal if your server's query port differs (default port 28015).
- Add watched players by **SteamID64** (their profile can be private — presence comes from the
  server's public player list, not the profile) or by name.
- The tracker embed shows **on server / not on server**, connected-for and **hours on server
  over the last 7 days**; connect/disconnect are announced in the trackers channel.
- Limitations vs Battlemetrics: matching in the player list is by name (name changes need a
  manual rename of the watched entry), and servers hidden from the server browser cannot be
  queried.

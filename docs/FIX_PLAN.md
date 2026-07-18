# Fix Plan — Wipe-cycle & Reliability Improvements

This document analyzes four long-standing problems with rustplusplus and describes the fixes
implemented in this fork. Each fix is committed separately so it can be reviewed/reverted in
isolation.

---

## Problem 1 — Credentials: expiry is invisible, re-registration is blocked

**Symptoms**
* Credentials from the browser extension expire after ~2 weeks (Rust Companion API Steam Auth
  Token TTL), but the bot never tells you when they expire or that they *have* expired.
* Running `/credentials add` again after a break fails with *"already registered"* — you must
  manually `/credentials remove` first, which is easy to get wrong months later.

**Root causes** (`src/commands/credentials.js`)
* `addCredentials()` hard-rejects when the Steam ID already exists (line ~128), instead of
  updating the stored credentials.
* `/credentials show` (`getCredentialsShowEmbed` in `discordEmbeds.js`) displays name/steamId/
  hoster but not the stored `issued_date` / `expire_date`.
* Nothing anywhere checks `expire_date` — the FCM listener keeps "running" with dead
  credentials, silently receiving nothing.

**Fix**
1. `/credentials add` with an already-registered Steam ID now **overwrites** the stored
   credentials (permission rules: the credential owner or an admin). The relevant FCM
   listener is destroyed and restarted with the new credentials automatically. No more manual
   remove-then-add.
2. `/credentials show` now displays the expiry as a Discord relative timestamp
   (`<t:..:R>` — e.g. *"in 13 days"* / *"2 months ago"*) with a ⚠️ marker for expired entries.
   Dates are parsed defensively (unix seconds/ms or any `Date`-parseable string).
3. **Expiry monitoring**: a periodic check (once per hour, plus at startup) warns in the
   `activity` channel when the hoster credentials are expired or expire within 3 days.
   Each state (expiring soon / expired) is announced only once per credential registration
   (tracked via `expiry_notified` in the credentials file).
4. New helper `getCredentialExpireTimestamp()` in `instanceUtils.js` centralizes date parsing.

---

## Problem 2 — Discord channels get recreated / unordered / duplicated on a new wipe

**Symptoms**
* After months of downtime, starting the bot recreates channels, drops them at the top of the
  guild un-grouped, leaves the old ones behind, and creates an **empty** settings channel while
  the old settings channel keeps working.
* Pairing with a new server sometimes shows nothing in the servers channel until
  `/reset discord` is run.

**Root causes** (`src/discordTools/SetupGuildChannels.js`, `SetupGuildCategory.js`,
`SetupSettingsMenu.js`, `RemoveGuildChannels.js`)
* `addTextChannel()` only calls `channel.setParent(category)` when the channel was **newly
  created** or on `firstTime` — and the call is not even awaited. An existing channel that got
  orphaned (category deleted / recreated) is never re-attached → "ungrouped and unordered".
* When a stored channel ID is stale but a channel with the right name still exists (e.g. a
  partially-failed `/reset discord`: `RemoveGuildChannels` nulls the IDs **even when deletion
  failed**), setup creates a **duplicate** channel instead of adopting the existing one →
  "the old ones are still there". The old settings channel keeps "working" because Discord
  component interactions are routed by customId, not by channel.
* `SetupSettingsMenu` only populates the settings channel when `instance.firstTime || forced`
  → a settings channel recreated later stays **empty**.
* The new-server pairing message is posted to `channelId.servers`; when that reference is
  stale the server card (with the CONNECT button) never appears → "won't connect to the new
  one without resetting channels".

**Fix — make guild setup self-healing**
1. `SetupGuildCategory`: if the stored category ID is stale, **adopt** an existing category
   named `rustplusplus` before creating a new one.
2. `SetupGuildChannels.addTextChannel`:
   * If the stored ID is stale, **adopt** an existing text channel with the expected name
     (preferring one inside our category) before creating a new one.
   * Always ensure `channel.parentId === category.id` — `await channel.setParent(...)`
     (properly awaited, logged on failure) for both existing and new channels.
   * Report whether the settings channel content should be rebuilt.
3. Channels are re-ordered inside the category to the canonical order with one bulk
   `guild.channels.setPositions()` call (only when out of order).
4. `SetupSettingsMenu`: also (re)populate when the settings channel is **empty** (not only on
   `firstTime`/forced) — heals the "empty settings channel" case at startup.
5. `RemoveGuildChannels`: only null out a channel ID when the deletion actually succeeded, so
   live channels are never orphaned from the instance file.

Result: after any wipe/downtime you just start the bot — old channels are re-used, re-parented,
re-ordered and re-populated; no duplicates; pairing messages land in the right channel.

---

## Problem 3 — Flaky server connections reset AFK / Crate / in-game-time tracking

**Symptoms**
* Servers like rusticated.com drop the Rust+ websocket regularly. Every drop makes the bot
  declare the server offline, spam offline/online messages, and lose all runtime state:
  AFK timers restart at 0, locked-crate/cargo timers vanish, and the in-game time
  (time-till-day/night learning) starts over — making those features unusable.

**Root causes**
* `rustplusEvents/disconnected.js` treats every unexpected disconnect as server-down:
  `mapMarkers.reset()` (kills crate/cargo timers), stops all custom timers, announces
  offline immediately, deletes the instance and schedules a reconnect (15 s).
* The reconnect creates a **brand-new** `RustPlus` with `isFirstPoll = true`;
  `pollingHandler` then recreates `Time`, `Team`, `MapMarkers` from scratch → AFK
  (`player.lastMovement`), crate timers and time-learning (`startTimeObject`,
  `passedFirstSunriseOrSunset`) are all reset.
* The bot has no second opinion on whether the server is actually down (Battlemetrics data is
  already being polled every 60 s for other features but unused here).

**Fix**
1. **State carry-over across reconnects.** On an unexpected disconnect of an operational
   session the old `RustPlus` instance is stashed (`client.rustplusStashes[guildId]`) instead
   of being reset: crate/cargo timers keep running (their Discord notifications still work
   while disconnected; in-game messages are queued), custom `!timer`s keep running, team/AFK
   state, event/connection/death histories, vending-machine subscription state and the
   in-game-time learning state are all preserved.
   When the reconnect succeeds on the *same server* (and no wipe was detected, and the stash
   is younger than 2 h), the new instance takes over the stashed structures (references are
   re-bound), custom timers are re-created with their remaining time, and the queued in-game
   messages are flushed. Team changes that happened during the outage are announced on the
   first poll (normal diff logic).
2. **In-game time learning survives the gap.** `timeHandler` gets a reconnect path: the
   offline wall-clock gap is added to the learning accumulators (valid because they
   accumulate real seconds); if a day/night boundary was crossed while offline or the gap is
   large, only the in-progress cycle is restarted — the already-learned
   `timeTillDay`/`timeTillNight` tables are never thrown away.
3. **Offline announcement grace period.** Short blips no longer spam the activity channel:
   the offline message is only sent if the connection is still down after a grace period
   (default 60 s, `RPP_OFFLINE_GRACE_PERIOD` env var); the online message is only sent if
   offline was actually announced. The servers-channel card still flips to RECONNECTING
   immediately, so the state is visible.
4. **Battlemetrics as a second status source.** When the grace period elapses, the bot checks
   the already-polled Battlemetrics instance for the active server: if Battlemetrics reports
   the server **online**, the message says the connection was lost but the server appears to
   be up (i.e. a Rust+ hiccup on the server side) instead of "server just went offline".
   Stash and reconnect behaviour are unaffected — the bot keeps retrying either way.

---

## Problem 4 — `/market search` can't find "Blueprint Fragment" items

**Symptoms**
* `/market search name: Blueprint Fragment` (also `Advanced Blueprint Fragment` on older
  item lists) → *"No item with name ... found"*. Affects other partial names too.

**Root causes**
* `Items.getClosestItemIdByName()` → `Utils.findClosestString()` is a pure Levenshtein match
  with **threshold 2**. "Blueprint Fragment" is 6 edits away from "Basic Blueprint Fragment"
  → no match. Any query that isn't the (nearly) full item name fails the same way
  ("heavy plate", "adv blueprint fragment", "rifle", ...).
* Additionally, deployments running an items.json from before PR #527 lack the two fragment
  items entirely (this fork's items.json already contains them: `-1896395719`, `-143481979`).

**Fix**
`Utils.findClosestString()` now matches in stages (first hit wins):
1. exact match (case-insensitive) — unchanged behaviour;
2. Levenshtein distance ≤ threshold — unchanged behaviour (typos like "asault rifle");
3. **substring**: entries containing the query as a substring, shortest entry wins
   ("blueprint fragment" → "Basic Blueprint Fragment");
4. **word-subset**: every word of the query appears somewhere in the entry, shortest wins
   ("adv blueprint frag" → "Advanced Blueprint Fragment").

Stages 3/4 only add matches for queries that previously returned *nothing*, so existing
behaviour is preserved. All item-name consumers benefit (`/market`, `/craft`, `/recycle`,
`/research`, `/despawn`, `/stack`, in-game commands, RustLabs lookups, CCTV codes).

---

## Execution order

| Step | Fix | Files touched (main) |
|------|-----|----------------------|
| 1 | Problem 4 — item search | `src/util/utils.js` |
| 2 | Problem 1 — credentials | `src/commands/credentials.js`, `src/discordTools/discordEmbeds.js`, `src/util/instanceUtils.js`, `src/handlers/credentialsExpiryHandler.js` (new), `src/discordEvents/ready.js`, `src/languages/en.json` |
| 3 | Problem 2 — channels | `src/discordTools/SetupGuildCategory.js`, `SetupGuildChannels.js`, `SetupSettingsMenu.js`, `RemoveGuildChannels.js`, `discordTools.js` |
| 4 | Problem 3 — resilience | `src/rustplusEvents/disconnected.js`, `connected.js`, `src/handlers/pollingHandler.js`, `timeHandler.js`, `src/structures/DiscordBot.js`, `RustPlus.js`, `config/index.js`, `src/languages/en.json` |

Verification for each step: `npm test` (tsc --noEmit) + targeted node smoke tests where
feasible (pure functions such as the item search).

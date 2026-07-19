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

---

# Round 2 — follow-ups and new features

## Follow-up on Problem 4 (item search)
Verified via git history: the two fragment items only entered `items.json` on **2025-11-12**
(upstream PR #500). Deployments older than that could not find them by name, shortname *or*
item ID because the item simply did not exist in the bot's database. Additionally, searching
by **shortname** never worked at all (the search only matched display names) — fixed:
exact display-name/shortname matches now short-circuit before the fuzzy stages.

## Follow-up on Problem 2 (wipe flow)
* The reconnect timer now reads the current server entry (playerToken!) from the instance
  file at fire time, so re-pairing during an outage (post-wipe) heals the loop automatically.
* An automatic reconnect that gets **explicitly rejected** by the server (invalid
  playerToken) aborts and reports "connection invalid" like upstream; only timeouts/flaky
  responses keep retrying.
* Verified cleanup on server switch: the switches / switch-groups / storage-monitors
  channels are cleared on CONNECT; the information channel edits its messages in place.
  Old-server **alarms** stay listed on purpose (FCM alarms work for non-connected servers) —
  they disappear when the old server card is deleted (one click on the trash button). On the
  *same* server after a forced wipe, dead devices show as unreachable and can be removed
  with the "delete unreachable devices" button.

## Follow-up on Problem 3 (outage speed/correctness)
* Offline is announced **immediately** when Battlemetrics confirms the server is down
  (real outage/restart) — the grace period only applies when Battlemetrics still reports
  online (connection-side issue) or has no data.
* Online is announced the moment the websocket reconnects, **before** the potentially slow
  map download, to be as early as possible on wipe-day restarts. Reconnect attempts run
  every 15 s (`RPP_RECONNECT_INTERVAL` to lower it further).

## New: Deep Sea event tracking
Detected via the floating-city vendor vending-machine markers (Attire Shop Vendor, Firearms
Vendor, Fish Exchange Vending Machine, ...; ≥3 distinct official names required, location =
marker centroid). Notification settings for appeared / closing soon / despawned; warnings at
30 and 10 minutes before the ~3 h lifetime ends (timers stop if it despawns early and
survive reconnects); `!deepsea` command (location + time till close, or time since close +
expected 60–150 min respawn window); integrated into `!events` and the information-channel
event embed. New settings entries appear after `/reset settings` on existing setups.

---

# Round 3 — wipe cleanup without channel replacement, duplicate healing

## Channels are never replaced anymore (permissions always survive)
The wipe cleanup (and `/reset history`, disconnect/delete buttons) used to **replace** the
events/teamchat/activity channels with empty clones. That created new channel ids every wipe
and — when the clone/permission copy didn't behave as expected — channels that no longer
matched the permission setup of the old ones. Replaced by `purgeTextChannel()`:
* Deletes the entire history **in place** — channel id, position, permission overwrites and
  category membership are untouched. No new channels or categories are ever created by the
  wipe flow.
* Messages younger than 14 days are bulk-deleted (weekly wipe cadence → everything), older
  ones are deleted one by one (slow but runs in the background).
* Only messages that existed when the purge started are deleted (snowflake boundary), so the
  new wipe's messages can be posted immediately while the purge still runs.

## When a channel really must be created, it inherits the category permissions
* `SetupGuildCategory` gained a third adoption fallback: if the stored id is stale *and* no
  category named `rustplusplus` exists (e.g. renamed), the category holding the tracked
  channels is adopted — a customized setup is never recreated just because of a rename.
* A **freshly created** channel now gets created inside the category and synced to the
  category's permission overwrites (`lockPermissions`), also when
  `manageChannelPermissions` is off. Adopted channels keep their manually configured perms.

## Duplicate server cards / duplicate information embeds
Message ids for the server cards and the information embeds are tracked per guild in the
instance file — a single bot process physically cannot keep **two** sets of embeds updating
in parallel. Two sets that both update (observed: one set edited until 12:54, the other until
13:07 the same day) mean **two bot processes are running with the same Discord token but
separate `instances/` state** (e.g. an old upstream-image container still auto-restarting
next to the fork container, or a local `npm start` next to Docker). Check with `docker ps`
and stop the stray one — the bot cannot fix that from inside.

What the bot does now handle itself: at every startup it sweeps the **servers** and
**information** channels and deletes bot messages that are no longer tracked in the instance
file (orphans from crashes/state resets/second processes, which would otherwise sit there
stale forever). Messages younger than 5 minutes are spared to avoid racing an in-flight
send. When the sweep removes something it logs a warning including the second-process hint.

## Zombie rustplus instances after rapid disconnect/connect (in-process duplicates)
Observed live: after pressing DISCONNECT/CONNECT in quick succession, every event message
was posted twice and two full information-embed sets appeared — from a **single** process.
`createRustplusInstance()` simply overwrote `client.rustplusInstances[guildId]`; when a
second CONNECT click (or a reconnect-timer race) created a new instance while the previous
one was still connecting, the old one was never disconnected: a zombie with its own socket
and polling interval. Fixed in three layers:
1. `createRustplusInstance()` marks any still-registered instance deleted and disconnects
   it before replacing it.
2. The `connected` event handler bails out (and disconnects) when its instance is no longer
   the registered one — checked once at the start and again after the slow map request.
3. `pollingHandler` self-terminates a poller whose instance was replaced/deleted (clears
   its intervals, disconnects), so no zombie can survive longer than one poll tick.
Also fixed the `TypeError: reading 'leaderSteamId'` unhandled rejection seen during the
same incident (`updateLeaderRustPlusLiteInstance` / FcmListenerLite now guard against a
not-yet-created team structure and a missing serverListLite entry).

---

# Planned (not implemented): phone call when a smart alarm triggers

**Goal:** registered phone numbers get an actual call (ringing phone, TTS message) when a
smart alarm fires — for raids that happen while asleep/away from Discord.

**Provider options**
1. **Twilio Programmable Voice** *(recommended)* — bot POSTs to the Twilio REST API (axios,
   already a dependency; no inbound webserver needed when TwiML is passed inline). Costs:
   ~$1–1.5/month for a number + per-minute rates; trial credit works with verified numbers.
   Also offers SMS as a cheap fallback channel.
2. Vonage / Plivo / MessageBird — same architecture, different pricing/coverage.
3. **Pushover critical push** *(cheap alternative or addition)* — "Emergency"-priority push
   notifications repeat until acknowledged and bypass mute/do-not-disturb; one-time $5 app,
   no per-event cost. Not a call, but covers the "wake me up" need with less setup.

**Design sketch**
* Config via env: `RPP_CALL_PROVIDER`, `RPP_TWILIO_ACCOUNT_SID`, `RPP_TWILIO_AUTH_TOKEN`,
  `RPP_TWILIO_FROM_NUMBER`.
* New `/phone` slash command: `add <E.164 number>` / `remove` / `show` / `test` — one number
  per Discord user, stored in the (gitignored) per-guild credentials file, masked in logs,
  admin rules like `/credentials`.
* Per-alarm **call toggle** (like the @everyone flag) + a global on/off general setting.
* Trigger points: `smartAlarmHandler` (connected server) and the FCM alarm path
  (non-connected servers, when fcmAlarmNotificationEnabled).
* Call content: TTS "<server>: <alarm name> — <alarm message>", repeated twice.
* **Storm protection:** per-number cooldown (e.g. one call per 5 min; alarms within the
  window are batched into the next call), optional quiet hours.

**Open questions before implementing**
1. Twilio (real call, small monthly cost) vs Pushover-style critical push (no call, ~free)?
   Both?
2. Call every registered number on any triggering alarm, or per-alarm number selection?
3. Quiet hours / cooldown length preferences?

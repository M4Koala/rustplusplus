# Oil rig event alerts via RF (replacement for the removed Rust+ event markers)

On 6 Aug 2026 (Power Trip update) Facepunch stopped sending vending machine and event map
markers (cargo ship, patrol helicopter, CH-47, locked crate, traveling vendor) to Rust+.
The marker-based trackers are disabled by default and labeled as unsupported in the settings
menu (`Marker events` setting, keep it off unless the data comes back).

One event can still be recovered **in-game, no server admin access needed**: the oil rig
locked crate hack broadcasts a fixed RF signal. Routed through an RF Receiver and a Smart
Alarm, it reproduces the old oil rig events (which were really tracking the CH-47 that
drops the heavy scientists) from a source Facepunch did not take away.

## Setup

1. Build an **RF Receiver** tuned to the oil rig crate frequency:
   - Small oil rig crate hack: **4765**
   - Large oil rig crate hack: **4768**

   RF has range limits, so verify reception from your base/lookout location first.
2. Wire the RF Receiver output to a **Smart Alarm** and pair the Smart Alarm with Rust+ as
   usual (it appears in the `#alarms` channel).
3. Name the alarm something recognizable, e.g. `Small Oil Rig 4765` — the alarm name is
   shown as the event location.
4. In the alarm's **Alarm type** dropdown on the alarm card, pick
   **Small call (small oil rig)** or **Large call (large oil rig)**.
   (Slash command alternative: `/alarm edit id <entityId> image smart_alarm type small|large`.)

## What you get

When the crate hack fires, the alarm triggers and the **events channel** shows exactly the
old event sequence, same texts, colors and logos as before the Rust+ change:

1. *"Heavy Scientists got called to the Small/Large Oil Rig at {alarm name}."* — same
   event keys the old marker tracker used, so `!small` / `!large` history commands work.
2. After the server's configured crate unlock time (default 15 min), the matching
   **locked crate unlocked** event fires automatically.

Voice and in-game notifications follow the existing `heavyScientistCalledSetting` options.
There is **no** phone wake-up call — that is reserved for normal raid alarms.

| Alarm type | Behaviour |
|---|---|
| Raid alarm (default) | Alarm card + ntfy phone wake-up |
| Small call (small oil rig) | Old small oil rig event sequence above, no wake-up call |
| Large call (large oil rig) | Old large oil rig event sequence above, no wake-up call |

A leftover `oilrig` type from the first version of this feature behaves as **large**.

Cargo ship, patrol helicopter and CH-47 *spawns* have no RF equivalent — those stay
unsupported unless you run the server yourself (Oxide/RCON).

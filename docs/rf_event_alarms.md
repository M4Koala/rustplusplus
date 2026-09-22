# Oil rig / event alerts via RF (replacement for removed Rust+ event markers)

On 6 Aug 2026 (Power Trip update) Facepunch stopped sending vending machine and event map
markers (cargo ship, patrol helicopter, CH-47, locked crate, traveling vendor) to Rust+.
The marker-based trackers are disabled by default and labeled as unsupported in the settings
menu (`Marker events` setting, keep it off unless the data comes back).

One event can still be recovered **in-game, no server admin access needed**: the oil rig
locked crate hack broadcasts a fixed RF signal.

## Setup (per alarm you want to use as an event alert)

1. Build an **RF Receiver** tuned to the oil rig crate frequency:
   - Small oil rig crate hack: **4765**
   - Large oil rig crate hack: **4768**
   RF has range limits, so verify reception from your base/lookout location first.
2. Wire the RF Receiver output to a **Smart Alarm** (timer input) and pair the Smart Alarm
   with Rust+ as usual (it appears in the `#alarms` channel).
3. Set the alarm's **type** — either press the `Type:` button on the alarm card (cycles
   normal → small call → large call → oil rig), or:
   ```
   /alarm edit id <entityId> image smart_alarm type oilrig
   ```
4. When the crate hack fires, the alarm triggers and is posted to the **events channel**
   like the old marker events (voice/in-game follow the matching notification settings),
   **without** a phone wake-up call.

| Alarm type | Behaviour |
|---|---|
| normal | Alarm card + ntfy phone wake-up (raid alarm) |
| small call | Posted as the old patrol-helicopter "small" event, no wake-up call |
| large call | Posted as the old heavy-scientist "large" event, no wake-up call |
| oil rig | Posted as the old CH-47 "chinook" event, no wake-up call |

Cargo ship, patrol helicopter and CH-47 *spawns* have no RF equivalent — those stay
unsupported unless you run the server yourself (Oxide/RCON).

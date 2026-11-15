# NASA Space Mission Game — Gameplay Specification (frozen)

All numbers live in `packages/shared/src/config/*`. Values there are **game-design balance values, not NASA data**.
Where the original design named a mechanic without a formula, the config exposes a value; those assumptions are listed at the bottom.

## Modes
- **Solo** — fly Earth→Moon, complete one lunar task. Total mission time (launch → task complete) is a personal-best candidate (stored in localStorage).
- **1v1 (online)** — private room code or public matchmaking. Identical ships, 1,000 credits each. Both get the **same task instance** (same id + seed). First valid task completion wins, regardless of arrival order. If a ship reaches 0 HP during flight, the opponent wins immediately.
- **Co-op (online, two devices)** — one shared ship and shared budget. Pilot and Engineer roles with strict permissions. Each player gets a **different** role-eligible task; both must finish. 0 HP = mission failed. Team time is a personal-best candidate.

## Flow
Main menu → mode → (lobby for online) → Preparation (attachment shop, difficulty) → Ready → Loading screen with NASA facts + 3-2-1 → Flight → Lunar task → Results.
A guided 60-second tutorial is reachable from the main menu.

## Preparation
- Start: 1,000 credits, base mass 100, base power capacity 60, 100 HP.
- 12 attachments (4 shielding / 4 propulsion / 4 instruments) + optional Repair Drone (+ Repair Upgrade).
- Each attachment adds mass and power draw. Power used may not exceed power capacity. Selling in preparation refunds fully.
- Unspent credits carry into flight for abilities and repairs.

## Flight
- Ship automatically follows the Earth→Moon route (150 units). speed = referenceSpeed × Πthrust × (baseMass/mass)^0.45 × temporary effects.
- **Abilities** (cost credits, have cooldowns, flight phases only — never after arrival):
  - 5 boosters/protectors (all modes): Thruster Burn, Gravity Assist, Deflector Surge, Hull Patch, Navigation Lock.
  - 5 deterrents (1v1 only, target the opponent): Ion Jammer, Debris Scatter, EMP Pulse, Tractor Lock, Comms Spoof. EMP Pulse and Tractor Lock share the `stun` cooldown.
  - Deterrents cannot target a ship that is no longer flying.
- **Hazards** (6): Micrometeoroid Swarm, Solar Flare, Van Allen Belt Pass, Orbital Debris, Thermal Spike, Navigation Anomaly. Seeded schedule, telegraphed with a warning. Damage = base × difficulty mult (× co-op pressure) × (1 − shielding reduction) × (1 − active Deflector Surge). In 1v1 both ships receive the same schedule (fairness).
- **Repair** (requires Repair Drone): heals over time, escalating cost (40, 60, 80 …), cooldown. Upgrade: more heal, faster, shorter cooldown.
- **Timing:** main flight 0:00–3:00. **Overtime** 3:00–4:00: ability cost ×0.5 and effect magnitude ×0.5, cooldowns unchanged. After **4:00** unfinished ships enter **accelerated simulation**: movement ×6, auto-buys the best affordable booster when off cooldown (Gravity Assist, then Thruster Burn); with no credits it simply keeps flying. No hazards during simulation, so every surviving ship arrives.
- Each ship's phase is independent: one player can be on the Moon while the other still flies.

## Co-op roles
- Pilot: Thruster Burn, Gravity Assist, Navigation Lock.
- Engineer: Deflector Surge, Hull Patch, Repair.
- Both may buy equipment in preparation (shared budget). Both must be ready to launch.

## Lunar tasks (5)
Surface Analysis, Establish Communications, Power System Calibration, Lunar Orbit Calibration, Terrain Mapping. Generated from a seed; validated by the engine/server. Unlimited attempts; failed attempts are counted in stats.
Co-op eligibility: Pilot → communications, orbit-calibration, terrain-mapping. Engineer → communications, surface-analysis, power-calibration.
Spectrometer attachment unlocks a hint on the lunar task.

## Results
Outcome, total time, arrival time, credits spent (by category), damage taken/prevented, repairs, abilities used, hazards encountered, task attempts. "Expanded statistics" toggle. Personal bests per mode+difficulty (solo, co-op).

## Documented assumptions (configurable)
1. Names/values of the 12 attachments, 10 abilities, 6 hazards: see config files.
2. Overtime "half effect" halves magnitudes (speed %, damage reduction %, heal, damage, instant progress); durations unchanged.
3. Stuns cannot be applied to a target that is already stunned; Navigation Lock grants immunity to stun/slow.
4. No hazards in accelerated simulation; auto-sim still respects costs and cooldowns.
5. Matchmaking exists for 1v1 and co-op queues; difficulty for matchmade games is Normal.
6. Disconnects: server keeps the match running; reconnect restores the player via sessionId. A room abandoned by all players for 60 s is cleaned up.

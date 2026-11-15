# Lunar Transit

**A NASA-inspired Earth-to-Moon mission race — built for the NASA Space Apps Challenge 2026 "Space Mission Design Game" challenge.**

### Play now: **https://lunar-transit.onrender.com**

Runs in any modern browser on desktop, tablet or phone. No download or account needed.
*(Free hosting: if nobody has played for a while, the first load can take about a minute while the server wakes up.)*

---

## The game in simple terms

You are a mission engineer with **1,000 credits** and an empty spacecraft. Your job is to get it from Earth to the Moon and do science when you arrive.

1. **Design your spacecraft.** Spend credits on parts: shields, engines, instruments and an optional repair drone. Every part adds **mass** (heavier ships fly slower) and uses **power** (you can't install more than your power supply allows). Whatever you don't spend comes with you as fuel for in-flight abilities. Nothing is free: spend on armor and you have less for speed, and the other way round.
2. **Fly the mission.** Your ship follows the Earth-to-Moon path automatically. Space throws problems at you: micrometeoroids, solar flares, Van Allen radiation belts, orbital debris, heat spikes and navigation glitches. You get a warning before each one hits. Spend credits on abilities to speed up, shield yourself, patch the hull or repair.
3. **Beat the clock.** The main flight lasts 3 minutes. Then comes 1 minute of **overtime**, where abilities cost half and do half as much. After 4 minutes, any ship still flying finishes the trip on autopilot.
4. **Do the science.** When you reach the Moon you get one of five hands-on science tasks:
   - read spectrometer data to find titanium-rich rock
   - point an antenna at Earth
   - balance the power budget
   - plan two engine burns into the right orbit
   - map lunar terrain from altimeter readings
5. **See how you did.** A mission report shows your time, damage taken and prevented, where your credits went, and your personal best.

**Ways to play**

| Mode | How it works |
|---|---|
| **Solo** | Fly against the clock and beat your personal best. Easy, Normal or Hard. |
| **Online 1v1** | Share a room code or use Quick Match. Same ship, same budget, same science task; the first to finish the task wins. You can also slow your rival with jammers, debris or an EMP. |
| **Co-op** | Two players share one ship and one budget. The **Pilot** handles speed and navigation; the **Engineer** handles shields, hull patches and repairs. Both must finish their own science task. |
| **Tutorial** | A guided flight of about 60 seconds that explains every system. |

**Controls:** `1`–`5` boosters · `Q W E R T` deterrents (1v1 only) · `F` repair · or just click the buttons.

---

## How Lunar Transit answers the challenge

The challenge asks for an interactive game where players **design a space mission, manage limited resources, simulate the mission, and see how each choice affects the outcome**. The goal is to make engineering trade-offs feel real rather than theoretical. Here is how each part of that brief maps to the game.

### Core goals

| Challenge asks for | What Lunar Transit does |
|---|---|
| **A clear mission objective before technical choices** | Every mission has one stated goal: reach the Moon safely and complete a science task, as fast as possible. |
| **Spacecraft and payload design** | 12 attachments across shielding, propulsion and instruments, plus a Repair Drone and an upgrade. Each has a cost, mass, power draw and a specific effect. A live 3D preview shows your ship change as you build it. |
| **Budget, mass and power constraints** | A fixed 1,000-credit budget, a mass total that directly slows the ship, and a power capacity you cannot exceed. The Solar Array raises capacity; the Ion Thruster and Magnetic Deflector draw a lot of power. |
| **Communications and data** | The Deep Space Transponder turns science telemetry into extra credits during flight. *Establish Communications* is one of the lunar tasks. |
| **Mission simulation** | A real-time, deterministic simulation of the whole flight: speed from thrust and mass, seeded hazards, shielding by damage type, repairs, cooldowns, overtime and autopilot. |
| **Evaluation and scoring** | A results report with total mission time, arrival time, hull left, damage taken and prevented, credits spent by category, abilities used and task attempts. Solo and co-op times are saved as personal bests for each difficulty. |
| **Every decision has consequences, and no single perfect build** | Heavy shielding protects you but slows you down, so you face more hazards. Engines get you there faster but leave you fragile. Saving credits pays for abilities later. Our balance-testing bot (`packages/shared/scripts/balanceBot.ts`) confirms that very different builds can all succeed. |

### Game design and user experience

| Challenge asks for | What Lunar Transit does |
|---|---|
| **Access for different skill levels** | A guided tutorial, three difficulty levels and plain-language tooltips on every part and ability. |
| **Single-player and multiplayer** | Solo, online co-op and online 1v1, with private room codes or quick matchmaking. |
| **Distinct team roles** | In co-op the Pilot and Engineer have strictly different abilities and different science tasks, and they share one budget. Neither can win alone. |
| **Clear feedback on success and failure** | Hazard warnings with countdowns, a mission log showing damage dealt and damage blocked, and a destruction screen that explains what happened. |
| **Redesign and rerun** | You can change your loadout before every launch and play again immediately to try a different strategy. |
| **Scenarios and difficulty** | Easy, Normal and Hard change how often hazards strike and how hard they hit. Co-op adds extra hazard pressure. A different science task is drawn each mission. |

### Suggested extra features we built

- **Random events:** six hazard types with telegraphed warnings.
- **Interactive vehicle visualization:** a 3D spacecraft that shows every installed part, flying a 3D Earth-to-Moon trajectory.
- **Real-time mission dashboard:** hull, credits, route progress, speed, ETA, active effects, a rival or crewmate panel and a mission log.
- **Competitive mode on the same objective:** 1v1, with an identical ship and an identical science task.
- **Post-mission report:** basic and expanded statistics.
- **Leaderboard:** local personal bests.

### Educational value

- **NASA content in the game:** **32 short NASA-sourced facts** appear on the loading screens and results. Every part in the shop has a *"The real science"* panel explaining the real engineering principle behind it, and *what the game simplifies*.
- **Real science in each task:** each lunar task includes a short explanation of the science behind it.
- **Honest numbers:** the game clearly separates real NASA concepts from game-balance numbers. Credits, damage values and speeds are gameplay values, not NASA data.

### Scope notes (honest gaps)

To keep the game fast and focused, a few items from the brief are simplified or not included:
- **Launch vehicle and orbit choice:** the route is a fixed, visually plausible translunar arc, not a launch-vehicle or orbit picker. Orbital mechanics appears in the *Lunar Orbit Calibration* task instead.
- **Data volume:** this is not tracked as a separate resource.
- **Team size:** multiplayer supports **2 players** (the brief allows up to 4).

---

## NASA resources used

All educational content is bundled with the game, so it needs no live NASA services. The sources are listed in-game under **About & Sources**.

| Resource | Used for |
|---|---|
| [CubeSat 101](https://www.nasa.gov/wp-content/uploads/2017/03/nasa_csli_cubesat_101_508.pdf) | Spacecraft subsystems, power, mass and communications facts; attachment explanations |
| [General Mission Analysis Tool (GMAT)](https://software.nasa.gov/software/GSC-19640-1) | Trajectory and mission-analysis concepts |
| [Concept Maturity Levels (JPL)](https://ntrs.nasa.gov/citations/20150007816) | Mission trade-off principles |
| [Mission Design Lab, NASA Goddard](https://etd.gsfc.nasa.gov/capabilities/integrated-design-center/mission-design-lab) | Subsystem and mission-design trade-offs |
| [Design and Develop Science Missions](https://ntrs.nasa.gov/citations/20250002492) | Mission life-cycle concepts |
| [A Learning Game About Telescopes](https://science.nasa.gov/mission/webb/game-build-it-yourself/) | Ideas for learning-game interaction |
| NASA Mission Viz | Visual reference for presenting trajectories |
| Visualize a Space Mission Using Virtual Reality | Earth–Moon transfer concept |
| NASA Digital Games and Activities | Ideas for accessible learning games |

*Not affiliated with or endorsed by NASA.*

---

## How it's built

| Part | Technology |
|---|---|
| Language | TypeScript throughout |
| Client | React + Vite; Three.js via React Three Fiber (procedurally drawn Earth, Moon, spacecraft and effects, with no image downloads); Zustand |
| Server | Node.js + Socket.IO. The server is authoritative, running a fixed 20 Hz simulation, so clients can't cheat on credits, health or task answers |
| Game rules | One shared, deterministic engine (`packages/shared`) used by solo play in the browser, by the multiplayer server and by the autopilot |
| Validation and tests | Zod for validation; 64 Vitest tests covering the economy, movement, abilities, hazards, phases, tasks, victory rules and multiplayer |

```
packages/shared   game rules engine, config (all balance numbers), task generators/validators, NASA content
apps/server       multiplayer server (rooms, matchmaking, match loop); also serves the website in production
apps/client       the web game: menus, shop, HUD, 3D scene, five lunar tasks
docs/             GAME_DESIGN.md: full rules and design assumptions
```

## Run it locally

```bash
npm install
npm run dev          # game server on :3001, website on http://localhost:5173
```

To test multiplayer on one computer, open the game in two browser tabs; each tab is its own player.

```bash
npm run test         # run all tests
npm run typecheck    # TypeScript checks
npm run build        # production build (server + website)
npm start            # run the production build on one port
```

## Deployment

Production runs as **one Render web service** (`render.yaml`). The Node server hosts both the website and real-time multiplayer at the same URL. Pushing to `main` redeploys automatically. A `Dockerfile` is included for other hosts.

# Lunar Transit — NASA-inspired Earth-to-Moon mission race

A browser game: outfit a spacecraft with a 1,000-credit budget, race along a translunar trajectory while managing hazards, abilities and repairs, then complete a NASA-grounded science task on arrival.

- **Solo** — beat your personal best (runs fully in the browser, no server needed).
- **Online 1v1** — private room codes or quick-match; same ship, same lunar task, first to finish wins.
- **Co-op** — Pilot + Engineer share one ship and budget; both must finish their own task.
- **Tutorial** — guided ~60-second flight.

## Run locally

```bash
npm install
npm run dev          # server on :3001, client on :5173
```

Open http://localhost:5173. For local multiplayer, open a second **tab** (each tab is its own player).
If those ports are taken: `PORT=3011 npm run dev -w apps/server` and `VITE_SERVER_URL=http://localhost:3011 npx vite apps/client --port 5174`, with `CLIENT_ORIGIN=http://localhost:5174` for the server.

```bash
npm run test         # engine + multiplayer tests (Vitest)
npm run typecheck
npm run build        # bundles server (apps/server/dist) and client (apps/client/dist)
npx tsx packages/shared/scripts/validateNasaData.ts   # validate bundled NASA content
npx tsx packages/shared/scripts/balanceBot.ts         # simulate builds across difficulties
```

## Controls

| Key | Action |
|---|---|
| 1–5 | Boosters: Thruster Burn, Gravity Assist, Deflector Surge, Hull Patch, Navigation Lock |
| Q W E R T | Deterrents (1v1): Ion Jammer, Debris Scatter, EMP Pulse, Tractor Lock, Comms Spoof |
| F | Repair (requires Repair Drone) |

## Deploy

- **Server (Render):** `render.yaml` included. Set `CLIENT_ORIGIN` to your Vercel URL. Health check: `/health`.
- **Client (Vercel):** root `apps/client`, build `vite build`, output `dist`, env `VITE_SERVER_URL=https://<your-render-service>`. You may need to set the install command to `cd ../.. && npm install` so the workspace package resolves.

## Layout

```
packages/shared   types, protocol (Zod), config (all balance values), deterministic engine, task generators/validators, NASA data
apps/server       Socket.IO gateway, rooms, matchmaking, authoritative 20 Hz match runner
apps/client       React UI + HUD, React Three Fiber scene (procedural Earth/Moon/ship), five lunar task minigames
docs/             GAME_DESIGN.md (rules + documented assumptions)
```

Gameplay numbers are game-balance values, not NASA data. NASA content is bundled locally with source references (see About & Sources in-game). Not affiliated with or endorsed by NASA.

# AGENTS.md — NASA Space Mission Game

Gameplay spec: `docs/GAME_DESIGN.md` (FINAL — do not add/remove mechanics). Architecture: TypeScript, React + Vite, Three.js via React Three Fiber, Zustand, Node + Socket.IO, Zod, Vitest, npm workspaces.

- `packages/shared/` — types (`src/types.ts`), protocol (`src/protocol.ts`), config, deterministic simulation (`src/simulation/`), tasks, bundled NASA data.
- `apps/server/` — Socket.IO gateway, rooms, matchmaking, authoritative 20 Hz match runner.
- `apps/client/` — React UI, HUD, R3F scene, lunar tasks. Solo/tutorial run the same shared engine locally in the browser.

Rules: server authoritative in multiplayer; all gameplay values in shared config; all game math in `packages/shared/src/simulation`; per-ship independent phases; never send task solutions or future hazards to clients; seeded randomness; strict TS, no `any`.

Commands: `npm run dev`, `npm run test`, `npm run typecheck`, `npm run build`.
Env: `VITE_SERVER_URL` (client), `PORT`, `CLIENT_ORIGIN` (server).

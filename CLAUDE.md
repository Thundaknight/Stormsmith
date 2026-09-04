# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stormsmith — a self-hosted web dashboard (+ Discord bot) for running game servers that are Docker
containers on Unraid or any Docker host. It doesn't run games itself; it attaches to containers that
already exist and manages their lifecycle (start/stop/restart/pause), shows live status/stats,
proxies RCON/console access, runs scheduled restarts, and mirrors all of it into Discord. Palworld
(settings editor) and AzerothCore/WoW (SOAP GM console + player-account management) get extra tooling.

Published as `thundaknight/stormsmith` on Docker Hub. README.md has the full feature list and all
operator-facing setup (Discord bot, OAuth, RCON, AzerothCore notes) — consult it for behavior
details before changing a feature.

## Commands

npm workspaces: root delegates to `server` (backend) and `web` (frontend).

```sh
npm install
npm run dev        # backend on :8080 (tsx watch src/index.ts)
npm run dev:web    # frontend on :5173 (Vite, proxies /api and /ws to :8080)
npm run build      # web build, then server tsc -> server/dist, web/dist
npm start          # run built server (serves web/dist too)
docker build -t thundaknight/stormsmith .
```

On Windows dev, point the backend at a remote Docker: `DOCKER_HOST=tcp://<unraid-ip>:2375`
(enable Unraid's Docker remote API first).

There is no test suite and no linter configured. "Building" for a type check = `npm run build`
(or `tsc -p server/tsconfig.json` / `web/tsconfig.json` individually).

### Versioning / release

Three `package.json` files carry the version (`/`, `/server`, `/web`) — bump all three together.
The UI footer and `/version` read `server/package.json` **at runtime** (copied into the image next
to `dist/`), so the displayed version reflects the running build, not a compile-time constant.
Per repo convention: after pushing, state the shipped version number in chat, and commit messages
carry it in parens (e.g. `... (1.0.30)`).

## Architecture

### Backend (`server/src`), single Express process

- **`index.ts`** wires everything: mounts `/api/*` routers, serves `web/dist` as a SPA fallback in
  production, then starts the long-lived subsystems: `monitor`, WebSocket server, public-IP probe,
  scheduler, Discord bot, and an hourly sweep of expired links.
- **`db.ts`** — better-sqlite3, one file at `$DATA_DIR/stormsmith.db` (WAL). `initDb()` creates
  tables **and** runs idempotent `ALTER TABLE ... ADD COLUMN` migrations inline — the pattern for
  any schema change is: add the column to the `CREATE TABLE`, then add a matching `addColumn(...)`
  call. All query helpers live here; routes never touch `db` directly except a couple of Discord
  spots. There is no ORM.
- **`monitor.ts`** — `StatusMonitor` (EventEmitter singleton). Polls Docker every
  `POLL_INTERVAL_MS` (5s) for every imported server's container state, plus CPU/mem for running
  ones, plus player lists over RCON throttled to 30s per server. Emits `update` every poll and
  `change` only on a real state/player-count delta. This is the single source of live status —
  routes and the WebSocket read `monitor.get(id)` / `getAll()` rather than hitting Docker again.
  Also diffs each player-list poll against the previous one (`prevPlayers`) to write
  connect/disconnect rows and roster `last_seen` into the activity tables — a `null` poll
  (RCON hiccup) is treated as "no info", never "everyone left".
- **Activity log** (`server_activity_log` + `server_player_seen` in `db.ts`) — an audit trail
  of every command / broadcast / container action / config change, from the web routes, the
  Discord bot, the scheduler, and the monitor (player events). `logServerActivity()` is called
  inline in each handler; `listServerActivity()` backs the per-server Logs tab and the global
  `GET /api/servers/activity`. Distinct from `discord_command_log`, which stays as the
  `/wowlevel`-specific audit on the global Logs page.
- **`docker.ts`** — the only module that talks to dockerode. Local socket by default, or
  `DOCKER_HOST` tcp. Notable: reads/writes files *inside* containers via the archive (tar) API and
  `execInContainer` (POSIX `sh` only, no GNU tools assumed) — this is how the Palworld settings
  editor and mod uploads work with **no extra volume mounts**, and it works on stopped containers.
- **`rcon.ts`** — hand-rolled Source RCON client. Deliberately not a library: Palworld's RCON
  replies with packet id 0 instead of echoing the request id, so matching is lenient/phase-based.
  Also encodes U+00A0 as a raw `0xA0` byte for Palworld broadcasts (it truncates at the first real
  space). For `game === 'azerothcore'`, RCON calls are transparently routed to `soap.ts` instead.
- **`soap.ts`** — AzerothCore worldserver SOAP GM command client.
- **`games/`** — per-game logic. `palworld.ts` = parser/serializer for the single-line
  `OptionSettings=(...)` in `PalWorldSettings.ini` (quote/paren-aware). `valheim.ts` =
  parse/serialize for the `adminlist.txt`/`bannedlist.txt`/`permittedlist.txt` ID lists,
  Platform-User-ID validation, `ValheimRcon.dll` detection, and the POSIX-`sh` snippets
  that locate the save dir / BepInEx plugins dir inside the container (no image-specific
  paths hard-coded; `servers.ts` runs them via `execInContainer` and caches the result on
  the server row). `azerothcore.ts` = direct
  `mysql2` reads of the acore_characters/acore_auth DBs to get real player/account lists with
  `mod-playerbots` bot accounts (prefix `rndbot`) filtered out — AzerothCore has no in-game command
  that does this. `players.ts` = the dispatch table mapping game -> how to list connected players.
- **`games/thunderstore.ts`** — pure planner for mod `.zip` uploads: given the unzipped
  entries (via `fflate`) and the target dirs, returns absolute container paths per the
  Thunderstore layout (root `BepInEx/` merges into BepInEx, root `plugins/` into plugins,
  loose files into `plugins/<pkg>/`; a single wrapping version folder is stripped;
  `manifest.json`/icon/readme dropped; path traversal rejected). `docker.putContainerFiles`
  writes the whole set in one `putArchive`. The mods upload route branches on `.zip`.
- **`unifi/`** — keeps UniFi port-forward rules in step with container state. `client.ts` is a
  hand-rolled UniFi OS client on `node:https` (not `fetch`: consoles use self-signed certs and
  fetch can only relax TLS via an undici dispatcher, which isn't a dependency); it logs in at
  `/api/auth/login`, replays the `TOKEN` cookie + `x-csrf-token`, and talks to the *classic*
  Network API at `/proxy/network/api/s/<site>/rest/portforward` — the newer `X-API-KEY`
  integration API doesn't expose port forwards. `sync.ts` is the reconciler: it subscribes to
  `monitor`'s `change` event plus a 60s sweep, and converges each mapped rule to "enabled iff
  some mapped server is running". Disabling waits out a grace window (default 90s) while
  enabling is immediate — that asymmetry, not any special case, is why a container restart
  never closes a port. It never runs inside a request, so an unreachable console can't delay
  or fail a container action, and an error leaves rules untouched rather than assuming closed.
- **`scheduler.ts`** — scheduled restarts. Each server's next restart is armed once then advanced
  by a fixed period (not recomputed from "now" each tick) so a manual "delay 30 min" stays stable.
  RCON warnings at 30/5/1 min; skipped if the container restarted within the last hour.
- **`discord/bot.ts`** (largest file, ~800 lines) — discord.js client. Maintains one auto-updating
  status message *per server* (so control buttons sit under their own embed), registers guild slash
  commands, and enforces a two-layer permission model: per-role feature perms + per-command
  enable toggles, both configured in the web UI (`discord_role_perms`, `discord_config`).
  Sensitive commands (`/wowcreate`, `/wowlevel`) are written to the `discord_command_log` audit
  table surfaced on the Logs page.
- **`auth.ts`** — JWT bearer tokens (secret auto-persisted to `$DATA_DIR/.jwt-secret`). Middleware:
  `requireAuth` (re-reads user from DB each request so role/status changes take effect immediately),
  `requireAdmin`, `requireServerPermission(kind)`. `userCan(user, serverId, kind)` is the central
  check — admins implicitly pass everything; others need a `server_permissions` row.
  Permission kinds: `view` / `control` / `rcon` / `configure`.
- **`routes/`** — thin Express routers. `servers.ts` is the bulk (actions, RCON, config files, mods,
  Palworld settings, AzerothCore accounts, scheduled-restart overrides). `publicServer()` there is
  the serializer that decides which fields (esp. secrets) a given user sees. `wowAccount.ts` and
  `invite.ts` serve **token-authenticated public pages** — no login, the token is the identity.

### Auth / access model

- Login: username+password, Discord OAuth (`discordOAuth.ts` — new signups land `status='pending'`),
  or a single-use admin invite link. First run: the very first account created becomes admin.
- Per-server granular perms live in `server_permissions`; admin-only areas (Import, Users, Discord)
  are gated in both the API (`requireAdmin`) and the React router.

### Frontend (`web/src`), React 18 + Vite + react-router

- **`api.ts`** — single fetch wrapper, attaches the bearer token, base `/api`.
- **`useStatusSocket.ts` / `useStatusSocket`** — connects to `/ws?token=<jwt>`; the server pushes
  the status list filtered to servers the user may view. This is the live-updating data behind the
  dashboard and server cards; REST is used for everything mutating.
- **`auth.tsx`** — auth context/provider. **`App.tsx`** — routing, including the two pre-login
  public routes (`/wow-account/:token`, `/invite/:token`).
- `pages/` = one per route; `components/` = shared UI. Game-awareness (e.g. hiding RCON UI for
  Satisfactory/Valheim, AzerothCore user-management tab) is driven by `server.game` and flags like
  `rcon_configured` / `db_configured` from `publicServer()`.

### Data & deployment

- Everything persists in the one SQLite file under `$DATA_DIR` (`/app/data` in the container,
  a mounted appdata dir on Unraid). No other datastore; the optional AzerothCore MySQL connection
  is read-only reporting, configured per-server.
- The container needs the **Docker socket mounted** — that's how it controls the other containers.
- Env vars: `PORT`, `DATA_DIR`, `DOCKER_SOCK`, `DOCKER_HOST`, `JWT_SECRET`, `POLL_INTERVAL_MS`
  (see README for defaults).
- Multi-stage `Dockerfile`: build stage runs `npm run build`; runtime stage installs
  server prod deps only and copies `server/dist` + `web/dist`.

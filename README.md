# Stormsmith

A self-hosted manager for game servers running as Docker containers on Unraid (or any Docker host).

- **Docker Hub:** [`thundaknight/stormsmith`](https://hub.docker.com/r/thundaknight/stormsmith)
- **Source:** [github.com/Thundaknight/Stormsmith](https://github.com/Thundaknight/Stormsmith)

**Features**

- **Import game servers** — pick any Docker container on the host (Palworld, Satisfactory, Minecraft, …) and manage it as a game server with live status monitoring.
- **Web interface** — start, stop, restart, pause and resume servers; live status via WebSocket; CPU/memory stats.
- **User management** — the only manually-created account is the initial admin from first-run setup. Everyone else signs up with Discord OAuth and lands in a pending queue; approving a sign-up is also the onboarding step, where the admin picks its role and, for a regular user, exactly which servers it can access. Admins can also link Discord to their own account as a second sign-in option. Per-server permissions are granular: **View**, **Control** (start/stop/restart/pause), **RCON** (console + broadcasts), and **Configure** (server settings, config file, mods) — Import Server, Users, and Discord Bot settings are always admin-only regardless of per-server grants.
- **RCON** — built-in console for Source-RCON games (Palworld, Minecraft, Rust, ARK, 7DtD, …) plus one-click in-game broadcast messages with per-game command templates. Palworld servers get a full command palette (kick/ban, save, graceful shutdown, …).
- **Palworld settings editor** — reads `PalWorldSettings.ini` directly from inside the game container (auto-detecting its location, no extra mounts), and lets you view and edit every setting with sliders, toggles, and dropdowns, then writes it back.
- **AzerothCore (WoW) support** — GM commands run over the worldserver's SOAP interface (kick, mute, ban, announce, teleport, server shutdown/restart, …) from the web console or Discord's `/rcon`. A dedicated Player Accounts panel creates and resets login accounts (`.account create` / `.account set password`, with an optional GM level). An optional read-only database connection reports the real online player count and names with mod-playerbots bots filtered out, instead of the bot-inflated count the game itself reports.
- **Discord bot** — each server posts as its own auto-updating message: an embedded card (color, uptime, players, …) with its control buttons directly beneath it, not bundled with other servers. Plus slash commands (`/servers`, `/server`, `/rcon`, `/broadcast`, `/wowcreate`), all gated by per-role feature permissions and per-command toggles configured in the web UI. Each server can display in its own channel, so you can run multiple status channels.
- **Scheduled restarts** — daily at a set time, or every N hours from a start time, with in-game RCON warnings at 30/5/1 minutes before. A restart is automatically skipped if the server already restarted within the last hour, and any upcoming restart can be pushed back 30 minutes at a time from the dashboard, the server page, or a Discord button.
- **Address display control** — per server, show the auto-detected public IP and game port, substitute a custom address (e.g. a domain name), or hide the address entirely. Applies to the dashboard, the server page, and the Discord embed.
- **Custom embed fields** — attach extra lines to a server's card and Discord embed: a plain message, or a titled link (e.g. a config-file download).
- **Game-aware RCON UI** — RCON/console settings and controls only appear for games that actually have a remote console (Satisfactory and vanilla Valheim don't, so their server pages skip that UI entirely).

## Tech stack

- **Backend:** Node.js 22, TypeScript, Express, better-sqlite3, dockerode, discord.js, ws, mysql2, and a built-in Source RCON client (lenient response matching for Palworld's non-standard RCON) plus a SOAP client for AzerothCore
- **Frontend:** React 18 + Vite
- **Storage:** single SQLite file in `/app/data`

## Deploying on Unraid

1. Run the published image with the Docker socket mounted:

   ```sh
   docker run -d \
     --name stormsmith \
     -p 8080:8080 \
     -v /var/run/docker.sock:/var/run/docker.sock \
     -v /mnt/user/appdata/stormsmith:/app/data \
     --restart unless-stopped \
     thundaknight/stormsmith:latest
   ```

   In the Unraid UI you can add it as a custom container instead — repository `thundaknight/stormsmith:latest` with the same mappings:
   - Path: `/var/run/docker.sock` → `/var/run/docker.sock`
   - Path: `/mnt/user/appdata/stormsmith` → `/app/data`
   - Port: `8080` → `8080`

2. Open `http://<unraid-ip>:8080` and create the initial admin account (first visit only).

To build the image yourself instead of pulling from Docker Hub: `docker build -t thundaknight/stormsmith .`

> **Security note:** mounting the Docker socket gives this container control over Docker on the host. Keep the web UI on your LAN or behind a reverse proxy with HTTPS if you expose it.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/app/data` | Where the SQLite DB and JWT secret live |
| `DOCKER_SOCK` | `/var/run/docker.sock` | Docker socket path |
| `DOCKER_HOST` | _(unset)_ | Set to `tcp://ip:2375` to use a remote Docker API instead of the socket |
| `JWT_SECRET` | _(auto-generated)_ | Override the persisted JWT signing secret |
| `POLL_INTERVAL_MS` | `5000` | Container status poll interval |

## Setting up the Discord bot

1. Create an application at <https://discord.com/developers/applications>, add a **Bot**, and copy its token.
2. Invite the bot to your Discord server with the `bot` and `applications.commands` scopes and permission to **Send Messages** and **Embed Links**.
3. In the web UI → **Discord Bot**: paste the token, enter your guild ID (right-click your server in Discord → Copy Server ID, with developer mode enabled), enable the bot, and save.
4. Once connected, the role and channel pickers populate automatically. Choose:
   - a **status channel** — the bot keeps one embed there with live server status and control buttons,
   - which **roles** may control servers and use RCON (Discord administrators always can),
   - which **channels** slash commands may be used in,
   - which **commands** are enabled, and an optional **RCON allowlist** (command prefixes) to restrict what `/rcon` may run.

## Setting up Discord sign-in (web login)

This is separate from the bot above — it lets people log into the Stormsmith *website* with their Discord account, and can use the same Discord application.

1. In that application's **OAuth2** page (left sidebar), copy the **Client ID** and **Client Secret**.
2. Add a **Redirect** on that same page matching exactly what you'll enter in Stormsmith — e.g. `http://<unraid-ip>:8080/api/auth/discord/callback`.
3. In the web UI → **Discord Bot** → **Web Login (Discord OAuth)**: paste the Client ID, Client Secret, and Redirect URI (there's a button to fill in the current page's origin for convenience), enable it, and save.
4. Leave **"Only allow sign-in from members of the guild configured above"** on (the default) to restrict sign-ups to your Discord server's members — this needs the bot connected and a guild ID set above; turn it off to allow any Discord account to sign up.
5. Share the login page with your community. When someone signs in with Discord for the first time, an account is created with status **pending** and no permissions; approve it from the **Users** page to let them in, then grant per-server permissions.

The initial admin (from first-run setup) can also link a Discord account to their existing login from the new **Account** page, as a second way to sign in alongside their password.

## RCON notes

- Works with any game that speaks the **Source RCON protocol**: Palworld, Minecraft, Rust, ARK, 7 Days to Die, and more.
- The **RCON host** is usually your Unraid IP, with the RCON port mapped by the game container. Remember to enable RCON in the game's own config (e.g. `RCONEnabled=True` for Palworld).
- The **broadcast template** is the RCON command used for in-game messages. `{message}` is replaced with the text; `{message_underscored}` replaces spaces with underscores (needed for Palworld's `Broadcast`).
- Satisfactory and Valheim (vanilla) do not support RCON — you can still import and manage their containers; just leave RCON blank.

## AzerothCore notes

AzerothCore doesn't speak Source RCON — it exposes GM commands over its worldserver **SOAP** interface instead, so importing one as game type "AzerothCore (WoW)" repurposes the RCON fields as SOAP settings:

- Enable SOAP in `worldserver.conf`: `SOAP.Enabled = 1` (default port `7878`, matches the preset).
- The "GM account" needs GM level 3+, and its row in `account_access` must have `RealmID = -1` (all realms).
- The RCON console, `/rcon` in Discord, and the broadcast box all work exactly as with other games — commands go out over SOAP instead of Source RCON. A GM command palette on the server page covers the common ones (kick, mute, ban, announce, teleport, `.server shutdown`/`restart`, …), verified against the [AzerothCore GM commands wiki](https://www.azerothcore.org/wiki/gm-commands).
- A server page's **User Management** tab lists real player accounts (bots excluded) from the optional Player database connection, and has a **Player Accounts** panel to create new login accounts (`.account create`, with an optional starting GM level) or reset an existing account's password (`.account set password`) — these are WoW login accounts for players, separate from Stormsmith's own web-interface users on the Users page.
- Password resets can be done two ways: an admin types the new password directly, or picks the account from a dropdown and **generates a reset link** instead — a one-time, public URL (works over your site's own domain, e.g. `https://your-domain/wow-password-reset/<token>`) that lets the player set their own password without needing a Stormsmith account. The link expires 24 hours after creation or as soon as it's used, whichever comes first.
- Roles granted the **Create WoW accounts** permission (Discord Bot → Role permissions) can run `/wowcreate @user`, which DMs that person a "Set Up Account" button; they choose their own username and password (checked for a name collision on that server), and the bot creates the AzerothCore account over SOAP and confirms in the same DM (and to whoever ran the command, if different) once it's ready.
- **Player counts and account lists**: `mod-playerbots`' random bots show up as ordinary accounts and online characters, so there's no in-game command that reports real players only. If you want an accurate count and account list, fill in the optional **Player database** connection in the server's Settings tab (host/port/user/password + the `acore_characters`/`acore_auth` database names) — Stormsmith then queries the databases directly and excludes any account starting with the bot prefix (`AiPlayerbot.RandomBotAccountPrefix`, default `rndbot`). Leave the host blank to skip this; the server still works, it just won't show a player count or account list.

## Development

```sh
npm install
npm run dev        # backend on :8080 (tsx watch)
npm run dev:web    # frontend on :5173 (vite, proxies /api and /ws)
```

On Windows, point the backend at your Unraid box with `DOCKER_HOST=tcp://<unraid-ip>:2375` (enable the remote API in Unraid's Docker settings first).

## Permission model

| Permission | Grants |
| --- | --- |
| **View** | See the server and its status/stats |
| **Control** | Start / stop / restart / pause / resume |
| **RCON** | RCON console and in-game broadcasts |

Admins implicitly have every permission on every server, plus user management, server import, and Discord configuration.

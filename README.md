# Stormsmith

A self-hosted manager for game servers running as Docker containers on Unraid (or any Docker host).

- **Docker Hub:** [`thundaknight/stormsmith`](https://hub.docker.com/r/thundaknight/stormsmith)
- **Source:** [github.com/Thundaknight/Stormsmith](https://github.com/Thundaknight/Stormsmith)

**Features**

- **Import game servers** — pick any Docker container on the host (Palworld, Satisfactory, Minecraft, …) and manage it as a game server with live status monitoring.
- **Web interface** — start, stop, restart, pause and resume servers; live status via WebSocket; CPU/memory stats.
- **User management** — admin and user roles, with per-server permissions (view / control / RCON) for each user.
- **RCON** — built-in console for Source-RCON games (Palworld, Minecraft, Rust, ARK, 7DtD, …) plus one-click in-game broadcast messages with per-game command templates.
- **Discord bot** — auto-updating status embed with start/stop/restart buttons, slash commands (`/servers`, `/server`, `/rcon`, `/broadcast`), all gated by roles, channels, and per-command toggles configured in the web UI.

## Tech stack

- **Backend:** Node.js 22, TypeScript, Express, better-sqlite3, dockerode, rcon-client, discord.js, ws
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

## RCON notes

- Works with any game that speaks the **Source RCON protocol**: Palworld, Minecraft, Rust, ARK, 7 Days to Die, and more.
- The **RCON host** is usually your Unraid IP, with the RCON port mapped by the game container. Remember to enable RCON in the game's own config (e.g. `RCONEnabled=True` for Palworld).
- The **broadcast template** is the RCON command used for in-game messages. `{message}` is replaced with the text; `{message_underscored}` replaces spaces with underscores (needed for Palworld's `Broadcast`).
- Satisfactory and Valheim (vanilla) do not support RCON — you can still import and manage their containers; just leave RCON blank.

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

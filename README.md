# Stormsmith

Stormsmith is a self-hosted web dashboard for running game servers as Docker containers — on Unraid or any other Docker host. Point it at containers you already have and it takes over the day-to-day: start/stop/restart, live status and stats, RCON/console access, scheduled restarts, and a Discord bot that mirrors all of it as embeds, buttons, and slash commands. Multiple people can share one instance with per-server, per-action permissions instead of everyone needing full access, and accounts can be created via Discord sign-in or an admin-issued invite link — no shared passwords. Palworld and AzerothCore (WoW) get extra dedicated tooling (a settings editor and GM/player-account management, respectively) beyond what's available for games in general.

- **Docker Hub:** [`thundaknight/stormsmith`](https://hub.docker.com/r/thundaknight/stormsmith)
- **Source:** [github.com/Thundaknight/Stormsmith](https://github.com/Thundaknight/Stormsmith)

## Features at a glance

- Import any Docker container as a managed game server, with live status, CPU/memory stats, and start/stop/restart/pause controls
- RCON console and in-game broadcasts for Source-RCON games, plus a SOAP-based GM console for AzerothCore
- A Discord bot that posts auto-updating status embeds with control buttons, and offers slash commands for control, RCON, broadcasts, and AzerothCore account/bot management
- Multi-user access with granular per-server permissions (view/control/RCON/configure); sign in via username+password, Discord OAuth, or an admin-issued invite link
- Scheduled restarts with in-game warnings, custom embed fields, and configurable public address display
- Automatic UniFi port forwarding: a server's port-forward rules close while it's stopped or paused, and reopen when it starts — restarts never close them
- A full Palworld settings editor and dedicated AzerothCore player-account and bot-management tooling
- An admin-only Logs page auditing sensitive Discord bot commands, and a version footer to confirm what's actually deployed

See below for the full detail on each feature.

**Features (detailed)**

- **Import game servers** — pick any Docker container on the host (Palworld, Satisfactory, Minecraft, …) and manage it as a game server with live status monitoring.
- **Web interface** — start, stop, restart, pause and resume servers; live status via WebSocket; CPU/memory stats.
- **User management** — the only manually-created account is the initial admin from first-run setup. Everyone else either signs up with Discord OAuth and lands in a pending queue for approval, or uses an admin-generated **invite link** to create their own username and password directly — no Discord required. Either way, the admin picks the account's role and, for a regular user, exactly which servers it can access, either at approval time or when generating the invite. Invite links are single-use and expire 24 hours after creation or as soon as they're redeemed, whichever comes first. Admins can also link Discord to their own account as a second sign-in option. Per-server permissions are granular: **View**, **Control** (start/stop/restart/pause), **RCON** (console + broadcasts), and **Configure** (server settings, config file, mods) — Import Server, Users, and Discord Bot settings are always admin-only regardless of per-server grants.
- **RCON** — built-in console for Source-RCON games (Palworld, Minecraft, Rust, ARK, 7DtD, …) plus one-click in-game broadcast messages with per-game command templates. Palworld servers get a full command palette (kick/ban, save, graceful shutdown, …).
- **Palworld settings editor** — reads `PalWorldSettings.ini` directly from inside the game container (auto-detecting its location, no extra mounts), and lets you view and edit every setting with sliders, toggles, and dropdowns, then writes it back.
- **Valheim support** — an Admin & Bans tab that edits `adminlist.txt` / `bannedlist.txt` / `permittedlist.txt` in the container, a BepInEx mods panel, and a full RCON console + broadcasts + player list that unlock automatically when the ValheimRcon plugin is detected. See the Valheim notes below.
- **AzerothCore (WoW) support** — GM commands run over the worldserver's SOAP interface (kick, mute, ban, announce, teleport, server shutdown/restart, …) from the web console or Discord's `/rcon`. A dedicated Player Accounts panel creates and resets login accounts (`.account create` / `.account set password`, with an optional GM level). An optional read-only database connection reports the real online player count with mod-playerbots bots filtered out, instead of the bot-inflated count the game itself reports — each online character is shown as name, level, race, and class (e.g. "Fruitpunch 32 Undead Rogue") on the dashboard, server page, and Discord embed.
- **Discord bot** — each server posts as its own auto-updating message: an embedded card (color, uptime, players, …) with its control buttons directly beneath it, not bundled with other servers. Plus slash commands (`/servers`, `/server`, `/rcon`, `/broadcast`, `/wowcreate`, `/wowlevel`), all gated by per-role feature permissions and per-command toggles configured in the web UI. Each server can display in its own channel, so you can run multiple status channels.
- **Scheduled restarts** — daily at a set time, or every N hours from a start time, with in-game RCON warnings at 30/5/1 minutes before. A restart is automatically skipped if the server already restarted within the last hour, and any upcoming restart can be pushed back 30 minutes at a time from the dashboard, the server page, or a Discord button.
- **Address display control** — per server, show the auto-detected public IP and game port, substitute a custom address (e.g. a domain name), or hide the address entirely. Applies to the dashboard, the server page, and the Discord embed.
- **Custom embed fields** — attach extra lines to a server's card and Discord embed: a plain message, or a titled link (e.g. a config-file download).
- **UniFi port forwarding** — map a server to one or more port-forward rules on a UniFi console and Stormsmith keeps them in step with the container: open while it runs, closed once it's been stopped or paused, so a port is never left exposed with nothing behind it. See below for setup.
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
- Satisfactory does not support RCON — you can still import and manage its container; just leave RCON blank. Valheim needs a mod (see below).

## Valheim notes

Vanilla Valheim has no remote console of any kind. Stormsmith works with that:

- **Lifecycle, stats, scheduled restarts, address display, Discord embed and UniFi port forwarding** all work out of the box, same as any other game.
- **Admin & Bans tab** (admins only) — Valheim's only server-side control surface is three text files in the save folder: `adminlist.txt`, `bannedlist.txt`, `permittedlist.txt`, one Platform User ID (`Steam_7656…`) per line. Stormsmith reads and writes them directly in the container. Bans apply within about 30 seconds; admin and permitted changes apply when the player next connects. Get a player's ID from the server log or the in-game F2 panel.
- **Mods tab** (admins only) — upload BepInEx plugin DLLs straight into the container's `BepInEx/plugins` folder. BepInEx itself must already be enabled on your image. Restart the server to load them.
- **Live console, broadcasts and a player list** appear automatically once Stormsmith detects the [`ValheimRcon`](https://thunderstore.io/c/valheim/p/Tristan/ValheimRcon/) BepInEx plugin (`ValheimRcon.dll`) in the plugins folder. Then set the RCON port and password (from `BepInEx/config/org.tristan.rcon.cfg`; the port defaults to the game port + 2) on the Settings tab. ValheimRcon uses a Conan-Exiles-style RCON packet layout — Stormsmith's lenient client handles it.
- Stormsmith auto-detects the save and plugins folders for the common images (ich777, lloesche, mbround18, SteamCMD). If it can't, set the paths on the Settings tab — the container may need to be running the first time so it can look.
- **Not editable:** the server name, world, password and world modifiers. Those are launch arguments / environment variables on every Valheim image, and Stormsmith only controls the container lifecycle, not its configuration.

## AzerothCore notes

AzerothCore doesn't speak Source RCON — it exposes GM commands over its worldserver **SOAP** interface instead, so importing one as game type "AzerothCore (WoW)" repurposes the RCON fields as SOAP settings:

- Enable SOAP in `worldserver.conf`: `SOAP.Enabled = 1` (default port `7878`, matches the preset).
- The "GM account" needs GM level 3+, and its row in `account_access` must have `RealmID = -1` (all realms).
- The RCON console, `/rcon` in Discord, and the broadcast box all work exactly as with other games — commands go out over SOAP instead of Source RCON. A GM command palette on the server page covers the common ones (kick, mute, ban, announce, teleport, `.server shutdown`/`restart`, …), verified against the [AzerothCore GM commands wiki](https://www.azerothcore.org/wiki/gm-commands).
- A server page's **User Management** tab has two panels — these are WoW login accounts for players, separate from Stormsmith's own web-interface users on the Users page:
  - **Player Accounts** lists real accounts (bots excluded) from the optional Player database connection, with online status and last login. Each row expands to show that account's characters (name, level, race, class), and has a **Reset Password** button that pops up either a direct password change or a one-time public reset link the player can use themselves.
  - **Create Account** creates a new login account (`.account create`, with a GM level applied via `.account set gmlevel`) — either directly, or by generating a one-time public **account link** where the player picks their own username and password at the GM level you chose.
  - Both kinds of link resolve at `https://your-domain/wow-account/<token>` and expire 24 hours after creation or as soon as they're used, whichever comes first; every currently-outstanding link for a server is listed under Create Account, with a Revoke button.
- Roles granted the **Create WoW accounts** permission (Discord Bot → Role permissions) can run `/wowcreate @user`, which DMs that person a "Set Up Account" button; they choose their own username and password (checked for a name collision on that server), and the bot creates the AzerothCore account over SOAP and confirms in the same DM (and to whoever ran the command, if different) once it's ready.
- **Player counts and account lists**: `mod-playerbots`' random bots show up as ordinary accounts and online characters, so there's no in-game command that reports real players only. If you want an accurate count and account list, fill in the optional **Player database** connection in the server's Settings tab (host/port/user/password + the `acore_characters`/`acore_auth` database names) — Stormsmith then queries the databases directly and excludes any account starting with the bot prefix (`AiPlayerbot.RandomBotAccountPrefix`, default `rndbot`). Leave the host blank to skip this; the server still works, it just won't show a player count or account list.
- Roles granted the **Manage AI bots** permission can run `/wowlevel @character <level>` (requires the `mod-playerbots` module and the Player database connection above) to level up a specific `mod-playerbots` AI bot by character name. It looks the character up in the Player database first and refuses to run on anything that isn't one of the server's bot accounts, so it can't be pointed at a real player.
  - `/wowlevel` runs AzerothCore's core `.levelup <character> <#levels>` GM command directly on the character record, so it works regardless of whether the bot is still tracked in mod-playerbots' random-bot pool (unlike `.playerbots rndbot` commands, which stop working on a bot once it's ever been added to a party — an mod-playerbots limitation with no server-side fix). It can't lower a bot's level.
  - AzerothCore doesn't send a confirmation back for this command, so Stormsmith can only confirm it was sent, not that it took effect.
  - `/wowlevel` can be restricted to specific Discord channels — see **AI bot command channels** on the Discord Bot page. When set, that list is authoritative for this command (it replaces, not adds to, the bot's general command-channel restriction). Every use, including denied and failed attempts, is recorded on the **Logs** page with who ran it, when, and the result.
  - `/wowgear` and `/wowrestock` (re-gearing/restocking an AI bot) have been removed — AzerothCore has no core GM command for either, only the `mod-playerbots`-specific `.playerbots rndbot refresh`, which (like all `rndbot` commands) stops working on a bot once it's ever been in a party, with no way to restore it.

## UniFi port forwarding

Stormsmith can close a game server's port-forward rules while the server isn't running, so a port is never left open to the internet with nothing listening behind it.

It only ever flips a rule's **enabled** switch. It never creates, edits, or deletes rules — you make them in UniFi as usual and then point Stormsmith at the ones you want managed.

**Setting it up**

1. In your UniFi console, go to **Settings → Admins** and create an admin with **Local access only**. This is a hard requirement: Ubiquiti cloud/SSO logins are rejected by the port-forwarding API, and the account must **not** have two-factor authentication enabled.
2. In the web UI → **Port Forwarding**: tick the enable box, enter the console's IP, port (443), site (`default` unless you renamed it), and the local admin's username and password, then **Save & test**. Leave *Verify TLS certificate* off — UniFi consoles use a self-signed certificate.
3. The page then lists every port-forward rule on the console, with its current open/closed state and which server (if any) manages it.
4. On each game server's **Settings** tab, pick the rules that belong to it. A server can drive several rules (game port, query port, …), and several servers can share one rule — a shared rule only closes once *all* of them are down.

**How it behaves**

- Rules **open immediately** when the container starts.
- Rules **close once the container has been stopped or paused for the grace period** (default 90 seconds, configurable).
- **Restarting never closes a port.** That's what the grace period is for — the container is back up long before the window expires, so no change is ever written. This applies to scheduled restarts too.
- It follows the *actual* container state, not just Stormsmith's own buttons, so a crash or a stop from the Unraid UI closes the rules as well, and state is corrected automatically after Stormsmith itself restarts.
- A rule flipped by hand in the UniFi console is put back within about a minute. If you need a port open for maintenance while its server is down, un-map it first or turn the integration off.
- If the console is unreachable, Stormsmith leaves every rule exactly as it is and retries — it never guesses. The error shows on the Port Forwarding page. Container start/stop is completely unaffected either way; nothing waits on UniFi.
- If a mapped rule is deleted and recreated in UniFi it comes back with a new internal id, so Stormsmith re-matches it by name and repoints the mapping. If it can't find it at all, the server's Settings tab shows a warning instead of silently doing nothing.

**If the connection test fails**

- *"Use a local UniFi admin account…"* — the account is still tied to a Ubiquiti cloud/SSO identity. Recreate it with local access only.
- *"…two-factor authentication enabled"* — turn MFA off for that account, or make a separate one for Stormsmith.
- *"UniFi refused the login request (HTTP 403)"* — the console rejected the request before checking the credentials. Point the host and port at the UniFi console itself rather than a reverse proxy in front of it. Repeated failed logins can also block the caller for a few minutes.
- *"…self-signed certificate"* — untick **Verify TLS certificate**.
- *"the configured Site does not exist"* / `api.err.NoSiteContext` — the **Site** field must be the site's name as shown in the UniFi UI (Stormsmith also accepts its internal id). Leave it as `default` for a single untouched site.

If the account was only just created, log into the UniFi UI with it once before running the test — UniFi doesn't fully provision a new admin until its first sign-in.

Only admins can configure the console or map rules to servers, regardless of per-server permissions.

Tested against UniFi OS consoles (UDM, UDM-Pro, UDR, UCG, Cloud Key Gen2+).

The Stormsmith version is shown at the bottom of the sidebar (and on the login page) — useful for confirming a deployed container is actually running the version you expect, e.g. after pulling a new image.

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

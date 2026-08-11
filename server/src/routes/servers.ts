import crypto from 'crypto';
import express, { Router } from 'express';
import { requireAdmin, requireAuth, requireServerPermission, userCan } from '../auth';
import {
  createServer, createWowPasswordReset, deleteServer, getServerById, listCustomFields, listServers,
  setCustomFields, updateServer,
} from '../db';
import { resolveDisplayAddress } from '../address';
import {
  execInContainer, getStats, listContainerDir, listContainers, performAction,
  putContainerFile, readContainerFile, writeContainerFile,
} from '../docker';
import { discordBot } from '../discord/bot';
import { fetchAzerothAccounts, hasDbConfig } from '../games/azerothcore';
import { applySettings, parseOptionSettings } from '../games/palworld';
import { monitor } from '../monitor';
import { getPublicIp } from '../publicIp';
import { sendBroadcast, sendRconCommand } from '../rcon';
import { delayScheduledRestart, getNextScheduledRestart } from '../scheduler';
import type { GameServer, ServerAction } from '../types';
import { asyncRoute } from './helpers';

const WOW_RESET_TTL_MS = 24 * 60 * 60 * 1000;

const router = Router();
router.use(requireAuth);

const ACTIONS: ServerAction[] = ['start', 'stop', 'restart', 'pause', 'unpause'];

function publicServer(s: GameServer, includeSecrets: boolean) {
  const status = monitor.get(s.id);
  const base = {
    id: s.id,
    name: s.name,
    game: s.game,
    container_name: s.container_name,
    broadcast_template: s.broadcast_template,
    config_path: s.config_path,
    game_port: s.game_port,
    restart_enabled: !!s.restart_enabled,
    restart_time: s.restart_time,
    restart_mode: s.restart_mode,
    restart_interval_hours: s.restart_interval_hours,
    discord_show: !!s.discord_show,
    discord_channel_id: s.discord_channel_id,
    rcon_configured: !!(s.rcon_host && s.rcon_port),
    db_configured: hasDbConfig(s),
    address: resolveDisplayAddress(s, getPublicIp()),
    address_mode: s.address_mode,
    custom_address: s.custom_address,
    custom_fields: listCustomFields(s.id),
    state: status?.state ?? 'not_found',
    statusText: status?.statusText ?? '',
    cpuPercent: status?.cpuPercent ?? null,
    memUsageBytes: status?.memUsageBytes ?? null,
    memLimitBytes: status?.memLimitBytes ?? null,
    playerCount: status?.playerCount ?? null,
    players: status?.players ?? null,
    startedAt: status?.startedAt ?? null,
    nextRestartAt: (() => {
      const at = getNextScheduledRestart(s.id);
      return at ? new Date(at).toISOString() : null;
    })(),
    created_at: s.created_at,
  };
  if (!includeSecrets) return base;
  return {
    ...base,
    rcon_host: s.rcon_host,
    rcon_port: s.rcon_port,
    rcon_username: s.rcon_username,
    rcon_password: s.rcon_password,
    db_host: s.db_host,
    db_port: s.db_port,
    db_user: s.db_user,
    db_password: s.db_password,
    db_characters_db: s.db_characters_db,
    db_auth_db: s.db_auth_db,
    bot_account_prefix: s.bot_account_prefix,
  };
}

/** Servers visible to the current user, with live status. */
router.get('/', (req, res) => {
  const user = req.user!;
  const servers = listServers().filter((s) => userCan(user, s.id, 'view'));
  res.json({
    servers: servers.map((s) => ({
      ...publicServer(s, user.role === 'admin' || userCan(user, s.id, 'configure')),
      can_control: userCan(user, s.id, 'control'),
      can_rcon: userCan(user, s.id, 'rcon'),
      can_configure: userCan(user, s.id, 'configure'),
    })),
    dockerError: monitor.getLastError(),
    publicIp: getPublicIp(),
  });
});

/** Docker containers available for import (admin only). */
router.get('/available-containers', requireAdmin, asyncRoute(async (_req, res) => {
  const containers = await listContainers();
  const imported = new Set(listServers().map((s) => s.container_name));
  res.json({ containers: containers.map((c) => ({ ...c, imported: imported.has(c.name) })) });
}));

/** Import a server (admin only). */
router.post('/', requireAdmin, (req, res) => {
  const { name, game, container_name, rcon_host, rcon_port, rcon_password, broadcast_template } = req.body || {};
  if (!name || !container_name) {
    res.status(400).json({ error: 'Name and container name are required' });
    return;
  }
  try {
    const server = createServer({
      name,
      game: game || 'custom',
      container_name,
      rcon_host: rcon_host || '',
      rcon_port: parseInt(rcon_port, 10) || 0,
      rcon_username: req.body?.rcon_username || '',
      rcon_password: rcon_password || '',
      broadcast_template: broadcast_template ?? 'say {message}',
      config_path: req.body?.config_path || '',
      game_port: parseInt(req.body?.game_port, 10) || 0,
      restart_enabled: 0,
      restart_time: '04:00',
      restart_mode: 'daily',
      restart_interval_hours: 6,
      discord_show: 1,
      discord_channel_id: '',
      db_host: req.body?.db_host || '',
      db_port: parseInt(req.body?.db_port, 10) || 3306,
      db_user: req.body?.db_user || '',
      db_password: req.body?.db_password || '',
      db_characters_db: req.body?.db_characters_db || 'acore_characters',
      db_auth_db: req.body?.db_auth_db || 'acore_auth',
      bot_account_prefix: req.body?.bot_account_prefix || 'rndbot',
      address_mode: 'auto',
      custom_address: '',
    });
    monitor.refresh().catch(() => {});
    discordBot.refreshStatus();
    res.json({ server: publicServer(server, true) });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) {
      res.status(409).json({ error: 'That container has already been imported' });
      return;
    }
    throw err;
  }
});

router.get('/:id', requireServerPermission('view'), (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const user = req.user!;
  res.json({
    server: {
      ...publicServer(server, user.role === 'admin' || userCan(user, server.id, 'configure')),
      can_control: userCan(user, server.id, 'control'),
      can_rcon: userCan(user, server.id, 'rcon'),
      can_configure: userCan(user, server.id, 'configure'),
    },
  });
});

router.put('/:id', requireServerPermission('configure'), (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const b = req.body || {};
  updateServer(server.id, {
    name: b.name ?? server.name,
    game: b.game ?? server.game,
    container_name: b.container_name ?? server.container_name,
    rcon_host: b.rcon_host ?? server.rcon_host,
    rcon_port: b.rcon_port !== undefined ? parseInt(b.rcon_port, 10) || 0 : server.rcon_port,
    rcon_username: b.rcon_username ?? server.rcon_username,
    rcon_password: b.rcon_password ?? server.rcon_password,
    broadcast_template: b.broadcast_template ?? server.broadcast_template,
    config_path: b.config_path ?? server.config_path,
    game_port: b.game_port !== undefined ? parseInt(b.game_port, 10) || 0 : server.game_port,
    restart_enabled: b.restart_enabled !== undefined ? (b.restart_enabled ? 1 : 0) : server.restart_enabled,
    restart_time:
      b.restart_time !== undefined && /^\d{1,2}:\d{2}$/.test(String(b.restart_time))
        ? String(b.restart_time)
        : server.restart_time,
    restart_mode: b.restart_mode === 'daily' || b.restart_mode === 'interval' ? b.restart_mode : server.restart_mode,
    restart_interval_hours:
      b.restart_interval_hours !== undefined
        ? Math.min(Math.max(parseInt(b.restart_interval_hours, 10) || 6, 1), 24)
        : server.restart_interval_hours,
    discord_show: b.discord_show !== undefined ? (b.discord_show ? 1 : 0) : server.discord_show,
    discord_channel_id:
      b.discord_channel_id !== undefined ? String(b.discord_channel_id).trim() : server.discord_channel_id,
    db_host: b.db_host ?? server.db_host,
    db_port: b.db_port !== undefined ? parseInt(b.db_port, 10) || 3306 : server.db_port,
    db_user: b.db_user ?? server.db_user,
    db_password: b.db_password ?? server.db_password,
    db_characters_db: b.db_characters_db ?? server.db_characters_db,
    db_auth_db: b.db_auth_db ?? server.db_auth_db,
    bot_account_prefix: b.bot_account_prefix ?? server.bot_account_prefix,
    address_mode:
      b.address_mode === 'auto' || b.address_mode === 'custom' || b.address_mode === 'hidden'
        ? b.address_mode
        : server.address_mode,
    custom_address: b.custom_address !== undefined ? String(b.custom_address).trim() : server.custom_address,
  });
  monitor.refresh().catch(() => {});
  discordBot.refreshStatus();
  res.json({ server: publicServer(getServerById(server.id)!, true) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  deleteServer(parseInt(req.params.id, 10));
  monitor.refresh().catch(() => {});
  discordBot.refreshStatus();
  res.json({ ok: true });
});

/** Replace this server's custom embed fields (message or link entries shown on the dashboard and in Discord). */
router.put('/:id/fields', requireServerPermission('configure'), (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const fields = req.body?.fields;
  if (!Array.isArray(fields)) {
    res.status(400).json({ error: 'fields must be an array' });
    return;
  }
  setCustomFields(
    server.id,
    fields.map((f: any) => ({
      type: f?.type === 'link' ? 'link' : 'message',
      title: String(f?.title || ''),
      content: String(f?.content || ''),
    }))
  );
  discordBot.refreshStatus();
  res.json({ fields: listCustomFields(server.id) });
});

/** Start / stop / restart / pause / unpause the container. */
router.post('/:id/action', requireServerPermission('control'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const action = req.body?.action as ServerAction;
  if (!ACTIONS.includes(action)) {
    res.status(400).json({ error: `Action must be one of: ${ACTIONS.join(', ')}` });
    return;
  }
  await performAction(server.container_name, action);
  await monitor.refresh();
  res.json({ ok: true, state: monitor.get(server.id)?.state });
}));

/** Push the next scheduled restart back by 30 minutes. */
router.post('/:id/delay-restart', requireServerPermission('control'), (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const targetAt = server.restart_enabled ? delayScheduledRestart(server.id) : null;
  if (!targetAt) {
    res.status(400).json({ error: 'No scheduled restart to delay' });
    return;
  }
  res.json({ ok: true, nextRestartAt: new Date(targetAt).toISOString() });
});

/** Live CPU / memory stats. */
router.get('/:id/stats', requireServerPermission('view'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  res.json({ stats: await getStats(server.container_name) });
}));

/** Send a raw RCON command. */
router.post('/:id/rcon', requireServerPermission('rcon'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const command = String(req.body?.command || '').trim();
  if (!command) {
    res.status(400).json({ error: 'Command is required' });
    return;
  }
  const response = await sendRconCommand(server, command);
  res.json({ response });
}));

/** Send an in-game broadcast message using the server's template. */
router.post('/:id/broadcast', requireServerPermission('rcon'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const message = String(req.body?.message || '').trim();
  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }
  const response = await sendBroadcast(server, message);
  res.json({ response });
}));

// ---- AzerothCore player accounts ----

/** Real player accounts (bots excluded) from the optional player database connection. */
router.get('/:id/wow-accounts', requireServerPermission('rcon'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server || server.game !== 'azerothcore') {
    res.status(400).json({ error: 'Not an AzerothCore server' });
    return;
  }
  if (!hasDbConfig(server)) {
    res.status(400).json({ error: 'Player database is not configured for this server — set it in the Settings tab.' });
    return;
  }
  const accounts = await fetchAzerothAccounts(server);
  res.json({ accounts });
}));

/**
 * Generates a one-time, publicly-accessible link a player can use to set
 * their own password, instead of an admin typing it for them. Expires after
 * 24 hours or as soon as it's used — whichever comes first.
 */
router.post('/:id/wow-accounts/reset-link', requireServerPermission('rcon'), (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server || server.game !== 'azerothcore') {
    res.status(400).json({ error: 'Not an AzerothCore server' });
    return;
  }
  const username = String(req.body?.username || '').trim();
  if (!username) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + WOW_RESET_TTL_MS;
  createWowPasswordReset({ token, server_id: server.id, username, created_by: req.user!.userId, expires_at: expiresAt });
  res.json({ token, expiresAt: new Date(expiresAt).toISOString() });
});

// Known PalWorldSettings.ini locations across popular Palworld Docker images
const PALWORLD_CONFIG_CANDIDATES = [
  '/palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
  '/serverdata/serverfiles/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
  '/data/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
  '/home/steam/palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
];

async function resolveConfigPath(server: GameServer): Promise<{ path: string; raw: string }> {
  if (server.config_path) {
    return { path: server.config_path, raw: await readContainerFile(server.container_name, server.config_path) };
  }
  for (const candidate of PALWORLD_CONFIG_CANDIDATES) {
    try {
      const raw = await readContainerFile(server.container_name, candidate);
      updateServer(server.id, { ...server, config_path: candidate });
      return { path: candidate, raw };
    } catch {
      /* try the next known location */
    }
  }
  throw Object.assign(
    new Error(
      'Could not find PalWorldSettings.ini in the container. Set the config file path in the server settings.'
    ),
    { statusCode: 404 }
  );
}

/** Read the game config file from inside the container (requires configure permission). */
router.get('/:id/config', requireServerPermission('configure'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { path: configPath, raw } = await resolveConfigPath(server);
  const entries = parseOptionSettings(raw);
  res.json({
    path: configPath,
    settings: Object.fromEntries((entries || []).map((e) => [e.key, e.value])),
    empty: entries === null,
  });
}));

/** Write updated settings back into the container's config file (requires configure permission). */
router.put('/:id/config', requireServerPermission('configure'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    res.status(400).json({ error: 'settings must be an object of key/value pairs' });
    return;
  }
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (!/^[A-Za-z0-9_]+$/.test(k)) continue;
    updates[k] = String(v);
  }
  const { path: configPath, raw } = await resolveConfigPath(server);
  const next = applySettings(raw, updates);
  await writeContainerFile(server.container_name, configPath, next);
  const state = monitor.get(server.id)?.state;
  res.json({ ok: true, path: configPath, restartRequired: state === 'running' });
}));

// ---- Mods (Palworld) ----

const MOD_FOLDERS = ['~mods', 'LogicMods'] as const;
type ModFolder = (typeof MOD_FOLDERS)[number];

function modFolder(req: { query: Record<string, unknown> }): ModFolder {
  const f = String(req.query.folder || '~mods');
  return (MOD_FOLDERS as readonly string[]).includes(f) ? (f as ModFolder) : '~mods';
}

/** The Paks directory, derived from the (auto-detected) config file location. */
async function resolvePaksDir(server: GameServer): Promise<string> {
  if (server.game !== 'palworld') {
    throw Object.assign(new Error('Mod management is currently only supported for Palworld servers'), { statusCode: 400 });
  }
  const { path: configPath } = await resolveConfigPath(server);
  const idx = configPath.indexOf('/Pal/Saved/');
  if (idx === -1) {
    throw Object.assign(new Error('Could not derive the Paks directory from the config path'), { statusCode: 500 });
  }
  return `${configPath.slice(0, idx)}/Pal/Content/Paks`;
}

function safeModFileName(name: string): string {
  const clean = String(name).trim();
  if (!clean || clean.includes('/') || clean.includes('\\') || clean.includes('..') || clean.startsWith('.')) {
    throw Object.assign(new Error('Invalid file name'), { statusCode: 400 });
  }
  return clean;
}

/** List mod files (requires the container to be running). */
router.get('/:id/mods', requireServerPermission('configure'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const paksDir = await resolvePaksDir(server);
  const folder = modFolder(req);
  const running = monitor.get(server.id)?.state === 'running';
  if (!running) {
    res.json({ path: `${paksDir}/${folder}`, folder, running: false, mods: [] });
    return;
  }
  const mods = await listContainerDir(server.container_name, `${paksDir}/${folder}`);
  res.json({ path: `${paksDir}/${folder}`, folder, running: true, mods });
}));

/** Upload a mod file (works even while the container is stopped). */
router.post(
  '/:id/mods',
  requireServerPermission('configure'),
  express.raw({ type: () => true, limit: '2gb' }),
  asyncRoute(async (req, res) => {
    const server = getServerById(parseInt(req.params.id, 10));
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    const fileName = safeModFileName(String(req.query.filename || ''));
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: 'Empty upload' });
      return;
    }
    const paksDir = await resolvePaksDir(server);
    const folder = modFolder(req);
    await putContainerFile(server.container_name, paksDir, folder, fileName, body);
    res.json({ ok: true, name: fileName, size: body.length, folder });
  })
);

/** Delete a mod file (requires the container to be running). */
router.delete('/:id/mods/:filename', requireServerPermission('configure'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (monitor.get(server.id)?.state !== 'running') {
    res.status(409).json({ error: 'The container must be running to delete files' });
    return;
  }
  const fileName = safeModFileName(req.params.filename);
  const paksDir = await resolvePaksDir(server);
  const folder = modFolder(req);
  const result = await execInContainer(server.container_name, ['rm', '-rf', `${paksDir}/${folder}/${fileName}`]);
  if (result.exitCode !== 0) {
    res.status(500).json({ error: `Delete failed: ${result.stderr || 'unknown error'}` });
    return;
  }
  res.json({ ok: true });
}));

export default router;

import crypto from 'crypto';
import path from 'path';
import express, { Router } from 'express';
import { requireAdmin, requireAuth, requireServerPermission, userCan } from '../auth';
import {
  createServer, createWowAccountLink, deleteServer, deleteWowAccountLink, getServerById, listCustomFields,
  listPlayersSeen, listServerActivity, listServers, listUnifiRules, listWowAccountLinks, logServerActivity,
  setCustomFields, setUnifiRules, updateServer,
} from '../db';
import { resolveDisplayAddress } from '../address';
import {
  execInContainer, getStats, listContainerDir, listContainers, performAction,
  putContainerFile, readContainerFile, writeContainerFile,
} from '../docker';
import { discordBot } from '../discord/bot';
import { fetchAzerothAccounts, fetchAzerothCharacters, hasDbConfig } from '../games/azerothcore';
import { supportsPlayerList } from '../games/players';
import { applySettings, parseOptionSettings } from '../games/palworld';
import {
  findPluginsDirScript, findSaveDirScript, isValidValheimId, parseIdList, serializeIdList, VALHEIM_LISTS,
} from '../games/valheim';
import type { ValheimList } from '../games/valheim';
import { monitor } from '../monitor';
import { getPublicIp } from '../publicIp';
import { sendBroadcast, sendRconCommand } from '../rcon';
import { delayScheduledRestart, getNextScheduledRestart } from '../scheduler';
import { unifiSync } from '../unifi/sync';
import type { GameServer, ServerAction } from '../types';
import { asyncRoute } from './helpers';

const WOW_LINK_TTL_MS = 24 * 60 * 60 * 1000;

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
    valheim_save_dir: s.valheim_save_dir,
    valheim_plugins_dir: s.valheim_plugins_dir,
    unifi_rule_ids: listUnifiRules(s.id).map((r) => r.rule_id),
    unifi_warning: unifiSync.warningFor(s.id),
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

/** Activity across every server (admin Logs page). Must precede `/:id`. */
router.get('/activity', requireAdmin, (req, res) => {
  const entries = listServerActivity({
    kinds: parseKinds(req.query.kind),
    before: req.query.before ? parseInt(String(req.query.before), 10) || undefined : undefined,
    limit: req.query.limit ? parseInt(String(req.query.limit), 10) || undefined : undefined,
  });
  res.json({ entries: entries.map(activityView) });
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
      valheim_save_dir: '',
      valheim_plugins_dir: '',
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
    valheim_save_dir:
      b.valheim_save_dir !== undefined ? String(b.valheim_save_dir).trim() : server.valheim_save_dir,
    valheim_plugins_dir:
      b.valheim_plugins_dir !== undefined ? String(b.valheim_plugins_dir).trim() : server.valheim_plugins_dir,
  });
  // Port forwarding is network-level, so it stays admin-only even for users granted 'configure'
  // on this server — same rule as Import Server / Users / Discord Bot.
  if (b.unifi_rules !== undefined && req.user?.role === 'admin') {
    const rules = Array.isArray(b.unifi_rules) ? b.unifi_rules : [];
    setUnifiRules(
      server.id,
      rules.map((r: any) =>
        typeof r === 'string'
          ? { rule_id: r, rule_name: '' }
          : { rule_id: String(r?.rule_id || ''), rule_name: String(r?.rule_name || '') }
      )
    );
  }
  logServerActivity({ server_id: server.id, kind: 'config', actor: req.user!.username, detail: 'edited server settings' });
  monitor.refresh().catch(() => {});
  discordBot.refreshStatus();
  res.json({ server: publicServer(getServerById(server.id)!, true) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (server) {
    logServerActivity({ server_id: null, kind: 'config', actor: req.user!.username, detail: `removed server "${server.name}"` });
  }
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
  logServerActivity({ server_id: server.id, kind: 'config', actor: req.user!.username, detail: 'edited custom embed fields' });
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
  try {
    await performAction(server.container_name, action);
    logServerActivity({ server_id: server.id, kind: 'action', actor: req.user!.username, detail: action, result: 'ok' });
  } catch (err: any) {
    logServerActivity({
      server_id: server.id, kind: 'action', actor: req.user!.username, detail: action,
      result: 'error', target: err?.message || String(err),
    });
    throw err;
  }
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
  logServerActivity({
    server_id: server.id, kind: 'config', actor: req.user!.username,
    detail: `delayed the scheduled restart to ${new Date(targetAt).toLocaleString()}`,
  });
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
  try {
    const response = await sendRconCommand(server, command);
    logServerActivity({ server_id: server.id, kind: 'command', actor: req.user!.username, detail: command, result: 'ok' });
    res.json({ response });
  } catch (err: any) {
    logServerActivity({
      server_id: server.id, kind: 'command', actor: req.user!.username, detail: command,
      result: 'error', target: err?.message || String(err),
    });
    throw err;
  }
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
  try {
    const response = await sendBroadcast(server, message);
    logServerActivity({ server_id: server.id, kind: 'broadcast', actor: req.user!.username, detail: message, result: 'ok' });
    res.json({ response });
  } catch (err: any) {
    logServerActivity({
      server_id: server.id, kind: 'broadcast', actor: req.user!.username, detail: message,
      result: 'error', target: err?.message || String(err),
    });
    throw err;
  }
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

/** The characters on one login account. */
router.get('/:id/wow-accounts/:username/characters', requireServerPermission('rcon'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server || server.game !== 'azerothcore') {
    res.status(400).json({ error: 'Not an AzerothCore server' });
    return;
  }
  if (!hasDbConfig(server)) {
    res.status(400).json({ error: 'Player database is not configured for this server — set it in the Settings tab.' });
    return;
  }
  const characters = await fetchAzerothCharacters(server, req.params.username);
  res.json({ characters });
}));

/** Currently-outstanding account-creation and password-reset links for this server. */
router.get('/:id/wow-accounts/links', requireServerPermission('rcon'), (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server || server.game !== 'azerothcore') {
    res.status(400).json({ error: 'Not an AzerothCore server' });
    return;
  }
  res.json({
    links: listWowAccountLinks(server.id).map((l) => ({
      token: l.token, purpose: l.purpose, username: l.username, gmLevel: l.gm_level,
      expiresAt: new Date(l.expires_at).toISOString(), createdAt: l.created_at,
    })),
  });
});

router.delete('/:id/wow-accounts/links/:token', requireServerPermission('rcon'), (req, res) => {
  deleteWowAccountLink(req.params.token);
  res.json({ ok: true });
});

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
  const expiresAt = Date.now() + WOW_LINK_TTL_MS;
  createWowAccountLink({
    token, server_id: server.id, purpose: 'reset', username, gm_level: 0,
    created_by: req.user!.userId, expires_at: expiresAt,
  });
  res.json({ token, expiresAt: new Date(expiresAt).toISOString() });
});

/**
 * Generates a one-time, publicly-accessible link a new player can use to
 * create their own account (they choose their own username and password) at
 * a GM level the admin sets now. Expires after 24 hours or as soon as it's used.
 */
router.post('/:id/wow-accounts/create-link', requireServerPermission('rcon'), (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server || server.game !== 'azerothcore') {
    res.status(400).json({ error: 'Not an AzerothCore server' });
    return;
  }
  const gmLevel = Math.min(Math.max(parseInt(req.body?.gmLevel, 10) || 0, 0), 3);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + WOW_LINK_TTL_MS;
  createWowAccountLink({
    token, server_id: server.id, purpose: 'create', username: '', gm_level: gmLevel,
    created_by: req.user!.userId, expires_at: expiresAt,
  });
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
  logServerActivity({
    server_id: server.id, kind: 'config', actor: req.user!.username,
    detail: `edited the game config (${Object.keys(updates).length} setting${Object.keys(updates).length === 1 ? '' : 's'})`,
  });
  res.json({ ok: true, path: configPath, restartRequired: state === 'running' });
}));

// ---- Mods ----

/** Rejects a path we can't safely interpolate into a shell command. */
function shArg(p: string): string {
  if (p.includes("'") || p.includes('\n')) {
    throw Object.assign(new Error('Invalid container path'), { statusCode: 400 });
  }
  return `'${p}'`;
}

interface ModLayout {
  /** Parent dir passed to putContainerFile; `${base}/${folder}` is the operating dir. */
  base: string;
  folders: Array<{ id: string; label: string; hint: string }>;
  defaultFolder: string;
}

/** The Palworld Paks directory, derived from the (auto-detected) config file location. */
async function resolvePalworldPaksDir(server: GameServer): Promise<string> {
  const { path: configPath } = await resolveConfigPath(server);
  const idx = configPath.indexOf('/Pal/Saved/');
  if (idx === -1) {
    throw Object.assign(new Error('Could not derive the Paks directory from the config path'), { statusCode: 500 });
  }
  return `${configPath.slice(0, idx)}/Pal/Content/Paks`;
}

/** The Valheim BepInEx plugins directory — a manual override, else probed once and cached. */
async function resolveValheimPluginsDir(server: GameServer): Promise<string> {
  if (server.valheim_plugins_dir) return server.valheim_plugins_dir;
  if (monitor.get(server.id)?.state !== 'running') {
    throw Object.assign(
      new Error('Start the container once so Stormsmith can locate the BepInEx plugins folder, or set it in Settings.'),
      { statusCode: 409 }
    );
  }
  const result = await execInContainer(server.container_name, ['sh', '-c', findPluginsDirScript()]);
  const dir = result.stdout.trim().split(/\r?\n/)[0].trim();
  if (!dir) {
    throw Object.assign(
      new Error('Could not find a BepInEx/plugins folder in the container. Install BepInEx, or set the path in Settings.'),
      { statusCode: 404 }
    );
  }
  updateServer(server.id, { ...server, valheim_plugins_dir: dir });
  return dir;
}

async function resolveModLayout(server: GameServer): Promise<ModLayout> {
  if (server.game === 'palworld') {
    return {
      base: await resolvePalworldPaksDir(server),
      folders: [
        { id: '~mods', label: 'Pak mods (~mods)', hint: 'Standard .pak mods go here.' },
        { id: 'LogicMods', label: 'Logic mods (LogicMods)', hint: 'UE4SS/BP logic mod .pak files go here.' },
      ],
      defaultFolder: '~mods',
    };
  }
  if (server.game === 'valheim') {
    const pluginsDir = await resolveValheimPluginsDir(server);
    const folderId = path.posix.basename(pluginsDir) || 'plugins';
    return {
      base: path.posix.dirname(pluginsDir),
      folders: [{ id: folderId, label: 'BepInEx plugins', hint: 'BepInEx plugin .dll files (and mod folders) go here.' }],
      defaultFolder: folderId,
    };
  }
  throw Object.assign(new Error('Mod management is not available for this game'), { statusCode: 400 });
}

function pickModFolder(layout: ModLayout, req: { query: Record<string, unknown> }): string {
  const f = String(req.query.folder || layout.defaultFolder);
  return layout.folders.some((x) => x.id === f) ? f : layout.defaultFolder;
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
  const layout = await resolveModLayout(server);
  const folder = pickModFolder(layout, req);
  const dir = `${layout.base}/${folder}`;
  const running = monitor.get(server.id)?.state === 'running';
  if (!running) {
    res.json({ path: dir, folder, folders: layout.folders, running: false, mods: [] });
    return;
  }
  const mods = await listContainerDir(server.container_name, dir);
  res.json({ path: dir, folder, folders: layout.folders, running: true, mods });
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
    const layout = await resolveModLayout(server);
    const folder = pickModFolder(layout, req);
    await putContainerFile(server.container_name, layout.base, folder, fileName, body);
    logServerActivity({ server_id: server.id, kind: 'config', actor: req.user!.username, detail: `uploaded mod file ${fileName}` });
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
  const layout = await resolveModLayout(server);
  const folder = pickModFolder(layout, req);
  const result = await execInContainer(server.container_name, ['rm', '-rf', `${layout.base}/${folder}/${fileName}`]);
  if (result.exitCode !== 0) {
    res.status(500).json({ error: `Delete failed: ${result.stderr || 'unknown error'}` });
    return;
  }
  logServerActivity({ server_id: server.id, kind: 'config', actor: req.user!.username, detail: `deleted mod file ${fileName}` });
  res.json({ ok: true });
}));

// ---- Valheim: admin / banned / permitted lists + RCON-mod detection ----

/** The Valheim save directory (holds adminlist.txt etc.) — manual override, else probed once. */
async function resolveValheimSaveDir(server: GameServer): Promise<string> {
  if (server.valheim_save_dir) return server.valheim_save_dir;
  if (monitor.get(server.id)?.state !== 'running') {
    throw Object.assign(
      new Error('Start the container once so Stormsmith can locate the save folder, or set it in Settings.'),
      { statusCode: 409 }
    );
  }
  const result = await execInContainer(server.container_name, ['sh', '-c', findSaveDirScript()]);
  const dir = result.stdout.trim().split(/\r?\n/)[0].trim();
  if (!dir) {
    throw Object.assign(
      new Error('Could not locate the Valheim save folder in the container. Set the save directory in Settings.'),
      { statusCode: 404 }
    );
  }
  updateServer(server.id, { ...server, valheim_save_dir: dir });
  return dir;
}

function requireValheim(server: GameServer | undefined, res: express.Response): server is GameServer {
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return false;
  }
  if (server.game !== 'valheim') {
    res.status(400).json({ error: 'Not a Valheim server' });
    return false;
  }
  return true;
}

/** Resolved paths + whether the ValheimRcon plugin is present (drives the Tier-2 UI). */
router.get('/:id/valheim', requireServerPermission('configure'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!requireValheim(server, res)) return;
  const running = monitor.get(server.id)?.state === 'running';

  let pluginsDir = server.valheim_plugins_dir;
  let rconDetected = false;
  let warning = '';
  try {
    pluginsDir = await resolveValheimPluginsDir(server);
    if (running) {
      const found = await execInContainer(server.container_name, [
        'sh', '-c', `find ${shArg(pluginsDir)} -maxdepth 3 -iname 'ValheimRcon.dll' 2>/dev/null | head -n1`,
      ]);
      rconDetected = found.stdout.trim().length > 0;
    }
  } catch (err: any) {
    warning = err?.message || String(err);
  }
  res.json({
    running,
    saveDir: server.valheim_save_dir,
    pluginsDir,
    rconDetected,
    warning,
  });
}));

/** The three permission lists, one Platform User ID per row. */
router.get('/:id/valheim-lists', requireServerPermission('configure'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!requireValheim(server, res)) return;
  const dir = await resolveValheimSaveDir(server);
  const lists: Record<string, string[]> = {};
  for (const list of VALHEIM_LISTS) {
    try {
      lists[list] = parseIdList(await readContainerFile(server.container_name, `${dir}/${list}.txt`)).ids;
    } catch {
      lists[list] = []; // file not written yet — that's fine
    }
  }
  res.json({ saveDir: dir, lists });
}));

/** Replace one list. Body: { list: 'adminlist'|'bannedlist'|'permittedlist', ids: string[] }. */
router.put('/:id/valheim-lists', requireServerPermission('configure'), asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!requireValheim(server, res)) return;

  const list = String(req.body?.list || '') as ValheimList;
  if (!(VALHEIM_LISTS as readonly string[]).includes(list)) {
    res.status(400).json({ error: `list must be one of: ${VALHEIM_LISTS.join(', ')}` });
    return;
  }
  const rawIds: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => String(x).trim()) : [];
  const ids = [...new Set(rawIds.filter(Boolean))];
  const invalid = ids.filter((id) => !isValidValheimId(id));
  if (invalid.length) {
    res.status(400).json({ error: `Not valid Platform User IDs (expected e.g. Steam_7656…): ${invalid.join(', ')}` });
    return;
  }

  const dir = await resolveValheimSaveDir(server);
  const filePath = `${dir}/${list}.txt`;
  let header = '';
  try {
    header = parseIdList(await readContainerFile(server.container_name, filePath)).header;
  } catch {
    /* new file */
  }
  await writeContainerFile(server.container_name, filePath, serializeIdList({ header, ids }));
  logServerActivity({
    server_id: server.id, kind: 'config', actor: req.user!.username,
    detail: `updated ${list}.txt (${ids.length} ID${ids.length === 1 ? '' : 's'})`,
  });
  res.json({
    ok: true,
    list,
    ids,
    appliesIn: list === 'bannedlist' ? 'within ~30 seconds' : 'when the affected player next connects',
  });
}));

// ---- Activity log + player roster (admin only) ----

const ACTIVITY_KINDS = ['command', 'broadcast', 'action', 'config', 'player'] as const;

function parseKinds(raw: unknown): Array<(typeof ACTIVITY_KINDS)[number]> | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const wanted = raw.split(',').map((s) => s.trim());
  const valid = ACTIVITY_KINDS.filter((k) => wanted.includes(k));
  return valid.length ? valid : undefined;
}

/** Activity for one server (its Logs tab). */
router.get('/:id/activity', requireAdmin, (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const entries = listServerActivity({
    serverId: server.id,
    kinds: parseKinds(req.query.kind),
    before: req.query.before ? parseInt(String(req.query.before), 10) || undefined : undefined,
    limit: req.query.limit ? parseInt(String(req.query.limit), 10) || undefined : undefined,
  });
  res.json({ entries: entries.map(activityView) });
});

/** Player roster for one server: who has connected, and when they were last seen. */
router.get('/:id/players', requireAdmin, asyncRoute(async (req, res) => {
  const server = getServerById(parseInt(req.params.id, 10));
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const online = new Set(monitor.get(server.id)?.players ?? []);

  if (server.game === 'azerothcore' && hasDbConfig(server)) {
    // AzerothCore keeps a real last_login per account — better than our poll history.
    const accounts = await fetchAzerothAccounts(server);
    res.json({
      supported: true,
      source: 'database',
      players: accounts.map((a) => ({
        name: a.username, online: a.online, lastSeen: a.lastLogin, firstSeen: null,
      })),
    });
    return;
  }

  const seen = listPlayersSeen(server.id);
  res.json({
    supported: supportsPlayerList(server) || seen.length > 0,
    source: 'poll',
    players: seen.map((p) => ({
      name: p.player_name,
      online: online.has(p.player_name),
      lastSeen: isoFromSqlite(p.last_seen),
      firstSeen: isoFromSqlite(p.first_seen),
    })),
  });
}));

function isoFromSqlite(s: string): string {
  // SQLite datetime('now') is UTC but lacks the 'T'/'Z' — make it unambiguous ISO-8601.
  return new Date(`${s.replace(' ', 'T')}Z`).toISOString();
}

function activityView(e: import('../types').ServerActivityEntry) {
  return {
    id: e.id,
    serverId: e.server_id,
    serverName: e.server_id ? getServerById(e.server_id)?.name ?? null : null,
    kind: e.kind,
    source: e.source,
    actor: e.actor,
    detail: e.detail,
    target: e.target,
    result: e.result,
    createdAt: isoFromSqlite(e.created_at),
  };
}

export default router;

import { Router } from 'express';
import { requireAdmin, requireAuth, requireServerPermission, userCan } from '../auth';
import {
  createServer, deleteServer, getServerById, listServers, updateServer,
} from '../db';
import { getStats, listContainers, performAction, readContainerFile, writeContainerFile } from '../docker';
import { applySettings, parseOptionSettings } from '../games/palworld';
import { monitor } from '../monitor';
import { sendBroadcast, sendRconCommand } from '../rcon';
import type { GameServer, ServerAction } from '../types';
import { asyncRoute } from './helpers';

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
    rcon_configured: !!(s.rcon_host && s.rcon_port),
    state: status?.state ?? 'not_found',
    statusText: status?.statusText ?? '',
    created_at: s.created_at,
  };
  if (!includeSecrets) return base;
  return { ...base, rcon_host: s.rcon_host, rcon_port: s.rcon_port, rcon_password: s.rcon_password };
}

/** Servers visible to the current user, with live status. */
router.get('/', (req, res) => {
  const user = req.user!;
  const servers = listServers().filter((s) => userCan(user, s.id, 'view'));
  res.json({
    servers: servers.map((s) => ({
      ...publicServer(s, user.role === 'admin'),
      can_control: userCan(user, s.id, 'control'),
      can_rcon: userCan(user, s.id, 'rcon'),
    })),
    dockerError: monitor.getLastError(),
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
      rcon_password: rcon_password || '',
      broadcast_template: broadcast_template ?? 'say {message}',
      config_path: req.body?.config_path || '',
    });
    monitor.refresh().catch(() => {});
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
      ...publicServer(server, user.role === 'admin'),
      can_control: userCan(user, server.id, 'control'),
      can_rcon: userCan(user, server.id, 'rcon'),
    },
  });
});

router.put('/:id', requireAdmin, (req, res) => {
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
    rcon_password: b.rcon_password ?? server.rcon_password,
    broadcast_template: b.broadcast_template ?? server.broadcast_template,
    config_path: b.config_path ?? server.config_path,
  });
  monitor.refresh().catch(() => {});
  res.json({ server: publicServer(getServerById(server.id)!, true) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  deleteServer(parseInt(req.params.id, 10));
  monitor.refresh().catch(() => {});
  res.json({ ok: true });
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

/** Read the game config file from inside the container (admin only). */
router.get('/:id/config', requireAdmin, asyncRoute(async (req, res) => {
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

/** Write updated settings back into the container's config file (admin only). */
router.put('/:id/config', requireAdmin, asyncRoute(async (req, res) => {
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

export default router;

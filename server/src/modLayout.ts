/**
 * Resolves where a server's mod files live inside its container. Shared between the web
 * mods routes (routes/servers.ts) and the Thunderstore install helpers (modInstall.ts) —
 * both need the same "where do mods go for this game" logic without importing each other.
 */
import path from 'path';
import { updateServer } from './db';
import { execInContainer, readContainerFile } from './docker';
import { findPluginsDirScript } from './games/valheim';
import { monitor } from './monitor';
import type { GameServer } from './types';

export interface ModLayout {
  /** Parent dir passed to putContainerFile; `${base}/${folder}` is the operating dir. */
  base: string;
  folders: Array<{ id: string; label: string; hint: string }>;
  defaultFolder: string;
}

// Known PalWorldSettings.ini locations across popular Palworld Docker images
const PALWORLD_CONFIG_CANDIDATES = [
  '/palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
  '/serverdata/serverfiles/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
  '/data/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
  '/home/steam/palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
];

export async function resolveConfigPath(server: GameServer): Promise<{ path: string; raw: string }> {
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
export async function resolveValheimPluginsDir(server: GameServer): Promise<string> {
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

export async function resolveModLayout(server: GameServer): Promise<ModLayout> {
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

/** Rejects a path we can't safely interpolate into a shell command. */
export function shArg(p: string): string {
  if (p.includes("'") || p.includes('\n')) {
    throw Object.assign(new Error('Invalid container path'), { statusCode: 400 });
  }
  return `'${p}'`;
}

export function safeModFileName(name: string): string {
  const clean = String(name).trim();
  if (!clean || clean.includes('/') || clean.includes('\\') || clean.includes('..') || clean.startsWith('.')) {
    throw Object.assign(new Error('Invalid file name'), { statusCode: 400 });
  }
  return clean;
}

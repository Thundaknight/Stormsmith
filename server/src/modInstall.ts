/**
 * Downloads and installs Thunderstore mod packages into a server's container, and tracks
 * enough (namespace/package/installed version) in `server_mod_links` to later check for
 * updates. Shared by the web "paste a link" / "Link" mods-panel flows (routes/servers.ts)
 * and the `/updatemod` Discord command (discord/bot.ts) — kept out of both so neither has
 * to import the other.
 */
import path from 'path';
import { unzipSync } from 'fflate';
import { listModLinks, logServerActivity, upsertModLink } from './db';
import { putContainerFiles } from './docker';
import { resolveModLayout } from './modLayout';
import { planThunderstoreZip } from './games/thunderstore';
import { downloadPackageZip, fetchLatestVersion } from './games/thunderstoreApi';
import type { ThunderstorePackageRef } from './games/thunderstoreApi';
import type { ActivitySource, GameServer } from './types';

export interface InstallResult {
  fileName: string;
  version: string;
  extracted: string[];
  skipped: string[];
}

function requireValheimForInstall(server: GameServer): void {
  if (server.game !== 'valheim') {
    throw Object.assign(new Error('Thunderstore install is only supported for Valheim servers'), { statusCode: 400 });
  }
}

async function installVersion(
  server: GameServer, ref: ThunderstorePackageRef, version: string, downloadUrl: string,
  actor: string, source: ActivitySource
): Promise<InstallResult> {
  const zip = await downloadPackageZip(downloadUrl);
  const entries = Object.entries(unzipSync(zip)).map(([name, content]) => ({ name, content }));

  const layout = await resolveModLayout(server);
  const targetDir = `${layout.base}/${layout.defaultFolder}`;
  const fileName = `${ref.namespace}-${ref.name}`;
  const plan = planThunderstoreZip(entries, {
    pluginsDir: targetDir,
    bepinexDir: path.posix.dirname(targetDir),
    packageName: fileName,
  });
  if (plan.files.length === 0) {
    throw Object.assign(
      new Error(`${ref.namespace}-${ref.name} v${version} contained no installable files.`), { statusCode: 400 }
    );
  }
  await putContainerFiles(server.container_name, plan.files);

  upsertModLink({
    server_id: server.id, file_name: fileName, namespace: ref.namespace,
    package_name: ref.name, installed_version: version,
  });
  logServerActivity({
    server_id: server.id, kind: 'config', source, actor,
    detail: `installed mod ${ref.namespace}-${ref.name} v${version} from Thunderstore`,
  });

  return { fileName, version, extracted: plan.files.map((f) => f.path), skipped: plan.skipped };
}

/** Downloads a Thunderstore package's latest version and installs it, recording the link. */
export async function installThunderstoreMod(
  server: GameServer, ref: ThunderstorePackageRef, actor: string, source: ActivitySource
): Promise<InstallResult> {
  requireValheimForInstall(server);
  const { version, downloadUrl } = await fetchLatestVersion(ref);
  return installVersion(server, ref, version, downloadUrl, actor, source);
}

/**
 * Associates an already-installed mod file/folder with a Thunderstore package, without
 * touching its files — the currently-fetched latest version is recorded as the installed
 * one (there's no way to know the actual installed version of a manually-placed mod), so
 * the next update check compares against whatever ships after this point.
 */
export async function linkExistingMod(
  server: GameServer, fileName: string, ref: ThunderstorePackageRef, actor: string, source: ActivitySource
): Promise<{ version: string }> {
  requireValheimForInstall(server);
  const { version } = await fetchLatestVersion(ref);
  upsertModLink({
    server_id: server.id, file_name: fileName, namespace: ref.namespace,
    package_name: ref.name, installed_version: version,
  });
  logServerActivity({
    server_id: server.id, kind: 'config', source, actor,
    detail: `linked mod ${fileName} to Thunderstore package ${ref.namespace}-${ref.name}`,
  });
  return { version };
}

export interface UpdateLinkedModsResult {
  checked: number;
  updated: Array<{ fileName: string; from: string; to: string }>;
  errors: Array<{ fileName: string; error: string }>;
}

/** Checks every mod linked to a Thunderstore package and reinstalls any that are outdated. */
export async function updateLinkedMods(
  server: GameServer, actor: string, source: ActivitySource
): Promise<UpdateLinkedModsResult> {
  requireValheimForInstall(server);
  const links = listModLinks(server.id);
  const updated: Array<{ fileName: string; from: string; to: string }> = [];
  const errors: Array<{ fileName: string; error: string }> = [];
  for (const link of links) {
    try {
      const ref: ThunderstorePackageRef = { namespace: link.namespace, name: link.package_name };
      const { version, downloadUrl } = await fetchLatestVersion(ref);
      if (version === link.installed_version) continue;
      await installVersion(server, ref, version, downloadUrl, actor, source);
      updated.push({ fileName: link.file_name, from: link.installed_version, to: version });
    } catch (err: any) {
      errors.push({ fileName: link.file_name, error: err?.message || String(err) });
    }
  }
  return { checked: links.length, updated, errors };
}

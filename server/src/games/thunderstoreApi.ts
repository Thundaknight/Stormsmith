/**
 * Client for Thunderstore's public package API — resolving a pasted package page URL to
 * its namespace/name, and looking up the latest version's download URL. Read-only network
 * calls only; the actual zip download/extraction/install stays with the caller
 * (routes/servers.ts, discord/bot.ts), matching thunderstore.ts's pure-planner split.
 */

export interface ThunderstorePackageRef {
  namespace: string;
  name: string;
}

/** Matches both the community-scoped page (`/c/valheim/p/Author/Mod/`) and the legacy
 *  per-community subdomain page (`valheim.thunderstore.io/package/Author/Mod/`), each
 *  optionally followed by `/v/1.2.3/`. */
const URL_PATTERNS = [
  /^https?:\/\/(?:[a-z0-9-]+\.)?thunderstore\.io\/c\/[a-z0-9-]+\/p\/([^/]+)\/([^/]+)\/?/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)?thunderstore\.io\/package\/([^/]+)\/([^/]+)\/?/i,
];

export function parseThunderstoreUrl(url: string): ThunderstorePackageRef | null {
  const trimmed = url.trim();
  for (const re of URL_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return { namespace: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) };
  }
  return null;
}

export interface ThunderstoreVersionInfo {
  version: string;
  downloadUrl: string;
}

export async function fetchLatestVersion(ref: ThunderstorePackageRef): Promise<ThunderstoreVersionInfo> {
  const res = await fetch(
    `https://thunderstore.io/api/experimental/package/${encodeURIComponent(ref.namespace)}/${encodeURIComponent(ref.name)}/`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `Thunderstore package not found: ${ref.namespace}/${ref.name}`
        : `Thunderstore lookup failed (HTTP ${res.status})`
    );
  }
  const data: any = await res.json();
  const latest = data?.latest;
  if (!latest?.version_number || !latest?.download_url) {
    throw new Error(`Thunderstore returned no downloadable version for ${ref.namespace}/${ref.name}`);
  }
  return { version: latest.version_number, downloadUrl: latest.download_url };
}

export async function downloadPackageZip(downloadUrl: string): Promise<Uint8Array> {
  const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Thunderstore download failed (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

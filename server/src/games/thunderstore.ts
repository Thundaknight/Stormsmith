/**
 * Plans where the files in a mod .zip should land inside the container.
 *
 * Thunderstore / r2modman packages come in a few shapes:
 *   - loose `ModName.dll` alongside `manifest.json` / `icon.png` / `README.md`
 *       → the real files go into `BepInEx/plugins/<PackageName>/`
 *   - a `BepInEx/` folder at the archive root (mods that also ship configs / patchers)
 *       → merge its contents into the game's `BepInEx/`
 *   - a `plugins/` folder at the root
 *       → merge into `BepInEx/plugins/`
 * Some archives wrap everything in a single `Name-1.0.0/` directory — that's stripped first.
 *
 * This is a pure function; `docker.ts` writes the resulting paths into the container.
 */

/** Thunderstore metadata that BepInEx doesn't need — dropped when at the archive root. */
const BOILERPLATE = new Set([
  'manifest.json', 'icon.png', 'readme.md', 'changelog.md', 'license', 'license.md', 'license.txt',
]);

export interface PlannedFile {
  /** Absolute path inside the container. */
  path: string;
  content: Uint8Array;
}

export interface PlanOptions {
  /** Absolute container path to `BepInEx/plugins`. */
  pluginsDir: string;
  /** Absolute container path to `BepInEx` (usually the parent of pluginsDir). */
  bepinexDir: string;
  /** Fallback folder name for loose files — from the uploaded zip's base name. */
  packageName: string;
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Rejects path traversal after normalization. */
function isSafe(rel: string): boolean {
  return rel.length > 0 && !rel.split('/').some((seg) => seg === '..' || seg === '.');
}

/** Drops a single wrapping top-level directory shared by every entry, if there is one. */
function stripCommonRoot(paths: string[]): { prefix: string; strip: (p: string) => string } {
  const firstSegs = new Set(paths.map((p) => p.split('/')[0]));
  if (firstSegs.size !== 1) return { prefix: '', strip: (p) => p };
  const root = [...firstSegs][0];
  // Only strip it if it actually looks like a wrapper (every path has a second segment).
  if (!paths.every((p) => p.includes('/'))) return { prefix: '', strip: (p) => p };
  // ...and it isn't itself a meaningful folder like BepInEx / plugins.
  if (/^(bepinex|plugins|config|patchers)$/i.test(root)) return { prefix: '', strip: (p) => p };
  return { prefix: root, strip: (p) => p.slice(root.length + 1) };
}

export function planThunderstoreZip(
  entries: Array<{ name: string; content: Uint8Array }>,
  opts: PlanOptions
): { files: PlannedFile[]; skipped: string[] } {
  const cleaned = entries
    .map((e) => ({ rel: normalizeSlashes(e.name), content: e.content }))
    .filter((e) => e.rel && !e.rel.endsWith('/'));

  const { strip } = stripCommonRoot(cleaned.map((e) => e.rel));
  const stripped = cleaned.map((e) => ({ rel: strip(e.rel), content: e.content })).filter((e) => isSafe(e.rel));

  const hasBepinex = stripped.some((e) => /^bepinex\//i.test(e.rel));
  const hasPluginsRoot = stripped.some((e) => /^plugins\//i.test(e.rel));

  const files: PlannedFile[] = [];
  const skipped: string[] = [];

  for (const e of stripped) {
    const lower = e.rel.toLowerCase();
    // Drop Thunderstore boilerplate only when it's at the (post-strip) root.
    if (!e.rel.includes('/') && BOILERPLATE.has(lower)) {
      skipped.push(e.rel);
      continue;
    }
    let dest: string;
    if (hasBepinex && /^bepinex\//i.test(e.rel)) {
      dest = `${opts.bepinexDir}/${e.rel.slice('bepinex/'.length)}`;
    } else if (hasBepinex) {
      // Loose files sitting next to a BepInEx/ folder — assume they're plugins.
      dest = `${opts.pluginsDir}/${opts.packageName}/${e.rel}`;
    } else if (hasPluginsRoot && /^plugins\//i.test(e.rel)) {
      dest = `${opts.pluginsDir}/${e.rel.slice('plugins/'.length)}`;
    } else if (hasPluginsRoot) {
      dest = `${opts.pluginsDir}/${opts.packageName}/${e.rel}`;
    } else {
      // Flat package: everything into plugins/<PackageName>/.
      dest = `${opts.pluginsDir}/${opts.packageName}/${e.rel}`;
    }
    files.push({ path: dest, content: e.content });
  }

  return { files, skipped };
}

/** Loose extraction for non-BepInEx games: every non-boilerplate file into one directory. */
export function planFlatZip(
  entries: Array<{ name: string; content: Uint8Array }>,
  destDir: string
): { files: PlannedFile[]; skipped: string[] } {
  const files: PlannedFile[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    const rel = normalizeSlashes(e.name);
    if (!rel || rel.endsWith('/') || !isSafe(rel)) continue;
    if (!rel.includes('/') && BOILERPLATE.has(rel.toLowerCase())) {
      skipped.push(rel);
      continue;
    }
    files.push({ path: `${destDir}/${rel}`, content: e.content });
  }
  return { files, skipped };
}

/** A friendly package name from an uploaded zip filename. */
export function packageNameFromZip(fileName: string): string {
  const base = fileName.replace(/\.zip$/i, '');
  // Thunderstore names files "Author-Mod-1.2.3.zip" — keep "Author-Mod".
  const withoutVersion = base.replace(/-\d+\.\d+\.\d+$/, '');
  return (withoutVersion || base).replace(/[^A-Za-z0-9._-]/g, '_');
}

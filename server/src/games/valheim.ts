/**
 * Valheim has no remote console of its own. The only server-side control surface a
 * dedicated server exposes is three plain-text permission files in the save directory —
 * one Platform User ID per line:
 *
 *   adminlist.txt      grants admin      (re-read when a player connects)
 *   bannedlist.txt     bans players      (re-read periodically, ~30s — applies live)
 *   permittedlist.txt  allow-list        (non-empty => everyone not listed is refused)
 *
 * Stormsmith reads and writes these through the container archive API, the same way the
 * Palworld INI editor works. A BepInEx RCON mod (ValheimRcon) is needed for anything more;
 * its presence is detected by the plugin DLL, and the rest is plain Source-ish RCON.
 */

export const VALHEIM_LISTS = ['adminlist', 'bannedlist', 'permittedlist'] as const;
export type ValheimList = (typeof VALHEIM_LISTS)[number];

/** The ValheimRcon plugin DLL — its presence flips on the console/broadcast/player-list UI. */
export const VALHEIM_RCON_DLL = 'ValheimRcon.dll';

export interface ParsedIdList {
  /** The run of leading comment/blank lines shipped in the file — preserved on write. */
  header: string;
  ids: string[];
}

/**
 * A Valheim Platform User ID looks like `Steam_76561198000000000` (newer) or a bare
 * 17-digit SteamID64 (older). Anything with whitespace, path separators or `//` is not an
 * ID — those are comments or junk.
 */
export function isValidValheimId(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v) || v.includes('/') || v.includes('\\')) return false;
  return /^[A-Za-z][A-Za-z0-9]*_[0-9A-Za-z]+$/.test(v) || /^\d{16,20}$/.test(v);
}

export function parseIdList(raw: string): ParsedIdList {
  const lines = raw.split(/\r?\n/);
  const headerLines: string[] = [];
  let inHeader = true;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (inHeader && (trimmed === '' || trimmed.startsWith('//'))) {
      headerLines.push(line);
      continue;
    }
    inHeader = false;
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    // A line may be "<id> // note" — keep just the id.
    const id = trimmed.split('//')[0].trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { header: headerLines.join('\n'), ids };
}

export function serializeIdList(list: ParsedIdList): string {
  const header = list.header.trim();
  const body = list.ids.join('\n');
  const parts = [header, body].filter(Boolean);
  return parts.join('\n\n') + '\n';
}

export function hasRconDll(entries: Array<{ name: string }>): boolean {
  return entries.some((e) => e.name.toLowerCase() === VALHEIM_RCON_DLL.toLowerCase());
}

/** The roots a Valheim save dir turns up under, across the common Docker images. */
const SAVE_DIR_GLOBS = [
  '/serverdata/serverfiles/.config/unity3d/IronGate/Valheim',
  '"$HOME/.config/unity3d/IronGate/Valheim"',
  '/root/.config/unity3d/IronGate/Valheim',
  '/home/*/.config/unity3d/IronGate/Valheim',
  '/config',
  '/config/worlds_local',
  '/serverdata/serverfiles',
  '/opt/valheim/data',
];

const PLUGINS_DIR_GLOBS = [
  '/serverdata/serverfiles/BepInEx/plugins',
  '/opt/valheim/BepInEx/plugins',
  '"$HOME/valheim/BepInEx/plugins"',
  '/config/bepinex/plugins',
  '/home/steam/valheim/BepInEx/plugins',
  '/valheim/BepInEx/plugins',
];

/**
 * POSIX `sh` (passed whole to `sh -c`) that prints the directory holding Valheim's save
 * data — the one containing adminlist.txt, or failing that the *.fwl world files — or
 * exits non-zero. Covers ich777, lloesche, mbround18 and SteamCMD layouts without
 * committing to any one.
 */
export function findSaveDirScript(): string {
  const roots = SAVE_DIR_GLOBS.join(' ');
  return [
    `for d in ${roots}; do`,
    '  [ -f "$d/adminlist.txt" ] && { printf %s "$d"; exit 0; }',
    'done',
    `for d in ${roots}; do`,
    '  set -- "$d"/*.fwl',
    '  [ -f "$1" ] && { printf %s "$d"; exit 0; }',
    'done',
    'exit 1',
  ].join('\n');
}

/**
 * POSIX `sh` that prints the BepInEx `plugins` directory or exits non-zero. BepInEx is
 * unpacked next to the game binary; images vary in where that lives, so fall back to a
 * depth-limited search.
 */
export function findPluginsDirScript(): string {
  return [
    `for d in ${PLUGINS_DIR_GLOBS.join(' ')}; do`,
    '  [ -d "$d" ] && { printf %s "$d"; exit 0; }',
    'done',
    'found=$(find /serverdata /opt /config /home /valheim -maxdepth 6 -type d -path "*/BepInEx/plugins" 2>/dev/null | head -n1)',
    '[ -n "$found" ] && { printf %s "$found"; exit 0; }',
    'exit 1',
  ].join('\n');
}

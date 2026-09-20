/**
 * Parser for BepInEx plugin `.cfg` files (the format `BepInEx.Configuration.ConfigFile`
 * writes): `[Section]` headers, `key = value` lines, and a block of `##`/`#` comment
 * lines immediately above each key carrying its description and, for most types, a
 * `# Setting type: X`, `# Default value: Y` and `# Acceptable value range / values: ...`
 * hint. We only ever patch the value half of a matched `key = value` line on write, so
 * every comment, blank line, and unrecognized setting round-trips untouched.
 */

export interface BepInExSetting {
  /** `${section}::${key}` — stable id used for updates, since keys repeat across sections. */
  id: string;
  section: string;
  key: string;
  value: string;
  description?: string;
  type?: string;
  acceptableValues?: string[];
  range?: { min: number; max: number };
}

export interface BepInExSection {
  name: string;
  settings: BepInExSetting[];
}

export function parseBepInExConfig(raw: string): BepInExSection[] {
  const sections = new Map<string, BepInExSetting[]>();
  let section = '';
  let descriptionLines: string[] = [];
  let type: string | undefined;
  let acceptableValues: string[] | undefined;
  let range: { min: number; max: number } | undefined;

  const resetPending = () => {
    descriptionLines = [];
    type = undefined;
    acceptableValues = undefined;
    range = undefined;
  };

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (!sections.has(section)) sections.set(section, []);
      resetPending();
      continue;
    }
    if (trimmed.startsWith('##')) {
      descriptionLines.push(trimmed.replace(/^##\s?/, ''));
      continue;
    }
    if (trimmed.startsWith('#')) {
      const body = trimmed.replace(/^#\s?/, '');
      const typeMatch = body.match(/^Setting type:\s*(.+)$/i);
      const rangeMatch = body.match(/^Acceptable value range:\s*From\s+([\d.\-]+)\s+to\s+([\d.\-]+)/i);
      const acceptMatch = body.match(/^Acceptable values:\s*(.+)$/i);
      if (typeMatch) type = typeMatch[1].trim();
      else if (rangeMatch) range = { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
      else if (acceptMatch) acceptableValues = acceptMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (!trimmed || !section) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    const list = sections.get(section) || [];
    list.push({
      id: `${section}::${key}`, section, key, value,
      description: descriptionLines.join(' ') || undefined,
      type, acceptableValues, range,
    });
    sections.set(section, list);
    resetPending();
  }

  return [...sections.entries()]
    .filter(([, settings]) => settings.length > 0)
    .map(([name, settings]) => ({ name, settings }));
}

/** Applies `updates` (keyed by the `${section}::${key}` id) in place, leaving everything else untouched. */
export function applyBepInExConfig(raw: string, updates: Record<string, string>): string {
  let section = '';
  return raw.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      return line;
    }
    if (!trimmed || trimmed.startsWith('#') || !section) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    const id = `${section}::${key}`;
    if (updates[id] === undefined) return line;
    const leading = line.slice(0, line.length - line.trimStart().length);
    return `${leading}${key} = ${updates[id]}`;
  }).join('\n');
}

/** Words too generic (package boilerplate, GUID prefixes) to count toward a name match. */
const STOPWORDS = new Set([
  'org', 'com', 'net', 'io', 'the', 'a', 'an', 'and', 'of', 'plugin', 'plugins',
  'mod', 'mods', 'bepinex', 'config', 'cfg', 'temporary', 'temp', 'release', 'pack',
]);

function tokenize(name: string): string[] {
  const base = name.replace(/\.(dll|cfg|zip)$/i, '');
  return base
    .split(/[^A-Za-z0-9]+/)
    .flatMap((s) => s.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 2 && !STOPWORDS.has(s));
}

/**
 * Best-effort match between a mod's file/folder name and one of a plugin's config
 * files. BepInEx names `.cfg` files after the plugin GUID, not the Thunderstore
 * package name, so there's no exact key — instead we compare significant word
 * tokens and require the config file's tokens to be (almost) fully covered by the
 * mod's name. Returns the matching filename, or null if nothing clears the bar.
 */
export function matchConfigFile(modName: string, cfgFileNames: string[]): string | null {
  const modTokens = new Set(tokenize(modName));
  if (modTokens.size === 0) return null;
  let best: { name: string; score: number } | null = null;
  for (const cfgName of cfgFileNames) {
    const cfgTokens = tokenize(cfgName);
    if (cfgTokens.length === 0) continue;
    const overlap = cfgTokens.filter((t) => modTokens.has(t)).length;
    const score = overlap / cfgTokens.length;
    if (score >= 0.6 && (!best || score > best.score)) best = { name: cfgName, score };
  }
  return best?.name ?? null;
}

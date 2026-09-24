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

function configMatchScore(modTokens: Set<string>, cfgTokens: Set<string>): { score: number; overlap: number } {
  const overlap = [...cfgTokens].filter((t) => modTokens.has(t)).length;
  if (overlap === 0) return { score: 0, overlap: 0 };
  const smaller = Math.min(modTokens.size, cfgTokens.size);
  const score = smaller <= 1 ? (modTokens.size === 1 && cfgTokens.size === 1 ? 1 : 0) : overlap / smaller;
  return { score, overlap };
}

/**
 * Best-effort match between every mod's file/folder name and a plugin's config
 * files. BepInEx names `.cfg` files after the plugin GUID (often `Author.PluginName.cfg`),
 * not the Thunderstore package name and not necessarily containing the author at all
 * on the mod's side, so there's no exact key — instead we compare significant word
 * tokens across every mod/config pair at once (not mod-by-mod), in two passes:
 *
 *  1. Confident matches: score by containment against whichever side has *fewer*
 *     tokens (a mod uploaded as a loose `.dll`, e.g. `NoSmokeStayLit.dll`, carries
 *     fewer tokens than its GUID-based config, e.g. `TastyChickenLegs.NoSmokeStayLit.cfg`
 *     — scoring only against the config's token count would unfairly penalize that
 *     direction). Assigned best-score-first, each mod and config claimed at most once.
 *  2. Elimination: for whatever's left unclaimed, a mod and a config that share even
 *     one real word are paired *only* if each is the other's sole remaining candidate
 *     — safe precisely because there's no ambiguity left to get wrong. This catches
 *     cases like `ValheimRcon.dll` vs `org.tristan.rcon.cfg`, where the author name
 *     never appears in the mod's own filename and "rcon" is the only shared token.
 */
export function matchConfigFiles(modNames: string[], cfgFileNames: string[]): Record<string, string | null> {
  const modTokenSets = new Map(modNames.map((m) => [m, new Set(tokenize(m))]));
  const cfgTokenSets = new Map(cfgFileNames.map((c) => [c, new Set(tokenize(c))]));

  const pairs: Array<{ modName: string; cfgName: string; score: number; overlap: number }> = [];
  for (const modName of modNames) {
    const modTokens = modTokenSets.get(modName)!;
    if (modTokens.size === 0) continue;
    for (const cfgName of cfgFileNames) {
      const cfgTokens = cfgTokenSets.get(cfgName)!;
      if (cfgTokens.size === 0) continue;
      const { score, overlap } = configMatchScore(modTokens, cfgTokens);
      if (overlap > 0) pairs.push({ modName, cfgName, score, overlap });
    }
  }

  const result: Record<string, string | null> = Object.fromEntries(modNames.map((m) => [m, null]));
  const claimedMod = new Set<string>();
  const claimedCfg = new Set<string>();

  const confident = pairs.filter((p) => p.score >= 0.6).sort((a, b) => b.score - a.score || b.overlap - a.overlap);
  for (const p of confident) {
    if (claimedMod.has(p.modName) || claimedCfg.has(p.cfgName)) continue;
    result[p.modName] = p.cfgName;
    claimedMod.add(p.modName);
    claimedCfg.add(p.cfgName);
  }

  const leftover = pairs.filter((p) => !claimedMod.has(p.modName) && !claimedCfg.has(p.cfgName));
  const modCandidates = new Map<string, number>();
  const cfgCandidates = new Map<string, number>();
  for (const p of leftover) {
    modCandidates.set(p.modName, (modCandidates.get(p.modName) || 0) + 1);
    cfgCandidates.set(p.cfgName, (cfgCandidates.get(p.cfgName) || 0) + 1);
  }
  for (const p of leftover) {
    if (modCandidates.get(p.modName) === 1 && cfgCandidates.get(p.cfgName) === 1) {
      result[p.modName] = p.cfgName;
      claimedMod.add(p.modName);
      claimedCfg.add(p.cfgName);
    }
  }

  return result;
}

/**
 * Parser/serializer for PalWorldSettings.ini, which stores every setting in a
 * single line: OptionSettings=(Key=Value,Key="Quoted, value",List=("A","B"),...)
 * Values may contain commas inside quotes and nested parentheses, so splitting
 * must track quote state and paren depth.
 */

export interface IniEntry {
  key: string;
  value: string;
  quoted: boolean;
}

const SECTION_HEADER = '[/Script/Pal.PalGameWorldSettings]';

/** Settings that must be written quoted even when newly added. */
const QUOTED_KEYS = new Set([
  'ServerName', 'ServerDescription', 'AdminPassword', 'ServerPassword',
  'PublicIP', 'Region', 'BanListURL', 'RandomizerSeed',
]);

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inQuotes = false;
  for (const ch of body) {
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Returns the parsed entries, or null if the file has no OptionSettings line (e.g. never generated). */
export function parseOptionSettings(raw: string): IniEntry[] | null {
  const match = raw.match(/^\s*OptionSettings\s*=\s*\((.*)\)\s*$/m);
  if (!match) return null;
  return splitTopLevel(match[1]).map((part) => {
    const eq = part.indexOf('=');
    const key = part.slice(0, eq).trim();
    let value = eq === -1 ? '' : part.slice(eq + 1).trim();
    const quoted = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
    if (quoted) value = value.slice(1, -1);
    return { key, value, quoted };
  }).filter((e) => e.key);
}

function serializeEntries(entries: IniEntry[]): string {
  const body = entries
    .map((e) => `${e.key}=${e.quoted ? `"${e.value}"` : e.value}`)
    .join(',');
  return `OptionSettings=(${body})`;
}

/**
 * Applies `updates` to the file content, preserving existing key order,
 * quoting style, and any keys not mentioned. New keys are appended.
 * If the file has no OptionSettings line, a fresh one is generated.
 */
export function applySettings(raw: string, updates: Record<string, string>): string {
  const existing = parseOptionSettings(raw) || [];
  const entries: IniEntry[] = existing.map((e) =>
    updates[e.key] !== undefined ? { ...e, value: updates[e.key] } : e
  );
  const known = new Set(existing.map((e) => e.key));
  for (const [key, value] of Object.entries(updates)) {
    if (!known.has(key)) entries.push({ key, value, quoted: QUOTED_KEYS.has(key) });
  }
  const line = serializeEntries(entries);

  if (parseOptionSettings(raw) !== null) {
    return raw.replace(/^\s*OptionSettings\s*=\s*\(.*\)\s*$/m, line);
  }
  // File was empty or had only the section header: build a valid file
  const base = raw.includes(SECTION_HEADER) ? raw.trimEnd() : SECTION_HEADER;
  return `${base}\n${line}\n`;
}

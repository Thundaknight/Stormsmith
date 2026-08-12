import mysql from 'mysql2/promise';
import type { GameServer } from '../types';

/**
 * AzerothCore has no built-in way to report player counts excluding bots —
 * mod-playerbots' random bots are ordinary online characters. The only
 * reliable way to exclude them is to query the character/auth databases
 * directly and filter out accounts using the bot account prefix
 * (AiPlayerbot.RandomBotAccountPrefix, default "rndbot").
 */

const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

// Race/class ids match Blizzard's ChrRaces.dbc / ChrClasses.dbc, which AzerothCore's
// characters.race/class columns store directly — stable across client versions.
const RACE_NAMES: Record<number, string> = {
  1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead', 6: 'Tauren',
  7: 'Gnome', 8: 'Troll', 9: 'Goblin', 10: 'Blood Elf', 11: 'Draenei', 22: 'Worgen',
};

const CLASS_NAMES: Record<number, string> = {
  1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest', 6: 'Death Knight',
  7: 'Shaman', 8: 'Mage', 9: 'Warlock', 10: 'Monk', 11: 'Druid', 12: 'Demon Hunter',
};

export function hasDbConfig(server: GameServer): boolean {
  return !!(server.db_host && server.db_port && server.db_user && server.db_characters_db && server.db_auth_db);
}

async function connect(server: GameServer) {
  return mysql.createConnection({
    host: server.db_host,
    port: server.db_port,
    user: server.db_user,
    password: server.db_password,
    connectTimeout: 5000,
  });
}

/** "Fruitpunch 32 Undead Rogue" per online character, e.g. for the Discord embed and web player chips. */
export async function fetchAzerothPlayers(server: GameServer): Promise<string[]> {
  if (!hasDbConfig(server)) {
    throw new Error('Database connection is not configured for this server');
  }
  const charactersDb = server.db_characters_db;
  const authDb = server.db_auth_db;
  if (!IDENTIFIER_RE.test(charactersDb) || !IDENTIFIER_RE.test(authDb)) {
    throw new Error('Database names must contain only letters, numbers, and underscores');
  }

  const conn = await connect(server);
  try {
    const prefix = server.bot_account_prefix || 'rndbot';
    const [rows] = await conn.query(
      `SELECT c.name AS name, c.level AS level, c.race AS race, c.class AS class
       FROM \`${charactersDb}\`.characters c
       JOIN \`${authDb}\`.account a ON c.account = a.id
       WHERE c.online = 1 AND a.username NOT LIKE ?
       ORDER BY c.name`,
      [`${prefix}%`]
    );
    return (rows as Array<{ name: string; level: number; race: number; class: number }>).map((r) => {
      const race = RACE_NAMES[r.race] || 'Unknown';
      const cls = CLASS_NAMES[r.class] || 'Unknown';
      return `${r.name} ${r.level} ${race} ${cls}`;
    });
  } finally {
    await conn.end().catch(() => {});
  }
}

export interface AzerothAccount {
  username: string;
  online: boolean;
  lastLogin: string | null;
}

/** Login accounts from the auth database, excluding mod-playerbots' bot accounts. Used for the User Management tab. */
export async function fetchAzerothAccounts(server: GameServer): Promise<AzerothAccount[]> {
  if (!hasDbConfig(server)) {
    throw new Error('Database connection is not configured for this server');
  }
  const authDb = server.db_auth_db;
  if (!IDENTIFIER_RE.test(authDb)) {
    throw new Error('Database names must contain only letters, numbers, and underscores');
  }

  const conn = await connect(server);
  try {
    const prefix = server.bot_account_prefix || 'rndbot';
    const [rows] = await conn.query(
      `SELECT username, online, last_login FROM \`${authDb}\`.account WHERE username NOT LIKE ? ORDER BY username`,
      [`${prefix}%`]
    );
    return (rows as Array<{ username: string; online: number; last_login: Date | null }>).map((r) => ({
      username: r.username,
      online: !!r.online,
      lastLogin: r.last_login ? new Date(r.last_login).toISOString() : null,
    }));
  } finally {
    await conn.end().catch(() => {});
  }
}

export interface AzerothCharacter {
  name: string;
  level: number;
  race: string;
  class: string;
  online: boolean;
}

/** The characters on one login account — e.g. for a "Characters" expander in the User Management tab. */
export async function fetchAzerothCharacters(server: GameServer, username: string): Promise<AzerothCharacter[]> {
  if (!hasDbConfig(server)) {
    throw new Error('Database connection is not configured for this server');
  }
  const charactersDb = server.db_characters_db;
  const authDb = server.db_auth_db;
  if (!IDENTIFIER_RE.test(charactersDb) || !IDENTIFIER_RE.test(authDb)) {
    throw new Error('Database names must contain only letters, numbers, and underscores');
  }

  const conn = await connect(server);
  try {
    const [rows] = await conn.query(
      `SELECT c.name AS name, c.level AS level, c.race AS race, c.class AS class, c.online AS online
       FROM \`${charactersDb}\`.characters c
       JOIN \`${authDb}\`.account a ON c.account = a.id
       WHERE a.username = ?
       ORDER BY c.level DESC, c.name`,
      [username]
    );
    return (rows as Array<{ name: string; level: number; race: number; class: number; online: number }>).map((r) => ({
      name: r.name,
      level: r.level,
      race: RACE_NAMES[r.race] || 'Unknown',
      class: CLASS_NAMES[r.class] || 'Unknown',
      online: !!r.online,
    }));
  } finally {
    await conn.end().catch(() => {});
  }
}

/**
 * Whether a character name belongs to a mod-playerbots random bot account
 * (not a real player) — gates the Discord bot-management commands, since
 * AzerothCore's own `.playerbots rndbot` commands silently no-op on names
 * outside its bot-account list rather than returning a usable error.
 */
export async function isAzerothBotCharacter(server: GameServer, characterName: string): Promise<boolean> {
  if (!hasDbConfig(server)) {
    throw new Error('Database connection is not configured for this server');
  }
  const charactersDb = server.db_characters_db;
  const authDb = server.db_auth_db;
  if (!IDENTIFIER_RE.test(charactersDb) || !IDENTIFIER_RE.test(authDb)) {
    throw new Error('Database names must contain only letters, numbers, and underscores');
  }

  const conn = await connect(server);
  try {
    const prefix = server.bot_account_prefix || 'rndbot';
    const [rows] = await conn.query(
      `SELECT 1 FROM \`${charactersDb}\`.characters c
       JOIN \`${authDb}\`.account a ON c.account = a.id
       WHERE c.name = ? AND a.username LIKE ?
       LIMIT 1`,
      [characterName, `${prefix}%`]
    );
    return (rows as unknown[]).length > 0;
  } finally {
    await conn.end().catch(() => {});
  }
}

/**
 * A bot character's current level, or null if the name isn't a bot on this
 * server (or doesn't exist) — used by /wowlevel, which has to step a bot up
 * one level at a time (AzerothCore has no "set to level N" console command)
 * and needs to know how many steps that is.
 */
export async function getAzerothBotCharacterLevel(server: GameServer, characterName: string): Promise<number | null> {
  if (!hasDbConfig(server)) {
    throw new Error('Database connection is not configured for this server');
  }
  const charactersDb = server.db_characters_db;
  const authDb = server.db_auth_db;
  if (!IDENTIFIER_RE.test(charactersDb) || !IDENTIFIER_RE.test(authDb)) {
    throw new Error('Database names must contain only letters, numbers, and underscores');
  }

  const conn = await connect(server);
  try {
    const prefix = server.bot_account_prefix || 'rndbot';
    const [rows] = await conn.query(
      `SELECT c.level AS level FROM \`${charactersDb}\`.characters c
       JOIN \`${authDb}\`.account a ON c.account = a.id
       WHERE c.name = ? AND a.username LIKE ?
       LIMIT 1`,
      [characterName, `${prefix}%`]
    );
    const row = (rows as Array<{ level: number }>)[0];
    return row ? row.level : null;
  } finally {
    await conn.end().catch(() => {});
  }
}

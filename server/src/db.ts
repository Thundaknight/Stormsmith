import Database from 'better-sqlite3';
import { config } from './config';
import type {
  CustomField, DiscordConfig, DiscordRolePerm, GameServer, ServerPermission, User, WowPasswordReset,
} from './types';

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      discord_id TEXT NOT NULL DEFAULT '',
      discord_username TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      game TEXT NOT NULL DEFAULT 'custom',
      container_name TEXT NOT NULL UNIQUE,
      rcon_host TEXT NOT NULL DEFAULT '',
      rcon_port INTEGER NOT NULL DEFAULT 0,
      rcon_username TEXT NOT NULL DEFAULT '',
      rcon_password TEXT NOT NULL DEFAULT '',
      broadcast_template TEXT NOT NULL DEFAULT 'say {message}',
      config_path TEXT NOT NULL DEFAULT '',
      game_port INTEGER NOT NULL DEFAULT 0,
      restart_enabled INTEGER NOT NULL DEFAULT 0,
      restart_time TEXT NOT NULL DEFAULT '04:00',
      restart_mode TEXT NOT NULL DEFAULT 'daily',
      restart_interval_hours INTEGER NOT NULL DEFAULT 6,
      discord_show INTEGER NOT NULL DEFAULT 1,
      discord_channel_id TEXT NOT NULL DEFAULT '',
      db_host TEXT NOT NULL DEFAULT '',
      db_port INTEGER NOT NULL DEFAULT 3306,
      db_user TEXT NOT NULL DEFAULT '',
      db_password TEXT NOT NULL DEFAULT '',
      db_characters_db TEXT NOT NULL DEFAULT 'acore_characters',
      db_auth_db TEXT NOT NULL DEFAULT 'acore_auth',
      bot_account_prefix TEXT NOT NULL DEFAULT 'rndbot',
      address_mode TEXT NOT NULL DEFAULT 'auto',
      custom_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS server_custom_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'message',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS discord_role_perms (
      role_id TEXT PRIMARY KEY,
      role_name TEXT NOT NULL DEFAULT '',
      can_use_commands INTEGER NOT NULL DEFAULT 1,
      can_start INTEGER NOT NULL DEFAULT 0,
      can_stop INTEGER NOT NULL DEFAULT 0,
      can_restart INTEGER NOT NULL DEFAULT 0,
      can_rcon INTEGER NOT NULL DEFAULT 0,
      can_broadcast INTEGER NOT NULL DEFAULT 0,
      can_create_wow_accounts INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS discord_status_messages (
      server_id INTEGER PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS server_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      can_view INTEGER NOT NULL DEFAULT 1,
      can_control INTEGER NOT NULL DEFAULT 0,
      can_rcon INTEGER NOT NULL DEFAULT 0,
      can_configure INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, server_id)
    );

    CREATE TABLE IF NOT EXISTS discord_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      bot_token TEXT NOT NULL DEFAULT '',
      guild_id TEXT NOT NULL DEFAULT '',
      status_channel_id TEXT NOT NULL DEFAULT '',
      status_message_id TEXT NOT NULL DEFAULT '',
      control_role_ids TEXT NOT NULL DEFAULT '[]',
      rcon_role_ids TEXT NOT NULL DEFAULT '[]',
      command_channel_ids TEXT NOT NULL DEFAULT '[]',
      allow_start INTEGER NOT NULL DEFAULT 1,
      allow_stop INTEGER NOT NULL DEFAULT 1,
      allow_restart INTEGER NOT NULL DEFAULT 1,
      allow_rcon INTEGER NOT NULL DEFAULT 0,
      allow_broadcast INTEGER NOT NULL DEFAULT 1,
      rcon_command_allowlist TEXT NOT NULL DEFAULT '[]',
      oauth_enabled INTEGER NOT NULL DEFAULT 0,
      oauth_client_id TEXT NOT NULL DEFAULT '',
      oauth_client_secret TEXT NOT NULL DEFAULT '',
      oauth_redirect_uri TEXT NOT NULL DEFAULT '',
      oauth_restrict_to_guild INTEGER NOT NULL DEFAULT 1
    );

    INSERT OR IGNORE INTO discord_config (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS wow_password_resets (
      token TEXT PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations for databases created before these columns existed
  const addColumnTo = (table: string, name: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };

  const serverCols = db.prepare('PRAGMA table_info(servers)').all() as Array<{ name: string }>;
  const addColumn = (name: string, ddl: string) => {
    if (!serverCols.some((c) => c.name === name)) db.exec(`ALTER TABLE servers ADD COLUMN ${ddl}`);
  };
  addColumn('config_path', "config_path TEXT NOT NULL DEFAULT ''");
  addColumn('game_port', 'game_port INTEGER NOT NULL DEFAULT 0');
  addColumn('restart_enabled', 'restart_enabled INTEGER NOT NULL DEFAULT 0');
  addColumn('restart_time', "restart_time TEXT NOT NULL DEFAULT '04:00'");
  addColumn('restart_mode', "restart_mode TEXT NOT NULL DEFAULT 'daily'");
  addColumn('restart_interval_hours', 'restart_interval_hours INTEGER NOT NULL DEFAULT 6');

  addColumn('discord_show', 'discord_show INTEGER NOT NULL DEFAULT 1');
  addColumn('discord_channel_id', "discord_channel_id TEXT NOT NULL DEFAULT ''");
  addColumn('rcon_username', "rcon_username TEXT NOT NULL DEFAULT ''");
  addColumn('db_host', "db_host TEXT NOT NULL DEFAULT ''");
  addColumn('db_port', 'db_port INTEGER NOT NULL DEFAULT 3306');
  addColumn('db_user', "db_user TEXT NOT NULL DEFAULT ''");
  addColumn('db_password', "db_password TEXT NOT NULL DEFAULT ''");
  addColumn('db_characters_db', "db_characters_db TEXT NOT NULL DEFAULT 'acore_characters'");
  addColumn('db_auth_db', "db_auth_db TEXT NOT NULL DEFAULT 'acore_auth'");
  addColumn('bot_account_prefix', "bot_account_prefix TEXT NOT NULL DEFAULT 'rndbot'");
  addColumn('address_mode', "address_mode TEXT NOT NULL DEFAULT 'auto'");
  addColumn('custom_address', "custom_address TEXT NOT NULL DEFAULT ''");

  addColumnTo('users', 'status', "status TEXT NOT NULL DEFAULT 'active'");
  addColumnTo('users', 'discord_id', "discord_id TEXT NOT NULL DEFAULT ''");
  addColumnTo('users', 'discord_username', "discord_username TEXT NOT NULL DEFAULT ''");
  addColumnTo('discord_config', 'oauth_enabled', 'oauth_enabled INTEGER NOT NULL DEFAULT 0');
  addColumnTo('discord_config', 'oauth_client_id', "oauth_client_id TEXT NOT NULL DEFAULT ''");
  addColumnTo('discord_config', 'oauth_client_secret', "oauth_client_secret TEXT NOT NULL DEFAULT ''");
  addColumnTo('discord_config', 'oauth_redirect_uri', "oauth_redirect_uri TEXT NOT NULL DEFAULT ''");
  addColumnTo('discord_config', 'oauth_restrict_to_guild', 'oauth_restrict_to_guild INTEGER NOT NULL DEFAULT 1');
  addColumnTo('server_permissions', 'can_configure', 'can_configure INTEGER NOT NULL DEFAULT 0');
  addColumnTo('discord_role_perms', 'can_create_wow_accounts', 'can_create_wow_accounts INTEGER NOT NULL DEFAULT 0');

  // Broadcasts now use the NBSP trick instead of underscores (spaces render properly in-game)
  db.prepare(
    "UPDATE servers SET broadcast_template = 'Broadcast {message_nbsp}' WHERE broadcast_template = 'Broadcast {message_underscored}'"
  ).run();

  // One-time migration of the old control/rcon role lists into per-role permissions
  const dcCols = db.prepare('PRAGMA table_info(discord_config)').all() as Array<{ name: string }>;
  if (!dcCols.some((c) => c.name === 'roles_migrated')) {
    db.exec('ALTER TABLE discord_config ADD COLUMN roles_migrated INTEGER NOT NULL DEFAULT 0');
  }
  const cfg = db.prepare('SELECT * FROM discord_config WHERE id = 1').get() as any;
  if (cfg && !cfg.roles_migrated) {
    const parse = (json: string): string[] => {
      try {
        const v = JSON.parse(json);
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return [];
      }
    };
    const control = new Set(parse(cfg.control_role_ids || '[]'));
    const rcon = new Set(parse(cfg.rcon_role_ids || '[]'));
    const ins = db.prepare(
      `INSERT OR REPLACE INTO discord_role_perms
       (role_id, role_name, can_use_commands, can_start, can_stop, can_restart, can_rcon, can_broadcast)
       VALUES (?, '', 1, ?, ?, ?, ?, ?)`
    );
    for (const id of new Set([...control, ...rcon])) {
      const c = control.has(id) ? 1 : 0;
      const r = rcon.has(id) ? 1 : 0;
      ins.run(id, c, c, c, r, r);
    }
    db.prepare('UPDATE discord_config SET roles_migrated = 1 WHERE id = 1').run();
  }

  // discord_status_messages moved from one row per channel to one row per server
  // (each server now gets its own message so buttons sit directly under it). The
  // old rows are just a message-ID cache, safe to discard and let the bot re-post.
  const statusMsgCols = db.prepare('PRAGMA table_info(discord_status_messages)').all() as Array<{ name: string }>;
  if (statusMsgCols.length > 0 && !statusMsgCols.some((c) => c.name === 'server_id')) {
    db.exec('DROP TABLE discord_status_messages');
    db.exec(`
      CREATE TABLE discord_status_messages (
        server_id INTEGER PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL
      )
    `);
  }
}

// ---- Users ----

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
}

export function getUserById(id: number): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function getUserByDiscordId(discordId: string): User | undefined {
  if (!discordId) return undefined;
  return db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId) as User | undefined;
}

export function listUsers(): User[] {
  return db.prepare('SELECT * FROM users ORDER BY username').all() as User[];
}

export function createUser(username: string, passwordHash: string, role: string): User {
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, passwordHash, role);
  return getUserById(Number(info.lastInsertRowid))!;
}

/** Signs up a new pending user from a verified Discord identity. Disambiguates username collisions. */
export function createOAuthUser(discordId: string, discordUsername: string): User {
  const base = discordUsername.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 28) || 'discord-user';
  let username = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const info = db
        .prepare(
          `INSERT INTO users (username, password_hash, role, status, discord_id, discord_username)
           VALUES (?, '', 'user', 'pending', ?, ?)`
        )
        .run(username, discordId, discordUsername);
      return getUserById(Number(info.lastInsertRowid))!;
    } catch (err: any) {
      if (!String(err?.message).includes('UNIQUE')) throw err;
      username = `${base}-${discordId.slice(-4)}${attempt > 0 ? attempt : ''}`;
    }
  }
  throw new Error('Could not allocate a unique username for this Discord account');
}

export function approveUser(id: number): void {
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
}

export function linkDiscordAccount(userId: number, discordId: string, discordUsername: string): void {
  db.prepare('UPDATE users SET discord_id = ?, discord_username = ? WHERE id = ?').run(
    discordId, discordUsername, userId
  );
}

export function unlinkDiscordAccount(userId: number): void {
  db.prepare("UPDATE users SET discord_id = '', discord_username = '' WHERE id = ?").run(userId);
}

export function updateUser(id: number, fields: { password_hash?: string; role?: string }): void {
  if (fields.password_hash !== undefined) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(fields.password_hash, id);
  }
  if (fields.role !== undefined) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(fields.role, id);
  }
}

export function deleteUser(id: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ---- Servers ----

export function listServers(): GameServer[] {
  return db.prepare('SELECT * FROM servers ORDER BY name').all() as GameServer[];
}

export function getServerById(id: number): GameServer | undefined {
  return db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as GameServer | undefined;
}

const SERVER_FIELDS = [
  'name', 'game', 'container_name', 'rcon_host', 'rcon_port', 'rcon_username', 'rcon_password',
  'broadcast_template', 'config_path', 'game_port', 'restart_enabled', 'restart_time', 'restart_mode',
  'restart_interval_hours', 'discord_show', 'discord_channel_id', 'db_host', 'db_port', 'db_user',
  'db_password', 'db_characters_db', 'db_auth_db', 'bot_account_prefix', 'address_mode', 'custom_address',
] as const;

export function createServer(s: Omit<GameServer, 'id' | 'created_at'>): GameServer {
  const columns = SERVER_FIELDS.join(', ');
  const placeholders = SERVER_FIELDS.map((f) => `@${f}`).join(', ');
  const info = db.prepare(`INSERT INTO servers (${columns}) VALUES (${placeholders})`).run(s);
  return getServerById(Number(info.lastInsertRowid))!;
}

export function updateServer(id: number, s: Omit<GameServer, 'id' | 'created_at'>): void {
  const sets = SERVER_FIELDS.map((f) => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE servers SET ${sets} WHERE id = @id`).run({ ...s, id });
}

export function deleteServer(id: number): void {
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
}

// ---- Custom embed fields ----

export function listCustomFields(serverId: number): CustomField[] {
  return db.prepare('SELECT * FROM server_custom_fields WHERE server_id = ? ORDER BY id').all(serverId) as CustomField[];
}

export function setCustomFields(
  serverId: number,
  fields: Array<{ type: string; title: string; content: string }>
): void {
  const del = db.prepare('DELETE FROM server_custom_fields WHERE server_id = ?');
  const ins = db.prepare(
    'INSERT INTO server_custom_fields (server_id, type, title, content) VALUES (?, ?, ?, ?)'
  );
  db.transaction(() => {
    del.run(serverId);
    for (const f of fields) {
      const content = (f.content || '').trim();
      if (!content) continue;
      ins.run(serverId, f.type === 'link' ? 'link' : 'message', (f.title || '').trim(), content);
    }
  })();
}

// ---- Permissions ----

export function getPermission(userId: number, serverId: number): ServerPermission | undefined {
  return db
    .prepare('SELECT * FROM server_permissions WHERE user_id = ? AND server_id = ?')
    .get(userId, serverId) as ServerPermission | undefined;
}

export function listPermissionsForUser(userId: number): ServerPermission[] {
  return db.prepare('SELECT * FROM server_permissions WHERE user_id = ?').all(userId) as ServerPermission[];
}

export function setPermissionsForUser(
  userId: number,
  perms: Array<{
    server_id: number; can_view: boolean; can_control: boolean; can_rcon: boolean; can_configure: boolean;
  }>
): void {
  const del = db.prepare('DELETE FROM server_permissions WHERE user_id = ?');
  const ins = db.prepare(
    `INSERT INTO server_permissions (user_id, server_id, can_view, can_control, can_rcon, can_configure)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    del.run(userId);
    for (const p of perms) {
      if (!p.can_view && !p.can_control && !p.can_rcon && !p.can_configure) continue;
      ins.run(
        userId, p.server_id, p.can_view ? 1 : 0, p.can_control ? 1 : 0, p.can_rcon ? 1 : 0, p.can_configure ? 1 : 0
      );
    }
  })();
}

// ---- Discord role permissions ----

export function listDiscordRolePerms(): DiscordRolePerm[] {
  return db.prepare('SELECT * FROM discord_role_perms ORDER BY role_name, role_id').all() as DiscordRolePerm[];
}

export function setDiscordRolePerms(rows: Array<Omit<DiscordRolePerm, never>>): void {
  const del = db.prepare('DELETE FROM discord_role_perms');
  const ins = db.prepare(
    `INSERT INTO discord_role_perms
     (role_id, role_name, can_use_commands, can_start, can_stop, can_restart, can_rcon, can_broadcast,
      can_create_wow_accounts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    del.run();
    for (const r of rows) {
      ins.run(
        r.role_id, r.role_name, r.can_use_commands ? 1 : 0, r.can_start ? 1 : 0, r.can_stop ? 1 : 0,
        r.can_restart ? 1 : 0, r.can_rcon ? 1 : 0, r.can_broadcast ? 1 : 0, r.can_create_wow_accounts ? 1 : 0
      );
    }
  })();
}

// ---- Discord status messages (one message per server, so buttons sit under their own embed) ----

export function listStatusMessages(): Array<{ server_id: number; channel_id: string; message_id: string }> {
  return db.prepare('SELECT * FROM discord_status_messages').all() as Array<{
    server_id: number; channel_id: string; message_id: string;
  }>;
}

export function getStatusMessage(serverId: number): { channel_id: string; message_id: string } | undefined {
  return db.prepare('SELECT channel_id, message_id FROM discord_status_messages WHERE server_id = ?').get(serverId) as
    | { channel_id: string; message_id: string }
    | undefined;
}

export function setStatusMessage(serverId: number, channelId: string, messageId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO discord_status_messages (server_id, channel_id, message_id) VALUES (?, ?, ?)'
  ).run(serverId, channelId, messageId);
}

export function deleteStatusMessage(serverId: number): void {
  db.prepare('DELETE FROM discord_status_messages WHERE server_id = ?').run(serverId);
}

// ---- Discord config ----

export function getDiscordConfig(): DiscordConfig {
  return db.prepare('SELECT * FROM discord_config WHERE id = 1').get() as DiscordConfig;
}

export function updateDiscordConfig(fields: Partial<DiscordConfig>): void {
  const allowed: Array<keyof DiscordConfig> = [
    'enabled', 'bot_token', 'guild_id', 'status_channel_id', 'status_message_id',
    'control_role_ids', 'rcon_role_ids', 'command_channel_ids',
    'allow_start', 'allow_stop', 'allow_restart', 'allow_rcon', 'allow_broadcast',
    'rcon_command_allowlist',
    'oauth_enabled', 'oauth_client_id', 'oauth_client_secret', 'oauth_redirect_uri', 'oauth_restrict_to_guild',
  ];
  const keys = allowed.filter((k) => fields[k] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE discord_config SET ${sets} WHERE id = 1`).run(...keys.map((k) => fields[k]));
}

// ---- WoW (AzerothCore) password reset links ----

export function sweepExpiredWowPasswordResets(): void {
  db.prepare('DELETE FROM wow_password_resets WHERE expires_at < ?').run(Date.now());
}

export function createWowPasswordReset(r: {
  token: string; server_id: number; username: string; created_by: number; expires_at: number;
}): void {
  sweepExpiredWowPasswordResets();
  db.prepare(
    `INSERT INTO wow_password_resets (token, server_id, username, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(r.token, r.server_id, r.username, r.created_by, r.expires_at);
}

export function getWowPasswordReset(token: string): WowPasswordReset | undefined {
  return db
    .prepare('SELECT * FROM wow_password_resets WHERE token = ? AND expires_at > ?')
    .get(token, Date.now()) as WowPasswordReset | undefined;
}

export function deleteWowPasswordReset(token: string): void {
  db.prepare('DELETE FROM wow_password_resets WHERE token = ?').run(token);
}

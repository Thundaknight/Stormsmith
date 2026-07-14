import Database from 'better-sqlite3';
import { config } from './config';
import type { DiscordConfig, GameServer, ServerPermission, User } from './types';

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      game TEXT NOT NULL DEFAULT 'custom',
      container_name TEXT NOT NULL UNIQUE,
      rcon_host TEXT NOT NULL DEFAULT '',
      rcon_port INTEGER NOT NULL DEFAULT 0,
      rcon_password TEXT NOT NULL DEFAULT '',
      broadcast_template TEXT NOT NULL DEFAULT 'say {message}',
      config_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS server_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      can_view INTEGER NOT NULL DEFAULT 1,
      can_control INTEGER NOT NULL DEFAULT 0,
      can_rcon INTEGER NOT NULL DEFAULT 0,
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
      rcon_command_allowlist TEXT NOT NULL DEFAULT '[]'
    );

    INSERT OR IGNORE INTO discord_config (id) VALUES (1);
  `);

  // Migration for databases created before config_path existed
  const serverCols = db.prepare('PRAGMA table_info(servers)').all() as Array<{ name: string }>;
  if (!serverCols.some((c) => c.name === 'config_path')) {
    db.exec("ALTER TABLE servers ADD COLUMN config_path TEXT NOT NULL DEFAULT ''");
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

export function listUsers(): User[] {
  return db.prepare('SELECT * FROM users ORDER BY username').all() as User[];
}

export function createUser(username: string, passwordHash: string, role: string): User {
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, passwordHash, role);
  return getUserById(Number(info.lastInsertRowid))!;
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

export function createServer(s: Omit<GameServer, 'id' | 'created_at'>): GameServer {
  const info = db
    .prepare(
      `INSERT INTO servers (name, game, container_name, rcon_host, rcon_port, rcon_password, broadcast_template, config_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(s.name, s.game, s.container_name, s.rcon_host, s.rcon_port, s.rcon_password, s.broadcast_template, s.config_path);
  return getServerById(Number(info.lastInsertRowid))!;
}

export function updateServer(id: number, s: Omit<GameServer, 'id' | 'created_at'>): void {
  db.prepare(
    `UPDATE servers SET name = ?, game = ?, container_name = ?, rcon_host = ?, rcon_port = ?,
     rcon_password = ?, broadcast_template = ?, config_path = ? WHERE id = ?`
  ).run(s.name, s.game, s.container_name, s.rcon_host, s.rcon_port, s.rcon_password, s.broadcast_template, s.config_path, id);
}

export function deleteServer(id: number): void {
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
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
  perms: Array<{ server_id: number; can_view: boolean; can_control: boolean; can_rcon: boolean }>
): void {
  const del = db.prepare('DELETE FROM server_permissions WHERE user_id = ?');
  const ins = db.prepare(
    `INSERT INTO server_permissions (user_id, server_id, can_view, can_control, can_rcon)
     VALUES (?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    del.run(userId);
    for (const p of perms) {
      if (!p.can_view && !p.can_control && !p.can_rcon) continue;
      ins.run(userId, p.server_id, p.can_view ? 1 : 0, p.can_control ? 1 : 0, p.can_rcon ? 1 : 0);
    }
  })();
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
  ];
  const keys = allowed.filter((k) => fields[k] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE discord_config SET ${sets} WHERE id = 1`).run(...keys.map((k) => fields[k]));
}

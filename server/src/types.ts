export type Role = 'admin' | 'user';

export type UserStatus = 'active' | 'pending';

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  discord_id: string;
  discord_username: string;
  created_at: string;
}

export interface SafeUser {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

export interface GameServer {
  id: number;
  name: string;
  game: string;
  container_name: string;
  rcon_host: string;
  rcon_port: number;
  rcon_username: string; // used by SOAP-based games (AzerothCore); empty for Source RCON games
  rcon_password: string;
  broadcast_template: string;
  config_path: string;
  game_port: number;
  restart_enabled: number;
  restart_time: string;
  restart_mode: string; // 'daily' | 'interval'
  restart_interval_hours: number;
  discord_show: number;
  discord_channel_id: string; // empty = the default status channel
  db_host: string; // optional MySQL connection for player queries (AzerothCore)
  db_port: number;
  db_user: string;
  db_password: string;
  db_characters_db: string;
  db_auth_db: string;
  bot_account_prefix: string;
  address_mode: string; // 'auto' | 'custom' | 'hidden'
  custom_address: string;
  created_at: string;
}

export interface CustomField {
  id: number;
  server_id: number;
  type: string; // 'message' | 'link'
  title: string;
  content: string;
}

export interface DiscordRolePerm {
  role_id: string;
  role_name: string;
  can_use_commands: number;
  can_start: number;
  can_stop: number;
  can_restart: number;
  can_rcon: number;
  can_broadcast: number;
  can_create_wow_accounts: number;
}

export interface ServerPermission {
  user_id: number;
  server_id: number;
  can_view: number;
  can_control: number;
  can_rcon: number;
  can_configure: number;
}

export type ContainerState =
  | 'running'
  | 'paused'
  | 'exited'
  | 'restarting'
  | 'created'
  | 'dead'
  | 'removing'
  | 'not_found';

export interface ServerStatus {
  serverId: number;
  name: string;
  game: string;
  containerName: string;
  state: ContainerState;
  statusText: string;
  cpuPercent: number | null;
  memUsageBytes: number | null;
  memLimitBytes: number | null;
  playerCount: number | null;
  players: string[] | null;
  gamePort: number;
  startedAt: string | null;
}

export type ServerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause';

export interface DiscordConfig {
  enabled: number;
  bot_token: string;
  guild_id: string;
  status_channel_id: string;
  status_message_id: string;
  control_role_ids: string; // JSON string[]
  rcon_role_ids: string; // JSON string[]
  command_channel_ids: string; // JSON string[]; empty = all channels
  allow_start: number;
  allow_stop: number;
  allow_restart: number;
  allow_rcon: number;
  allow_broadcast: number;
  rcon_command_allowlist: string; // JSON string[]; empty = all commands
  oauth_enabled: number;
  oauth_client_id: string;
  oauth_client_secret: string;
  oauth_redirect_uri: string;
  oauth_restrict_to_guild: number;
}

export type WowAccountLinkPurpose = 'create' | 'reset';

export interface WowAccountLink {
  token: string;
  server_id: number;
  purpose: WowAccountLinkPurpose;
  username: string;
  gm_level: number;
  created_by: number;
  expires_at: number;
  created_at: string;
}

export interface InviteLink {
  token: string;
  role: Role;
  permissions: string;
  created_by: number;
  expires_at: number;
  created_at: string;
}

export interface AuthTokenPayload {
  userId: number;
  username: string;
  role: Role;
}

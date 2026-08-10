export type Role = 'admin' | 'user';
export type UserStatus = 'active' | 'pending';

export interface User {
  id: number;
  username: string;
  role: Role;
  // Present on the admin Users list; the minimal auth-response shape omits these.
  status?: UserStatus;
  discord_username?: string;
  has_password?: boolean;
  created_at?: string;
}

export interface Account {
  username: string;
  role: Role;
  discord_username: string;
  has_password: boolean;
}

export type ContainerState =
  | 'running' | 'paused' | 'exited' | 'restarting'
  | 'created' | 'dead' | 'removing' | 'not_found';

export interface GameServer {
  id: number;
  name: string;
  game: string;
  container_name: string;
  broadcast_template: string;
  config_path: string;
  game_port: number;
  restart_enabled: boolean;
  restart_time: string;
  restart_mode: 'daily' | 'interval';
  restart_interval_hours: number;
  discord_show: boolean;
  discord_channel_id: string;
  rcon_configured: boolean;
  db_configured: boolean;
  address: string | null;
  address_mode: 'auto' | 'custom' | 'hidden';
  custom_address: string;
  custom_fields: CustomField[];
  state: ContainerState;
  statusText: string;
  cpuPercent?: number | null;
  memUsageBytes?: number | null;
  memLimitBytes?: number | null;
  playerCount?: number | null;
  players?: string[] | null;
  startedAt?: string | null;
  nextRestartAt?: string | null;
  can_control: boolean;
  can_rcon: boolean;
  can_configure: boolean;
  rcon_host?: string;
  rcon_port?: number;
  rcon_username?: string;
  rcon_password?: string;
  db_host?: string;
  db_port?: number;
  db_user?: string;
  db_password?: string;
  db_characters_db?: string;
  db_auth_db?: string;
  bot_account_prefix?: string;
  created_at?: string;
}

export interface ServerStatusUpdate {
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

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  statusText: string;
  imported: boolean;
}

export interface DiscordRolePerm {
  role_id: string;
  role_name: string;
  can_use_commands: boolean | number;
  can_start: boolean | number;
  can_stop: boolean | number;
  can_restart: boolean | number;
  can_rcon: boolean | number;
  can_broadcast: boolean | number;
  can_create_wow_accounts: boolean | number;
}

export interface CustomField {
  id?: number;
  type: 'message' | 'link';
  title: string;
  content: string;
}

export interface ModEntry {
  name: string;
  size: number;
  isDir: boolean;
}

export interface Permission {
  server_id: number;
  can_view: boolean;
  can_control: boolean;
  can_rcon: boolean;
  can_configure: boolean;
}

export interface DiscordConfigView {
  enabled: number;
  bot_token: string;
  bot_token_set: boolean;
  bot_running: boolean;
  bot_error: string;
  guild_id: string;
  status_channel_id: string;
  control_role_ids: string;
  rcon_role_ids: string;
  command_channel_ids: string;
  allow_start: number;
  allow_stop: number;
  allow_restart: number;
  allow_rcon: number;
  allow_broadcast: number;
  rcon_command_allowlist: string;
  oauth_enabled: number;
  oauth_client_id: string;
  oauth_client_secret: string;
  oauth_client_secret_set: boolean;
  oauth_redirect_uri: string;
  oauth_restrict_to_guild: number;
}

export type ServerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause';

export interface GamePreset {
  label: string;
  rconPort: number;
  gamePort: number;
  broadcast: string;
  /** Whether this game has any remote console at all (RCON, SOAP, etc.) — controls whether RCON/console UI shows. */
  supportsConsole: boolean;
}

export const GAME_PRESETS: Record<string, GamePreset> = {
  palworld: { label: 'Palworld', rconPort: 25575, gamePort: 8211, broadcast: 'Broadcast {message_nbsp}', supportsConsole: true },
  minecraft: { label: 'Minecraft', rconPort: 25575, gamePort: 25565, broadcast: 'say {message}', supportsConsole: true },
  satisfactory: { label: 'Satisfactory', rconPort: 0, gamePort: 7777, broadcast: '', supportsConsole: false },
  valheim: { label: 'Valheim', rconPort: 0, gamePort: 2456, broadcast: '', supportsConsole: false },
  rust: { label: 'Rust', rconPort: 28016, gamePort: 28015, broadcast: 'say {message}', supportsConsole: true },
  ark: { label: 'ARK: Survival', rconPort: 27020, gamePort: 7777, broadcast: 'ServerChat {message}', supportsConsole: true },
  '7dtd': { label: '7 Days to Die', rconPort: 8081, gamePort: 26900, broadcast: 'say "{message}"', supportsConsole: true },
  azerothcore: { label: 'AzerothCore (WoW)', rconPort: 7878, gamePort: 8085, broadcast: '.announce {message}', supportsConsole: true },
  custom: { label: 'Other / Custom', rconPort: 0, gamePort: 0, broadcast: 'say {message}', supportsConsole: true },
};

export function gameSupportsConsole(game: string): boolean {
  return GAME_PRESETS[game]?.supportsConsole ?? true;
}

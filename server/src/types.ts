export type Role = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
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
  rcon_password: string;
  broadcast_template: string;
  config_path: string;
  created_at: string;
}

export interface ServerPermission {
  user_id: number;
  server_id: number;
  can_view: number;
  can_control: number;
  can_rcon: number;
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
}

export interface AuthTokenPayload {
  userId: number;
  username: string;
  role: Role;
}

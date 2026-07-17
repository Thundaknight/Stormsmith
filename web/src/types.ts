export type Role = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at?: string;
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
  state: ContainerState;
  statusText: string;
  cpuPercent?: number | null;
  memUsageBytes?: number | null;
  memLimitBytes?: number | null;
  playerCount?: number | null;
  players?: string[] | null;
  startedAt?: string | null;
  can_control: boolean;
  can_rcon: boolean;
  rcon_host?: string;
  rcon_port?: number;
  rcon_password?: string;
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
}

export type ServerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause';

export const GAME_PRESETS: Record<string, { label: string; rconPort: number; gamePort: number; broadcast: string }> = {
  palworld: { label: 'Palworld', rconPort: 25575, gamePort: 8211, broadcast: 'Broadcast {message_nbsp}' },
  minecraft: { label: 'Minecraft', rconPort: 25575, gamePort: 25565, broadcast: 'say {message}' },
  satisfactory: { label: 'Satisfactory', rconPort: 0, gamePort: 7777, broadcast: '' },
  valheim: { label: 'Valheim', rconPort: 0, gamePort: 2456, broadcast: '' },
  rust: { label: 'Rust', rconPort: 28016, gamePort: 28015, broadcast: 'say {message}' },
  ark: { label: 'ARK: Survival', rconPort: 27020, gamePort: 7777, broadcast: 'ServerChat {message}' },
  '7dtd': { label: '7 Days to Die', rconPort: 8081, gamePort: 26900, broadcast: 'say "{message}"' },
  custom: { label: 'Other / Custom', rconPort: 0, gamePort: 0, broadcast: 'say {message}' },
};

import type {
  ContainerSummary, DiscordConfigView, DiscordRolePerm, GameServer, ModEntry, Permission, ServerAction, User,
} from './types';

const TOKEN_KEY = 'sm_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new ApiError(res.status, (data as any).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  // auth
  authStatus: () => request<{ needsSetup: boolean }>('GET', '/api/auth/status'),
  setup: (username: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/setup', { username, password }),
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/login', { username, password }),
  me: () => request<{ user: { userId: number; username: string; role: string } }>('GET', '/api/auth/me'),

  // servers
  listServers: () =>
    request<{ servers: GameServer[]; dockerError: string; publicIp: string }>('GET', '/api/servers'),
  getServer: (id: number) => request<{ server: GameServer }>('GET', `/api/servers/${id}`),
  availableContainers: () =>
    request<{ containers: ContainerSummary[] }>('GET', '/api/servers/available-containers'),
  importServer: (data: Record<string, unknown>) => request<{ server: GameServer }>('POST', '/api/servers', data),
  updateServer: (id: number, data: Record<string, unknown>) =>
    request<{ server: GameServer }>('PUT', `/api/servers/${id}`, data),
  deleteServer: (id: number) => request<{ ok: boolean }>('DELETE', `/api/servers/${id}`),
  serverAction: (id: number, action: ServerAction) =>
    request<{ ok: boolean; state: string }>('POST', `/api/servers/${id}/action`, { action }),
  delayRestart: (id: number) =>
    request<{ ok: boolean; nextRestartAt: string }>('POST', `/api/servers/${id}/delay-restart`),
  serverStats: (id: number) =>
    request<{ stats: { cpuPercent: number; memUsageBytes: number; memLimitBytes: number } }>(
      'GET', `/api/servers/${id}/stats`),
  sendRcon: (id: number, command: string) =>
    request<{ response: string }>('POST', `/api/servers/${id}/rcon`, { command }),
  sendBroadcast: (id: number, message: string) =>
    request<{ response: string }>('POST', `/api/servers/${id}/broadcast`, { message }),
  getServerConfig: (id: number) =>
    request<{ path: string; settings: Record<string, string>; empty: boolean }>(
      'GET', `/api/servers/${id}/config`),
  saveServerConfig: (id: number, settings: Record<string, string>) =>
    request<{ ok: boolean; path: string; restartRequired: boolean }>(
      'PUT', `/api/servers/${id}/config`, { settings }),

  // mods
  listMods: (id: number, folder: string) =>
    request<{ path: string; folder: string; running: boolean; mods: ModEntry[] }>(
      'GET', `/api/servers/${id}/mods?folder=${encodeURIComponent(folder)}`),
  uploadMod: async (id: number, folder: string, file: File): Promise<{ ok: boolean; name: string }> => {
    const res = await fetch(
      `/api/servers/${id}/mods?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: file,
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (data as any).error || `Upload failed (${res.status})`);
    return data as { ok: boolean; name: string };
  },
  deleteMod: (id: number, folder: string, name: string) =>
    request<{ ok: boolean }>(
      'DELETE', `/api/servers/${id}/mods/${encodeURIComponent(name)}?folder=${encodeURIComponent(folder)}`),

  // users
  listUsers: () => request<{ users: User[] }>('GET', '/api/users'),
  createUser: (username: string, password: string, role: string) =>
    request<{ user: User }>('POST', '/api/users', { username, password, role }),
  updateUser: (id: number, data: { password?: string; role?: string }) =>
    request<{ user: User }>('PUT', `/api/users/${id}`, data),
  deleteUser: (id: number) => request<{ ok: boolean }>('DELETE', `/api/users/${id}`),
  getUserPermissions: (id: number) =>
    request<{ permissions: Array<{ server_id: number; can_view: number; can_control: number; can_rcon: number }> }>(
      'GET', `/api/users/${id}/permissions`),
  setUserPermissions: (id: number, permissions: Permission[]) =>
    request<{ permissions: unknown }>('PUT', `/api/users/${id}/permissions`, { permissions }),

  // discord
  getDiscordConfig: () => request<{ config: DiscordConfigView }>('GET', '/api/discord/config'),
  updateDiscordConfig: (data: Record<string, unknown>) =>
    request<{ config: DiscordConfigView }>('PUT', '/api/discord/config', data),
  restartDiscordBot: () => request<{ config: DiscordConfigView }>('POST', '/api/discord/restart'),
  discordMeta: () =>
    request<{ roles: Array<{ id: string; name: string }>; channels: Array<{ id: string; name: string }> }>(
      'GET', '/api/discord/meta'),
  getDiscordRoles: () => request<{ roles: DiscordRolePerm[] }>('GET', '/api/discord/roles'),
  setDiscordRoles: (roles: DiscordRolePerm[]) =>
    request<{ roles: DiscordRolePerm[] }>('PUT', '/api/discord/roles', { roles }),
};

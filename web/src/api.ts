import type {
  Account, ContainerSummary, CustomField, DiscordConfigView, DiscordLogEntry, DiscordRolePerm, GameServer,
  InviteLink, ModEntry, Permission, ServerAction, UnifiConfigView, UnifiRule, User, WowAccount, WowAccountLink,
  WowCharacter,
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
  authStatus: () =>
    request<{ needsSetup: boolean; discordOAuthEnabled: boolean; version: string }>('GET', '/api/auth/status'),
  setup: (username: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/setup', { username, password }),
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/login', { username, password }),
  me: () => request<{ user: { userId: number; username: string; role: string } }>('GET', '/api/auth/me'),
  getAccount: () => request<{ account: Account }>('GET', '/api/auth/account'),
  unlinkDiscord: () => request<{ ok: boolean }>('POST', '/api/auth/discord/unlink'),

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
  setCustomFields: (id: number, fields: CustomField[]) =>
    request<{ fields: CustomField[] }>('PUT', `/api/servers/${id}/fields`, { fields }),
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

  // AzerothCore player accounts
  listWowAccounts: (id: number) => request<{ accounts: WowAccount[] }>('GET', `/api/servers/${id}/wow-accounts`),
  listWowCharacters: (id: number, username: string) =>
    request<{ characters: WowCharacter[] }>('GET', `/api/servers/${id}/wow-accounts/${encodeURIComponent(username)}/characters`),
  listWowAccountLinks: (id: number) => request<{ links: WowAccountLink[] }>('GET', `/api/servers/${id}/wow-accounts/links`),
  revokeWowAccountLink: (id: number, token: string) =>
    request<{ ok: boolean }>('DELETE', `/api/servers/${id}/wow-accounts/links/${token}`),
  createWowResetLink: (id: number, username: string) =>
    request<{ token: string; expiresAt: string }>('POST', `/api/servers/${id}/wow-accounts/reset-link`, { username }),
  createWowAccountCreateLink: (id: number, gmLevel: number) =>
    request<{ token: string; expiresAt: string }>('POST', `/api/servers/${id}/wow-accounts/create-link`, { gmLevel }),
  getWowAccountLinkInfo: (token: string) =>
    request<{ purpose: string; username: string; serverName: string }>('GET', `/api/wow-account/${token}`),
  redeemWowAccountLink: (token: string, data: { username?: string; password: string }) =>
    request<{ ok: boolean }>('POST', `/api/wow-account/${token}`, data),

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
  approveUser: (id: number, data?: { role?: string; permissions?: Permission[] }) =>
    request<{ user: User }>('POST', `/api/users/${id}/approve`, data),
  updateUser: (id: number, data: { password?: string; role?: string }) =>
    request<{ user: User }>('PUT', `/api/users/${id}`, data),
  deleteUser: (id: number) => request<{ ok: boolean }>('DELETE', `/api/users/${id}`),
  getUserPermissions: (id: number) =>
    request<{
      permissions: Array<{ server_id: number; can_view: number; can_control: number; can_rcon: number; can_configure: number }>;
    }>('GET', `/api/users/${id}/permissions`),
  setUserPermissions: (id: number, permissions: Permission[]) =>
    request<{ permissions: unknown }>('PUT', `/api/users/${id}/permissions`, { permissions }),

  // invite links (sign up without Discord)
  createInvite: (role: string, permissions?: Permission[]) =>
    request<{ token: string; role: string; expiresAt: string }>('POST', '/api/users/invites', { role, permissions }),
  listInvites: () => request<{ invites: InviteLink[] }>('GET', '/api/users/invites'),
  revokeInvite: (token: string) => request<{ ok: boolean }>('DELETE', `/api/users/invites/${token}`),
  getInviteInfo: (token: string) => request<{ role: string }>('GET', `/api/invite/${token}`),
  redeemInvite: (token: string, username: string, password: string) =>
    request<{ token: string; user: User }>('POST', `/api/invite/${token}`, { username, password }),

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
  listDiscordLogs: () => request<{ entries: DiscordLogEntry[] }>('GET', '/api/discord/logs'),

  // unifi (port-forward automation)
  getUnifiConfig: () => request<{ config: UnifiConfigView }>('GET', '/api/unifi/config'),
  updateUnifiConfig: (data: Record<string, unknown>) =>
    request<{ config: UnifiConfigView }>('PUT', '/api/unifi/config', data),
  testUnifi: () =>
    request<{ ok: boolean; error?: string; rules: UnifiRule[]; config: UnifiConfigView }>('POST', '/api/unifi/test'),
  unifiRules: () => request<{ rules: UnifiRule[]; enabled: boolean }>('GET', '/api/unifi/rules'),
};

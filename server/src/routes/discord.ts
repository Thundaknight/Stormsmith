import { Router } from 'express';
import { requireAdmin, requireAuth } from '../auth';
import {
  getDiscordConfig, getServerById, listDiscordCommandLog, listDiscordRolePerms, setDiscordRolePerms,
  updateDiscordConfig,
} from '../db';
import { discordBot } from '../discord/bot';
import { asyncRoute } from './helpers';

const router = Router();
router.use(requireAuth, requireAdmin);

function maskedConfig() {
  const cfg = getDiscordConfig();
  return {
    ...cfg,
    bot_token: cfg.bot_token ? '••••••••' : '',
    bot_token_set: !!cfg.bot_token,
    oauth_client_secret: cfg.oauth_client_secret ? '••••••••' : '',
    oauth_client_secret_set: !!cfg.oauth_client_secret,
    bot_running: discordBot.isRunning(),
    bot_error: discordBot.lastError,
  };
}

router.get('/config', (_req, res) => {
  res.json({ config: maskedConfig() });
});

router.put('/config', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const jsonArray = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.map(String) : []);
  const previousChannelId = getDiscordConfig().status_channel_id;
  updateDiscordConfig({
    enabled: b.enabled !== undefined ? (b.enabled ? 1 : 0) : undefined,
    // Only overwrite the token if the client actually sent a new one (not the mask)
    bot_token: typeof b.bot_token === 'string' && !b.bot_token.includes('•') ? b.bot_token : undefined,
    guild_id: typeof b.guild_id === 'string' ? b.guild_id.trim() : undefined,
    status_channel_id: typeof b.status_channel_id === 'string' ? b.status_channel_id.trim() : undefined,
    control_role_ids: b.control_role_ids !== undefined ? jsonArray(b.control_role_ids) : undefined,
    rcon_role_ids: b.rcon_role_ids !== undefined ? jsonArray(b.rcon_role_ids) : undefined,
    command_channel_ids: b.command_channel_ids !== undefined ? jsonArray(b.command_channel_ids) : undefined,
    wow_bot_channel_ids: b.wow_bot_channel_ids !== undefined ? jsonArray(b.wow_bot_channel_ids) : undefined,
    allow_start: b.allow_start !== undefined ? (b.allow_start ? 1 : 0) : undefined,
    allow_stop: b.allow_stop !== undefined ? (b.allow_stop ? 1 : 0) : undefined,
    allow_restart: b.allow_restart !== undefined ? (b.allow_restart ? 1 : 0) : undefined,
    allow_rcon: b.allow_rcon !== undefined ? (b.allow_rcon ? 1 : 0) : undefined,
    allow_broadcast: b.allow_broadcast !== undefined ? (b.allow_broadcast ? 1 : 0) : undefined,
    rcon_command_allowlist: b.rcon_command_allowlist !== undefined ? jsonArray(b.rcon_command_allowlist) : undefined,
    oauth_enabled: b.oauth_enabled !== undefined ? (b.oauth_enabled ? 1 : 0) : undefined,
    oauth_client_id: typeof b.oauth_client_id === 'string' ? b.oauth_client_id.trim() : undefined,
    oauth_client_secret:
      typeof b.oauth_client_secret === 'string' && !b.oauth_client_secret.includes('•')
        ? b.oauth_client_secret
        : undefined,
    oauth_redirect_uri: typeof b.oauth_redirect_uri === 'string' ? b.oauth_redirect_uri.trim() : undefined,
    oauth_restrict_to_guild: b.oauth_restrict_to_guild !== undefined ? (b.oauth_restrict_to_guild ? 1 : 0) : undefined,
  });
  // If the status channel changed, the old status message id no longer applies
  if (typeof b.status_channel_id === 'string' && b.status_channel_id.trim() !== previousChannelId) {
    updateDiscordConfig({ status_message_id: '' });
  }
  await discordBot.restart();
  res.json({ config: maskedConfig() });
}));

/** Restart the bot without changing config (e.g. after a Discord hiccup). */
router.post('/restart', asyncRoute(async (_req, res) => {
  await discordBot.restart();
  res.json({ config: maskedConfig() });
}));

/** Roles + text channels of the configured guild, for the settings UI pickers. */
router.get('/meta', asyncRoute(async (_req, res) => {
  res.json(await discordBot.getGuildMeta());
}));

/** Per-Discord-role feature permissions. */
router.get('/roles', (_req, res) => {
  res.json({ roles: listDiscordRolePerms() });
});

router.put('/roles', (req, res) => {
  const roles = req.body?.roles;
  if (!Array.isArray(roles)) {
    res.status(400).json({ error: 'roles must be an array' });
    return;
  }
  setDiscordRolePerms(
    roles
      .filter((r: any) => r && typeof r.role_id === 'string' && r.role_id.trim())
      .map((r: any) => ({
        role_id: String(r.role_id).trim(),
        role_name: String(r.role_name || ''),
        can_use_commands: r.can_use_commands ? 1 : 0,
        can_start: r.can_start ? 1 : 0,
        can_stop: r.can_stop ? 1 : 0,
        can_restart: r.can_restart ? 1 : 0,
        can_rcon: r.can_rcon ? 1 : 0,
        can_broadcast: r.can_broadcast ? 1 : 0,
        can_create_wow_accounts: r.can_create_wow_accounts ? 1 : 0,
        can_manage_wow_bots: r.can_manage_wow_bots ? 1 : 0,
      }))
  );
  res.json({ roles: listDiscordRolePerms() });
});

/** Audit trail for sensitive bot commands (currently /wowlevel). */
router.get('/logs', (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '200'), 10) || 200, 1), 2000);
  const entries = listDiscordCommandLog(limit);
  res.json({
    entries: entries.map((e) => ({
      id: e.id,
      command: e.command,
      serverId: e.server_id,
      serverName: e.server_id ? getServerById(e.server_id)?.name ?? null : null,
      discordUserId: e.discord_user_id,
      discordUsername: e.discord_username,
      characterName: e.character_name,
      result: e.result,
      detail: e.detail,
      // SQLite's datetime('now') is UTC but has no 'T'/'Z', which Date.parse treats
      // inconsistently across environments — make it unambiguous ISO-8601 here.
      createdAt: new Date(`${e.created_at.replace(' ', 'T')}Z`).toISOString(),
    })),
  });
});

export default router;

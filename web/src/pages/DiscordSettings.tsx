import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import type { DiscordConfigView, DiscordRolePerm } from '../types';

const ROLE_PERM_COLUMNS: Array<{ key: keyof DiscordRolePerm; label: string }> = [
  { key: 'can_use_commands', label: 'Slash commands' },
  { key: 'can_start', label: 'Start' },
  { key: 'can_stop', label: 'Stop' },
  { key: 'can_restart', label: 'Restart / pause' },
  { key: 'can_rcon', label: 'RCON' },
  { key: 'can_broadcast', label: 'Broadcast' },
];

interface IdName {
  id: string;
  name: string;
}

function parseIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function MultiPicker({ label, hint, options, selected, onChange }: {
  label: string;
  hint?: string;
  options: IdName[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="picker">
      <div className="picker-label">{label}</div>
      {hint && <div className="hint">{hint}</div>}
      {options.length === 0 ? (
        <div className="muted">Connect the bot to load options, or paste IDs below.</div>
      ) : (
        <div className="chip-list">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`chip ${selected.includes(o.id) ? 'chip-on' : ''}`}
              onClick={() => toggle(o.id)}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
      <input
        className="mono"
        value={selected.join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        placeholder="Comma-separated IDs"
      />
    </div>
  );
}

export default function DiscordSettings() {
  const [cfg, setCfg] = useState<DiscordConfigView | null>(null);
  const [roles, setRoles] = useState<IdName[]>([]);
  const [channels, setChannels] = useState<IdName[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // form state
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [guildId, setGuildId] = useState('');
  const [statusChannelId, setStatusChannelId] = useState('');
  const [rolePerms, setRolePerms] = useState<DiscordRolePerm[]>([]);
  const [addRoleId, setAddRoleId] = useState('');
  const [commandChannels, setCommandChannels] = useState<string[]>([]);
  const [allow, setAllow] = useState({ start: true, stop: true, restart: true, rcon: false, broadcast: true });
  const [rconAllowlist, setRconAllowlist] = useState('');

  const applyConfig = useCallback((c: DiscordConfigView) => {
    setCfg(c);
    setEnabled(!!c.enabled);
    setBotToken(c.bot_token);
    setGuildId(c.guild_id);
    setStatusChannelId(c.status_channel_id);
    setCommandChannels(parseIds(c.command_channel_ids));
    setAllow({
      start: !!c.allow_start,
      stop: !!c.allow_stop,
      restart: !!c.allow_restart,
      rcon: !!c.allow_rcon,
      broadcast: !!c.allow_broadcast,
    });
    setRconAllowlist(parseIds(c.rcon_command_allowlist).join('\n'));
  }, []);

  const loadMeta = useCallback(() => {
    api.discordMeta().then((r) => {
      setRoles(r.roles);
      setChannels(r.channels);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.getDiscordConfig().then((r) => {
      applyConfig(r.config);
      if (r.config.bot_running) loadMeta();
    }).catch((err) => setError(err.message));
    api.getDiscordRoles().then((r) => setRolePerms(r.roles)).catch(() => {});
  }, [applyConfig, loadMeta]);

  const addRole = () => {
    if (!addRoleId || rolePerms.some((r) => r.role_id === addRoleId)) return;
    const meta = roles.find((r) => r.id === addRoleId);
    setRolePerms([
      ...rolePerms,
      {
        role_id: addRoleId,
        role_name: meta?.name || '',
        can_use_commands: true,
        can_start: false,
        can_stop: false,
        can_restart: false,
        can_rcon: false,
        can_broadcast: false,
      },
    ]);
    setAddRoleId('');
  };

  const toggleRolePerm = (roleId: string, key: keyof DiscordRolePerm) => {
    setRolePerms(rolePerms.map((r) => (r.role_id === roleId ? { ...r, [key]: !r[key] } : r)));
  };

  const removeRole = (roleId: string) => {
    setRolePerms(rolePerms.filter((r) => r.role_id !== roleId));
  };

  const roleDisplayName = (r: DiscordRolePerm) =>
    roles.find((m) => m.id === r.role_id)?.name || r.role_name || r.role_id;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.setDiscordRoles(rolePerms);
      const r = await api.updateDiscordConfig({
        enabled,
        bot_token: botToken,
        guild_id: guildId,
        status_channel_id: statusChannelId,
        command_channel_ids: commandChannels,
        allow_start: allow.start,
        allow_stop: allow.stop,
        allow_restart: allow.restart,
        allow_rcon: allow.rcon,
        allow_broadcast: allow.broadcast,
        rcon_command_allowlist: rconAllowlist.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      applyConfig(r.config);
      setNotice(r.config.bot_running ? '✅ Saved — bot is connected.' : 'Saved.');
      if (r.config.bot_running) loadMeta();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <div className="muted">Loading…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>Discord Bot</h1>
        <span className={`status-badge ${cfg.bot_running ? 'status-running' : 'status-exited'}`}>
          <span className="status-dot" />
          {cfg.bot_running ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      {cfg.bot_error && <div className="alert alert-error">Bot error: {cfg.bot_error}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <form onSubmit={save}>
        <div className="card">
          <h2>Connection</h2>
          <label className="checkbox-label">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable Discord bot
          </label>
          <div className="form-grid">
            <label>
              Bot token
              <input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)}
                placeholder={cfg.bot_token_set ? 'Saved — enter a new token to replace' : 'From the Discord Developer Portal'} />
            </label>
            <label>
              Guild (server) ID
              <input value={guildId} onChange={(e) => setGuildId(e.target.value)} placeholder="Right-click your Discord server → Copy ID" />
            </label>
          </div>
          <p className="hint">
            Create an application at discord.com/developers, add a bot, and invite it to your server with the
            <span className="mono"> applications.commands</span> scope and permission to send messages.
          </p>
        </div>

        <div className="card">
          <h2>Status message</h2>
          <div className="picker">
            <div className="picker-label">Status channel</div>
            <div className="hint">
              Default channel for the auto-updating status embed (with control buttons). Each game server can
              pick a different channel — or opt out of Discord entirely — in its own Settings tab, so you can run
              multiple status channels.
            </div>
            {channels.length > 0 ? (
              <select value={statusChannelId} onChange={(e) => setStatusChannelId(e.target.value)}>
                <option value="">— none —</option>
                {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
            ) : (
              <input value={statusChannelId} onChange={(e) => setStatusChannelId(e.target.value)} placeholder="Channel ID" className="mono" />
            )}
          </div>
        </div>

        <div className="card">
          <h2>Role permissions</h2>
          <p className="hint">
            Each Discord role gets its own set of allowed features. Discord server administrators can always do
            everything. Members with none of these roles cannot use the bot.
          </p>
          <div className="mods-toolbar">
            {roles.length > 0 ? (
              <select value={addRoleId} onChange={(e) => setAddRoleId(e.target.value)}>
                <option value="">— pick a role to add —</option>
                {roles
                  .filter((r) => !rolePerms.some((p) => p.role_id === r.id))
                  .map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            ) : (
              <input
                value={addRoleId}
                onChange={(e) => setAddRoleId(e.target.value)}
                placeholder="Role ID (connect the bot to pick by name)"
                className="mono"
              />
            )}
            <button type="button" className="btn" onClick={addRole} disabled={!addRoleId}>+ Add role</button>
          </div>
          {rolePerms.length === 0 && <p className="muted">No roles configured yet.</p>}
          {rolePerms.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Role</th>
                    {ROLE_PERM_COLUMNS.map((c) => <th key={String(c.key)}>{c.label}</th>)}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rolePerms.map((r) => (
                    <tr key={r.role_id}>
                      <td><span className="chip chip-on">{roleDisplayName(r)}</span></td>
                      {ROLE_PERM_COLUMNS.map((c) => (
                        <td key={String(c.key)}>
                          <input
                            type="checkbox"
                            checked={!!r[c.key]}
                            onChange={() => toggleRolePerm(r.role_id, c.key)}
                          />
                        </td>
                      ))}
                      <td className="table-actions">
                        <button type="button" className="btn btn-small btn-danger-outline" onClick={() => removeRole(r.role_id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Command channels</h2>
          <MultiPicker
            label="Channels where commands are allowed"
            hint="Leave empty to allow slash commands in every channel."
            options={channels} selected={commandChannels} onChange={setCommandChannels}
          />
        </div>

        <div className="card">
          <h2>Allowed commands</h2>
          <div className="checkbox-row">
            {([
              ['start', 'Start'], ['stop', 'Stop'], ['restart', 'Restart / pause'],
              ['broadcast', 'In-game broadcast'], ['rcon', 'Raw RCON'],
            ] as const).map(([key, label]) => (
              <label key={key} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={allow[key]}
                  onChange={(e) => setAllow({ ...allow, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            RCON command allowlist (one prefix per line; empty = allow everything)
            <textarea
              rows={4}
              value={rconAllowlist}
              onChange={(e) => setRconAllowlist(e.target.value)}
              placeholder={'ShowPlayers\nlist\ninfo'}
              className="mono"
            />
          </label>
        </div>

        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save & restart bot'}</button>
        </div>
      </form>
    </div>
  );
}

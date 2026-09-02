import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import AzerothUserManagement from '../components/AzerothUserManagement';
import CopyButton from '../components/CopyButton';
import CustomFields from '../components/CustomFields';
import ModsPanel from '../components/ModsPanel';
import PalworldSettings from '../components/PalworldSettings';
import StatusBadge from '../components/StatusBadge';
import { formatBytes, formatRelative, mergeLive } from '../format';
import type { GameCommand } from '../gameCommands';
import { GAME_COMMANDS, buildCommand } from '../gameCommands';
import type { GameServer, ServerAction, UnifiRule } from '../types';
import { GAME_PRESETS, gameSupportsConsole } from '../types';
import { useStatusSocket } from '../useStatusSocket';

interface ConsoleLine {
  kind: 'cmd' | 'out' | 'err';
  text: string;
}

type Tab = 'controls' | 'accounts' | 'config' | 'mods' | 'settings';

export default function ServerDetail() {
  const { id } = useParams();
  const serverId = parseInt(id || '', 10);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [server, setServer] = useState<GameServer | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('controls');
  const [busy, setBusy] = useState<ServerAction | null>(null);
  const [delaying, setDelaying] = useState(false);
  const { statuses } = useStatusSocket(true);

  // RCON console
  const [command, setCommand] = useState('');
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [rconBusy, setRconBusy] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Game command palette
  const [selectedCmd, setSelectedCmd] = useState<GameCommand | null>(null);
  const [cmdValues, setCmdValues] = useState<Record<string, string>>({});

  // Broadcast
  const [message, setMessage] = useState('');
  const [broadcastResult, setBroadcastResult] = useState('');

  // Settings tab form
  const [form, setForm] = useState<Record<string, string>>({});
  const [restartEnabled, setRestartEnabled] = useState(false);
  const [discordShow, setDiscordShow] = useState(true);
  const [discordChannels, setDiscordChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [unifiRules, setUnifiRules] = useState<UnifiRule[]>([]);
  const [unifiEnabled, setUnifiEnabled] = useState(false);
  const [selectedUnifiRules, setSelectedUnifiRules] = useState<string[]>([]);
  const [settingsNotice, setSettingsNotice] = useState('');

  const initForm = useCallback((s: GameServer) => {
    setForm({
      name: s.name,
      game: s.game,
      container_name: s.container_name,
      rcon_host: s.rcon_host || '',
      rcon_port: String(s.rcon_port || ''),
      rcon_username: s.rcon_username || '',
      rcon_password: s.rcon_password || '',
      broadcast_template: s.broadcast_template || '',
      config_path: s.config_path || '',
      game_port: s.game_port ? String(s.game_port) : '',
      restart_time: s.restart_time || '04:00',
      restart_mode: s.restart_mode || 'daily',
      restart_interval_hours: String(s.restart_interval_hours || 6),
      discord_channel_id: s.discord_channel_id || '',
      db_host: s.db_host || '',
      db_port: s.db_port ? String(s.db_port) : '3306',
      db_user: s.db_user || '',
      db_password: s.db_password || '',
      db_characters_db: s.db_characters_db || 'acore_characters',
      db_auth_db: s.db_auth_db || 'acore_auth',
      bot_account_prefix: s.bot_account_prefix || 'rndbot',
      address_mode: s.address_mode || 'auto',
      custom_address: s.custom_address || '',
    });
    setRestartEnabled(!!s.restart_enabled);
    setDiscordShow(s.discord_show !== false);
    setSelectedUnifiRules(s.unifi_rule_ids || []);
  }, []);

  const load = useCallback(() => {
    api
      .getServer(serverId)
      .then((r) => {
        setServer(r.server);
        initForm(r.server);
      })
      .catch((err) => setError(err.message));
  }, [serverId, initForm]);

  useEffect(load, [load]);

  useEffect(() => {
    if (isAdmin) {
      api.discordMeta().then((r) => setDiscordChannels(r.channels)).catch(() => {});
      api.unifiRules().then((r) => {
        setUnifiEnabled(r.enabled);
        setUnifiRules(r.rules);
      }).catch(() => {});
    }
  }, [isAdmin]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines]);

  if (error && !server) {
    return (
      <div>
        <div className="alert alert-error">{error}</div>
        <Link to="/" className="btn">← Back to dashboard</Link>
      </div>
    );
  }
  if (!server) return <div className="muted">Loading…</div>;

  const live = mergeLive(server, statuses.get(serverId));
  const state = live.state;
  const running = state === 'running';
  const paused = state === 'paused';
  const hasStats = running && live.cpuPercent != null;
  const players = (running && live.players) || [];

  const act = async (action: ServerAction) => {
    setBusy(action);
    setError('');
    try {
      await api.serverAction(server.id, action);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const delayRestart = async () => {
    setDelaying(true);
    setError('');
    try {
      const r = await api.delayRestart(server.id);
      setServer({ ...server, nextRestartAt: r.nextRestartAt });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDelaying(false);
    }
  };

  const sendToConsole = async (cmd: string) => {
    setConsoleLines((l) => [...l, { kind: 'cmd', text: `> ${cmd}` }]);
    setRconBusy(true);
    try {
      const r = await api.sendRcon(server.id, cmd);
      setConsoleLines((l) => [...l, { kind: 'out', text: r.response.trim() || '(no response)' }]);
    } catch (err: any) {
      setConsoleLines((l) => [...l, { kind: 'err', text: err.message }]);
    } finally {
      setRconBusy(false);
    }
  };

  const runRcon = async (e: FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;
    setCommand('');
    await sendToConsole(cmd);
  };

  const pickCommand = (c: GameCommand) => {
    setSelectedCmd(selectedCmd?.command === c.command ? null : c);
    setCmdValues({});
  };

  const runPaletteCommand = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCmd) return;
    const cmd = buildCommand(selectedCmd, cmdValues);
    if (selectedCmd.destructive && !window.confirm(`Send "${cmd}" to ${server.name}?`)) return;
    await sendToConsole(cmd);
  };

  const broadcast = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBroadcastResult('');
    try {
      await api.sendBroadcast(server.id, message.trim());
      setBroadcastResult('✅ Message sent');
      setMessage('');
    } catch (err: any) {
      setBroadcastResult(`❌ ${err.message}`);
    }
  };

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSettingsNotice('');
    try {
      const r = await api.updateServer(server.id, {
        ...form,
        restart_enabled: restartEnabled,
        discord_show: discordShow,
        // Names travel with the ids so a rule recreated in UniFi can be re-matched by name.
        ...(isAdmin
          ? {
              unifi_rules: selectedUnifiRules.map((ruleId) => ({
                rule_id: ruleId,
                rule_name: unifiRules.find((u) => u.id === ruleId)?.name || '',
              })),
            }
          : {}),
      });
      setServer({ ...server, ...r.server });
      initForm({ ...server, ...r.server });
      setSettingsNotice('✅ Settings saved');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove "${server.name}" from Stormsmith? The Docker container itself is not touched.`)) return;
    await api.deleteServer(server.id);
    navigate('/');
  };

  const canConfigure = isAdmin || server.can_configure;
  const tabs: Array<{ id: Tab; label: string }> = [{ id: 'controls', label: 'Controls' }];
  if (server.game === 'azerothcore') tabs.push({ id: 'accounts', label: 'User Management' });
  if (canConfigure && server.game === 'palworld') {
    tabs.push({ id: 'config', label: 'Server Config' });
    tabs.push({ id: 'mods', label: 'Mods' });
  }
  if (canConfigure) tabs.push({ id: 'settings', label: 'Settings' });

  const commands = GAME_COMMANDS[server.game];
  const supportsConsole = gameSupportsConsole(server.game);

  return (
    <div>
      <Link to="/" className="muted back-link">← Dashboard</Link>
      <div className="page-head">
        <div>
          <h1>{server.name}</h1>
          <div className="server-meta">
            <span className="game-badge">{GAME_PRESETS[server.game]?.label || server.game}</span>
            <span className="muted mono">{server.container_name}</span>
            {server.address && (
              <span className="muted mono">
                {server.address}
                <CopyButton text={server.address} />
              </span>
            )}
            {running && live.playerCount != null && (
              <span className="muted">{live.playerCount} player{live.playerCount === 1 ? '' : 's'} online</span>
            )}
          </div>
        </div>
        <StatusBadge state={state} />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="muted server-status-text">{live.statusText}</div>

      {tabs.length > 1 && (
        <div className="tab-bar">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${tab === t.id ? 'tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'controls' && (
        <>
          {server.can_control && (
            <div className="card">
              <h2>Server Controls</h2>
              <div className="btn-row controls-row">
                <button className="btn btn-success" disabled={running || paused || !!busy} onClick={() => act('start')}>▶ Start</button>
                <button className="btn btn-danger" disabled={(!running && !paused) || !!busy} onClick={() => act('stop')}>⏹ Stop</button>
                <button className="btn" disabled={!running || !!busy} onClick={() => act('restart')}>🔄 Restart</button>
                {paused ? (
                  <button className="btn" disabled={!!busy} onClick={() => act('unpause')}>⏵ Resume</button>
                ) : (
                  <button className="btn" disabled={!running || !!busy} onClick={() => act('pause')}>⏸ Pause</button>
                )}
              </div>
              {busy && <div className="muted">Running {busy}…</div>}
              {server.restart_enabled && server.nextRestartAt && (
                <div className="restart-notice">
                  <span className="muted">Next scheduled restart {formatRelative(server.nextRestartAt)}</span>
                  <button className="btn btn-small" disabled={delaying} onClick={delayRestart}>
                    {delaying ? '…' : '⏰ Delay 30m'}
                  </button>
                </div>
              )}
            </div>
          )}

          {hasStats && (
            <div className="card">
              <h2>Resources</h2>
              <div className="stats-row">
                <div className="stat">
                  <div className="stat-label">CPU</div>
                  <div className="stat-value">{live.cpuPercent!.toFixed(1)}%</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Memory</div>
                  <div className="stat-value">
                    {formatBytes(live.memUsageBytes || 0)}
                    {live.memLimitBytes ? <span className="muted"> / {formatBytes(live.memLimitBytes)}</span> : null}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">Players</div>
                  <div className="stat-value">{live.playerCount ?? '—'}</div>
                </div>
              </div>
              {players.length > 0 && (
                <div className="player-chips">
                  {players.map((p) => <span key={p} className="player-chip">{p}</span>)}
                </div>
              )}
            </div>
          )}

          {server.can_rcon && supportsConsole && (
            <>
              <div className="card">
                <h2>{server.game === 'azerothcore' ? 'GM Console' : 'RCON Console'}</h2>
                {!server.rcon_configured && (
                  <div className="alert alert-warn">
                    {server.game === 'azerothcore' ? 'SOAP' : 'RCON'} is not configured for this server
                    {canConfigure ? ' — set the host, port, and password in the Settings tab.' : '.'}
                  </div>
                )}
                {commands && (
                  <div className="cmd-palette">
                    <div className="chip-list">
                      {commands.map((c) => (
                        <button
                          key={c.command}
                          type="button"
                          className={`chip ${selectedCmd?.command === c.command ? 'chip-on' : ''} ${c.destructive ? 'chip-danger' : ''}`}
                          onClick={() => pickCommand(c)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    {selectedCmd && (
                      <form className="cmd-form" onSubmit={runPaletteCommand}>
                        <div className="hint">{selectedCmd.description}</div>
                        <div className="cmd-form-row">
                          {selectedCmd.params.map((p) => (
                            <input
                              key={p.name}
                              value={cmdValues[p.name] || ''}
                              onChange={(e) => setCmdValues({ ...cmdValues, [p.name]: e.target.value })}
                              placeholder={p.placeholder}
                              required={p.required}
                            />
                          ))}
                          <button
                            className={`btn ${selectedCmd.destructive ? 'btn-danger' : 'btn-primary'}`}
                            disabled={rconBusy}
                          >
                            Run {selectedCmd.label}
                          </button>
                        </div>
                        <div className="hint mono">{buildCommand(selectedCmd, cmdValues)}</div>
                      </form>
                    )}
                  </div>
                )}
                <div className="console">
                  {consoleLines.length === 0 && <div className="muted">Enter a command below to get started.</div>}
                  {consoleLines.map((line, i) => (
                    <div key={i} className={`console-line console-${line.kind}`}>{line.text}</div>
                  ))}
                  <div ref={consoleEndRef} />
                </div>
                <form className="inline-form" onSubmit={runRcon}>
                  <input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="RCON command (e.g. ShowPlayers, list, info)"
                    disabled={rconBusy}
                  />
                  <button className="btn btn-primary" disabled={rconBusy || !command.trim()}>Send</button>
                </form>
              </div>

              <div className="card">
                <h2>In-game Message</h2>
                <form className="inline-form" onSubmit={broadcast}>
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Message to broadcast to players"
                  />
                  <button className="btn btn-primary" disabled={!message.trim()}>📢 Send</button>
                </form>
                {broadcastResult && <div className="muted">{broadcastResult}</div>}
              </div>
            </>
          )}

          {!server.can_control && !(server.can_rcon && supportsConsole) && (
            <div className="card empty-state">
              <p className="muted">You have view-only access to this server.</p>
            </div>
          )}
        </>
      )}

      {tab === 'accounts' && server.game === 'azerothcore' && (
        server.can_rcon ? (
          <AzerothUserManagement serverId={server.id} dbConfigured={server.db_configured} />
        ) : (
          <div className="card empty-state">
            <p className="muted">You have view-only access to this server.</p>
          </div>
        )
      )}

      {tab === 'config' && canConfigure && server.game === 'palworld' && (
        <PalworldSettings serverId={server.id} serverState={state} />
      )}

      {tab === 'mods' && canConfigure && server.game === 'palworld' && (
        <ModsPanel serverId={server.id} serverState={state} />
      )}

      {tab === 'settings' && canConfigure && (
        <>
          <div className="card">
            <h2>Stormsmith Settings</h2>
            {settingsNotice && <div className="alert alert-ok">{settingsNotice}</div>}
            <form className="form-grid" onSubmit={saveSettings}>
              <label>
                Display name
                <input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                <span className="hint">How this server appears in Stormsmith and Discord.</span>
              </label>
              <label>
                Game
                <select value={form.game || 'custom'} onChange={(e) => setForm({ ...form, game: e.target.value })}>
                  {Object.entries(GAME_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label>
                Container name
                <input value={form.container_name || ''} onChange={(e) => setForm({ ...form, container_name: e.target.value })} required />
              </label>
              <label>
                Game port
                <input type="number" value={form.game_port || ''} onChange={(e) => setForm({ ...form, game_port: e.target.value })} placeholder="e.g. 8211 for Palworld" />
              </label>
              <div className="span-2 restart-schedule">
                <label>
                  Address display
                  <select
                    value={form.address_mode || 'auto'}
                    onChange={(e) => setForm({ ...form, address_mode: e.target.value })}
                  >
                    <option value="auto">Public IP : game port</option>
                    <option value="custom">Custom address</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </label>
                {form.address_mode === 'custom' && (
                  <label>
                    Custom address
                    <input
                      value={form.custom_address || ''}
                      onChange={(e) => setForm({ ...form, custom_address: e.target.value })}
                      placeholder="e.g. wow.mydomain.com or wow.mydomain.com:8085"
                    />
                  </label>
                )}
                <span className="hint">
                  Shown on the dashboard card, this page, and the Discord embed. Use Custom for a domain name
                  instead of the raw public IP, or Hidden to not show a join address at all.
                </span>
              </div>
              {supportsConsole && (
                <>
                  <label>
                    {form.game === 'azerothcore' ? 'SOAP host' : 'RCON host'}
                    <input value={form.rcon_host || ''} onChange={(e) => setForm({ ...form, rcon_host: e.target.value })} placeholder="Usually your Unraid IP" />
                  </label>
                  <label>
                    {form.game === 'azerothcore' ? 'SOAP port' : 'RCON port'}
                    <input type="number" value={form.rcon_port || ''} onChange={(e) => setForm({ ...form, rcon_port: e.target.value })} placeholder={form.game === 'azerothcore' ? '7878' : ''} />
                  </label>
                  {form.game === 'azerothcore' && (
                    <label>
                      GM account username
                      <input value={form.rcon_username || ''} onChange={(e) => setForm({ ...form, rcon_username: e.target.value })} placeholder="A GM level 3+ account" />
                      <span className="hint">The account's access must have realmID = -1 in account_access.</span>
                    </label>
                  )}
                  <label>
                    {form.game === 'azerothcore' ? 'GM account password' : 'RCON password'}
                    <input type="password" value={form.rcon_password || ''} onChange={(e) => setForm({ ...form, rcon_password: e.target.value })} />
                  </label>
                </>
              )}
              <label className="span-2">
                Game config file path
                <input value={form.config_path || ''} onChange={(e) => setForm({ ...form, config_path: e.target.value })} placeholder="Auto-detected for Palworld" />
                <span className="hint">Path inside the game container. Leave blank to auto-detect.</span>
              </label>
              {supportsConsole && (
                <label className="span-2">
                  Broadcast command template
                  <input value={form.broadcast_template || ''} onChange={(e) => setForm({ ...form, broadcast_template: e.target.value })} placeholder="say {message}" />
                  <span className="hint">
                    Use {'{message}'} for the text. For Palworld use {'{message_nbsp}'} — it sends spaces as
                    non-breaking spaces so messages display normally in-game. {'{message_underscored}'} is also
                    available if your server needs the old underscore workaround.
                  </span>
                </label>
              )}
              {form.game === 'azerothcore' && (
                <div className="span-2 restart-schedule">
                  <div className="setting-label" style={{ fontWeight: 700 }}>Player database (optional)</div>
                  <span className="hint">
                    AzerothCore has no built-in way to report player counts without mod-playerbots bots included.
                    Connecting to the character/auth databases lets Stormsmith show only real players. Leave the
                    host blank to skip this — the server will still work, just without a player count.
                  </span>
                  <div className="restart-options">
                    <label>
                      DB host
                      <input value={form.db_host || ''} onChange={(e) => setForm({ ...form, db_host: e.target.value })} placeholder="Usually your Unraid IP" />
                    </label>
                    <label>
                      DB port
                      <input type="number" value={form.db_port || ''} onChange={(e) => setForm({ ...form, db_port: e.target.value })} placeholder="3306" />
                    </label>
                    <label>
                      DB user
                      <input value={form.db_user || ''} onChange={(e) => setForm({ ...form, db_user: e.target.value })} />
                    </label>
                    <label>
                      DB password
                      <input type="password" value={form.db_password || ''} onChange={(e) => setForm({ ...form, db_password: e.target.value })} />
                    </label>
                    <label>
                      Characters database name
                      <input value={form.db_characters_db || ''} onChange={(e) => setForm({ ...form, db_characters_db: e.target.value })} placeholder="acore_characters" />
                    </label>
                    <label>
                      Auth database name
                      <input value={form.db_auth_db || ''} onChange={(e) => setForm({ ...form, db_auth_db: e.target.value })} placeholder="acore_auth" />
                    </label>
                    <label>
                      Bot account prefix
                      <input value={form.bot_account_prefix || ''} onChange={(e) => setForm({ ...form, bot_account_prefix: e.target.value })} placeholder="rndbot" />
                      <span className="hint">Matches AiPlayerbot.RandomBotAccountPrefix — accounts starting with this are excluded.</span>
                    </label>
                  </div>
                </div>
              )}
              <div className="span-2 restart-schedule">
                <label className="checkbox-label">
                  <input type="checkbox" checked={discordShow} onChange={(e) => setDiscordShow(e.target.checked)} />
                  Show in Discord status channel
                </label>
                {discordShow && (
                  <label className="restart-time">
                    Status channel
                    {discordChannels.length > 0 ? (
                      <select
                        value={form.discord_channel_id || ''}
                        onChange={(e) => setForm({ ...form, discord_channel_id: e.target.value })}
                      >
                        <option value="">Default status channel</option>
                        {discordChannels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                      </select>
                    ) : (
                      <input
                        className="mono"
                        value={form.discord_channel_id || ''}
                        onChange={(e) => setForm({ ...form, discord_channel_id: e.target.value })}
                        placeholder="Channel ID (blank = default channel)"
                      />
                    )}
                  </label>
                )}
                <span className="hint">
                  Choose which Discord channel this server's status embed appears in — different servers can use
                  different channels.
                </span>
              </div>
              <div className="span-2 restart-schedule">
                <label className="checkbox-label">
                  <input type="checkbox" checked={restartEnabled} onChange={(e) => setRestartEnabled(e.target.checked)} />
                  Scheduled restart
                </label>
                {restartEnabled && (
                  <div className="restart-options">
                    <label>
                      Schedule
                      <select
                        value={form.restart_mode || 'daily'}
                        onChange={(e) => setForm({ ...form, restart_mode: e.target.value })}
                      >
                        <option value="daily">Once a day at a set time</option>
                        <option value="interval">Every X hours</option>
                      </select>
                    </label>
                    {form.restart_mode === 'interval' && (
                      <label>
                        Every (hours)
                        <input
                          type="number"
                          min={1}
                          max={24}
                          value={form.restart_interval_hours || '6'}
                          onChange={(e) => setForm({ ...form, restart_interval_hours: e.target.value })}
                          required
                        />
                      </label>
                    )}
                    <label>
                      {form.restart_mode === 'interval' ? 'First restart at' : 'Restart time'}
                      <input type="time" value={form.restart_time || '04:00'} onChange={(e) => setForm({ ...form, restart_time: e.target.value })} required />
                    </label>
                  </div>
                )}
                <span className="hint">
                  {form.restart_mode === 'interval'
                    ? 'Restarts repeat from the start time each day (e.g. 04:00 every 6h → 04:00, 10:00, 16:00, 22:00).'
                    : 'Restarts the container every day at this time.'}
                  {' '}If RCON is configured, players are warned in-game 30 minutes, 5 minutes, and 1 minute before each restart.
                </span>
              </div>
              {isAdmin && unifiEnabled && (
                <div className="span-2 restart-schedule">
                  <div className="picker-label">UniFi port forwarding</div>
                  {server.unifi_warning && <div className="alert alert-error">{server.unifi_warning}</div>}
                  {unifiRules.length > 0 ? (
                    <div className="chip-list">
                      {unifiRules.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className={`chip ${selectedUnifiRules.includes(r.id) ? 'chip-on' : ''}`}
                          onClick={() =>
                            setSelectedUnifiRules(
                              selectedUnifiRules.includes(r.id)
                                ? selectedUnifiRules.filter((x) => x !== r.id)
                                : [...selectedUnifiRules, r.id]
                            )
                          }
                        >
                          {r.name || r.id}{r.dstPort ? ` (${r.dstPort})` : ''}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="muted">
                      No rules loaded — check the connection on the Port Forwarding page.
                    </div>
                  )}
                  <span className="hint">
                    These port-forward rules open when this server starts and close once it has been stopped or
                    paused for the grace period. Restarting never closes them. Configure the console on the{' '}
                    <Link to="/unifi">Port Forwarding</Link> page.
                  </span>
                </div>
              )}
              <div className="btn-row span-2">
                <button className="btn btn-primary" type="submit">Save settings</button>
                <button className="btn" type="button" onClick={() => initForm(server)}>Reset</button>
              </div>
            </form>
          </div>

          <CustomFields serverId={server.id} initialFields={server.custom_fields} />

          {isAdmin && (
            <div className="card danger-zone">
              <h2>Danger Zone</h2>
              <p className="muted">Removes this server from Stormsmith only — the Docker container and its data are not touched.</p>
              <button className="btn btn-danger-outline" onClick={remove}>Remove server from Stormsmith</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

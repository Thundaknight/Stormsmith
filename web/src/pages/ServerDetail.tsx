import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import PalworldSettings from '../components/PalworldSettings';
import StatusBadge from '../components/StatusBadge';
import type { GameServer, ServerAction } from '../types';
import { GAME_PRESETS } from '../types';
import type { GameCommand } from '../gameCommands';
import { GAME_COMMANDS, buildCommand } from '../gameCommands';
import { useStatusSocket } from '../useStatusSocket';

interface ConsoleLine {
  kind: 'cmd' | 'out' | 'err';
  text: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  return `${(bytes / 2 ** (10 * i)).toFixed(1)} ${units[i]}`;
}

export default function ServerDetail() {
  const { id } = useParams();
  const serverId = parseInt(id || '', 10);
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [server, setServer] = useState<GameServer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<ServerAction | null>(null);
  const [stats, setStats] = useState<{ cpuPercent: number; memUsageBytes: number; memLimitBytes: number } | null>(null);
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

  // Admin settings
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api
      .getServer(serverId)
      .then((r) => setServer(r.server))
      .catch((err) => setError(err.message));
  }, [serverId]);

  useEffect(load, [load]);

  const live = statuses.get(serverId);
  const state = live?.state ?? server?.state ?? 'not_found';
  const statusText = live?.statusText ?? server?.statusText ?? '';

  // Poll stats while running
  useEffect(() => {
    if (state !== 'running') {
      setStats(null);
      return;
    }
    let cancelled = false;
    const tick = () => {
      api.serverStats(serverId).then((r) => !cancelled && setStats(r.stats)).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [serverId, state]);

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

  const running = state === 'running';
  const paused = state === 'paused';

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

  const startEdit = () => {
    setForm({
      name: server.name,
      game: server.game,
      container_name: server.container_name,
      rcon_host: server.rcon_host || '',
      rcon_port: String(server.rcon_port || ''),
      rcon_password: server.rcon_password || '',
      broadcast_template: server.broadcast_template || '',
      config_path: server.config_path || '',
    });
    setEditing(true);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.updateServer(server.id, form);
      setServer({ ...server, ...r.server });
      setEditing(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove "${server.name}" from Server Manager? The Docker container itself is not touched.`)) return;
    await api.deleteServer(server.id);
    navigate('/');
  };

  return (
    <div>
      <Link to="/" className="muted back-link">← Dashboard</Link>
      <div className="page-head">
        <div>
          <h1>{server.name}</h1>
          <div className="server-meta">
            <span className="game-badge">{GAME_PRESETS[server.game]?.label || server.game}</span>
            <span className="muted mono">{server.container_name}</span>
          </div>
        </div>
        <StatusBadge state={state} />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="muted server-status-text">{statusText}</div>

      {server.can_control && (
        <div className="card">
          <h2>Controls</h2>
          <div className="btn-row">
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
        </div>
      )}

      {stats && (
        <div className="card">
          <h2>Resources</h2>
          <div className="stats-row">
            <div className="stat">
              <div className="stat-label">CPU</div>
              <div className="stat-value">{stats.cpuPercent.toFixed(1)}%</div>
            </div>
            <div className="stat">
              <div className="stat-label">Memory</div>
              <div className="stat-value">
                {formatBytes(stats.memUsageBytes)}
                <span className="muted"> / {formatBytes(stats.memLimitBytes)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {server.can_rcon && (
        <>
          <div className="card">
            <h2>RCON Console</h2>
            {!server.rcon_configured && (
              <div className="alert alert-warn">RCON is not configured for this server{isAdmin ? ' — set the host, port, and password in Settings below.' : '.'}</div>
            )}
            {GAME_COMMANDS[server.game] && (
              <div className="cmd-palette">
                <div className="chip-list">
                  {GAME_COMMANDS[server.game].map((c) => (
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

      {isAdmin && server.game === 'palworld' && (
        <PalworldSettings serverId={server.id} serverState={state} />
      )}

      {isAdmin && (
        <div className="card">
          <div className="card-head-row">
            <h2>Settings</h2>
            {!editing && <button className="btn" onClick={startEdit}>Edit</button>}
          </div>
          {editing ? (
            <form className="form-grid" onSubmit={saveEdit}>
              <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <label>
                Game
                <select value={form.game} onChange={(e) => setForm({ ...form, game: e.target.value })}>
                  {Object.entries(GAME_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label>Container name<input value={form.container_name} onChange={(e) => setForm({ ...form, container_name: e.target.value })} required /></label>
              <label>RCON host<input value={form.rcon_host} onChange={(e) => setForm({ ...form, rcon_host: e.target.value })} placeholder="Unraid IP or container IP" /></label>
              <label>RCON port<input value={form.rcon_port} onChange={(e) => setForm({ ...form, rcon_port: e.target.value })} type="number" /></label>
              <label>RCON password<input value={form.rcon_password} onChange={(e) => setForm({ ...form, rcon_password: e.target.value })} type="password" /></label>
              <label className="span-2">
                Game config file path
                <input value={form.config_path} onChange={(e) => setForm({ ...form, config_path: e.target.value })} placeholder="Auto-detected for Palworld; e.g. /palworld/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini" />
                <span className="hint">Path inside the game container. Leave blank to auto-detect.</span>
              </label>
              <label className="span-2">
                Broadcast command template
                <input value={form.broadcast_template} onChange={(e) => setForm({ ...form, broadcast_template: e.target.value })} placeholder="say {message}" />
                <span className="hint">Use {'{message}'} for the text, or {'{message_underscored}'} for games (like Palworld) that need spaces replaced.</span>
              </label>
              <div className="btn-row span-2">
                <button className="btn btn-primary" type="submit">Save</button>
                <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="muted">
              RCON: {server.rcon_configured ? `${server.rcon_host}:${server.rcon_port}` : 'not configured'}
            </div>
          )}
          <hr className="divider" />
          <button className="btn btn-danger-outline" onClick={remove}>Remove server from manager</button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { ContainerSummary } from '../types';
import { GAME_PRESETS } from '../types';
import StatusBadge from '../components/StatusBadge';

export default function ImportServer() {
  const navigate = useNavigate();
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ContainerSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: '',
    game: 'custom',
    game_port: '',
    rcon_host: '',
    rcon_port: '',
    rcon_password: '',
    broadcast_template: GAME_PRESETS.custom.broadcast,
  });

  useEffect(() => {
    api
      .availableContainers()
      .then((r) => setContainers(r.containers))
      .catch((err) => setError(err.message))
      .finally(() => setLoaded(true));
  }, []);

  const pick = (c: ContainerSummary) => {
    setSelected(c);
    // Guess a game preset from the image name
    const image = c.image.toLowerCase();
    const guess =
      Object.keys(GAME_PRESETS).find((k) => k !== 'custom' && image.includes(k)) ||
      (image.includes('mc') || image.includes('minecraft') ? 'minecraft' : 'custom');
    applyGame(guess, c.name);
  };

  const applyGame = (game: string, defaultName?: string) => {
    const preset = GAME_PRESETS[game] || GAME_PRESETS.custom;
    setForm((f) => ({
      ...f,
      game,
      name: f.name || defaultName || '',
      game_port: preset.gamePort ? String(preset.gamePort) : f.game_port,
      rcon_port: preset.rconPort ? String(preset.rconPort) : f.rcon_port,
      broadcast_template: preset.broadcast,
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.importServer({ ...form, container_name: selected.name });
      navigate(`/servers/${r.server.id}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head"><h1>Import Server</h1></div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h2>1. Pick a Docker container</h2>
        {!loaded && <div className="muted">Loading containers…</div>}
        {loaded && containers.length === 0 && <div className="muted">No containers found on the Docker host.</div>}
        <div className="container-list">
          {containers.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`container-row ${selected?.id === c.id ? 'selected' : ''}`}
              disabled={c.imported}
              onClick={() => pick(c)}
            >
              <div>
                <div className="container-name">{c.name} {c.imported && <span className="muted">(already imported)</span>}</div>
                <div className="muted mono">{c.image}</div>
              </div>
              <StatusBadge state={c.state} />
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <form className="card" onSubmit={submit}>
          <h2>2. Configure “{selected.name}”</h2>
          <div className="form-grid">
            <label>Display name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>
              Game
              <select value={form.game} onChange={(e) => applyGame(e.target.value)}>
                {Object.entries(GAME_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label>
              Game port
              <input type="number" value={form.game_port} onChange={(e) => setForm({ ...form, game_port: e.target.value })} />
              <span className="hint">The port players join on; shown with your public IP.</span>
            </label>
            <label>RCON host<input value={form.rcon_host} onChange={(e) => setForm({ ...form, rcon_host: e.target.value })} placeholder="Usually your Unraid IP" /></label>
            <label>RCON port<input type="number" value={form.rcon_port} onChange={(e) => setForm({ ...form, rcon_port: e.target.value })} /></label>
            <label>RCON password<input type="password" value={form.rcon_password} onChange={(e) => setForm({ ...form, rcon_password: e.target.value })} /></label>
            <label>
              Broadcast template
              <input value={form.broadcast_template} onChange={(e) => setForm({ ...form, broadcast_template: e.target.value })} />
              <span className="hint">RCON command used for in-game messages. {'{message}'} is replaced with the text.</span>
            </label>
          </div>
          <p className="muted">RCON is optional — leave it blank to only manage the container. You can add it later in the server's settings.</p>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Importing…' : 'Import server'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { SettingDef } from '../palworldSettings';
import { KNOWN_KEYS, PALWORLD_SETTING_GROUPS } from '../palworldSettings';

interface Props {
  serverId: number;
  serverState: string;
}

function SettingRow({ def, value, onChange }: {
  def: SettingDef;
  value: string;
  onChange: (v: string) => void;
}) {
  if (def.type === 'bool') {
    const on = value.toLowerCase() === 'true';
    return (
      <label className="setting-row setting-bool">
        <span className="setting-label">{def.label}{def.help && <span className="hint">{def.help}</span>}</span>
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? 'True' : 'False')} />
      </label>
    );
  }
  if (def.type === 'select') {
    return (
      <label className="setting-row">
        <span className="setting-label">{def.label}{def.help && <span className="hint">{def.help}</span>}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {!def.options?.includes(value) && <option value={value}>{value || '—'}</option>}
          {def.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (def.type === 'float' || def.type === 'int') {
    const num = parseFloat(value);
    const valid = !Number.isNaN(num);
    return (
      <div className="setting-row">
        <span className="setting-label">{def.label}{def.help && <span className="hint">{def.help}</span>}</span>
        <div className="setting-slider">
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={valid ? num : def.min}
            onChange={(e) => onChange(e.target.value)}
          />
          <input
            type="number"
            className="setting-number"
            min={def.min}
            step={def.step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    );
  }
  return (
    <label className="setting-row">
      <span className="setting-label">{def.label}{def.help && <span className="hint">{def.help}</span>}</span>
      <input
        type={def.type === 'password' ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export default function PalworldSettings({ serverId, serverState }: Props) {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [path, setPath] = useState('');
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [openGroup, setOpenGroup] = useState('General');

  const load = () => {
    setError('');
    setNotice('');
    api.getServerConfig(serverId)
      .then((r) => {
        setSettings(r.settings);
        setOriginal(r.settings);
        setPath(r.path);
        setEmpty(r.empty);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, [serverId]);

  const dirtyKeys = useMemo(() => {
    if (!settings) return [];
    return Object.keys(settings).filter((k) => settings[k] !== original[k]);
  }, [settings, original]);

  // Settings present in the file but not in our metadata still get a row
  const otherKeys = useMemo(
    () => (settings ? Object.keys(settings).filter((k) => !KNOWN_KEYS.has(k)).sort() : []),
    [settings]
  );

  const save = async () => {
    if (!settings || dirtyKeys.length === 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const changed = Object.fromEntries(dirtyKeys.map((k) => [k, settings[k]]));
      const r = await api.saveServerConfig(serverId, changed);
      setOriginal(settings);
      setNotice(
        r.restartRequired
          ? '✅ Saved. Restart the server for the changes to take effect.'
          : '✅ Saved. Changes apply the next time the server starts.'
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && settings === null) {
    return (
      <div className="card">
        <h2>Palworld Settings</h2>
        <div className="alert alert-error">{error}</div>
        <button className="btn" onClick={load}>Retry</button>
      </div>
    );
  }
  if (settings === null) {
    return (
      <div className="card">
        <h2>Palworld Settings</h2>
        <div className="muted">Reading PalWorldSettings.ini from the container…</div>
      </div>
    );
  }

  const get = (key: string) => settings[key] ?? '';
  const set = (key: string, v: string) => setSettings({ ...settings, [key]: v });

  return (
    <div className="card">
      <div className="card-head-row">
        <h2>Palworld Settings</h2>
        <span className="muted mono">{path}</span>
      </div>
      {empty && (
        <div className="alert alert-warn">
          The config file has no settings yet (Palworld generates it empty on first run). Values you save here
          will be written as a complete configuration.
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {PALWORLD_SETTING_GROUPS.map((group) => (
        <div key={group.name} className="setting-group">
          <button
            type="button"
            className="setting-group-head"
            onClick={() => setOpenGroup(openGroup === group.name ? '' : group.name)}
          >
            <span>{group.name}</span>
            <span className="muted">{openGroup === group.name ? '▾' : '▸'}</span>
          </button>
          {openGroup === group.name && (
            <div className="setting-group-body">
              {group.settings
                .filter((def) => empty || settings[def.key] !== undefined)
                .map((def) => (
                  <SettingRow key={def.key} def={def} value={get(def.key)} onChange={(v) => set(def.key, v)} />
                ))}
              {group.settings.every((def) => !empty && settings[def.key] === undefined) && (
                <div className="muted">None of these settings are present in the config file.</div>
              )}
            </div>
          )}
        </div>
      ))}

      {otherKeys.length > 0 && (
        <div className="setting-group">
          <button
            type="button"
            className="setting-group-head"
            onClick={() => setOpenGroup(openGroup === 'Other' ? '' : 'Other')}
          >
            <span>Other</span>
            <span className="muted">{openGroup === 'Other' ? '▾' : '▸'}</span>
          </button>
          {openGroup === 'Other' && (
            <div className="setting-group-body">
              {otherKeys.map((key) => (
                <label key={key} className="setting-row">
                  <span className="setting-label mono">{key}</span>
                  <input value={get(key)} onChange={(e) => set(key, e.target.value)} />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="setting-footer">
        <div className="muted">
          {dirtyKeys.length > 0 ? `${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? '' : 's'}` : 'No unsaved changes'}
          {serverState === 'running' && dirtyKeys.length > 0 && ' — a restart is needed to apply'}
        </div>
        <div className="btn-row">
          <button className="btn" onClick={load} disabled={busy}>Reload</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || dirtyKeys.length === 0}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
      <p className="hint">
        Note: some Palworld Docker images generate this file from container environment variables at startup —
        if your image does, changes saved here may be overwritten when the container restarts.
      </p>
    </div>
  );
}

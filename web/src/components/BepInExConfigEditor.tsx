import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { BepInExSection, BepInExSetting } from '../types';

interface Props {
  serverId: number;
  serverState: string;
  modName: string;
  fileName: string;
  onClose: () => void;
}

function SettingControl({ setting, onChange }: { setting: BepInExSetting; onChange: (v: string) => void }) {
  const type = setting.type?.toLowerCase();
  if (type === 'boolean') {
    const on = setting.value.toLowerCase() === 'true';
    return <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />;
  }
  if (setting.acceptableValues?.length) {
    return (
      <select value={setting.value} onChange={(e) => onChange(e.target.value)}>
        {!setting.acceptableValues.includes(setting.value) && <option value={setting.value}>{setting.value}</option>}
        {setting.acceptableValues.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }
  if (setting.range && (type === 'int32' || type === 'single' || type === 'double' || type === 'int64')) {
    const num = parseFloat(setting.value);
    const step = type === 'int32' || type === 'int64' ? 1 : 0.01;
    return (
      <div className="setting-slider">
        <input
          type="range" min={setting.range.min} max={setting.range.max} step={step}
          value={Number.isNaN(num) ? setting.range.min : num}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="number" className="setting-number" min={setting.range.min} max={setting.range.max} step={step}
          value={setting.value} onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  if (type === 'int32' || type === 'single' || type === 'double' || type === 'int64') {
    return <input type="number" value={setting.value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input value={setting.value} onChange={(e) => onChange(e.target.value)} />;
}

export default function BepInExConfigEditor({ serverId, serverState, modName, fileName, onClose }: Props) {
  const [sections, setSections] = useState<BepInExSection[] | null>(null);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleSection = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const load = () => {
    setError('');
    setNotice('');
    api.getModConfig(serverId, fileName)
      .then((r) => {
        setSections(r.sections);
        setPath(r.path);
        const flat = Object.fromEntries(r.sections.flatMap((s) => s.settings.map((set) => [set.id, set.value])));
        setOriginal(flat);
        setValues(flat);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(load, [serverId, fileName]);

  const dirtyIds = useMemo(
    () => Object.keys(values).filter((id) => values[id] !== original[id]),
    [values, original]
  );

  const save = async () => {
    if (dirtyIds.length === 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updates = Object.fromEntries(dirtyIds.map((id) => [id, values[id]]));
      const r = await api.saveModConfig(serverId, fileName, updates);
      setOriginal(values);
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head-row">
          <h2>{modName} config</h2>
          <span className="muted mono">{path}</span>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-ok">{notice}</div>}

        {sections === null && !error && <div className="muted">Reading {fileName} from the container…</div>}

        {sections !== null && sections.map((section) => {
          const isOpen = !collapsed.has(section.name);
          return (
            <div key={section.name} className="setting-group">
              <button
                type="button"
                className="setting-group-head"
                onClick={() => toggleSection(section.name)}
              >
                <span>{section.name}</span>
                <span className="muted">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="setting-group-body">
                  {section.settings.map((setting) => (
                    <label key={setting.id} className="setting-row">
                      <span className="setting-label">
                        {setting.key}
                        {setting.description && <span className="hint">{setting.description}</span>}
                      </span>
                      <SettingControl
                        setting={{ ...setting, value: values[setting.id] ?? setting.value }}
                        onChange={(v) => setValues((prev) => ({ ...prev, [setting.id]: v }))}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="setting-footer">
          <div className="muted">
            {dirtyIds.length > 0 ? `${dirtyIds.length} unsaved change${dirtyIds.length === 1 ? '' : 's'}` : 'No unsaved changes'}
            {serverState === 'running' && dirtyIds.length > 0 && ' — a restart is needed to apply'}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={load} disabled={busy}>Reload</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || dirtyIds.length === 0}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

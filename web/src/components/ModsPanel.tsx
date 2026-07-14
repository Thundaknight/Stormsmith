import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatBytes } from '../format';
import type { ModEntry } from '../types';

interface Props {
  serverId: number;
  serverState: string;
}

const FOLDERS = [
  { id: '~mods', label: 'Pak mods (~mods)', hint: 'Standard .pak mods go here.' },
  { id: 'LogicMods', label: 'Logic mods (LogicMods)', hint: 'UE4SS/BP logic mod .pak files go here.' },
];

export default function ModsPanel({ serverId, serverState }: Props) {
  const [folder, setFolder] = useState('~mods');
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [path, setPath] = useState('');
  const [listedWhileRunning, setListedWhileRunning] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const running = serverState === 'running';

  const load = useCallback(() => {
    setError('');
    api.listMods(serverId, folder)
      .then((r) => {
        setMods(r.mods);
        setPath(r.path);
        setListedWhileRunning(r.running);
      })
      .catch((err) => setError(err.message));
  }, [serverId, folder]);

  useEffect(load, [load]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError('');
    setNotice('');
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        await api.uploadMod(serverId, folder, file);
      } catch (err: any) {
        setError(`${file.name}: ${err.message}`);
        break;
      }
    }
    setUploading('');
    setNotice('✅ Upload complete. Restart the server to load the mods.');
    if (fileInputRef.current) fileInputRef.current.value = '';
    load();
  };

  const remove = async (mod: ModEntry) => {
    if (!window.confirm(`Delete "${mod.name}" from the server?`)) return;
    setError('');
    try {
      await api.deleteMod(serverId, folder, mod.name);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const folderInfo = FOLDERS.find((f) => f.id === folder)!;

  return (
    <div className="card">
      <div className="card-head-row">
        <h2>Mods</h2>
        <span className="muted mono">{path}</span>
      </div>

      <div className="mods-toolbar">
        <select value={folder} onChange={(e) => setFolder(e.target.value)}>
          {FOLDERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => upload(e.target.files)}
        />
        <button className="btn btn-primary" disabled={!!uploading} onClick={() => fileInputRef.current?.click()}>
          {uploading ? `Uploading ${uploading}…` : '⬆ Upload mod files'}
        </button>
        <button className="btn" onClick={load}>Refresh</button>
      </div>
      <p className="hint">{folderInfo.hint}</p>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {!running && (
        <div className="alert alert-warn">
          The server is not running — uploads still work, but listing and deleting files requires the container
          to be running.
        </div>
      )}

      {listedWhileRunning && mods.length === 0 && !error && (
        <div className="muted">No files in this folder yet.</div>
      )}
      {mods.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>File</th><th>Size</th><th></th></tr>
          </thead>
          <tbody>
            {mods.map((m) => (
              <tr key={m.name}>
                <td className="mono">{m.isDir ? '📁 ' : ''}{m.name}</td>
                <td className="muted">{m.isDir ? '—' : formatBytes(m.size)}</td>
                <td className="table-actions">
                  <button className="btn btn-small btn-danger-outline" onClick={() => remove(m)} disabled={!running}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="hint">
        Mods take effect after a server restart. Note that Palworld's official mod workshop only supports Windows
        servers — on Linux/Docker servers, use classic .pak mods placed in these folders, and make sure the mods
        you install are marked as server-compatible.
      </p>
    </div>
  );
}

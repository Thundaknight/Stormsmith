import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

type ListId = 'adminlist' | 'bannedlist' | 'permittedlist';

const LISTS: Array<{ id: ListId; title: string; blurb: string }> = [
  {
    id: 'adminlist',
    title: 'Admins',
    blurb: 'Platform User IDs granted admin rights. Applies when the player next connects.',
  },
  {
    id: 'bannedlist',
    title: 'Banned',
    blurb: 'Banned Platform User IDs. Valheim re-reads this while running — bans apply within ~30 seconds.',
  },
  {
    id: 'permittedlist',
    title: 'Permitted (allow-list)',
    blurb:
      'If this list is non-empty, everyone NOT on it is refused. Leave it empty unless you want a strict whitelist.',
  },
];

/** e.g. Steam_76561198000000000, or a bare 17-digit SteamID64. */
function looksLikeId(v: string): boolean {
  const s = v.trim();
  return /^[A-Za-z][A-Za-z0-9]*_[0-9A-Za-z]+$/.test(s) || /^\d{16,20}$/.test(s);
}

function ListCard({
  serverId, id, title, blurb, initial,
}: { serverId: number; id: ListId; title: string; blurb: string; initial: string[] }) {
  const [ids, setIds] = useState<string[]>(initial);
  const [loaded, setLoaded] = useState<string[]>(initial);
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setIds(initial);
    setLoaded(initial);
  }, [initial]);

  const dirty = JSON.stringify(ids) !== JSON.stringify(loaded);

  const addId = () => {
    const v = add.trim();
    if (!v) return;
    if (!looksLikeId(v)) {
      setError(`"${v}" doesn't look like a Platform User ID (e.g. Steam_7656…).`);
      return;
    }
    if (ids.includes(v)) {
      setError('Already in the list.');
      return;
    }
    setError('');
    setIds([...ids, v]);
    setAdd('');
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api.saveValheimList(serverId, id, ids);
      setIds(r.ids);
      setLoaded(r.ids);
      setNotice(`✅ Saved — applies ${r.appliesIn}.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="hint">{blurb}</p>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {ids.length === 0 ? (
        <p className="muted">No IDs.</p>
      ) : (
        <ul className="id-list">
          {ids.map((v) => (
            <li key={v}>
              <span className="mono">{v}</span>
              <button
                type="button"
                className="btn btn-small btn-danger-outline"
                onClick={() => setIds(ids.filter((x) => x !== v))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mods-toolbar">
        <input
          className="mono"
          placeholder="Steam_7656…"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addId();
            }
          }}
        />
        <button type="button" className="btn" onClick={addId}>Add</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function ValheimAdminLists({ serverId }: { serverId: number }) {
  const [saveDir, setSaveDir] = useState('');
  const [lists, setLists] = useState<Record<ListId, string[]> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api.getValheimLists(serverId)
      .then((r) => {
        setSaveDir(r.saveDir);
        setLists(r.lists);
      })
      .catch((err) => setError(err.message));
  }, [serverId]);

  useEffect(load, [load]);

  if (error) {
    return (
      <div className="card">
        <h2>Admin &amp; Bans</h2>
        <div className="alert alert-error">{error}</div>
        <p className="hint">
          If Stormsmith can't find the save folder, set it on the Settings tab (the directory containing
          <span className="mono"> adminlist.txt</span>). The container may need to be running the first time.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h2>Admin &amp; Bans</h2>
        <p className="hint">
          Valheim has no in-game admin console for dedicated servers — these three text files are the whole
          control surface. One Platform User ID per line. Find a player's ID in the server log or the in-game
          F2 panel.
        </p>
        {saveDir && <p className="muted mono">{saveDir}</p>}
      </div>
      {lists && LISTS.map((l) => (
        <ListCard key={l.id} serverId={serverId} {...l} initial={lists[l.id] || []} />
      ))}
    </div>
  );
}

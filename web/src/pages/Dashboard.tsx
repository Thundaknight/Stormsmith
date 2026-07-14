import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import ServerCard from '../components/ServerCard';
import type { GameServer } from '../types';
import { useStatusSocket } from '../useStatusSocket';

export default function Dashboard() {
  const { user } = useAuth();
  const [servers, setServers] = useState<GameServer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const { statuses, dockerError } = useStatusSocket(true);

  const load = useCallback(() => {
    api
      .listServers()
      .then((r) => setServers(r.servers))
      .catch((err) => setError(err.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(load, [load]);

  // Merge live WebSocket state into the server list
  const merged = servers.map((s) => {
    const live = statuses.get(s.id);
    return live ? { ...s, state: live.state, statusText: live.statusText } : s;
  });

  return (
    <div>
      <div className="page-head">
        <h1>Dashboard</h1>
        {user?.role === 'admin' && (
          <Link to="/import" className="btn btn-primary">+ Import Server</Link>
        )}
      </div>
      {dockerError && <div className="alert alert-error">{dockerError}</div>}
      {error && <div className="alert alert-error">{error} <button className="btn btn-ghost" onClick={() => { setError(''); load(); }}>Retry</button></div>}
      {loaded && merged.length === 0 && !error && (
        <div className="card empty-state">
          <p>No servers yet.</p>
          {user?.role === 'admin' ? (
            <p className="muted">Import a Docker container to start managing it as a game server.</p>
          ) : (
            <p className="muted">Ask an administrator to give you access to a server.</p>
          )}
        </div>
      )}
      <div className="server-grid">
        {merged.map((s) => (
          <ServerCard key={s.id} server={s} onError={setError} />
        ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import type { GameServer, UnifiConfigView, UnifiRule } from '../types';

export default function UnifiSettings() {
  const [cfg, setCfg] = useState<UnifiConfigView | null>(null);
  const [rules, setRules] = useState<UnifiRule[]>([]);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // form state
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('443');
  const [site, setSite] = useState('default');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verifyTls, setVerifyTls] = useState(false);
  const [graceSeconds, setGraceSeconds] = useState('90');

  const applyConfig = useCallback((c: UnifiConfigView) => {
    setCfg(c);
    setEnabled(!!c.enabled);
    setHost(c.host);
    setPort(String(c.port || 443));
    setSite(c.site || 'default');
    setUsername(c.username);
    setPassword(c.password);
    setVerifyTls(!!c.verify_tls);
    setGraceSeconds(String(c.grace_seconds ?? 90));
  }, []);

  const loadRules = useCallback(() => {
    api.unifiRules().then((r) => setRules(r.rules)).catch(() => {});
  }, []);

  useEffect(() => {
    api.getUnifiConfig().then((r) => {
      applyConfig(r.config);
      if (r.config.enabled && r.config.host) loadRules();
    }).catch((err) => setError(err.message));
    api.listServers().then((r) => setServers(r.servers)).catch(() => {});
  }, [applyConfig, loadRules]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api.updateUnifiConfig({
        enabled,
        host,
        port,
        site,
        username,
        password,
        verify_tls: verifyTls,
        grace_seconds: graceSeconds,
      });
      applyConfig(r.config);
      if (!enabled) {
        setNotice('Saved — the integration is off, so no rules will be touched.');
        setRules([]);
      } else if (r.config.connected) {
        setNotice('✅ Saved — connected to the UniFi console.');
        loadRules();
      } else {
        setNotice('Saved, but the console could not be reached — see the error above.');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api.testUnifi();
      applyConfig(r.config);
      setRules(r.rules);
      setNotice(r.ok ? `✅ Connected — found ${r.rules.length} port-forward rule(s).` : '');
      if (!r.ok) setError(r.error || 'Connection failed');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const serverNames = (ids: number[]) =>
    ids.map((id) => servers.find((s) => s.id === id)?.name || `#${id}`).join(', ');

  if (!cfg) return <div className="muted">Loading…</div>;

  const connected = cfg.enabled ? cfg.connected : false;

  return (
    <div>
      <div className="page-head">
        <h1>Port Forwarding</h1>
        {!!cfg.enabled && (
          <span className={`status-badge ${connected ? 'status-running' : 'status-exited'}`}>
            <span className="status-dot" />
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        )}
      </div>

      {!!cfg.enabled && cfg.last_error && <div className="alert alert-error">UniFi error: {cfg.last_error}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      <form onSubmit={save}>
        <div className="card">
          <h2>UniFi console</h2>
          <label className="checkbox-label">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Close port forwards while their game server is stopped
          </label>
          <div className="form-grid">
            <label>
              Console host
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.1" className="mono" />
            </label>
            <label>
              Port
              <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="443" />
            </label>
            <label>
              Site
              <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="default" className="mono" />
            </label>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Local UniFi admin" />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={cfg.password_set ? 'Saved — enter a new password to replace' : 'Local admin password'} />
            </label>
            <label>
              Grace period (seconds)
              <input value={graceSeconds} onChange={(e) => setGraceSeconds(e.target.value)} placeholder="90" />
            </label>
            <label className="checkbox-label span-2">
              <input type="checkbox" checked={verifyTls} onChange={(e) => setVerifyTls(e.target.checked)} />
              Verify TLS certificate (leave off for a local console — UniFi uses a self-signed certificate)
            </label>
          </div>
          <p className="hint">
            Use a <strong>local</strong> UniFi admin account, created under Settings → Admins with "Local access
            only". Ubiquiti cloud/SSO logins are rejected by this API, and the account must{' '}
            <strong>not</strong> have two-factor authentication enabled.
          </p>
          <p className="hint">
            A rule is enabled as soon as its server starts, and disabled once the server has been down for the
            grace period. That window is what keeps a <strong>restart</strong> from ever closing the port —
            the container is back long before it expires. Stops made outside Stormsmith, and crashes, are picked
            up too.
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save & test'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={test} disabled={busy || !cfg.enabled}>
              Test connection
            </button>
          </div>
        </div>
      </form>

      <div className="card">
        <h2>Port-forward rules</h2>
        <p className="hint">
          Every rule on the console. Stormsmith only ever flips the <span className="mono">enabled</span> flag on
          rules you map to a server — it never creates, edits, or deletes rules. Map them on each server's
          Settings tab.
        </p>
        {rules.length === 0 ? (
          <div className="muted">
            {cfg.enabled ? 'No rules loaded — check the connection above.' : 'Enable the integration to load rules.'}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Port</th>
                <th>Forwards to</th>
                <th>State</th>
                <th>Managed by</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || <span className="muted">(unnamed)</span>}</td>
                  <td className="mono">{r.dstPort}{r.proto ? ` / ${r.proto}` : ''}</td>
                  <td className="mono">{r.fwd}{r.fwdPort ? `:${r.fwdPort}` : ''}</td>
                  <td>
                    <span className={`status-badge ${r.enabled ? 'status-running' : 'status-exited'}`}>
                      <span className="status-dot" />
                      {r.enabled ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td>
                    {r.serverIds.length > 0
                      ? serverNames(r.serverIds)
                      : <span className="muted">Not managed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cfg.last_sync && <p className="hint">Last reconciled {new Date(cfg.last_sync).toLocaleString()}.</p>}
      </div>
    </div>
  );
}

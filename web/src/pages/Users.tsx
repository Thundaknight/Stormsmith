import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import CopyButton from '../components/CopyButton';
import { formatRelative } from '../format';
import type { GameServer, InviteLink, Permission, User } from '../types';

type PermKey = 'can_view' | 'can_control' | 'can_rcon' | 'can_configure';

const EMPTY_PERM = (serverId: number): Permission => ({
  server_id: serverId, can_view: false, can_control: false, can_rcon: false, can_configure: false,
});

/** Applies the "control/rcon/configure imply view; unchecking view clears the rest" rule shared by both grids. */
function applyPermRule(cur: Permission, key: PermKey, value: boolean): Permission {
  const updated = { ...cur, [key]: value };
  if ((key === 'can_control' || key === 'can_rcon' || key === 'can_configure') && value) updated.can_view = true;
  if (key === 'can_view' && !value) {
    updated.can_control = false;
    updated.can_rcon = false;
    updated.can_configure = false;
  }
  return updated;
}

function PermissionGrid({ servers, perms, onChange }: {
  servers: GameServer[];
  perms: Map<number, Permission>;
  onChange: (serverId: number, key: PermKey, value: boolean) => void;
}) {
  if (servers.length === 0) return <p className="muted">No servers imported yet.</p>;
  return (
    <>
      <table className="table">
        <thead>
          <tr><th>Server</th><th>View</th><th>Control</th><th>RCON</th><th>Configure</th></tr>
        </thead>
        <tbody>
          {servers.map((s) => {
            const p = perms.get(s.id) || EMPTY_PERM(s.id);
            return (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td><input type="checkbox" checked={p.can_view} onChange={(e) => onChange(s.id, 'can_view', e.target.checked)} /></td>
                <td><input type="checkbox" checked={p.can_control} onChange={(e) => onChange(s.id, 'can_control', e.target.checked)} /></td>
                <td><input type="checkbox" checked={p.can_rcon} onChange={(e) => onChange(s.id, 'can_rcon', e.target.checked)} /></td>
                <td><input type="checkbox" checked={p.can_configure} onChange={(e) => onChange(s.id, 'can_configure', e.target.checked)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">
        View = see status · Control = start/stop/restart/pause · RCON = console + in-game messages ·
        Configure = edit server settings, config file, and mods
      </p>
    </>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Permission editor (existing active users)
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [perms, setPerms] = useState<Map<number, Permission>>(new Map());

  // Onboarding (approving a pending sign-up)
  const [onboardingUser, setOnboardingUser] = useState<User | null>(null);
  const [onboardingRole, setOnboardingRole] = useState<'user' | 'admin'>('user');
  const [onboardingPerms, setOnboardingPerms] = useState<Map<number, Permission>>(new Map());
  const [onboardingBusy, setOnboardingBusy] = useState(false);

  // Invite links (sign up without Discord)
  const [invitingOpen, setInvitingOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<'user' | 'admin'>('user');
  const [invitePerms, setInvitePerms] = useState<Map<number, Permission>>(new Map());
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState('');

  const load = useCallback(() => {
    Promise.all([api.listUsers(), api.listServers(), api.listInvites()])
      .then(([u, s, i]) => {
        setUsers(u.users);
        setServers(s.servers);
        setInvites(i.invites);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const pending = users.filter((u) => u.status === 'pending');
  const active = users.filter((u) => u.status !== 'pending');

  const startOnboarding = (u: User) => {
    setOnboardingUser(u);
    setOnboardingRole('user');
    setOnboardingPerms(new Map());
  };

  const setOnboardingPerm = (serverId: number, key: PermKey, value: boolean) => {
    setOnboardingPerms((prev) => {
      const next = new Map(prev);
      next.set(serverId, applyPermRule(prev.get(serverId) || EMPTY_PERM(serverId), key, value));
      return next;
    });
  };

  const submitOnboarding = async () => {
    if (!onboardingUser) return;
    setOnboardingBusy(true);
    setError('');
    try {
      await api.approveUser(onboardingUser.id, {
        role: onboardingRole,
        permissions: onboardingRole === 'user' ? [...onboardingPerms.values()] : undefined,
      });
      setNotice(`${onboardingUser.username} approved`);
      setOnboardingUser(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setOnboardingBusy(false);
    }
  };

  const reject = async (u: User) => {
    if (!window.confirm(`Reject and remove the pending sign-up for "${u.username}"?`)) return;
    try {
      await api.deleteUser(u.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (u: User) => {
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
    try {
      await api.deleteUser(u.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleRole = async (u: User) => {
    try {
      await api.updateUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const resetPassword = async (u: User) => {
    const password = window.prompt(`New password for "${u.username}" (min 8 characters):`);
    if (!password) return;
    try {
      await api.updateUser(u.id, { password });
      setNotice(`Password updated for ${u.username}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openPermissions = async (u: User) => {
    setEditingUser(u);
    try {
      const r = await api.getUserPermissions(u.id);
      setPerms(new Map(r.permissions.map((p) => [
        p.server_id,
        {
          server_id: p.server_id, can_view: !!p.can_view, can_control: !!p.can_control,
          can_rcon: !!p.can_rcon, can_configure: !!p.can_configure,
        },
      ])));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const setPerm = (serverId: number, key: PermKey, value: boolean) => {
    setPerms((prev) => {
      const next = new Map(prev);
      next.set(serverId, applyPermRule(prev.get(serverId) || EMPTY_PERM(serverId), key, value));
      return next;
    });
  };

  const savePermissions = async () => {
    if (!editingUser) return;
    try {
      await api.setUserPermissions(editingUser.id, [...perms.values()]);
      setNotice(`Permissions saved for ${editingUser.username}`);
      setEditingUser(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startInvite = () => {
    setInvitingOpen(true);
    setInviteRole('user');
    setInvitePerms(new Map());
    setInviteLink('');
  };

  const setInvitePerm = (serverId: number, key: PermKey, value: boolean) => {
    setInvitePerms((prev) => {
      const next = new Map(prev);
      next.set(serverId, applyPermRule(prev.get(serverId) || EMPTY_PERM(serverId), key, value));
      return next;
    });
  };

  const submitInvite = async () => {
    setInviteBusy(true);
    setError('');
    try {
      const r = await api.createInvite(inviteRole, inviteRole === 'user' ? [...invitePerms.values()] : undefined);
      setInviteLink(`${window.location.origin}/invite/${r.token}`);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setInviteBusy(false);
    }
  };

  const revokeInvite = async (token: string) => {
    try {
      await api.revokeInvite(token);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-head"><h1>Users</h1></div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok" onAnimationEnd={() => setNotice('')}>{notice}</div>}

      <div className="card">
        <h2>How people get an account</h2>
        <p className="muted">
          The only manually-created account is the initial admin. Everyone else either signs up with Discord and
          lands below awaiting your approval, or gets an invite link below — no Discord required.
        </p>
      </div>

      <div className="card">
        <h2>Invite links</h2>
        <p className="muted">
          Generate a one-time link for someone to create their own username and password — no Discord needed. Role
          and access are set now, the same as approving a Discord sign-up. Expires in 24 hours or as soon as it's used.
        </p>
        <button className="btn btn-primary" onClick={startInvite}>Generate Invite Link</button>
        {invites.length > 0 && (
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>Role</th><th>Expires</th><th></th></tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.token}>
                  <td><span className={`role-badge role-${i.role}`}>{i.role}</span></td>
                  <td className="muted">{formatRelative(i.expiresAt)}</td>
                  <td className="table-actions">
                    <CopyButton text={`${window.location.origin}/invite/${i.token}`} title="Copy invite link" />
                    <button className="btn btn-small btn-danger-outline" onClick={() => revokeInvite(i.token)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pending.length > 0 && (
        <div className="card">
          <h2>Pending approval ({pending.length})</h2>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Discord</th><th></th></tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td className="muted">{u.discord_username || '—'}</td>
                  <td className="table-actions">
                    <button className="btn btn-small btn-primary" onClick={() => startOnboarding(u)}>Approve</button>
                    <button className="btn btn-small btn-danger-outline" onClick={() => reject(u)}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>All users</h2>
        <table className="table">
          <thead>
            <tr><th>Username</th><th>Role</th><th>Discord</th><th></th></tr>
          </thead>
          <tbody>
            {active.map((u) => (
              <tr key={u.id}>
                <td>{u.username}{u.id === me?.id && <span className="muted"> (you)</span>}</td>
                <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
                <td className="muted">{u.discord_username || '—'}</td>
                <td className="table-actions">
                  {u.role === 'user' && (
                    <button className="btn btn-small" onClick={() => openPermissions(u)}>Permissions</button>
                  )}
                  {u.id !== me?.id && (
                    <button className="btn btn-small" onClick={() => toggleRole(u)}>
                      {u.role === 'admin' ? 'Make user' : 'Make admin'}
                    </button>
                  )}
                  <button className="btn btn-small" onClick={() => resetPassword(u)}>Reset password</button>
                  {u.id !== me?.id && (
                    <button className="btn btn-small btn-danger-outline" onClick={() => remove(u)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Admins can manage everything. Users only see servers you grant below.</p>
      </div>

      {onboardingUser && (
        <div className="modal-backdrop" onClick={() => setOnboardingUser(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>Approve {onboardingUser.username}</h2>
            <p className="muted">
              Choose this account's role and, if it's a regular user, what it can access before letting it in.
            </p>
            <div className="checkbox-row" style={{ marginBottom: 14 }}>
              <label className="checkbox-label">
                <input type="radio" name="onboard-role" checked={onboardingRole === 'user'} onChange={() => setOnboardingRole('user')} />
                User — granular per-server access
              </label>
              <label className="checkbox-label">
                <input type="radio" name="onboard-role" checked={onboardingRole === 'admin'} onChange={() => setOnboardingRole('admin')} />
                Admin — full access to everything
              </label>
            </div>
            {onboardingRole === 'user' && (
              <PermissionGrid servers={servers} perms={onboardingPerms} onChange={setOnboardingPerm} />
            )}
            <div className="btn-row">
              <button className="btn btn-primary" disabled={onboardingBusy} onClick={submitOnboarding}>
                {onboardingBusy ? 'Approving…' : 'Approve'}
              </button>
              <button className="btn" onClick={() => setOnboardingUser(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="modal-backdrop" onClick={() => setEditingUser(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>Permissions — {editingUser.username}</h2>
            <PermissionGrid servers={servers} perms={perms} onChange={setPerm} />
            <div className="btn-row">
              <button className="btn btn-primary" onClick={savePermissions}>Save</button>
              <button className="btn" onClick={() => setEditingUser(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {invitingOpen && (
        <div className="modal-backdrop" onClick={() => setInvitingOpen(false)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>Generate Invite Link</h2>
            {inviteLink ? (
              <>
                <div className="alert alert-ok">
                  <div>Share this link with the invitee — it works once, for one person.</div>
                  <div className="inline-form" style={{ marginTop: 6 }}>
                    <input className="mono" value={inviteLink} readOnly onFocus={(e) => e.target.select()} />
                    <CopyButton text={inviteLink} />
                  </div>
                </div>
                <div className="btn-row">
                  <button className="btn" onClick={() => setInvitingOpen(false)}>Done</button>
                </div>
              </>
            ) : (
              <>
                <p className="muted">
                  Choose this account's role and, if it's a regular user, what it can access — the invitee can't
                  change these themselves.
                </p>
                <div className="checkbox-row" style={{ marginBottom: 14 }}>
                  <label className="checkbox-label">
                    <input type="radio" name="invite-role" checked={inviteRole === 'user'} onChange={() => setInviteRole('user')} />
                    User — granular per-server access
                  </label>
                  <label className="checkbox-label">
                    <input type="radio" name="invite-role" checked={inviteRole === 'admin'} onChange={() => setInviteRole('admin')} />
                    Admin — full access to everything
                  </label>
                </div>
                {inviteRole === 'user' && (
                  <PermissionGrid servers={servers} perms={invitePerms} onChange={setInvitePerm} />
                )}
                <div className="btn-row">
                  <button className="btn btn-primary" disabled={inviteBusy} onClick={submitInvite}>
                    {inviteBusy ? 'Generating…' : 'Generate Link'}
                  </button>
                  <button className="btn" onClick={() => setInvitingOpen(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

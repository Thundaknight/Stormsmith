import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { GameServer, Permission, User } from '../types';

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // New-user form
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  const [creating, setCreating] = useState(false);

  // Permission editor
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [perms, setPerms] = useState<Map<number, Permission>>(new Map());

  const load = useCallback(() => {
    Promise.all([api.listUsers(), api.listServers()])
      .then(([u, s]) => {
        setUsers(u.users);
        setServers(s.servers);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      await api.createUser(newUser.username, newUser.password, newUser.role);
      setNewUser({ username: '', password: '', role: 'user' });
      setNotice('User created');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
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
        { server_id: p.server_id, can_view: !!p.can_view, can_control: !!p.can_control, can_rcon: !!p.can_rcon },
      ])));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const setPerm = (serverId: number, key: 'can_view' | 'can_control' | 'can_rcon', value: boolean) => {
    setPerms((prev) => {
      const next = new Map(prev);
      const cur = next.get(serverId) || { server_id: serverId, can_view: false, can_control: false, can_rcon: false };
      const updated = { ...cur, [key]: value };
      // control/rcon imply view
      if ((key === 'can_control' || key === 'can_rcon') && value) updated.can_view = true;
      if (key === 'can_view' && !value) {
        updated.can_control = false;
        updated.can_rcon = false;
      }
      next.set(serverId, updated);
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

  return (
    <div>
      <div className="page-head"><h1>Users</h1></div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok" onAnimationEnd={() => setNotice('')}>{notice}</div>}

      <div className="card">
        <h2>Add user</h2>
        <form className="inline-form" onSubmit={create}>
          <input
            placeholder="Username"
            value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            required
          />
          <input
            placeholder="Password (min 8 chars)"
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            minLength={8}
            required
          />
          <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn btn-primary" disabled={creating}>Add</button>
        </form>
      </div>

      <div className="card">
        <h2>All users</h2>
        <table className="table">
          <thead>
            <tr><th>Username</th><th>Role</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}{u.id === me?.id && <span className="muted"> (you)</span>}</td>
                <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
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

      {editingUser && (
        <div className="modal-backdrop" onClick={() => setEditingUser(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>Permissions — {editingUser.username}</h2>
            {servers.length === 0 && <p className="muted">No servers imported yet.</p>}
            <table className="table">
              <thead>
                <tr><th>Server</th><th>View</th><th>Control</th><th>RCON</th></tr>
              </thead>
              <tbody>
                {servers.map((s) => {
                  const p = perms.get(s.id) || { server_id: s.id, can_view: false, can_control: false, can_rcon: false };
                  return (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td><input type="checkbox" checked={p.can_view} onChange={(e) => setPerm(s.id, 'can_view', e.target.checked)} /></td>
                      <td><input type="checkbox" checked={p.can_control} onChange={(e) => setPerm(s.id, 'can_control', e.target.checked)} /></td>
                      <td><input type="checkbox" checked={p.can_rcon} onChange={(e) => setPerm(s.id, 'can_rcon', e.target.checked)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted">View = see status · Control = start/stop/restart/pause · RCON = console + in-game messages</p>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={savePermissions}>Save</button>
              <button className="btn" onClick={() => setEditingUser(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

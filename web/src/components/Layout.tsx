import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth';

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">⚡</span>
          <span>Stormsmith</span>
        </div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          {user?.role === 'admin' && (
            <>
              <NavLink to="/import">Import Server</NavLink>
              <NavLink to="/users">Users</NavLink>
              <NavLink to="/discord">Discord Bot</NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="user-name">{user?.username}</span>
            <span className={`role-badge role-${user?.role}`}>{user?.role}</span>
          </div>
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

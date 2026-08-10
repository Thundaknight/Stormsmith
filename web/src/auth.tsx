import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, clearToken, getToken, setToken } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  /** Finishes a Discord OAuth login: a token was already issued by the backend redirect. */
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadFromToken = useCallback(async () => {
    const r = await api.me();
    setUser({ id: r.user.userId, username: r.user.username, role: r.user.role as User['role'] });
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    loadFromToken()
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, [loadFromToken]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.login(username, password);
    setToken(r.token);
    setUser(r.user);
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const r = await api.setup(username, password);
    setToken(r.token);
    setUser(r.user);
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    setToken(token);
    await loadFromToken();
  }, [loadFromToken]);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, setup, loginWithToken, logout }),
    [user, loading, login, setup, loginWithToken, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

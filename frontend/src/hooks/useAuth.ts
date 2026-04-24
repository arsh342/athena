import { useEffect, useState } from 'react';
import { fetchAuthMe, logout, refreshAuth } from '../services/api';
import type { AuthUser } from '../types';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadUser(): Promise<void> {
    try {
      const me = await fetchAuthMe();
      setUser(me);
    } catch {
      try {
        const refreshed = await refreshAuth();
        setUser(refreshed);
      } catch {
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUser();
  }, []);

  async function refresh(): Promise<void> {
    setIsLoading(true);
    await loadUser();
  }

  async function signOut(): Promise<void> {
    await logout().catch(() => undefined);
    setUser(null);
  }

  return {
    isAuthenticated: user !== null,
    isLoading,
    user,
    refresh,
    signOut,
  };
}

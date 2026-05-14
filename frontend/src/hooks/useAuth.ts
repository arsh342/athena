import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import { fetchAuthMe, login, logout, refreshAuth, register } from '../services/api';
import { authReducer, initialAuthState } from '../auth/auth-store';
import type { AuthUser } from '../types';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  const bootstrap = useCallback(async (): Promise<void> => {
    dispatch({ type: 'BOOTSTRAP_START' });
    try {
      const me = await fetchAuthMe();
      dispatch({ type: 'BOOTSTRAP_DONE', user: me });
      return;
    } catch {
      try {
        const refreshed = await refreshAuth();
        dispatch({ type: 'BOOTSTRAP_DONE', user: refreshed });
      } catch {
        dispatch({ type: 'BOOTSTRAP_DONE', user: null });
      }
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const value = useMemo<AuthState>(() => ({
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    user: state.user,
    signIn: async (email: string, password: string) => {
      const user = await login(email, password);
      dispatch({ type: 'SIGNED_IN', user });
    },
    signUp: async (email: string, password: string) => {
      const user = await register(email, password);
      dispatch({ type: 'SIGNED_IN', user });
    },
    refresh: bootstrap,
    signOut: async () => {
      await logout();
      dispatch({ type: 'SIGNED_OUT' });
    },
  }), [bootstrap, state.isAuthenticated, state.isLoading, state.user]);

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

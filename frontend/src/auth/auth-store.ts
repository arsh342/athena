import type { AuthUser } from '../types';

export interface AuthStateModel {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export type AuthAction =
  | { type: 'BOOTSTRAP_START' }
  | { type: 'BOOTSTRAP_DONE'; user: AuthUser | null }
  | { type: 'SIGNED_IN'; user: AuthUser }
  | { type: 'SIGNED_OUT' };

export const initialAuthState: AuthStateModel = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
};

export function authReducer(state: AuthStateModel, action: AuthAction): AuthStateModel {
  switch (action.type) {
    case 'BOOTSTRAP_START':
      return { ...state, isLoading: true };
    case 'BOOTSTRAP_DONE':
      return { user: action.user, isAuthenticated: action.user !== null, isLoading: false };
    case 'SIGNED_IN':
      return { user: action.user, isAuthenticated: true, isLoading: false };
    case 'SIGNED_OUT':
      return { user: null, isAuthenticated: false, isLoading: false };
    default:
      return state;
  }
}

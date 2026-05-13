# Auth Navbar Reactive State Design

## Goal

Fix auth UX bug where navbar still shows `LOGIN` after successful login/register until manual page refresh.

Target behavior:
- navbar updates immediately after login/register/logout/refresh
- protected routes read same up-to-date auth state
- no forced page refresh

## Scope

In scope:
- frontend auth state architecture cleanup
- shared auth source for navbar, route guards, login/register pages
- immediate state transitions for sign-in/sign-up/sign-out
- deterministic init and refresh behavior

Out of scope:
- backend auth API contract changes
- token model redesign
- role-based authorization
- new auth UI design

## Problem Summary

Current flow uses auth checks in multiple places with inconsistent timing. Login/register call API directly, while navbar/guards rely on separate auth reads. This splits source of truth and causes stale navbar state until hard reload.

## Approaches Considered

1. **AuthContext provider (recommended)**
2. Event bus patch (`window` events + local refetch)
3. Route-triggered refetch

Chosen approach: **AuthContext provider**, because it gives single reactive source of truth and removes race/stale states.

## Architecture

Create centralized auth state in `AuthProvider`:

- `user: AuthUser | null`
- `isLoading: boolean`
- `isAuthenticated: boolean`
- actions:
  - `signIn(email, password)`
  - `signUp(email, password)`
  - `signOut()`
  - `refresh()`
  - `revalidate()`

`useAuth()` becomes a context consumer only. It does not own independent fetch-side effects anymore.

`main.tsx` wraps app with `AuthProvider`, so all auth-aware components subscribe to same state.

## Data Flow

### App init
1. Provider starts `isLoading=true`.
2. Calls `fetchAuthMe`.
3. If unauthorized, calls `refreshAuth`.
4. Sets final `{ user, isAuthenticated, isLoading=false }`.

### Login
1. `Login` calls `signIn`.
2. API success returns user.
3. Provider sets `user` immediately.
4. Navbar and route guards re-render instantly.

### Register
1. `Register` calls `signUp`.
2. Provider sets user immediately on success.
3. Navbar and route guards update same tick.

### Logout
1. `Navbar` calls `signOut`.
2. Provider clears user immediately after API completes.
3. Navbar switches back to `LOGIN` without refresh.

### Refresh/revalidate
- Any auth-sensitive path can call `revalidate` / `refresh`.
- Provider updates shared state once, centrally.

## Component Change Plan

- `frontend/src/hooks/useAuth.tsx`
  - convert to context-backed hook + provider
  - export provider and hook API
- `frontend/src/main.tsx`
  - wrap router/app with `AuthProvider`
- `frontend/src/components/Navbar.tsx`
  - consume provider state/actions only
- `frontend/src/components/ProtectedRoute.tsx`
  - read provider `isLoading` and `isAuthenticated`
- `frontend/src/pages/Login.tsx`
  - use `signIn` from context
- `frontend/src/pages/Register.tsx`
  - use `signUp` from context

## Error Handling

- Provider init fallback:
  - if both `fetchAuthMe` and `refreshAuth` fail, resolve to unauthenticated state
- `signIn/signUp/signOut` errors are thrown back to page handlers
- no silent auth failures
- keep existing user-facing error copy in pages

## Testing

Add/update frontend tests for:

1. login updates auth state immediately (no reload)
2. navbar switches from `LOGIN` to authenticated nav after `signIn`
3. register path updates navbar immediately
4. logout flips navbar back immediately
5. protected route honors provider loading gate to avoid flicker

## Risks

- Provider migration may break components expecting old hook behavior
- Initialization ordering can cause temporary flicker if loading gate not respected

Mitigation:
- keep explicit `isLoading` guard in `ProtectedRoute`
- migrate all known auth consumers in same change

## Acceptance Criteria

- after successful login, navbar instantly shows authenticated buttons
- after register, same instant navbar update
- after logout, navbar instantly shows `LOGIN`
- no manual page refresh required for auth nav state
- frontend tests covering immediate navbar/auth transitions pass

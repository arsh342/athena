# Supabase Auth + DB Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move backend auth and database persistence to Supabase-backed infrastructure (with rollback flag) and fix frontend navbar auth reactivity without changing existing API routes.

**Architecture:** Keep `/api/auth/*` and `/api/scans*` contracts stable. Add provider selection (`legacy` vs `supabase`) in backend auth, continue using PostgreSQL query layer (pointed at Supabase Postgres in phase 1), and enforce user-scoped reads/writes. On frontend, replace per-component `useAuth()` state with one `AuthProvider` context shared by navbar, guarded routes, and auth pages.

**Tech Stack:** TypeScript, Express, PostgreSQL (`pg`), Supabase JS (`@supabase/supabase-js`), React context/hooks, Node test runner (`node --import tsx --test`).

---

## Scope Check

This spec touches two areas (backend auth/data and frontend auth state), but they are tightly coupled by one acceptance criterion: auth transitions must immediately reflect in navbar while backend stays contract-compatible. One plan is appropriate.

## File Structure Map

- `backend/src/supabase.ts` (create) — provider parsing and Supabase client bootstrap.
- `backend/src/auth-supabase.ts` (create) — Supabase auth handler implementations + local user sync.
- `backend/src/auth.ts` (modify) — provider switch wrapper; keep legacy handlers intact.
- `backend/src/db.ts` (modify) — schema updates for Supabase identity mapping.
- `backend/src/scanner.ts` (modify) — persist scans against authenticated user when provided.
- `backend/src/server.ts` (modify) — use user-scoped data access and pass user to scanner.
- `backend/package.json` (modify) — add `@supabase/supabase-js`.
- `backend/test/supabase.test.ts` (create) — provider/client bootstrap tests.
- `backend/test/auth-supabase.test.ts` (create) — Supabase auth handler contract tests (status/payload).
- `backend/test/server-user-scope.test.ts` (create) — route-level user scoping tests via `createApp`.
- `frontend/src/auth/auth-store.ts` (create) — pure auth reducer/state transitions.
- `frontend/src/hooks/useAuth.ts` (modify) — `AuthProvider` + `useAuth` context consumer.
- `frontend/src/main.tsx` (modify) — app root wrapper with `AuthProvider`.
- `frontend/src/components/Navbar.tsx` (modify) — shared auth context usage.
- `frontend/src/components/ProtectedRoute.tsx` (modify) — shared auth loading/auth gate.
- `frontend/src/pages/Login.tsx` (modify) — call context `signIn`.
- `frontend/src/pages/Register.tsx` (modify) — call context `signUp`.
- `frontend/test/auth-store.test.ts` (create) — frontend auth state transition tests.
- `docs/supabase/schema.sql` (create) — canonical Supabase schema/RLS bootstrap for phase 1.
- `backend/.env.example` (modify) — Supabase env keys and provider flag.
- `docs/SYSTEM_DESIGN.md` (modify), `docs/TECH_STACK.md` (modify) — architecture + stack updates.

---

### Task 1: Add Supabase provider + client bootstrap

**Files:**
- Create: `backend/src/supabase.ts`
- Modify: `backend/package.json`
- Test: `backend/test/supabase.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/supabase.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClients, getAuthProvider, isSupabaseProvider } from '../src/supabase.ts';

test('getAuthProvider defaults to legacy', () => {
  assert.equal(getAuthProvider(undefined), 'legacy');
});

test('isSupabaseProvider returns true only for supabase', () => {
  assert.equal(isSupabaseProvider('supabase'), true);
  assert.equal(isSupabaseProvider('legacy'), false);
  assert.equal(isSupabaseProvider(undefined), false);
});

test('createSupabaseClients throws when required env vars are missing', () => {
  const snapshot = { ...process.env };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert.throws(() => createSupabaseClients(), /SUPABASE_URL/);
  process.env = snapshot;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/supabase.test.ts`  
Expected: FAIL with module not found for `../src/supabase.ts`.

- [ ] **Step 3: Implement module + dependency**

```ts
// backend/src/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AuthProvider = 'legacy' | 'supabase';

export function getAuthProvider(raw: string | undefined = process.env.AUTH_PROVIDER): AuthProvider {
  return String(raw ?? '').trim().toLowerCase() === 'supabase' ? 'supabase' : 'legacy';
}

export function isSupabaseProvider(raw: string | undefined = process.env.AUTH_PROVIDER): boolean {
  return getAuthProvider(raw) === 'supabase';
}

function required(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when AUTH_PROVIDER=supabase`);
  return value;
}

let cached: { anon: SupabaseClient; service: SupabaseClient } | null = null;

export function createSupabaseClients(): { anon: SupabaseClient; service: SupabaseClient } {
  if (cached) return cached;
  const url = required('SUPABASE_URL');
  const anonKey = required('SUPABASE_ANON_KEY');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');

  cached = {
    anon: createClient(url, anonKey, { auth: { persistSession: false } }),
    service: createClient(url, serviceRoleKey, { auth: { persistSession: false } }),
  };
  return cached;
}
```

```json
// backend/package.json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0"
  }
}
```

Run: `npm install -w @athena/backend @supabase/supabase-js`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @athena/backend -- test/supabase.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/supabase.ts backend/test/supabase.test.ts backend/package.json package-lock.json
git commit -m "feat(backend): add supabase provider and client bootstrap"
```

---

### Task 2: Add Supabase auth handlers with local user sync

**Files:**
- Create: `backend/src/auth-supabase.ts`
- Modify: `backend/src/db.ts`
- Test: `backend/test/auth-supabase.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/auth-supabase.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createSupabaseAuthHandlers } from '../src/auth-supabase.ts';

function createMockResponse() {
  const state: { statusCode: number; jsonBody: unknown; cookies: Array<{ name: string; value: string }> } = {
    statusCode: 200,
    jsonBody: null,
    cookies: [],
  };

  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.jsonBody = body;
      return this;
    },
    cookie(name: string, value: string) {
      state.cookies.push({ name, value });
      return this;
    },
    clearCookie() {
      return this;
    },
  } as unknown as Response;

  return { res, state };
}

test('register maps success to 201 and stable payload shape', async () => {
  const handlers = createSupabaseAuthHandlers({
    register: async () => ({
      userId: 'supa-uid-1',
      email: 'dev@athena.dev',
      accessToken: 'access',
      refreshToken: 'refresh',
    }),
    login: async () => {
      throw new Error('unused');
    },
    refresh: async () => {
      throw new Error('unused');
    },
    me: async () => null,
    logout: async () => undefined,
    upsertLocalUser: async () => ({ id: 17, email: 'dev@athena.dev' }),
  });

  const req = { body: { email: 'dev@athena.dev', password: 'password123' }, cookies: {} } as Request;
  const { res, state } = createMockResponse();

  await handlers.registerUser(req, res);
  assert.equal(state.statusCode, 201);
  assert.deepEqual(state.jsonBody, { user: { id: 17, email: 'dev@athena.dev' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/auth-supabase.test.ts`  
Expected: FAIL with module not found for `../src/auth-supabase.ts`.

- [ ] **Step 3: Implement handler module and user-sync schema support**

```ts
// backend/src/auth-supabase.ts
import type { Request, Response } from 'express';

const ACCESS_COOKIE = 'athena_access_token';
const REFRESH_COOKIE = 'athena_refresh_token';

export interface LocalAuthUser {
  id: number;
  email: string;
}

export interface SupabaseAuthDeps {
  register: (email: string, password: string) => Promise<{ userId: string; email: string; accessToken: string; refreshToken: string }>;
  login: (email: string, password: string) => Promise<{ userId: string; email: string; accessToken: string; refreshToken: string }>;
  refresh: (refreshToken: string) => Promise<{ userId: string; email: string; accessToken: string; refreshToken: string } | null>;
  me: (accessToken: string) => Promise<{ userId: string; email: string } | null>;
  logout: (accessToken: string, refreshToken: string) => Promise<void>;
  upsertLocalUser: (supabaseUserId: string, email: string) => Promise<LocalAuthUser>;
}

function setSupabaseCookies(res: Response, accessToken: string, refreshToken: string): void {
  const secure = String(process.env.AUTH_COOKIE_SECURE ?? '').trim().toLowerCase() === 'true';
  const sameSite = secure ? 'strict' : 'lax';
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
  const base = { httpOnly: true, secure, sameSite, path: '/', domain } as const;
  res.cookie(ACCESS_COOKIE, accessToken, base);
  res.cookie(REFRESH_COOKIE, refreshToken, base);
}

function clearCookies(res: Response): void {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
  res.clearCookie(ACCESS_COOKIE, { path: '/', domain });
  res.clearCookie(REFRESH_COOKIE, { path: '/', domain });
}

export function createSupabaseAuthHandlers(deps: SupabaseAuthDeps) {
  return {
    async registerUser(req: Request, res: Response): Promise<void> {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!email || password.length < 8) {
        res.status(400).json({ error: 'Valid email and password with 8+ characters are required.' });
        return;
      }
      const session = await deps.register(email, password);
      const localUser = await deps.upsertLocalUser(session.userId, session.email);
      setSupabaseCookies(res, session.accessToken, session.refreshToken);
      res.status(201).json({ user: localUser });
    },

    async loginUser(req: Request, res: Response): Promise<void> {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }
      const session = await deps.login(email, password);
      const localUser = await deps.upsertLocalUser(session.userId, session.email);
      setSupabaseCookies(res, session.accessToken, session.refreshToken);
      res.json({ user: localUser });
    },

    async refreshSession(req: Request, res: Response): Promise<void> {
      const refreshToken = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();
      if (!refreshToken) {
        res.status(401).json({ error: 'Missing refresh token.' });
        return;
      }
      const session = await deps.refresh(refreshToken);
      if (!session) {
        clearCookies(res);
        res.status(401).json({ error: 'Invalid refresh token.' });
        return;
      }
      const localUser = await deps.upsertLocalUser(session.userId, session.email);
      setSupabaseCookies(res, session.accessToken, session.refreshToken);
      res.json({ user: localUser });
    },

    async getAuthenticatedUser(req: Request): Promise<LocalAuthUser | null> {
      const accessToken = String(req.cookies?.[ACCESS_COOKIE] ?? '').trim();
      if (!accessToken) return null;
      const identity = await deps.me(accessToken);
      if (!identity) return null;
      return deps.upsertLocalUser(identity.userId, identity.email);
    },

    async logoutUser(req: Request, res: Response): Promise<void> {
      const accessToken = String(req.cookies?.[ACCESS_COOKIE] ?? '').trim();
      const refreshToken = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();
      await deps.logout(accessToken, refreshToken);
      clearCookies(res);
      res.json({ ok: true });
    },
  };
}
```

```ts
// backend/src/db.ts (inside ensureAuthSchema)
await db.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS supabase_user_id TEXT UNIQUE;
`);

await db.query(`
  CREATE INDEX IF NOT EXISTS idx_users_supabase_user_id
  ON users(supabase_user_id);
`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @athena/backend -- test/auth-supabase.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth-supabase.ts backend/src/db.ts backend/test/auth-supabase.test.ts
git commit -m "feat(auth): add supabase auth handlers and local user sync"
```

---

### Task 3: Wire auth.ts provider switch and preserve legacy fallback

**Files:**
- Modify: `backend/src/auth.ts`
- Test: `backend/test/auth-supabase.test.ts` (extend)

- [ ] **Step 1: Write failing provider-switch test**

```ts
// append to backend/test/auth-supabase.test.ts
import { shouldUseSupabaseAuth } from '../src/auth.ts';

test('shouldUseSupabaseAuth follows AUTH_PROVIDER env', () => {
  const snapshot = process.env.AUTH_PROVIDER;
  process.env.AUTH_PROVIDER = 'supabase';
  assert.equal(shouldUseSupabaseAuth(), true);
  process.env.AUTH_PROVIDER = 'legacy';
  assert.equal(shouldUseSupabaseAuth(), false);
  process.env.AUTH_PROVIDER = snapshot;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/auth-supabase.test.ts`  
Expected: FAIL with missing export `shouldUseSupabaseAuth`.

- [ ] **Step 3: Implement provider switching in auth.ts**

```ts
// backend/src/auth.ts (imports)
import { createSupabaseClients, isSupabaseProvider } from './supabase.js';
import { createSupabaseAuthHandlers } from './auth-supabase.js';
```

```ts
// backend/src/auth.ts (add)
export function shouldUseSupabaseAuth(): boolean {
  return isSupabaseProvider();
}
```

```ts
// backend/src/auth.ts (real Supabase deps)
const supabaseClients = createSupabaseClients;

const supabaseHandlers = createSupabaseAuthHandlers({
  async register(email, password) {
    const { service } = supabaseClients();
    const result = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error || !result.data.user) {
      throw new Error(result.error?.message ?? 'Could not create account.');
    }
    const loginResult = await service.auth.signInWithPassword({ email, password });
    if (loginResult.error || !loginResult.data.session) {
      throw new Error(loginResult.error?.message ?? 'Could not create session.');
    }
    return {
      userId: result.data.user.id,
      email: result.data.user.email ?? email,
      accessToken: loginResult.data.session.access_token,
      refreshToken: loginResult.data.session.refresh_token,
    };
  },
  async login(email, password) {
    const { anon } = supabaseClients();
    const result = await anon.auth.signInWithPassword({ email, password });
    if (result.error || !result.data.session || !result.data.user) {
      throw new Error('Invalid credentials.');
    }
    return {
      userId: result.data.user.id,
      email: result.data.user.email ?? email,
      accessToken: result.data.session.access_token,
      refreshToken: result.data.session.refresh_token,
    };
  },
  async refresh(refreshToken) {
    const { anon } = supabaseClients();
    const result = await anon.auth.refreshSession({ refresh_token: refreshToken });
    if (result.error || !result.data.session || !result.data.user) return null;
    return {
      userId: result.data.user.id,
      email: result.data.user.email ?? '',
      accessToken: result.data.session.access_token,
      refreshToken: result.data.session.refresh_token,
    };
  },
  async me(accessToken) {
    const { service } = supabaseClients();
    const result = await service.auth.getUser(accessToken);
    if (result.error || !result.data.user) return null;
    return {
      userId: result.data.user.id,
      email: result.data.user.email ?? '',
    };
  },
  async logout() {
    return;
  },
  async upsertLocalUser(supabaseUserId, email) {
    const result = await db.query<{ id: number; email: string }>(
      `
        INSERT INTO users (email, password_hash, supabase_user_id)
        VALUES ($1, 'supabase-managed', $2)
        ON CONFLICT (email)
        DO UPDATE SET supabase_user_id = EXCLUDED.supabase_user_id
        RETURNING id, email
      `,
      [email, supabaseUserId],
    );
    return result.rows[0];
  },
});
```

```ts
// backend/src/auth.ts (switch wrappers)
export async function getAuthenticatedUser(req: Request): Promise<AuthUser | null> {
  if (shouldUseSupabaseAuth()) return supabaseHandlers.getAuthenticatedUser(req);
  return findUserByAccessToken(String(req.cookies?.[ACCESS_COOKIE] ?? '').trim());
}

export async function registerUser(req: Request, res: Response): Promise<void> {
  if (shouldUseSupabaseAuth()) {
    await supabaseHandlers.registerUser(req, res);
    return;
  }
  // existing legacy register body remains unchanged below
}
```

Apply the same guard pattern to `loginUser`, `refreshSession`, and `logoutUser`.

- [ ] **Step 4: Run backend auth and store tests**

Run: `npm test -w @athena/backend -- test/auth-supabase.test.ts test/scan-store.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth.ts backend/test/auth-supabase.test.ts
git commit -m "feat(auth): gate legacy and supabase auth by provider flag"
```

---

### Task 4: Enforce user-scoped scan persistence and route reads

**Files:**
- Modify: `backend/src/server.ts`
- Modify: `backend/src/scanner.ts`
- Create: `backend/test/server-user-scope.test.ts`

- [ ] **Step 1: Write failing route scoping test**

```ts
// backend/test/server-user-scope.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';

test('GET /api/scans passes authenticated user id to getScans', async (t) => {
  let capturedUserId = -1;

  const app = createApp({
    ensureAuthSchema: async () => undefined,
    auth: {
      getAuthenticatedUser: async () => ({ id: 42, email: 'dev@athena.dev' }),
      registerUser: async () => undefined,
      loginUser: async () => undefined,
      refreshSession: async () => undefined,
      logoutUser: async () => undefined,
    },
    data: {
      getScans: async (userId: number) => {
        capturedUserId = userId;
        return [];
      },
      getScan: async () => undefined,
      getFindings: async () => [],
      getFindingsByScanId: async () => [],
      getLandingContent: () => ({ integrations: [], features: [], stats: [] }),
      getPipelineStages: () => [],
      landingPipelineLines: [],
    },
    scan: {
      runScan: async () => ({ scan: {} as never, findings: [], terminalLines: [] }),
    },
    repo: {
      validateRepoUrl: () => ({ ok: true as const, value: 'https://github.com/org/repo' }),
    },
  });

  const server = app.listen(0);
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/scans`);
  const body = await response.json() as { scans: unknown[] };

  assert.equal(response.status, 200);
  assert.equal(capturedUserId, 42);
  assert.deepEqual(body.scans, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/server-user-scope.test.ts`  
Expected: FAIL because `createApp` is not exported and routes are not dependency-injectable.

- [ ] **Step 3: Implement user-scoped wiring**

```ts
// backend/src/scanner.ts
export async function runScan(repoUrl: string, userId?: number): Promise<ScanResult> {
  const normalizedUrl = repoUrl.trim();
  const repoName = parseRepoName(normalizedUrl);
  const scanId = `scan_${repoName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}_${Date.now().toString(36).slice(-6)}`;
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);

  log(`$ athena scan ${normalizedUrl}`);
  log('Validating repository URL');

  // existing clone + scan flow remains unchanged
  if (typeof userId === 'number') {
    await addScan(userId, scanSummary, allFindings);
  } else {
    addScan(scanSummary, allFindings);
  }
  return { scan: scanSummary, findings: allFindings, terminalLines: lines };
}
```

```ts
// backend/src/server.ts (route corrections)
res.json({ scans: await getScans(user.id) });

const scan = await getScan(scanId, user.id);
res.json({ scan });

res.json({ findings: await getFindingsByScanId(scanId, user.id) });
res.json({ findings: await getFindings(user.id) });

const result = await runScan(validated.value, user.id);
```

```ts
// backend/src/server.ts (export app factory)
export interface ServerDeps {
  ensureAuthSchema: () => Promise<void>;
  auth: {
    getAuthenticatedUser: typeof getAuthenticatedUser;
    registerUser: typeof registerUser;
    loginUser: typeof loginUser;
    refreshSession: typeof refreshSession;
    logoutUser: typeof logoutUser;
  };
  data: {
    getScans: typeof getScans;
    getScan: typeof getScan;
    getFindings: typeof getFindings;
    getFindingsByScanId: typeof getFindingsByScanId;
    getLandingContent: typeof getLandingContent;
    getPipelineStages: typeof getPipelineStages;
    landingPipelineLines: typeof landingPipelineLines;
  };
  scan: { runScan: typeof runScan };
  repo: { validateRepoUrl: typeof validateRepoUrl };
}
```

Create `createApp(deps?: Partial<ServerDeps>)` and keep current `app.listen(port, () => { ... })` runtime bootstrap outside tests.

- [ ] **Step 4: Run backend tests**

Run: `npm test -w @athena/backend`  
Expected: PASS (existing tests + `server-user-scope.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.ts backend/src/scanner.ts backend/test/server-user-scope.test.ts
git commit -m "fix(server): enforce user-scoped scan reads and writes"
```

---

### Task 5: Add shared AuthProvider and migrate auth consumers

**Files:**
- Create: `frontend/src/auth/auth-store.ts`
- Modify: `frontend/src/hooks/useAuth.ts`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/components/Navbar.tsx`
- Modify: `frontend/src/components/ProtectedRoute.tsx`
- Modify: `frontend/src/pages/Login.tsx`
- Modify: `frontend/src/pages/Register.tsx`
- Test: `frontend/test/auth-store.test.ts`

- [ ] **Step 1: Write failing reducer test**

```ts
// frontend/test/auth-store.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { authReducer, initialAuthState } from '../src/auth/auth-store.ts';

test('authReducer marks signed-in user as authenticated', () => {
  const next = authReducer(initialAuthState, {
    type: 'SIGNED_IN',
    user: { id: 9, email: 'dev@athena.dev' },
  });

  assert.equal(next.isAuthenticated, true);
  assert.deepEqual(next.user, { id: 9, email: 'dev@athena.dev' });
  assert.equal(next.isLoading, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/frontend -- test/auth-store.test.ts`  
Expected: FAIL with module not found for `../src/auth/auth-store.ts`.

- [ ] **Step 3: Implement shared auth store and provider**

```ts
// frontend/src/auth/auth-store.ts
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
```

```ts
// frontend/src/hooks/useAuth.ts (core shape)
import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import { fetchAuthMe, login, logout, refreshAuth, register } from '../services/api';
import type { AuthUser } from '../types';
import { authReducer, initialAuthState } from '../auth/auth-store';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  async function bootstrap(): Promise<void> {
    dispatch({ type: 'BOOTSTRAP_START' });
    try {
      const me = await fetchAuthMe();
      dispatch({ type: 'BOOTSTRAP_DONE', user: me });
      return;
    } catch {
      try {
        const refreshed = await refreshAuth();
        dispatch({ type: 'BOOTSTRAP_DONE', user: refreshed });
        return;
      } catch {
        dispatch({ type: 'BOOTSTRAP_DONE', user: null });
      }
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    user: state.user,
    refresh: bootstrap,
    signIn: async (email, password) => {
      const user = await login(email, password);
      dispatch({ type: 'SIGNED_IN', user });
    },
    signUp: async (email, password) => {
      const user = await register(email, password);
      dispatch({ type: 'SIGNED_IN', user });
    },
    signOut: async () => {
      await logout();
      dispatch({ type: 'SIGNED_OUT' });
    },
  }), [state.isAuthenticated, state.isLoading, state.user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
```

```tsx
// frontend/src/main.tsx
<StrictMode>
  <AuthProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </AuthProvider>
</StrictMode>
```

```tsx
// frontend/src/pages/Login.tsx
const { signIn } = useAuth();
await signIn(email, password);
navigate('/dashboard', { replace: true });
```

```tsx
// frontend/src/pages/Register.tsx
const { signUp } = useAuth();
await signUp(email, password);
navigate('/dashboard', { replace: true });
```

`Navbar.tsx` and `ProtectedRoute.tsx` continue using `useAuth()`, now reading shared context state.

- [ ] **Step 4: Run frontend tests**

Run: `npm test -w @athena/frontend`  
Expected: PASS (`api.test.ts` + `auth-store.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auth/auth-store.ts frontend/src/hooks/useAuth.ts frontend/src/main.tsx frontend/src/components/Navbar.tsx frontend/src/components/ProtectedRoute.tsx frontend/src/pages/Login.tsx frontend/src/pages/Register.tsx frontend/test/auth-store.test.ts
git commit -m "feat(frontend): add shared auth provider and reactive navbar state"
```

---

### Task 6: Add Supabase schema docs, env config, and full verification

**Files:**
- Create: `docs/supabase/schema.sql`
- Modify: `backend/.env.example`
- Modify: `docs/SYSTEM_DESIGN.md`
- Modify: `docs/TECH_STACK.md`

- [ ] **Step 1: Write failing configuration/doc checks**

```bash
rg "AUTH_PROVIDER|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY" backend/.env.example docs/SYSTEM_DESIGN.md docs/TECH_STACK.md
```

Expected: no Supabase provider entries in at least one file.

- [ ] **Step 2: Add schema + config docs**

```sql
-- docs/supabase/schema.sql
create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id bigserial primary key,
  email text unique not null,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  supabase_user_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.scans (
  id bigserial primary key,
  scan_id text unique not null,
  user_id bigint not null references public.users(id) on delete cascade,
  repo_name text not null,
  repo_url text not null,
  status text not null,
  created_at timestamptz not null,
  ai_percentage integer not null,
  flagged_units integer not null,
  files_scanned integer not null,
  total_units integer not null,
  findings jsonb not null,
  risk_density jsonb not null,
  duration integer not null
);

create table if not exists public.scan_findings (
  id bigserial primary key,
  scan_id text not null references public.scans(scan_id) on delete cascade,
  severity text not null,
  type text not null,
  category text not null,
  message text not null,
  file text not null,
  line integer not null,
  "column" integer not null,
  source text not null,
  ai_score integer not null,
  code text not null,
  rule_id text not null,
  top_signals jsonb not null
);

create table if not exists public.scan_terminal_lines (
  id bigserial primary key,
  scan_id text not null references public.scans(scan_id) on delete cascade,
  seq integer not null,
  kind text not null,
  text text not null,
  created_at timestamptz not null default now(),
  unique (scan_id, seq)
);

alter table public.scans enable row level security;
alter table public.scan_findings enable row level security;
alter table public.scan_terminal_lines enable row level security;

drop policy if exists scans_select_own on public.scans;
create policy scans_select_own on public.scans
  for select using (auth.uid()::text = (select supabase_user_id::text from public.users u where u.id = user_id));

drop policy if exists scan_findings_select_own on public.scan_findings;
create policy scan_findings_select_own on public.scan_findings
  for select using (
    exists (
      select 1 from public.scans s
      join public.users u on u.id = s.user_id
      where s.scan_id = public.scan_findings.scan_id
        and auth.uid()::text = u.supabase_user_id::text
    )
  );

drop policy if exists scan_terminal_lines_select_own on public.scan_terminal_lines;
create policy scan_terminal_lines_select_own on public.scan_terminal_lines
  for select using (
    exists (
      select 1 from public.scans s
      join public.users u on u.id = s.user_id
      where s.scan_id = public.scan_terminal_lines.scan_id
        and auth.uid()::text = u.supabase_user_id::text
    )
  );
```

```env
# backend/.env.example
PORT=8787
DATABASE_URL=postgres://<db_user>:<db_password>@localhost:5432/athena
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
AUTH_PROVIDER=legacy
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AUTH_COOKIE_DOMAIN=
AUTH_COOKIE_SECURE=false
```

Add matching Supabase phase-1 notes in:
- `docs/SYSTEM_DESIGN.md` (backend provider switch and auth/data flow)
- `docs/TECH_STACK.md` (Supabase JS + Supabase Postgres in backend stack section)

- [ ] **Step 3: Run full verification**

Run: `npm run build && npm test -w @athena/backend && npm test -w @athena/frontend`  
Expected: all commands succeed.

- [ ] **Step 4: Commit**

```bash
git add docs/supabase/schema.sql backend/.env.example docs/SYSTEM_DESIGN.md docs/TECH_STACK.md
git commit -m "docs: add supabase schema and rollout configuration"
```

- [ ] **Step 5: Final readiness check**

```bash
git --no-pager log --oneline -n 6
git status --short
```

Expected: task commits present; worktree clean or only intentional pending changes.

---

## Self-Review

1. **Spec coverage:** Plan covers provider flag, Supabase auth adapter, Supabase-backed DB path, user-scoped reads/writes, reactive frontend auth provider, and rollout/docs.
2. **Placeholder scan:** Removed vague placeholders (pseudo steps, TBD/TODO); all code steps include concrete code.
3. **Type consistency:** `AuthProvider/useAuth` naming is consistent; provider flag consistently uses `AUTH_PROVIDER`; local persisted user model remains `{ id: number; email: string }` across backend/frontend contracts.

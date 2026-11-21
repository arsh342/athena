import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { createSupabaseAuthHandlers, type OAuthProvider } from './auth-supabase.js';
import { db } from './db.js';
import { createSupabaseClients, isSupabaseProvider } from './supabase.js';

const ACCESS_COOKIE = 'athena_access_token';
const REFRESH_COOKIE = 'athena_refresh_token';
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function shouldUseSupabaseAuth(): boolean {
  return isSupabaseProvider();
}

export interface AuthUser {
  id: number;
  email: string;
}

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

function requiredSupabaseEnv(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when AUTH_PROVIDER=supabase`);
  return value;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getAppOrigin(): string {
  return trimTrailingSlash(process.env.APP_ORIGIN?.trim() || process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173');
}

async function getOAuthAuthorizationUrl(input: {
  provider: OAuthProvider;
  redirectTo: string;
  codeChallenge: string;
}): Promise<string> {
  const supabaseUrl = trimTrailingSlash(requiredSupabaseEnv('SUPABASE_URL'));
  const url = new URL(`${supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set('provider', input.provider);
  url.searchParams.set('redirect_to', input.redirectTo);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 's256');
  return url.toString();
}

async function exchangeOAuthCode(code: string, codeVerifier: string) {
  const supabaseUrl = trimTrailingSlash(requiredSupabaseEnv('SUPABASE_URL'));
  const anonKey = requiredSupabaseEnv('SUPABASE_ANON_KEY');

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: codeVerifier,
    }),
  });

  const data = await response.json().catch(() => null) as {
    access_token?: string;
    refresh_token?: string;
    user?: { id?: string; email?: string | null };
  } | null;

  if (!response.ok || !data?.access_token || !data.refresh_token || !data.user?.id) {
    return null;
  }

  return {
    userId: data.user.id,
    email: data.user.email ?? '',
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}

const supabaseHandlers = createSupabaseAuthHandlers({
  async register(email, password) {
    const { service, anon } = createSupabaseClients();
    const createResult = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createResult.error || !createResult.data.user) {
      throw new Error(createResult.error?.message ?? 'Could not create account.');
    }

    const sessionResult = await anon.auth.signInWithPassword({ email, password });
    const session = sessionResult.data.session;
    if (sessionResult.error || !session || !sessionResult.data.user || !session.refresh_token) {
      throw new Error(sessionResult.error?.message ?? 'Could not create session.');
    }

    return {
      userId: createResult.data.user.id,
      email: createResult.data.user.email ?? email,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  },

  async login(email, password) {
    const { anon } = createSupabaseClients();
    const result = await anon.auth.signInWithPassword({ email, password });
    const session = result.data.session;

    if (result.error || !session || !result.data.user || !session.refresh_token) {
      throw new Error(result.error?.message ?? 'Invalid credentials.');
    }

    return {
      userId: result.data.user.id,
      email: result.data.user.email ?? email,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  },

  async refresh(refreshToken) {
    const { anon } = createSupabaseClients();
    const result = await anon.auth.refreshSession({ refresh_token: refreshToken });
    const session = result.data.session;
    if (result.error || !session || !result.data.user || !session.refresh_token) {
      return null;
    }

    return {
      userId: result.data.user.id,
      email: result.data.user.email ?? '',
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    };
  },

  async me(accessToken) {
    const { service } = createSupabaseClients();
    const result = await service.auth.getUser(accessToken);
    if (result.error || !result.data.user) return null;

    return {
      userId: result.data.user.id,
      email: result.data.user.email ?? '',
    };
  },

  async logout(accessToken, refreshToken) {
    if (!accessToken || !refreshToken) return;

    const { anon } = createSupabaseClients();
    const sessionResult = await anon.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionResult.error) return;
    await anon.auth.signOut();
  },

  async upsertLocalUser(supabaseUserId, email) {
    const existing = await db.query<{ id: number; email: string }>(
      `
        SELECT id, email
        FROM users
        WHERE supabase_user_id = $1
        LIMIT 1
      `,
      [supabaseUserId],
    );

    const user = existing.rows[0];
    if (user) {
      if (user.email === email) return user;

      const updated = await db.query<{ id: number; email: string }>(
        `
          UPDATE users
          SET email = $2
          WHERE id = $1
          RETURNING id, email
        `,
        [user.id, email],
      );

      return updated.rows[0];
    }

    const inserted = await db.query<{ id: number; email: string }>(
      `
        INSERT INTO users (email, password_hash, supabase_user_id)
        VALUES ($1, 'supabase-managed', $2)
        ON CONFLICT (email)
        DO UPDATE
          SET supabase_user_id = EXCLUDED.supabase_user_id
        RETURNING id, email
      `,
      [email, supabaseUserId],
    );

    return inserted.rows[0];
  },

  getOAuthAuthorizationUrl,
  exchangeOAuthCode,
});

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function createTokens(): SessionTokens {
  const accessToken = randomBytes(32).toString('hex');
  const refreshToken = randomBytes(48).toString('hex');
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

function setAuthCookies(res: Response, tokens: SessionTokens): void {
  const secure = process.env.AUTH_COOKIE_SECURE
    ? isTruthy(process.env.AUTH_COOKIE_SECURE)
    : process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'none' : 'lax';
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;

  const baseCookie = {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    domain,
  } as const;

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookie,
    expires: tokens.accessExpiresAt,
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookie,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
  res.clearCookie(ACCESS_COOKIE, { path: '/', domain });
  res.clearCookie(REFRESH_COOKIE, { path: '/', domain });
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function createDbSession(userId: number): Promise<SessionTokens> {
  const tokens = createTokens();
  await db.query(
    `
      INSERT INTO auth_sessions (
        user_id,
        access_token_hash,
        refresh_token_hash,
        access_expires_at,
        refresh_expires_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      userId,
      hashToken(tokens.accessToken),
      hashToken(tokens.refreshToken),
      tokens.accessExpiresAt,
      tokens.refreshExpiresAt,
    ],
  );

  return tokens;
}

async function findUserByAccessToken(accessToken: string): Promise<AuthUser | null> {
  const tokenHash = hashToken(accessToken);
  const result = await db.query<{
    id: number;
    email: string;
  }>(
    `
      SELECT u.id, u.email
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.access_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.access_expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash],
  );

  return result.rows[0] ?? null;
}

export async function getAuthenticatedUser(req: Request, passedToken?: string): Promise<AuthUser | null> {
  if (shouldUseSupabaseAuth()) {
    return supabaseHandlers.getAuthenticatedUser(req, passedToken);
  }

  let accessToken = passedToken || '';
  if (!accessToken) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      accessToken = authHeader.substring(7).trim();
    }
  }
  if (!accessToken) {
    accessToken = String(req.cookies?.[ACCESS_COOKIE] ?? '').trim();
  }
  if (!accessToken) return null;
  return findUserByAccessToken(accessToken);
}

export async function registerUser(req: Request, res: Response): Promise<void> {
  if (shouldUseSupabaseAuth()) {
    await supabaseHandlers.registerUser(req, res);
    return;
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  if (!isValidEmail(email) || password.length < 8) {
    res.status(400).json({ error: 'Valid email and password with 8+ characters are required.' });
    return;
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    const insertResult = await db.query<{ id: number; email: string }>(
      `
        INSERT INTO users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id, email
      `,
      [email, hash],
    );

    const user = insertResult.rows[0];
    const tokens = await createDbSession(user.id);
    setAuthCookies(res, tokens);

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('users_email_key')) {
      res.status(409).json({ error: 'Email already registered.' });
      return;
    }

    res.status(500).json({ error: 'Could not create account.' });
  }
}

export async function loginUser(req: Request, res: Response): Promise<void> {
  if (shouldUseSupabaseAuth()) {
    await supabaseHandlers.loginUser(req, res);
    return;
  }

  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  if (!isValidEmail(email) || password.length === 0) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const result = await db.query<{
    id: number;
    email: string;
    password_hash: string;
    failed_attempts: number;
    locked_until: string | null;
  }>(
    `
      SELECT id, email, password_hash, failed_attempts, locked_until
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [email],
  );

  const user = result.rows[0];
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
    return;
  }

  const matched = await bcrypt.compare(password, user.password_hash);
  if (!matched) {
    // Count the failure in the database, atomically: parallel guesses must each be counted, so they cannot undercount
    // the attempts and keep the account unlocked.
    const counted = await db.query<{ locked: boolean }>(
      `
        UPDATE users
        SET failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
            locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() + ($3 || ' minutes')::INTERVAL ELSE locked_until END
        WHERE id = $1
        RETURNING (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
      `,
      [user.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES.toString()],
    );
    if (counted.rows[0]?.locked) {
      res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
      return;
    }

    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  await db.query(
    `
      UPDATE users
      SET failed_attempts = 0,
          locked_until = NULL
      WHERE id = $1
    `,
    [user.id],
  );

  const tokens = await createDbSession(user.id);
  setAuthCookies(res, tokens);
  res.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
}

export async function refreshSession(req: Request, res: Response): Promise<void> {
  if (shouldUseSupabaseAuth()) {
    await supabaseHandlers.refreshSession(req, res);
    return;
  }

  let rawRefresh = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();
  if (!rawRefresh) {
    rawRefresh = String(req.body?.refreshToken ?? '').trim();
  }
  if (!rawRefresh) {
    res.status(401).json({ error: 'Missing refresh token.' });
    return;
  }

  const refreshHash = hashToken(rawRefresh);
  const sessionResult = await db.query<{
    id: number;
    user_id: number;
    refresh_expires_at: string;
    revoked_at: string | null;
  }>(
    `
      SELECT id, user_id, refresh_expires_at, revoked_at
      FROM auth_sessions
      WHERE refresh_token_hash = $1
      LIMIT 1
    `,
    [refreshHash],
  );

  const session = sessionResult.rows[0];
  if (!session || session.revoked_at || new Date(session.refresh_expires_at).getTime() <= Date.now()) {
    clearAuthCookies(res);
    res.status(401).json({ error: 'Invalid refresh token.' });
    return;
  }

  // Redeem exactly once: only the request that flips revoked_at from NULL gets new tokens.
  const redeemed = await db.query<{ id: number }>(
    `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id
    `,
    [session.id],
  );
  if (redeemed.rows.length === 0) {
    clearAuthCookies(res);
    res.status(401).json({ error: 'Invalid refresh token.' });
    return;
  }

  const tokens = await createDbSession(session.user_id);
  setAuthCookies(res, tokens);

  const userResult = await db.query<{ id: number; email: string }>(
    `
      SELECT id, email
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [session.user_id],
  );

  const user = userResult.rows[0];
  if (!user) {
    clearAuthCookies(res);
    res.status(401).json({ error: 'Session user not found.' });
    return;
  }

  res.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
}

export async function logoutUser(req: Request, res: Response): Promise<void> {
  if (shouldUseSupabaseAuth()) {
    await supabaseHandlers.logoutUser(req, res);
    return;
  }

  let accessToken = '';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    accessToken = authHeader.substring(7).trim();
  }
  if (!accessToken) {
    accessToken = String(req.cookies?.[ACCESS_COOKIE] ?? '').trim();
  }
  const refreshToken = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();

  const hashes = [accessToken, refreshToken].filter(Boolean).map(hashToken);
  if (hashes.length > 0) {
    await db.query(
      `
        UPDATE auth_sessions
        SET revoked_at = NOW()
        WHERE (access_token_hash = ANY($1) OR refresh_token_hash = ANY($1))
          AND revoked_at IS NULL
      `,
      [hashes],
    );
  }

  clearAuthCookies(res);
  res.json({ ok: true });
}

export async function startOAuth(req: Request, res: Response): Promise<void> {
  if (!shouldUseSupabaseAuth()) {
    res.status(409).json({ error: 'OAuth is available only in Supabase auth mode.' });
    return;
  }

  await supabaseHandlers.startOAuth(req, res);
}

export async function completeOAuthCallback(req: Request, res: Response): Promise<void> {
  if (!shouldUseSupabaseAuth()) {
    res.redirect(302, `${getAppOrigin()}/login?oauth_error=oauth_disabled`);
    return;
  }

  await supabaseHandlers.completeOAuthCallback(req, res);
}

/** What deleting an account needs from outside this file, so tests can stand in for it. */
export interface DeleteAccountHooks {
  /** Remove the person from Supabase auth. Resolves true when removed, false when this deployment has no admin access. */
  removeSupabaseUser?: (supabaseUserId: string) => Promise<boolean>;
  /** Who is asking; defaults to the normal session lookup. */
  getUser?: (req: Request) => Promise<AuthUser | null>;
}

async function removeSupabaseUserDefault(supabaseUserId: string): Promise<boolean> {
  let service;
  try {
    service = createSupabaseClients().service;
  } catch {
    return false; // no service-role key configured: the sign-in identity cannot be removed from here
  }
  const { error } = await service.auth.admin.deleteUser(supabaseUserId);
  if (error && !/not.?found/i.test(error.message)) throw new Error(error.message);
  return true;
}

/**
 * Delete the signed-in user's account and everything saved under it (scans, findings, reports, sessions, alerts: all cascade from the user row).
 * The caller must retype their email, and with a local password account also their password, so a stolen or left-open session cannot do it silently.
 */
export async function deleteAccount(req: Request, res: Response, hooks: DeleteAccountHooks = {}): Promise<void> {
  const user = await (hooks.getUser ?? ((r) => getAuthenticatedUser(r)))(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const confirmEmail = String(req.body?.confirmEmail ?? '').trim().toLowerCase();
  if (confirmEmail !== user.email.trim().toLowerCase()) {
    res.status(400).json({ error: 'Type your account email exactly to confirm.' });
    return;
  }

  const row = await db.query<{ password_hash: string | null; supabase_user_id: string | null }>(
    'SELECT password_hash, supabase_user_id FROM users WHERE id = $1',
    [user.id],
  );
  const record = row.rows[0];
  if (!record) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  if (!shouldUseSupabaseAuth()) {
    // A local account: re-check the password. (Supabase accounts may have no password at all, for instance Google or GitHub sign-in.)
    const password = String(req.body?.password ?? '');
    if (!record.password_hash || !password || !(await bcrypt.compare(password, record.password_hash))) {
      res.status(403).json({ error: 'The password is missing or wrong.' });
      return;
    }
  }

  let identityRemoved = !record.supabase_user_id;
  if (record.supabase_user_id) {
    try {
      identityRemoved = await (hooks.removeSupabaseUser ?? removeSupabaseUserDefault)(record.supabase_user_id);
    } catch (error) {
      // Stop here and keep the data: the person can try again, instead of ending up with a login but no account.
      res.status(502).json({ error: `Could not remove your sign-in identity: ${error instanceof Error ? error.message : 'unknown error'}. Nothing was deleted.` });
      return;
    }
  }

  await db.query('DELETE FROM users WHERE id = $1', [user.id]);
  clearAuthCookies(res);
  res.json({ ok: true, identityRemoved });
}

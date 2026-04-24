import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { db } from './db.js';

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
  const sameSite = secure ? 'strict' : 'lax';
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

export async function getAuthenticatedUser(req: Request): Promise<AuthUser | null> {
  const accessToken = String(req.cookies?.[ACCESS_COOKIE] ?? '').trim();
  if (!accessToken) return null;
  return findUserByAccessToken(accessToken);
}

export async function registerUser(req: Request, res: Response): Promise<void> {
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
    const nextAttempts = user.failed_attempts + 1;
    if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
      await db.query(
        `
          UPDATE users
          SET failed_attempts = 0,
              locked_until = NOW() + ($2 || ' minutes')::INTERVAL
          WHERE id = $1
        `,
        [user.id, LOCK_MINUTES.toString()],
      );

      res.status(423).json({ error: 'Account temporarily locked. Try again later.' });
      return;
    }

    await db.query(
      `
        UPDATE users
        SET failed_attempts = $2,
            locked_until = NULL
        WHERE id = $1
      `,
      [user.id, nextAttempts],
    );

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
  res.json({ user: { id: user.id, email: user.email } });
}

export async function refreshSession(req: Request, res: Response): Promise<void> {
  const rawRefresh = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();
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

  await db.query(
    `
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE id = $1
    `,
    [session.id],
  );

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

  res.json({ user: { id: user.id, email: user.email } });
}

export async function logoutUser(req: Request, res: Response): Promise<void> {
  const accessToken = String(req.cookies?.[ACCESS_COOKIE] ?? '').trim();
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

import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

const ACCESS_COOKIE = 'athena_access_token';
const REFRESH_COOKIE = 'athena_refresh_token';
const OAUTH_VERIFIER_COOKIE = 'athena_oauth_verifier';
const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000;

export type OAuthProvider = 'google' | 'github';

export interface LocalAuthUser {
  id: number;
  email: string;
}

export interface SupabaseSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export interface SupabaseIdentity {
  userId: string;
  email: string;
}

export interface SupabaseAuthDeps {
  register: (email: string, password: string) => Promise<SupabaseSession>;
  login: (email: string, password: string) => Promise<SupabaseSession>;
  refresh: (refreshToken: string) => Promise<SupabaseSession | null>;
  me: (accessToken: string) => Promise<SupabaseIdentity | null>;
  logout: (accessToken: string, refreshToken: string) => Promise<void>;
  upsertLocalUser: (supabaseUserId: string, email: string) => Promise<LocalAuthUser>;
  getOAuthAuthorizationUrl: (input: {
    provider: OAuthProvider;
    redirectTo: string;
    codeChallenge: string;
  }) => Promise<string>;
  exchangeOAuthCode: (code: string, codeVerifier: string) => Promise<SupabaseSession | null>;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function setSupabaseCookies(res: Response, accessToken: string, refreshToken: string): void {
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

  res.cookie(ACCESS_COOKIE, accessToken, baseCookie);
  res.cookie(REFRESH_COOKIE, refreshToken, baseCookie);
}

function clearSupabaseCookies(res: Response): void {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
  res.clearCookie(ACCESS_COOKIE, { path: '/', domain });
  res.clearCookie(REFRESH_COOKIE, { path: '/', domain });
}

function getCookieSecurity() {
  const secure = process.env.AUTH_COOKIE_SECURE
    ? isTruthy(process.env.AUTH_COOKIE_SECURE)
    : process.env.NODE_ENV === 'production';
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;

  return { secure, domain };
}

function setOAuthFlowCookies(res: Response, codeVerifier: string): void {
  const { secure, domain } = getCookieSecurity();
  res.cookie(OAUTH_VERIFIER_COOKIE, codeVerifier, {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/api/auth/oauth',
    domain,
    maxAge: OAUTH_COOKIE_TTL_MS,
  });
}

function clearOAuthFlowCookies(res: Response): void {
  const { domain } = getCookieSecurity();
  res.clearCookie(OAUTH_VERIFIER_COOKIE, { path: '/api/auth/oauth', domain });
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function getAppOrigin(): string {
  const configured = process.env.APP_ORIGIN?.trim() || process.env.CORS_ORIGIN?.trim();
  return trimTrailingSlash(configured || 'http://localhost:5173');
}

function getOAuthCallbackUrl(): string {
  const configured = process.env.API_ORIGIN?.trim();
  const fallback = `http://localhost:${process.env.PORT ?? '8787'}`;
  return `${trimTrailingSlash(configured || fallback)}/api/auth/oauth/callback`;
}

function buildFrontendRedirect(pathname: string, params?: Record<string, string>): string {
  const url = new URL(pathname, `${getAppOrigin()}/`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function createPkceCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function createPkceCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function isSupportedOAuthProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'github';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDuplicateEmailError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('already') || normalized.includes('exists') || normalized.includes('duplicate');
}

function isInvalidCredentialError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('invalid credentials') || normalized.includes('invalid login credentials');
}

/** Creates Supabase-backed auth handlers that preserve the existing backend auth response contract. */
export function createSupabaseAuthHandlers(deps: SupabaseAuthDeps) {
  return {
    async registerUser(req: Request, res: Response): Promise<void> {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');

      if (!isValidEmail(email) || password.length < 8) {
        res.status(400).json({ error: 'Valid email and password with 8+ characters are required.' });
        return;
      }

      try {
        const session = await deps.register(email, password);
        const localUser = await deps.upsertLocalUser(session.userId, session.email);
        setSupabaseCookies(res, session.accessToken, session.refreshToken);
        res.status(201).json({ user: { id: localUser.id, email: localUser.email } });
      } catch (error) {
        console.error({ error: getErrorMessage(error) }, 'User registration failed');
        const message = getErrorMessage(error);
        if (isDuplicateEmailError(message)) {
          res.status(409).json({ error: 'Email already registered.' });
          return;
        }
        res.status(500).json({ error: 'Could not create account.' });
      }
    },

    async loginUser(req: Request, res: Response): Promise<void> {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');

      if (!isValidEmail(email) || password.length === 0) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      try {
        const session = await deps.login(email, password);
        const localUser = await deps.upsertLocalUser(session.userId, session.email);
        setSupabaseCookies(res, session.accessToken, session.refreshToken);
        res.json({ user: { id: localUser.id, email: localUser.email } });
      } catch (error) {
        console.error({ error: getErrorMessage(error) }, 'User login failed');
        const message = getErrorMessage(error);
        if (isInvalidCredentialError(message)) {
          res.status(401).json({ error: 'Invalid credentials.' });
          return;
        }
        res.status(500).json({ error: 'Could not sign in.' });
      }
    },

    async refreshSession(req: Request, res: Response): Promise<void> {
      const refreshToken = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();
      if (!refreshToken) {
        res.status(401).json({ error: 'Missing refresh token.' });
        return;
      }

      try {
        const session = await deps.refresh(refreshToken);
        if (!session) {
          clearSupabaseCookies(res);
          res.status(401).json({ error: 'Invalid refresh token.' });
          return;
        }

        const localUser = await deps.upsertLocalUser(session.userId, session.email);
        setSupabaseCookies(res, session.accessToken, session.refreshToken);
        res.json({ user: { id: localUser.id, email: localUser.email } });
      } catch (error) {
        console.error({ error: getErrorMessage(error) }, 'Session refresh failed');
        clearSupabaseCookies(res);
        res.status(401).json({ error: 'Invalid refresh token.' });
      }
    },

    async getAuthenticatedUser(req: Request): Promise<LocalAuthUser | null> {
      const accessToken = String(req.cookies?.[ACCESS_COOKIE] ?? '').trim();
      if (!accessToken) return null;

      try {
        const identity = await deps.me(accessToken);
        if (!identity) return null;

        return await deps.upsertLocalUser(identity.userId, identity.email);
      } catch (error) {
        console.error({ error: getErrorMessage(error) }, 'Get authenticated user failed');
        return null;
      }
    },

    async logoutUser(req: Request, res: Response): Promise<void> {
      const accessToken = String(req.cookies?.[ACCESS_COOKIE] ?? '').trim();
      const refreshToken = String(req.cookies?.[REFRESH_COOKIE] ?? '').trim();

      try {
        await deps.logout(accessToken, refreshToken);
      } catch (error) {
        console.error({ error: getErrorMessage(error) }, 'Logout failed');
      } finally {
        clearSupabaseCookies(res);
        res.json({ ok: true });
      }
    },

    async startOAuth(req: Request, res: Response): Promise<void> {
      const provider = String(req.params?.provider ?? '').trim().toLowerCase();
      if (!isSupportedOAuthProvider(provider)) {
        res.status(400).json({ error: 'Unsupported OAuth provider.' });
        return;
      }

      try {
        const codeVerifier = createPkceCodeVerifier();
        const codeChallenge = createPkceCodeChallenge(codeVerifier);
        const authorizationUrl = await deps.getOAuthAuthorizationUrl({
          provider,
          redirectTo: getOAuthCallbackUrl(),
          codeChallenge,
        });

        setOAuthFlowCookies(res, codeVerifier);
        res.redirect(302, authorizationUrl);
      } catch (error) {
        console.error({ error: getErrorMessage(error) }, 'OAuth initialization failed');
        clearOAuthFlowCookies(res);
        res.status(500).json({ error: 'Could not start OAuth sign-in.' });
      }
    },

    async completeOAuthCallback(req: Request, res: Response): Promise<void> {
      const providerError = String(req.query?.error ?? '').trim();
      const code = String(req.query?.code ?? '').trim();
      const codeVerifier = String(req.cookies?.[OAUTH_VERIFIER_COOKIE] ?? '').trim();

      clearOAuthFlowCookies(res);

      if (providerError) {
        res.redirect(302, buildFrontendRedirect('/login', { oauth_error: 'oauth_failed' }));
        return;
      }

      if (!code || !codeVerifier) {
        res.redirect(302, buildFrontendRedirect('/login', { oauth_error: 'callback_failed' }));
        return;
      }

      try {
        const session = await deps.exchangeOAuthCode(code, codeVerifier);
        if (!session) {
          res.redirect(302, buildFrontendRedirect('/login', { oauth_error: 'oauth_failed' }));
          return;
        }

        const email = session.email.trim().toLowerCase();
        if (!email) {
          res.redirect(302, buildFrontendRedirect('/login', { oauth_error: 'email_required' }));
          return;
        }

        await deps.upsertLocalUser(session.userId, email);
        setSupabaseCookies(res, session.accessToken, session.refreshToken);
        res.redirect(302, buildFrontendRedirect('/dashboard'));
      } catch (error) {
        console.error({ error: getErrorMessage(error) }, 'OAuth callback completion failed');
        res.redirect(302, buildFrontendRedirect('/login', { oauth_error: 'oauth_failed' }));
      }
    },
  };
}

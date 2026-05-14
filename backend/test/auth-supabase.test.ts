import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createSupabaseAuthHandlers } from '../src/auth-supabase.ts';
import { shouldUseSupabaseAuth } from '../src/auth.ts';

type CookieState = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

function createMockResponse() {
  const state: {
    statusCode: number;
    jsonBody: unknown;
    cookies: CookieState[];
    clearedCookies: Array<{ name: string; options?: Record<string, unknown> }>;
    redirectLocation: string | null;
  } = {
    statusCode: 200,
    jsonBody: null,
    cookies: [],
    clearedCookies: [],
    redirectLocation: null,
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
    cookie(name: string, value: string, options?: Record<string, unknown>) {
      state.cookies.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options?: Record<string, unknown>) {
      state.clearedCookies.push({ name, options });
      return this;
    },
    redirect(first: number | string, second?: string) {
      state.statusCode = typeof first === 'number' ? first : 302;
      state.redirectLocation = typeof first === 'string' ? first : (second ?? null);
      return this;
    },
  } as unknown as Response;

  return { res, state };
}

test('register maps success to 201 and stable payload shape with auth cookies', async () => {
  const cookieSecureSnapshot = process.env.AUTH_COOKIE_SECURE;
  process.env.AUTH_COOKIE_SECURE = 'true';

  const handlers = createSupabaseAuthHandlers({
    register: async () => ({
      userId: 'supa-uid-1',
      email: 'dev@athena.dev',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
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
    getOAuthAuthorizationUrl: async () => 'https://example.com/oauth/start',
    exchangeOAuthCode: async () => null,
  });

  const req = { body: { email: 'dev@athena.dev', password: 'password123' }, cookies: {} } as Request;
  const { res, state } = createMockResponse();

  try {
    await handlers.registerUser(req, res);

    assert.equal(state.statusCode, 201);
    assert.deepEqual(state.jsonBody, { user: { id: 17, email: 'dev@athena.dev' } });

    assert.equal(state.cookies.length, 2);
    assert.deepEqual(
      state.cookies.map((cookie) => [cookie.name, cookie.value]),
      [
        ['athena_access_token', 'access-token'],
        ['athena_refresh_token', 'refresh-token'],
      ],
    );
    assert.equal(state.cookies[0]?.options?.httpOnly, true);
    assert.equal(state.cookies[0]?.options?.secure, true);
    assert.equal(state.cookies[0]?.options?.sameSite, 'strict');
    assert.equal(state.cookies[0]?.options?.path, '/');
  } finally {
    process.env.AUTH_COOKIE_SECURE = cookieSecureSnapshot;
  }
});

test('shouldUseSupabaseAuth follows AUTH_PROVIDER env', () => {
  const snapshot = process.env.AUTH_PROVIDER;

  try {
    process.env.AUTH_PROVIDER = 'supabase';
    assert.equal(shouldUseSupabaseAuth(), true);

    process.env.AUTH_PROVIDER = 'legacy';
    assert.equal(shouldUseSupabaseAuth(), false);
  } finally {
    process.env.AUTH_PROVIDER = snapshot;
  }
});

test('startOAuth redirects with PKCE cookies for supported provider', async () => {
  const appOriginSnapshot = process.env.APP_ORIGIN;
  const apiOriginSnapshot = process.env.API_ORIGIN;
  process.env.APP_ORIGIN = 'http://localhost:5173';
  process.env.API_ORIGIN = 'http://localhost:8787';

  let capturedInput:
    | {
      provider: 'google' | 'github';
      redirectTo: string;
      codeChallenge: string;
    }
    | undefined;

  const handlers = createSupabaseAuthHandlers({
    register: async () => {
      throw new Error('unused');
    },
    login: async () => {
      throw new Error('unused');
    },
    refresh: async () => null,
    me: async () => null,
    logout: async () => undefined,
    upsertLocalUser: async () => ({ id: 1, email: 'dev@athena.dev' }),
    getOAuthAuthorizationUrl: async (input) => {
      capturedInput = input;
      return 'https://accounts.example.com/start';
    },
    exchangeOAuthCode: async () => null,
  });

  const req = { params: { provider: 'google' }, cookies: {} } as unknown as Request;
  const { res, state } = createMockResponse();

  try {
    await handlers.startOAuth(req, res);

    assert.equal(state.statusCode, 302);
    assert.equal(state.redirectLocation, 'https://accounts.example.com/start');
    assert.equal(capturedInput?.provider, 'google');
    assert.equal(capturedInput?.redirectTo, 'http://localhost:8787/api/auth/oauth/callback');
    assert.ok(capturedInput?.codeChallenge);
    assert.equal(state.cookies.length, 1);
    assert.deepEqual(
      state.cookies.map((cookie) => cookie.name),
      ['athena_oauth_verifier'],
    );
    assert.equal(state.cookies[0]?.options?.httpOnly, true);
    assert.equal(state.cookies[0]?.options?.sameSite, 'lax');
    assert.equal(state.cookies[0]?.options?.path, '/api/auth/oauth');
  } finally {
    process.env.APP_ORIGIN = appOriginSnapshot;
    process.env.API_ORIGIN = apiOriginSnapshot;
  }
});

test('completeOAuthCallback exchanges code, links local user, sets auth cookies, redirects to dashboard', async () => {
  const appOriginSnapshot = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'http://localhost:5173';

  let capturedExchange: { code: string; codeVerifier: string } | undefined;
  let capturedLink: { userId: string; email: string } | undefined;

  const handlers = createSupabaseAuthHandlers({
    register: async () => {
      throw new Error('unused');
    },
    login: async () => {
      throw new Error('unused');
    },
    refresh: async () => null,
    me: async () => null,
    logout: async () => undefined,
    upsertLocalUser: async (userId, email) => {
      capturedLink = { userId, email };
      return { id: 7, email };
    },
    getOAuthAuthorizationUrl: async () => 'unused',
    exchangeOAuthCode: async (code, codeVerifier) => {
      capturedExchange = { code, codeVerifier };
      return {
        userId: 'supa-7',
        email: 'dev@athena.dev',
        accessToken: 'oauth-access',
        refreshToken: 'oauth-refresh',
      };
    },
  });

  const req = {
    query: { code: 'auth-code' },
    cookies: {
      athena_oauth_verifier: 'verifier-abc',
    },
  } as unknown as Request;
  const { res, state } = createMockResponse();

  try {
    await handlers.completeOAuthCallback(req, res);

    assert.deepEqual(capturedExchange, { code: 'auth-code', codeVerifier: 'verifier-abc' });
    assert.deepEqual(capturedLink, { userId: 'supa-7', email: 'dev@athena.dev' });
    assert.equal(state.statusCode, 302);
    assert.equal(state.redirectLocation, 'http://localhost:5173/dashboard');
    assert.deepEqual(
      state.cookies.map((cookie) => [cookie.name, cookie.value]),
      [
        ['athena_access_token', 'oauth-access'],
        ['athena_refresh_token', 'oauth-refresh'],
      ],
    );
    assert.deepEqual(
      state.clearedCookies.map((cookie) => cookie.name),
      ['athena_oauth_verifier'],
    );
  } finally {
    process.env.APP_ORIGIN = appOriginSnapshot;
  }
});

test('completeOAuthCallback redirects to login when callback missing verifier', async () => {
  const appOriginSnapshot = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'http://localhost:5173';

  const handlers = createSupabaseAuthHandlers({
    register: async () => {
      throw new Error('unused');
    },
    login: async () => {
      throw new Error('unused');
    },
    refresh: async () => null,
    me: async () => null,
    logout: async () => undefined,
    upsertLocalUser: async () => ({ id: 1, email: 'dev@athena.dev' }),
    getOAuthAuthorizationUrl: async () => 'unused',
    exchangeOAuthCode: async () => {
      throw new Error('unused');
    },
  });

  const req = {
    query: { code: 'auth-code' },
    cookies: {},
  } as unknown as Request;
  const { res, state } = createMockResponse();

  try {
    await handlers.completeOAuthCallback(req, res);
    assert.equal(state.statusCode, 302);
    assert.equal(state.redirectLocation, 'http://localhost:5173/login?oauth_error=callback_failed');
  } finally {
    process.env.APP_ORIGIN = appOriginSnapshot;
  }
});

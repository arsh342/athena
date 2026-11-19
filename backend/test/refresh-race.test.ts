import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../src/db.ts';
import { refreshSession } from '../src/auth.ts';

function mockRes() {
  const out = { status: 200, body: undefined as unknown, cookies: [] as string[] };
  const res = {
    status(code: number) { out.status = code; return this; },
    json(b: unknown) { out.body = b; return this; },
    cookie(name: string) { out.cookies.push(name); return this; },
    clearCookie() { return this; },
  };
  return { res: res as never, out };
}

/** A database with one live session whose conditional UPDATE is atomic (as in Postgres) and whose reads interleave. */
function fakeAuthDb() {
  const session = { id: 1, user_id: 9, refresh_expires_at: new Date(Date.now() + 3600_000).toISOString(), revoked_at: null as string | null };
  let inserted = 0;
  const handle = db as unknown as { query: typeof db.query };
  const original = handle.query;
  handle.query = (async (text: string) => {
    if (/FROM auth_sessions\s+WHERE refresh_token_hash/.test(text)) {
      const snapshot = { ...session }; // both requests read the live row before either writes
      await new Promise((r) => setTimeout(r, 5));
      return { rows: [snapshot] };
    }
    if (/UPDATE auth_sessions/.test(text)) {
      if (/revoked_at IS NULL/.test(text)) {
        if (session.revoked_at) return { rows: [] };
        session.revoked_at = new Date().toISOString();
        return { rows: [{ id: session.id }] };
      }
      session.revoked_at = new Date().toISOString(); // the old, unconditional statement
      return { rows: [] };
    }
    if (/INSERT INTO auth_sessions/.test(text)) { inserted += 1; return { rows: [] }; }
    if (/FROM users/.test(text)) return { rows: [{ id: 9, email: 'a@b.c' }] };
    return { rows: [] };
  }) as typeof db.query;
  return { restore: () => { handle.query = original; }, inserted: () => inserted };
}

test('two simultaneous refreshes with one token issue exactly one session', async () => {
  delete process.env.AUTH_PROVIDER;
  const fake = fakeAuthDb();
  try {
    const a = mockRes();
    const b = mockRes();
    const req = () => ({ cookies: { athena_refresh_token: 'tok' }, body: {} }) as never;
    await Promise.all([refreshSession(req(), a.res), refreshSession(req(), b.res)]);
    const statuses = [a.out.status, b.out.status].sort();
    assert.deepEqual(statuses, [200, 401], JSON.stringify([a.out, b.out]));
    assert.equal(fake.inserted(), 1, 'exactly one new session row');
  } finally {
    fake.restore();
  }
});

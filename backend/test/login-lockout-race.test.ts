import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { db } from '../src/db.ts';
import { loginUser } from '../src/auth.ts';

function mockRes() {
  const out = { status: 200 };
  const res = { status(c: number) { out.status = c; return this; }, json() { return this; }, cookie() { return this; }, clearCookie() { return this; } };
  return { res: res as never, out };
}

/** One user row; the lockout UPDATE is atomic like Postgres, reads can interleave. */
function fakeUsersDb(hash: string) {
  const row = { id: 1, email: 'a@b.c', password_hash: hash, failed_attempts: 0, locked_until: null as string | null };
  const handle = db as unknown as { query: typeof db.query };
  const original = handle.query;
  handle.query = (async (text: string, params?: unknown[]) => {
    if (/FROM users\s+WHERE email/.test(text)) {
      const snapshot = { ...row };
      await new Promise((r) => setTimeout(r, 5));
      return { rows: [snapshot] };
    }
    if (/UPDATE users/.test(text) && /failed_attempts \+ 1/.test(text)) {
      row.failed_attempts += 1;
      if (row.failed_attempts >= 5) { row.failed_attempts = 0; row.locked_until = new Date(Date.now() + 15 * 60_000).toISOString(); }
      return { rows: [{ locked: row.locked_until !== null && Date.parse(row.locked_until) > Date.now() }] };
    }
    if (/UPDATE users/.test(text) && /failed_attempts = \$2/.test(text)) { row.failed_attempts = Number(params?.[1]); return { rows: [] }; }
    if (/UPDATE users/.test(text) && /locked_until = NOW\(\)/.test(text)) { row.locked_until = new Date(Date.now() + 900_000).toISOString(); row.failed_attempts = 0; return { rows: [] }; }
    return { rows: [] };
  }) as typeof db.query;
  return { restore: () => { handle.query = original; }, row };
}

test('parallel wrong-password logins are all counted, so the account locks after five', async () => {
  delete process.env.AUTH_PROVIDER;
  const fake = fakeUsersDb(await bcrypt.hash('right-password', 4));
  try {
    const results = await Promise.all(Array.from({ length: 8 }, async () => {
      const r = mockRes();
      await loginUser({ body: { email: 'a@b.c', password: 'wrong-password' }, cookies: {} } as never, r.res);
      return r.out.status;
    }));
    assert.ok(results.includes(423), `an account hit by 8 parallel wrong guesses is locked (statuses: ${results.join(',')})`);
    assert.ok(results.filter((s) => s === 401).length <= 4, 'at most four guesses are answered as plain failures');
  } finally {
    fake.restore();
  }
});

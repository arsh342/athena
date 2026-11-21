import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { deleteAccount } from '../src/auth.ts';
import { db } from '../src/db.ts';
import { deleteAllScans, deleteScan } from '../src/data.ts';

type Q = { text: string; params?: unknown[] };

/** Stand in for the database: `answer` returns the rows for a query, and every query is recorded. */
function fakeDb(answer: (q: Q) => { rows?: unknown[]; rowCount?: number }) {
  const handle = db as unknown as { query: typeof db.query };
  const original = handle.query;
  const queries: Q[] = [];
  handle.query = (async (text: string, params?: unknown[]) => {
    const q = { text, params };
    queries.push(q);
    return { rows: [], rowCount: 0, ...answer(q) };
  }) as typeof db.query;
  return { queries, restore: () => { handle.query = original; } };
}

function mockRes() {
  const out: { status: number; body: unknown; cleared: boolean } = { status: 200, body: null, cleared: false };
  const res = {
    status(c: number) { out.status = c; return this; },
    json(b: unknown) { out.body = b; return this; },
    clearCookie() { out.cleared = true; return this; },
    cookie() { return this; },
  };
  return { res: res as never, out };
}

/* ---- data layer ---- */

test('deleteScan only touches the asking user\'s scan, and says when it is missing', async () => {
  const none = fakeDb(() => ({ rows: [] }));
  assert.equal(await deleteScan('s1', 7), 'not-found');
  assert.ok(none.queries.every((q) => !/DELETE/.test(q.text)), 'nothing is deleted when the scan is not theirs');
  none.restore();
});

test('deleteScan refuses a scan that is running right now, and deletes any other with both ids in the WHERE', async () => {
  const running = fakeDb((q) => (/SELECT/.test(q.text) ? { rows: [{ status: 'RUNNING', running_recently: true }] } : {}));
  assert.equal(await deleteScan('s1', 7), 'running');
  assert.ok(running.queries.every((q) => !/DELETE/.test(q.text)));
  running.restore();

  const done = fakeDb((q) => (/SELECT/.test(q.text) ? { rows: [{ status: 'COMPLETED', running_recently: false }] } : {}));
  assert.equal(await deleteScan('s1', 7), 'deleted');
  const del = done.queries.find((q) => /DELETE FROM scans/.test(q.text))!;
  assert.match(del.text, /scan_id = \$1 AND user_id = \$2/);
  assert.deepEqual(del.params, ['s1', 7]);
  done.restore();
});

test('deleteAllScans is scoped to the user and reports how many went', async () => {
  const f = fakeDb(() => ({ rowCount: 4 }));
  assert.equal(await deleteAllScans(7), 4);
  assert.match(f.queries[0]!.text, /WHERE user_id = \$1/);
  assert.equal(f.queries[0]!.params![0], 7);
  f.restore();
  assert.equal(await deleteAllScans('not-a-number'), 0);
});

/* ---- account deletion ---- */

const asUser = async () => ({ id: 9, email: 'Person@Example.com' });

test('deleteAccount needs a signed-in user and the email retyped exactly', async () => {
  const f = fakeDb(() => ({}));
  const anon = mockRes();
  await deleteAccount({ body: {} } as never, anon.res, { getUser: async () => null });
  assert.equal(anon.out.status, 401);

  const wrong = mockRes();
  await deleteAccount({ body: { confirmEmail: 'someone@else.com' } } as never, wrong.res, { getUser: asUser });
  assert.equal(wrong.out.status, 400);
  assert.ok(f.queries.every((q) => !/DELETE/.test(q.text)), 'nothing is deleted without the right confirmation');
  f.restore();
});

test('a local password account must also give the right password', async () => {
  delete process.env.AUTH_PROVIDER;
  const hash = await bcrypt.hash('correct-horse', 4);
  const f = fakeDb((q) => (/SELECT password_hash/.test(q.text) ? { rows: [{ password_hash: hash, supabase_user_id: null }] } : {}));
  const bad = mockRes();
  await deleteAccount({ body: { confirmEmail: 'person@example.com', password: 'wrong' } } as never, bad.res, { getUser: asUser });
  assert.equal(bad.out.status, 403);
  const missing = mockRes();
  await deleteAccount({ body: { confirmEmail: 'person@example.com' } } as never, missing.res, { getUser: asUser });
  assert.equal(missing.out.status, 403);
  assert.ok(f.queries.every((q) => !/DELETE/.test(q.text)));

  const ok = mockRes();
  await deleteAccount({ body: { confirmEmail: ' PERSON@example.com ', password: 'correct-horse' } } as never, ok.res, { getUser: asUser });
  assert.equal(ok.out.status, 200);
  assert.deepEqual(ok.out.body, { ok: true, identityRemoved: true });
  const del = f.queries.find((q) => /DELETE FROM users/.test(q.text))!;
  assert.deepEqual(del.params, [9]);
  assert.equal(ok.out.cleared, true, 'the sign-in cookies are cleared');
  f.restore();
});

test('a Supabase account removes the sign-in identity first, with no password needed', async () => {
  process.env.AUTH_PROVIDER = 'supabase';
  try {
    const order: string[] = [];
    const f = fakeDb((q) => {
      if (/SELECT password_hash/.test(q.text)) return { rows: [{ password_hash: null, supabase_user_id: 'sb-123' }] };
      if (/DELETE FROM users/.test(q.text)) order.push('local');
      return {};
    });
    const r = mockRes();
    await deleteAccount({ body: { confirmEmail: 'person@example.com' } } as never, r.res, {
      getUser: asUser,
      removeSupabaseUser: async (id) => { order.push(`supabase:${id}`); return true; },
    });
    assert.equal(r.out.status, 200);
    assert.deepEqual(order, ['supabase:sb-123', 'local']);
    f.restore();
  } finally {
    delete process.env.AUTH_PROVIDER;
  }
});

test('if the sign-in identity cannot be removed, nothing is deleted and the person is told', async () => {
  process.env.AUTH_PROVIDER = 'supabase';
  try {
    const f = fakeDb((q) => (/SELECT password_hash/.test(q.text) ? { rows: [{ password_hash: null, supabase_user_id: 'sb-123' }] } : {}));
    const r = mockRes();
    await deleteAccount({ body: { confirmEmail: 'person@example.com' } } as never, r.res, {
      getUser: asUser,
      removeSupabaseUser: async () => { throw new Error('upstream down'); },
    });
    assert.equal(r.out.status, 502);
    assert.match(String((r.out.body as { error: string }).error), /Nothing was deleted/);
    assert.ok(f.queries.every((q) => !/DELETE FROM users/.test(q.text)), 'the local data is kept so they can try again');
    assert.equal(r.out.cleared, false);
    f.restore();
  } finally {
    delete process.env.AUTH_PROVIDER;
  }
});

test('a Supabase deployment with no admin key still deletes the local data and says the identity remains', async () => {
  process.env.AUTH_PROVIDER = 'supabase';
  try {
    const f = fakeDb((q) => (/SELECT password_hash/.test(q.text) ? { rows: [{ password_hash: null, supabase_user_id: 'sb-123' }] } : {}));
    const r = mockRes();
    await deleteAccount({ body: { confirmEmail: 'person@example.com' } } as never, r.res, { getUser: asUser, removeSupabaseUser: async () => false });
    assert.equal(r.out.status, 200);
    assert.deepEqual(r.out.body, { ok: true, identityRemoved: false });
    f.restore();
  } finally {
    delete process.env.AUTH_PROVIDER;
  }
});

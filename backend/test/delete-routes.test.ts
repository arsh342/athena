import assert from 'node:assert/strict';
import test from 'node:test';

function mockRes() {
  const state: { statusCode: number; jsonBody: unknown } = { statusCode: 200, jsonBody: null };
  const res = { status(c: number) { state.statusCode = c; return this; }, json(b: unknown) { state.jsonBody = b; return this; } };
  return { res, state };
}

function handlerFor(app: any, path: string, method: 'delete') {
  const router = app._router ?? app.router;
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[0].handle;
}

async function appWith(over: { user?: { id: number; email: string } | null; deleteScan?: any; deleteAllScans?: any; deleteAccount?: any }) {
  const snapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = snapshot;
  const user = over.user === undefined ? { id: 42, email: 'dev@athena.dev' } : over.user;
  return createApp({
    auth: { getAuthenticatedUser: async () => user, ...(over.deleteAccount ? { deleteAccount: over.deleteAccount } : {}) } as never,
    data: { ...(over.deleteScan ? { deleteScan: over.deleteScan } : {}), ...(over.deleteAllScans ? { deleteAllScans: over.deleteAllScans } : {}) } as never,
  });
}

test('DELETE /api/scans/:scanId needs a session and deletes only for the signed-in user', async () => {
  const calls: unknown[][] = [];
  const app = await appWith({ deleteScan: async (...a: unknown[]) => { calls.push(a); return 'deleted'; } });
  const { res, state } = mockRes();
  await handlerFor(app, '/api/scans/:scanId', 'delete')({ params: { scanId: 'abc' }, cookies: {} }, res);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.jsonBody, { ok: true });
  assert.deepEqual(calls, [['abc', 42]]);

  const anon = await appWith({ user: null, deleteScan: async () => { throw new Error('must not run'); } });
  const r2 = mockRes();
  await handlerFor(anon, '/api/scans/:scanId', 'delete')({ params: { scanId: 'abc' }, cookies: {} }, r2.res);
  assert.equal(r2.state.statusCode, 401);
});

test('DELETE /api/scans/:scanId answers 404 for someone else\'s scan and 409 for a running one', async () => {
  for (const [result, status] of [['not-found', 404], ['running', 409]] as const) {
    const app = await appWith({ deleteScan: async () => result });
    const { res, state } = mockRes();
    await handlerFor(app, '/api/scans/:scanId', 'delete')({ params: { scanId: 'x' }, cookies: {} }, res);
    assert.equal(state.statusCode, status);
  }
});

test('DELETE /api/scans deletes everything only with an explicit confirm', async () => {
  let called = 0;
  const app = await appWith({ deleteAllScans: async () => { called += 1; return 3; } });
  const refused = mockRes();
  await handlerFor(app, '/api/scans', 'delete')({ body: {}, cookies: {} }, refused.res);
  assert.equal(refused.state.statusCode, 400);
  assert.equal(called, 0);
  const ok = mockRes();
  await handlerFor(app, '/api/scans', 'delete')({ body: { confirm: true }, cookies: {} }, ok.res);
  assert.deepEqual(ok.state.jsonBody, { ok: true, deleted: 3 });
});

test('DELETE /api/account hands the request to the account deleter', async () => {
  let seen = false;
  const app = await appWith({ deleteAccount: async (_req: unknown, res: any) => { seen = true; res.json({ ok: true }); } });
  const { res, state } = mockRes();
  await handlerFor(app, '/api/account', 'delete')({ body: {}, cookies: {} }, res);
  assert.equal(seen, true);
  assert.deepEqual(state.jsonBody, { ok: true });
});

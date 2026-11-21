import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import request from 'supertest';
import { buildContributions } from '@athena/core';
import { db } from '../src/db.ts';
import { MAX_PER_INSTALL_30D, RETENTION_MONTHS, RateLimiter, purgeExpired } from '../src/learning.ts';

type Q = { text: string; params?: unknown[] };

/** A stand-in table: counts, inserts and deletes behave like the real queries. */
function fakeDb(initialCount = 0) {
  const handle = db as unknown as { query: typeof db.query };
  const original = handle.query;
  const queries: Q[] = [];
  const rows: Array<{ install: string; record: unknown }> = [];
  handle.query = (async (text: string, params?: unknown[]) => {
    queries.push({ text, params });
    if (/SELECT COUNT\(\*\)/.test(text)) return { rows: [{ n: initialCount + rows.filter((r) => r.install === params?.[0]).length }] };
    if (/INSERT INTO learning_contributions/.test(text)) {
      for (const r of JSON.parse(String(params?.[1]))) rows.push({ install: String(params?.[0]), record: r });
      return { rows: [], rowCount: JSON.parse(String(params?.[1])).length };
    }
    if (/DELETE FROM learning_contributions WHERE install_id/.test(text)) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i]!.install === params?.[0]) rows.splice(i, 1);
      return { rows: [], rowCount: before - rows.length };
    }
    if (/DELETE FROM learning_contributions WHERE received_at/.test(text)) return { rows: [], rowCount: 7 };
    return { rows: [] };
  }) as typeof db.query;
  return { queries, rows, restore: () => { handle.query = original; } };
}

const idA = 'a'.repeat(32);
const idB = 'b'.repeat(32);
const records = (n: number, installId = idA) => buildContributions(
  Array.from({ length: n }, (_, i) => ({ label: (i % 2 ? 'ai' : 'human') as 'ai' | 'human', source: 'recorded' as const, language: 'python', lines: 30, dense: Array.from({ length: 35 }, (_, j) => (i + j) / 50), pBase: 0.7 })),
  { installId, cliVersion: '0.4.4', baseTag: 'fast:0.2.1', tuned: false },
);

async function app() {
  const snapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = snapshot;
  return createApp({ auth: { getAuthenticatedUser: async () => null } as never });
}

test('a valid batch is accepted (202), needs no login, and is stored under its install id', async () => {
  const f = fakeDb();
  try {
    const res = await request(await app()).post('/api/learning/contributions').send({ records: records(3) });
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { accepted: 3 });
    assert.equal(f.rows.length, 3);
    assert.ok(f.rows.every((r) => r.install === idA));
  } finally { f.restore(); }
});

test('a record with an extra field, a missing batch, or mixed install ids is refused (400) and nothing is stored', async () => {
  const f = fakeDb();
  try {
    const a = await app();
    const withExtra = { ...records(1)[0]!, code: 'secret()' };
    assert.equal((await request(a).post('/api/learning/contributions').send({ records: [withExtra] })).status, 400);
    assert.equal((await request(a).post('/api/learning/contributions').send({})).status, 400);
    assert.equal((await request(a).post('/api/learning/contributions').send({ records: [] })).status, 400);
    assert.equal((await request(a).post('/api/learning/contributions').send({ records: [...records(1, idA), ...records(1, idB)] })).status, 400);
    assert.equal(f.rows.length, 0);
  } finally { f.restore(); }
});

test('a full batch of 500 valid records is accepted, so the body size limit is not in the way', async () => {
  const f = fakeDb();
  try {
    const body = { records: records(500) };
    assert.ok(JSON.stringify(body).length > 150_000, 'a full batch is larger than the default 100KB body limit');
    const res = await request(await app()).post('/api/learning/contributions').send(body);
    assert.equal(res.status, 202);
    assert.equal(f.rows.length, 500);
  } finally { f.restore(); }
});

test('more than 500 records in one request is refused (413) by the server\'s own check', async () => {
  const f = fakeDb();
  try {
    const res = await request(await app()).post('/api/learning/contributions').send({ records: records(501) });
    assert.equal(res.status, 413);
    assert.match(String(res.body.error), /At most 500/, 'our message, not the body parser\'s');
    assert.equal(f.rows.length, 0);
  } finally { f.restore(); }
});

test('an install past its 30 day cap is turned away (429), and one under it is accepted', async () => {
  const over = fakeDb(MAX_PER_INSTALL_30D - 2);
  try {
    const res = await request(await app()).post('/api/learning/contributions').send({ records: records(5) });
    assert.equal(res.status, 429);
    assert.equal(over.rows.length, 0);
  } finally { over.restore(); }
  const under = fakeDb(MAX_PER_INSTALL_30D - 5);
  try {
    assert.equal((await request(await app()).post('/api/learning/contributions').send({ records: records(5) })).status, 202);
  } finally { under.restore(); }
});

test('flooding from one install id is rate limited (429)', async () => {
  const f = fakeDb();
  try {
    const a = await app();
    const statuses: number[] = [];
    for (let i = 0; i < 35; i += 1) statuses.push((await request(a).post('/api/learning/contributions').send({ records: records(1, idB) })).status);
    assert.equal(statuses.filter((s) => s === 202).length, 30);
    assert.ok(statuses.slice(30).every((s) => s === 429));
  } finally { f.restore(); }
});

test('DELETE removes only that install id\'s records, and only a well-formed id is accepted', async () => {
  const f = fakeDb();
  try {
    const a = await app();
    await request(a).post('/api/learning/contributions').send({ records: records(2, idA) });
    await request(a).post('/api/learning/contributions').send({ records: records(3, idB) });
    assert.equal(f.rows.length, 5);
    const res = await request(a).delete(`/api/learning/contributions/${idA}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, deleted: 2 });
    assert.equal(f.rows.length, 3);
    assert.ok(f.rows.every((r) => r.install === idB));
    assert.equal((await request(a).delete('/api/learning/contributions/not-an-id')).status, 400);
    assert.equal((await request(a).delete('/api/learning/contributions/%27%3B%20DROP%20TABLE%20users--')).status, 400);
  } finally { f.restore(); }
});

test('the table has no IP column, and nothing in the learning code stores an address', () => {
  const schema = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8');
  const block = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS learning_contributions'), schema.indexOf(');', schema.indexOf('CREATE TABLE IF NOT EXISTS learning_contributions')));
  assert.ok(block.length > 40);
  assert.ok(!/\bip\b|ip_addr|remote|address/i.test(block), 'no address column');
  const code = readFileSync(new URL('../src/learning.ts', import.meta.url), 'utf8');
  const inserts = code.match(/INSERT INTO learning_contributions[\s\S]*?\[[^\]]*\]/)?.[0] ?? '';
  assert.ok(!/\bip\b/.test(inserts), 'the insert does not take the address');
});

test('the retention job deletes records older than 18 months', async () => {
  const f = fakeDb();
  try {
    assert.equal(await purgeExpired(), 7);
    const q = f.queries.find((x) => /received_at </.test(x.text))!;
    assert.deepEqual(q.params, [String(RETENTION_MONTHS)]);
    assert.equal(RETENTION_MONTHS, 18);
  } finally { f.restore(); }
});

test('the rate limiter forgets old requests', () => {
  let now = 0;
  const l = new RateLimiter(2, 1000, () => now);
  assert.ok(l.take('k') && l.take('k'));
  assert.equal(l.take('k'), false);
  now = 1500;
  assert.ok(l.take('k'));
  assert.ok(l.take('other'));
});

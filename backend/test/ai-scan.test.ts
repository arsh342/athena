import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { parseAiHeaders, acquireAiSlot, scrub } from '../src/ai-scan.ts';

const KEY = 'sk-ant-SECRETKEY1234567890';
const ok = { 'x-ai-provider': 'anthropic', 'x-ai-key': KEY, 'x-ai-budget': '0.2', 'x-ai-consent': 'accepted' };

test('no AI header means no AI; a key, a budget and a model are required', () => {
  assert.equal(parseAiHeaders({}).kind, 'none');
  assert.match((parseAiHeaders({ 'x-ai-provider': 'anthropic', 'x-ai-budget': '0.2' }) as any).error, /key is required/);
  assert.match((parseAiHeaders({ 'x-ai-provider': 'anthropic', 'x-ai-key': KEY }) as any).error, /spend cap is required/);
  assert.match((parseAiHeaders({ ...ok, 'x-ai-budget': '5' }) as any).error, /at most \$1\.00/);
  assert.match((parseAiHeaders({ ...ok, 'x-ai-provider': 'openai' }) as any).error, /Choose a model/, 'non-Anthropic providers have no default model');
  assert.match((parseAiHeaders({ ...ok, 'x-ai-provider': 'bogus' }) as any).error, /Unknown AI provider/);
  const good = parseAiHeaders(ok) as any;
  assert.equal(good.kind, 'ok');
  assert.equal(good.request.model, 'claude-sonnet-5-5');
  assert.equal(good.consented, true);
  assert.match(good.consent, /api\.anthropic\.com/);
  assert.match(good.consent, /not stored or logged/);
});

test('base URLs: only https, default port, allowlisted hosts; local presets and internal hosts are refused (no SSRF)', () => {
  const compat = { ...ok, 'x-ai-provider': 'openai-compatible', 'x-ai-model': 'm' };
  for (const bad of ['http://api.groq.com/openai/v1', 'https://169.254.169.254/latest', 'https://localhost/v1', 'https://10.0.0.5/v1', 'https://api.groq.com:8443/v1', 'https://user:pw@api.groq.com/v1', 'https://evil.example/v1', 'not a url']) {
    assert.equal(parseAiHeaders({ ...compat, 'x-ai-base-url': bad }).kind, 'error', bad);
  }
  assert.equal(parseAiHeaders({ ...compat, 'x-ai-base-url': 'https://api.groq.com/openai/v1' }).kind, 'ok');
  assert.equal(parseAiHeaders({ ...compat, 'x-ai-preset': 'groq' }).kind, 'ok');
  assert.match((parseAiHeaders({ ...compat, 'x-ai-preset': 'ollama' }) as any).error, /local/i);
  assert.equal(parseAiHeaders({ ...compat, 'x-ai-base-url': 'https://models.corp.example/v1' }, { ATHENA_AI_ALLOWED_HOSTS: 'models.corp.example' }).kind, 'ok');
  assert.equal(parseAiHeaders({ ...ok, 'x-ai-base-url': 'https://api.groq.com/v1' }).kind, 'error', 'a base URL is not accepted for first-party providers');
});

test('one AI scan at a time per user', () => {
  const first = acquireAiSlot(42)!;
  assert.ok(first);
  assert.equal(acquireAiSlot(42), null);
  assert.ok(acquireAiSlot(43));
  first();
  assert.ok(acquireAiSlot(42));
});

test('scrub removes the key and key-shaped strings', () => {
  assert.ok(!scrub(`failed with ${KEY} and Bearer abcdefghijklmnop`, KEY).includes('SECRETKEY'));
  assert.ok(!scrub('Bearer abcdefghijklmnop', undefined).includes('abcdefghijklmnop'));
});

async function app(runScan: (...a: any[]) => Promise<any>) {
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  return createApp({
    auth: { getAuthenticatedUser: async () => ({ id: 7, email: 'u@example.com' }) } as any,
    repo: { validateRepoUrl: (u: string) => ({ ok: true, value: u }) } as any,
    scan: { runScan, runUploadScan: async () => { throw new Error('unused'); } } as any,
  });
}
const done = { scan: { scanId: 's' }, findings: [], terminalLines: [] };

test('the scan route: consent text returned first, the key reaches the scanner only on an AI scan, and nothing is logged', async () => {
  const seen: any[] = [];
  const a = await app(async (...args: any[]) => { seen.push(args); return done; });
  const logs: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...x: unknown[]) => { logs.push(x.join(' ')); };
  try {
    const plain = await request(a).post('/api/scans').send({ repoUrl: 'https://github.com/a/b' });
    assert.equal(plain.status, 200);
    assert.equal(seen[0][3], undefined, 'no AI without headers');

    const noConsent = await request(a).post('/api/scans').set({ ...ok, 'x-ai-consent': '' }).send({ repoUrl: 'https://github.com/a/b' });
    assert.equal(noConsent.status, 428);
    assert.match(noConsent.body.consent, /Short excerpts of your code/);
    assert.equal(seen.length, 1, 'nothing scanned without consent');

    const noBudget = await request(a).post('/api/scans').set({ ...ok, 'x-ai-budget': '' }).send({ repoUrl: 'https://github.com/a/b' });
    assert.equal(noBudget.status, 400);

    const withAi = await request(a).post('/api/scans').set(ok).send({ repoUrl: 'https://github.com/a/b' });
    assert.equal(withAi.status, 200);
    assert.equal(seen[1][3].key, KEY);
    assert.equal(seen[1][3].budgetUsd, 0.2);
    assert.ok(!JSON.stringify(withAi.body).includes('SECRETKEY'), 'the key is never echoed');
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(!logs.join('\n').includes('SECRETKEY'));
});

test('a failing AI scan never leaks the key in the error or the log, and frees the slot', async () => {
  const a = await app(async () => { throw new Error(`401 invalid x-api-key ${KEY}`); });
  const logs: string[] = [];
  const orig = console.error;
  console.error = (...x: unknown[]) => { logs.push(x.join(' ')); };
  let res: any;
  try {
    res = await request(a).post('/api/scans').set(ok).send({ repoUrl: 'https://github.com/a/b' });
  } finally {
    console.error = orig;
  }
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(res.body).includes('SECRETKEY'));
  assert.ok(!logs.join('\n').includes('SECRETKEY'));
  const free = acquireAiSlot(7);
  assert.ok(free, 'slot released after failure');
  free!();
});

test('a second concurrent AI scan by the same user is refused', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const a = await app(async () => { await gate; return done; });
  const first = request(a).post('/api/scans').set(ok).send({ repoUrl: 'https://github.com/a/b' }).then((r) => r);
  await new Promise((r) => setTimeout(r, 100));
  const second = await request(a).post('/api/scans').set(ok).send({ repoUrl: 'https://github.com/a/b' });
  assert.equal(second.status, 429);
  release();
  assert.equal((await first).status, 200);
});

test('options endpoint lists hosted presets only and the budget ceiling', async () => {
  const a = await app(async () => done);
  const r = await request(a).get('/api/ai/options');
  assert.ok(!r.body.presets.includes('ollama') && r.body.presets.includes('groq'));
  assert.equal(r.body.maxBudgetUsd, 1);
});

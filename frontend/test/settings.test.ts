import './storage-shim.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

const session = new Map<string, string>();
(globalThis as { sessionStorage?: Storage }).sessionStorage = {
  getItem: (k: string) => session.get(k) ?? null,
  setItem: (k: string, v: string) => { session.set(k, String(v)); },
  removeItem: (k: string) => { session.delete(k); },
  clear: () => session.clear(), key: () => null, length: 0,
} as unknown as Storage;

const { DEFAULT_SETTINGS, aiHeaders, aiReady, clearAiSettings, loadAiSettings, maskedKey, saveAiSettings } = await import('../src/utils/ai-settings.ts');
const { startScan, startUploadScan } = await import('../src/services/api.ts');

const on = { ...DEFAULT_SETTINGS, enabled: true, key: 'sk-ant-SECRET1234', budgetUsd: 0.2, consented: true };

test('no AI headers unless AI is on, complete, and has a key', () => {
  assert.deepEqual(aiHeaders(DEFAULT_SETTINGS), {});
  assert.deepEqual(aiHeaders({ ...on, enabled: false }), {});
  assert.deepEqual(aiHeaders({ ...on, key: '' }), {});
  assert.deepEqual(aiHeaders({ ...on, provider: 'openai', model: '' }), {}, 'non-Anthropic needs a model');
  assert.equal(aiReady({ ...on, provider: 'openai-compatible', model: 'm', preset: '' }), false);
  const h = aiHeaders(on);
  assert.equal(h['X-AI-Provider'], 'anthropic');
  assert.equal(h['X-AI-Key'], 'sk-ant-SECRET1234');
  assert.equal(h['X-AI-Budget'], '0.2');
  assert.equal(h['X-AI-Consent'], 'accepted');
  assert.equal(aiHeaders({ ...on, consented: false })['X-AI-Consent'], undefined, 'consent is only claimed once given');
});

test('the key is kept for this tab only: sessionStorage, never localStorage', () => {
  saveAiSettings(on);
  assert.equal(loadAiSettings().key, 'sk-ant-SECRET1234');
  assert.equal(localStorage.length, 0);
  assert.ok(![...Array(localStorage.length)].some((_, i) => localStorage.getItem(localStorage.key(i)!)?.includes('SECRET')));
  clearAiSettings();
  assert.equal(loadAiSettings().key, '');
  assert.equal(maskedKey('sk-ant-SECRET1234'), '••••1234');
});

test('headers ride only on AI scans: an ordinary scan and an upload without AI carry none', async () => {
  const seen: Headers[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => { seen.push(new Headers(init?.headers)); return new Response(JSON.stringify({ scan: {}, findings: [], lines: [] }), { status: 200 }); }) as typeof fetch;
  try {
    await startScan('https://github.com/a/b', undefined, DEFAULT_SETTINGS);
    await startUploadScan(new FormData(), 'sess', DEFAULT_SETTINGS);
    await startScan('https://github.com/a/b', 'sess', on);
  } finally {
    globalThis.fetch = realFetch;
  }
  for (const h of seen.slice(0, 2)) assert.ok(![...h.keys()].some((k) => k.startsWith('x-ai-')));
  assert.equal(seen[2]!.get('x-ai-key'), 'sk-ant-SECRET1234');
  assert.equal(seen[2]!.get('x-terminal-session'), 'sess');
});

test('server error messages (consent, budget, concurrency) reach the user', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'A spend cap is required' }), { status: 400 })) as typeof fetch;
  try {
    await assert.rejects(startScan('https://github.com/a/b', undefined, on), /spend cap is required/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

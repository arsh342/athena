import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { isValidContribution, loadLearning, saveLearning, type LearningState } from '@athena/core';
import { shareCommand } from '../src/commands/learning.ts';
import { loadProjectConfig } from '../src/utils/project-config.ts';
import { sendContributions } from '../src/utils/share.ts';
import { shareAfterScan } from '../src/utils/share-after-scan.ts';
import { INSTALL_ID_DAYS, ensureInstallId, loadSettings, saveSettings, sharingState, shareUrl } from '../src/utils/settings.ts';

const home = () => mkdtempSync(join(tmpdir(), 'athena-share-'));
const root = '/repo/example';

function state(n = 3): LearningState {
  return {
    version: 1, marks: [], baseTag: 'fast:0.2.1', adjustment: null, labelSet: '',
    samples: Array.from({ length: n }, (_, i) => ({
      sha: `sha-${i}`, y: (i % 2) as 0 | 1, pBase: 0.8, dense: Array.from({ length: 35 }, (_, j) => (j + i) / 40), source: i % 3 === 0 ? 'mark' : 'recorded',
      path: '/secret/path/file.ts', language: 'typescript', lines: 20 + i,
    })),
  };
}

type Seen = { method: string; url: string; body: string };
function fakeServer(status = 202): Promise<{ url: string; seen: Seen[]; close: () => void }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (c) => { body += String(c); });
    req.on('end', () => { seen.push({ method: req.method ?? '', url: req.url ?? '', body }); res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, deleted: 3 })); });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${port}`, seen, close: () => server.close() });
  }));
}

const base = { root, mode: 'scan' as const, learning: true, quiet: false, format: 'terminal', interactive: true, env: {} as NodeJS.ProcessEnv };

test('sharing is off by default, and `on` refuses an invalid server address', async () => {
  const h = home();
  assert.deepEqual(loadSettings(h), {});
  assert.equal(sharingState({}, undefined, {}, false).on, false);
  assert.equal(await shareCommand('on', { home: h }, { ATHENA_SHARE_URL: 'http://evil.example' }), 2, 'invalid address');
  assert.equal(loadSettings(h).share, undefined);
  assert.equal(shareUrl({}, {}), 'https://athena-g3hp.onrender.com', 'the built-in default');
  assert.equal(await shareCommand('on', { home: h, server: 'https://example.org' }, {}), 0);
  const s = loadSettings(h);
  assert.equal(s.share, 'on');
  assert.match(s.installId!, /^[0-9a-f]{32}$/);
  assert.equal(statSync(join(h, 'settings.json')).mode & 0o777, 0o600);
});

test('the server address must be https (http only for localhost)', () => {
  assert.equal(shareUrl({ shareUrl: 'http://evil.example' }, {}), null);
  assert.equal(shareUrl({ shareUrl: 'https://ok.example/' }, {}), 'https://ok.example');
  assert.equal(shareUrl({}, { ATHENA_SHARE_URL: 'http://localhost:8787' }), 'http://localhost:8787');
  assert.equal(shareUrl({ shareUrl: 'not a url' }, {}), null);
});

test('a repository can force sharing off but never on; CI never shares', () => {
  const on = { share: 'on' as const, shareUrl: 'https://ok.example' };
  assert.equal(sharingState(on, 'off', {}, false).on, false);
  assert.equal(sharingState(on, 'on', {}, false).on, true, 'the repo setting changes nothing when the user said on');
  assert.equal(sharingState({ share: 'off', shareUrl: 'https://ok.example' }, 'on', {}, false).on, false, 'a repo "on" cannot turn it on');
  assert.equal(sharingState(on, undefined, {}, true).on, false);
});

test('config: learning.share is read, and only the user can turn sharing on', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-cfg-'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'athena.config.json'), JSON.stringify({ learning: { share: 'off' } }));
  assert.equal((await loadProjectConfig(dir)).learningShare, 'off');
  writeFileSync(join(dir, 'athena.config.json'), JSON.stringify({ learning: false }));
  assert.equal((await loadProjectConfig(dir)).learning, false);
  writeFileSync(join(dir, 'athena.config.json'), JSON.stringify({ learning: { share: 'maybe' } }));
  await assert.rejects(() => loadProjectConfig(dir), /learning.share/);
});

test('the install id rotates after 90 days and the old one is remembered for deletion', () => {
  const first = ensureInstallId({}, new Date('2026-01-01'));
  assert.equal(ensureInstallId(first, new Date('2026-02-01')).installId, first.installId, 'unchanged inside 90 days');
  const later = ensureInstallId(first, new Date(Date.parse('2026-01-01') + (INSTALL_ID_DAYS + 1) * 86_400_000));
  assert.notEqual(later.installId, first.installId);
  assert.deepEqual(later.pastInstallIds, [first.installId]);
});

test('the one-time question: asked only for scan, on a terminal, outside CI, once, default no', async () => {
  const server = await fakeServer();
  const env = { ATHENA_SHARE_URL: server.url };
  try {
    for (const [label, args] of [
      ['check mode', { mode: 'check' as const }], ['review mode', { mode: 'review' as const }], ['no terminal', { interactive: false }],
      ['CI', { env: { ...env, CI: 'true' } }], ['repo turns it off', { repoShare: 'off' as const }], ['no learning', { learning: false }],
    ] as const) {
      const h = home();
      saveLearning(root, state(), h);
      let asked = 0;
      await shareAfterScan({ ...base, env, home: h, ...args, ask: async () => { asked += 1; return true; } });
      assert.equal(asked, 0, `${label}: the question must not appear`);
      assert.equal(loadSettings(h).share, undefined, `${label}: nothing changes`);
    }
    // Asked, and "no" is the default answer.
    const h = home();
    saveLearning(root, state(), h);
    let asked = 0;
    await shareAfterScan({ ...base, env, home: h, ask: async () => { asked += 1; return false; } });
    assert.equal(asked, 1);
    assert.equal(loadSettings(h).share, 'off');
    assert.deepEqual(server.seen, [], 'a no sends nothing');
    await shareAfterScan({ ...base, env, home: h, ask: async () => { asked += 1; return true; } });
    assert.equal(asked, 1, 'never asked twice');
    // No labelled samples yet: nothing to ask about.
    const empty = home();
    await shareAfterScan({ ...base, env, home: empty, ask: async () => { asked += 1; return true; } });
    assert.equal(asked, 1);
  } finally {
    server.close();
  }
});

test('with sharing on, valid records reach the server once, with no code or paths, and are remembered as sent', async () => {
  const server = await fakeServer();
  const env = { ATHENA_SHARE_URL: server.url };
  try {
    const h = home();
    saveSettings({ share: 'on', shareAsked: true, ...ensureInstallId({}) }, h);
    saveLearning(root, state(4), h);
    await shareAfterScan({ ...base, env, home: h });
    assert.equal(server.seen.length, 1);
    assert.equal(server.seen[0]!.method, 'POST');
    assert.equal(server.seen[0]!.url, '/api/learning/contributions');
    const payload = JSON.parse(server.seen[0]!.body) as { records: unknown[] };
    assert.equal(payload.records.length, 4);
    assert.ok(payload.records.every(isValidContribution));
    assert.ok(!server.seen[0]!.body.includes('/secret/path') && !server.seen[0]!.body.includes('sha-'), 'no paths, no hashes');
    assert.equal(loadLearning(root, h).sent?.length, 4);
    assert.equal(loadSettings(h).sentTotal, 4);
    await shareAfterScan({ ...base, env, home: h });
    assert.equal(server.seen.length, 1, 'already-sent samples are not sent again');
  } finally {
    server.close();
  }
});

test('a dead server returns within the timeout, throws nothing, and keeps the samples for next time', async () => {
  const h = home();
  saveSettings({ share: 'on', shareAsked: true, ...ensureInstallId({}) }, h);
  saveLearning(root, state(), h);
  const started = Date.now();
  await shareAfterScan({ ...base, env: { ATHENA_SHARE_URL: 'http://127.0.0.1:1' }, home: h, timeoutMs: 800 });
  assert.ok(Date.now() - started < 3000, 'well inside the 3 second budget');
  assert.equal(loadLearning(root, h).sent?.length ?? 0, 0, 'not marked sent');
  const quick = Date.now();
  assert.equal((await sendContributions('http://127.0.0.1:1', [{} as never], 500)).ok, false);
  assert.ok(Date.now() - quick < 2000);
});

test('off --delete asks the server to delete every install id, then forgets them; a failure forgets nothing', async () => {
  const server = await fakeServer(200);
  const env = { ATHENA_SHARE_URL: server.url };
  try {
    const h = home();
    saveSettings({ share: 'on', installId: 'b'.repeat(32), installIdCreatedAt: new Date().toISOString(), pastInstallIds: ['a'.repeat(32)], sentTotal: 9 }, h);
    saveLearning(root, { ...state(), sent: ['x'] }, h);
    assert.equal(await shareCommand('off', { delete: true, home: h, path: root }, env), 0);
    assert.deepEqual(server.seen.map((s) => `${s.method} ${s.url}`).sort(), [`DELETE /api/learning/contributions/${'a'.repeat(32)}`, `DELETE /api/learning/contributions/${'b'.repeat(32)}`]);
    const s = loadSettings(h);
    assert.equal(s.share, 'off');
    assert.equal(s.installId, undefined);
    assert.equal(s.pastInstallIds, undefined);
    assert.deepEqual(loadLearning(root, h).sent, []);
  } finally {
    server.close();
  }
  const h2 = home();
  saveSettings({ share: 'on', installId: 'c'.repeat(32), installIdCreatedAt: new Date().toISOString() }, h2);
  assert.equal(await shareCommand('off', { delete: true, home: h2, path: root }, { ATHENA_SHARE_URL: 'http://127.0.0.1:1' }), 2);
  assert.equal(loadSettings(h2).installId, 'c'.repeat(32), 'the id is kept so the delete can be retried');
});

test('status shows the sharing state and a sample record, and what is never sent', async () => {
  const h = home();
  const out: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = ((chunk: string) => { out.push(String(chunk)); return true; }) as never;
  try {
    assert.equal(await shareCommand('status', { home: h, path: root }, {}), 0);
  } finally {
    (process.stdout as { write: unknown }).write = write;
  }
  const text = out.join('');
  assert.match(text, /Sharing: off/);
  assert.match(text, /An example record/);
  assert.match(text, /Never sent: your code/);
});

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import request from 'supertest';

test('an upload is stored on disk (not held in memory), reaches the scanner intact, and the temporary copy is deleted afterwards', async () => {
  const snapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = snapshot;

  const seen: { path?: string; hadBuffer?: boolean; content?: string } = {};
  const app = createApp({
    auth: { getAuthenticatedUser: async () => ({ id: 42, email: 'dev@athena.dev' }) } as never,
    scan: {
      runUploadScan: (async (input: { files: Array<{ path?: string; buffer?: Buffer; originalname: string }> }) => {
        const f = input.files[0]!;
        seen.path = f.path;
        seen.hadBuffer = Boolean(f.buffer);
        seen.content = f.path ? readFileSync(f.path, 'utf8') : '';
        return { scan: { scanId: 's' }, findings: [], terminalLines: [] };
      }) as never,
    } as never,
  });

  const res = await request(app).post('/api/scans/upload').field('mode', 'folder').field('rootName', 'proj').attach('files[]', Buffer.from('console.log(1)\n'), 'proj/app.js');
  assert.equal(res.status, 200);
  assert.ok(seen.path, 'the scanner is given a path on disk');
  assert.equal(seen.hadBuffer, false, 'the bytes are not held in memory');
  assert.equal(seen.content, 'console.log(1)\n');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(existsSync(seen.path!), false, 'the temporary upload is removed');
});

test('a scan turned away as busy answers 429, and the upload is still cleaned up', async () => {
  const snapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  const { ScanBusyError } = await import('../src/scanner.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = snapshot;

  let path = '';
  const app = createApp({
    auth: { getAuthenticatedUser: async () => ({ id: 42, email: 'dev@athena.dev' }) } as never,
    scan: { runUploadScan: (async (input: { files: Array<{ path?: string }> }) => { path = input.files[0]!.path ?? ''; throw new ScanBusyError(); }) as never } as never,
  });
  const res = await request(app).post('/api/scans/upload').field('mode', 'folder').field('rootName', 'p').attach('files[]', Buffer.from('x'), 'p/a.js');
  assert.equal(res.status, 429);
  assert.match(String(res.body.error), /busy/i);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(existsSync(path), false);
});

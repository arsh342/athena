import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DepsClient } from '../src/deps/net.ts';
import { lookupPackage } from '../src/deps/registries.ts';

/** A registry document in the shape npm serves: every release with heavy metadata. */
function bigPackument(): string {
  const versions: Record<string, unknown> = {};
  const time: Record<string, string> = { modified: '2026-01-02T00:00:00.000Z' };
  for (let i = 0; i < 400; i += 1) {
    const v = `1.0.${i}`;
    versions[v] = { name: 'pkg', version: v, readme: 'x'.repeat(4000), dist: { tarball: 'https://example.invalid/t.tgz', integrity: 'sha512-' + 'a'.repeat(86) }, dependencies: { a: '^1', b: '^2' }, scripts: v === '1.0.7' ? { postinstall: 'node x.js' } : { test: 'jest' }, ...(v === '1.0.3' ? { deprecated: 'use 1.0.4' } : {}) };
    time[v] = `2025-01-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`;
  }
  return JSON.stringify({ name: 'pkg', versions, time, 'dist-tags': { latest: '1.0.399' } });
}

test('npm lookups keep what is reported (deprecation, install scripts, publish times) and drop the rest before caching', async () => {
  const body = bigPackument();
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  const cacheDir = mkdtempSync(join(tmpdir(), 'athena-slim-'));
  try {
    const client = new DepsClient({ cacheDir, registries: { npm: `http://127.0.0.1:${port}` } });
    const dep = (version: string) => ({ ecosystem: 'npm' as const, name: 'pkg', version });
    const deprecated = await lookupPackage(client, dep('1.0.3'));
    const scripted = await lookupPackage(client, dep('1.0.7'));
    const plain = await lookupPackage(client, dep('1.0.9'));
    assert.ok(deprecated?.status === 'ok' && deprecated.info.deprecated === 'use 1.0.4');
    assert.ok(scripted?.status === 'ok' && scripted.info.installScripts.includes('postinstall'));
    assert.ok(plain?.status === 'ok' && plain.info.deprecated === null && plain.info.installScripts.length === 0);
    assert.ok(plain.info.versionPublished !== null && plain.info.latestPublished !== null, 'publish times survive');
    const cached = readdirSync(cacheDir).map((f) => statSync(join(cacheDir, f)).size);
    assert.ok(Math.max(...cached) < body.length / 5, `the cached entry (${Math.max(...cached)} bytes) is far smaller than the registry document (${body.length} bytes)`);
    assert.ok(!readFileSync(join(cacheDir, readdirSync(cacheDir)[0]!), 'utf8').includes('tarball'));
  } finally {
    server.close();
  }
});

test('a registry response over the size limit is skipped and reported as unavailable, not parsed', async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(50 * 1024 * 1024) }); res.write('{"x":'); setTimeout(() => res.destroy(), 50); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  try {
    const client = new DepsClient({ cacheDir: mkdtempSync(join(tmpdir(), 'athena-big-')), registries: { npm: `http://127.0.0.1:${port}` }, retries: 0 });
    const r = await lookupPackage(client, { ecosystem: 'npm', name: 'huge', version: '1.0.0' });
    assert.ok(r?.status === 'unavailable' && /too large/.test(r.reason ?? ''));
  } finally {
    server.close();
  }
});

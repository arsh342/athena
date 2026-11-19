import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DepsClient } from '../src/deps/net.ts';
import { cvss3Score, queryVulnerabilities, severityFromScore } from '../src/deps/osv.ts';
import { lookupPackage } from '../src/deps/registries.ts';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;

async function serve(handler: Handler) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push(`${req.method} ${req.url}`);
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, hits, close: () => server.close() };
}
const json = (res: ServerResponse, data: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const client = (url: string, extra = {}) => new DepsClient({ osvUrl: url, registries: { npm: url, pypi: url, crates: url, packagist: url, nuget: url, maven: url, goproxy: url }, cacheDir: mkdtempSync(join(tmpdir(), 'deps-')), retries: 1, ...extra });

test('CVSS mapping: 9.8 critical, 7.5 high, 5.3 medium, 3.1 low', () => {
  assert.equal(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'), 9.8);
  assert.equal(severityFromScore(9.8), 'CRITICAL');
  assert.equal(severityFromScore(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H')!), 'HIGH');
  assert.equal(severityFromScore(5.3), 'MEDIUM');
  assert.equal(severityFromScore(3.1), 'LOW');
});

test('OSV: querybatch is chunked by 1000, details fetched once, MAL ids are critical, fixed versions reported', async () => {
  const s = await serve((req, body, res) => {
    if (req.url === '/v1/querybatch') {
      const q = (JSON.parse(body) as { queries: Array<{ package: { name: string } }> }).queries;
      return json(res, { results: q.map((x) => ({ vulns: x.package.name === 'bad' ? [{ id: 'GHSA-1' }, { id: 'CVE-1' }] : x.package.name === 'evil' ? [{ id: 'MAL-2023-1' }] : [] })) });
    }
    if (req.url === '/v1/vulns/GHSA-1') return json(res, { id: 'GHSA-1', aliases: ['CVE-1'], summary: 'RCE', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }], affected: [{ package: { name: 'bad' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '2.0.0' }] }], ecosystem_specific: { affected_functions: ['bad.run'] } }] });
    if (req.url === '/v1/vulns/CVE-1') return json(res, { id: 'CVE-1', aliases: ['GHSA-1'], summary: 'RCE' });
    if (req.url === '/v1/vulns/MAL-2023-1') return json(res, { id: 'MAL-2023-1', summary: 'Malicious code' });
    json(res, {}, 404);
  });
  const queries = [{ ecosystem: 'npm' as const, name: 'bad', version: '1.0.0' }, { ecosystem: 'npm' as const, name: 'evil', version: '1.0.0' }, ...Array.from({ length: 1500 }, (_, i) => ({ ecosystem: 'npm' as const, name: `ok${i}`, version: '1.0.0' }))];
  const r = await queryVulnerabilities(client(s.url), queries);
  s.close();
  assert.equal(s.hits.filter((h) => h === 'POST /v1/querybatch').length, 2);
  assert.equal(s.hits.filter((h) => h.startsWith('GET /v1/vulns/')).length, 3);
  const bad = r.advisories.get('npm\0bad\x001.0.0')!;
  assert.equal(bad.length, 1, 'GHSA and CVE aliases are one advisory');
  assert.equal(bad[0]!.severity, 'CRITICAL');
  assert.deepEqual(bad[0]!.fixed, ['2.0.0']);
  assert.deepEqual(bad[0]!.symbols, ['bad.run']);
  const evil = r.advisories.get('npm\0evil\x001.0.0')![0]!;
  assert.equal(evil.malicious, true);
  assert.equal(evil.severity, 'CRITICAL');
  assert.equal(r.unavailable, 0);
});

test('registry: 404 is notfound, 429/503 are unavailable (never "does not exist")', async () => {
  const s = await serve((req, _b, res) => {
    if (req.url === '/ghost') return json(res, {}, 404);
    if (req.url === '/limited') return json(res, {}, 429);
    if (req.url === '/down') return json(res, {}, 503);
    json(res, { versions: { '1.0.0': { deprecated: 'use y', scripts: { postinstall: 'node x.js' } } }, time: { '1.0.0': '2020-01-01T00:00:00Z', modified: '2020-02-01T00:00:00Z' }, 'dist-tags': { latest: '1.0.0' } });
  });
  const c = client(s.url);
  assert.equal((await lookupPackage(c, { ecosystem: 'npm', name: 'ghost', version: '1.0.0' }))?.status, 'notfound');
  assert.equal((await lookupPackage(c, { ecosystem: 'npm', name: 'limited', version: '1.0.0' }))?.status, 'unavailable');
  assert.equal((await lookupPackage(c, { ecosystem: 'npm', name: 'down', version: '1.0.0' }))?.status, 'unavailable');
  const ok = await lookupPackage(c, { ecosystem: 'npm', name: 'real', version: '1.0.0' });
  assert.equal(ok?.status, 'ok');
  if (ok?.status === 'ok') {
    assert.equal(ok.info.deprecated, 'use y');
    assert.deepEqual(ok.info.installScripts, ['postinstall']);
    assert.equal(ok.info.versionPublished, Date.parse('2020-01-01T00:00:00Z'));
  }
  s.close();
});

test('offline: warm cache answers without network, cold cache is unavailable', async () => {
  const s = await serve((_r, _b, res) => json(res, { versions: { '1.0.0': {} }, time: {}, 'dist-tags': {} }));
  const cacheDir = mkdtempSync(join(tmpdir(), 'deps-'));
  const warm = new DepsClient({ registries: { npm: s.url }, cacheDir });
  assert.equal((await lookupPackage(warm, { ecosystem: 'npm', name: 'a', version: '1.0.0' }))?.status, 'ok');
  s.close();
  const offline = new DepsClient({ registries: { npm: s.url }, cacheDir, offline: true, ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await lookupPackage(offline, { ecosystem: 'npm', name: 'a', version: '1.0.0' }))?.status, 'ok', 'stale cache still used offline');
  assert.equal(offline.stats.requests, 0);
  const miss = await lookupPackage(offline, { ecosystem: 'npm', name: 'never-seen', version: '1.0.0' });
  assert.equal(miss?.status, 'unavailable');
});

test('concurrency never exceeds the limit', async () => {
  let active = 0;
  let peak = 0;
  const s = await serve((_r, _b, res) => {
    active += 1;
    peak = Math.max(peak, active);
    setTimeout(() => { active -= 1; json(res, { versions: {}, time: {}, 'dist-tags': {} }); }, 20);
  });
  const c = client(s.url, { concurrency: 4 });
  await Promise.all(Array.from({ length: 30 }, (_, i) => lookupPackage(c, { ecosystem: 'npm', name: `p${i}`, version: '1' })));
  s.close();
  assert.ok(peak <= 4, `peak ${peak}`);
});

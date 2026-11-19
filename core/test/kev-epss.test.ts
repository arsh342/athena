import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { analyzeDependencies } from '../src/deps/analyze.ts';
import { generateReport } from '../src/report/report-generator.ts';
import { mergeConfig } from '../src/config.ts';
import { describeUpdate, ecosystemsFor, needsUpdate, runUpdate } from '../src/updates/scheduler.ts';
import { loadKev } from '../src/updates/kev.ts';
import { parseEpss } from '../src/updates/epss.ts';
import { forgetLocalCache } from '../src/updates/vulndb.ts';
import { makeZip } from './helpers-zip.ts';

const vuln = (id: string, cve: string, name: string, fixed: string) => ({
  id, aliases: [cve], summary: `${id} summary`,
  database_specific: { severity: 'MODERATE' },
  affected: [{ package: { ecosystem: 'npm', name }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed }] }] }], modified: '2026-11-01T00:00:00Z',
});

async function feeds() {
  const records: Record<string, object> = { 'GHSA-kev': vuln('GHSA-kev', 'CVE-2024-0001', 'exploited-lib', '2.0.0'), 'GHSA-plain': vuln('GHSA-plain', 'CVE-2024-0002', 'plain-lib', '2.0.0') };
  const server = createServer((req, res) => {
    if (req.url === '/npm/modified_id.csv') return void res.end('2026-11-01T00:00:01Z,GHSA-plain\n2026-11-01T00:00:00Z,GHSA-kev\n');
    if (req.url === '/npm/all.zip') return void res.end(makeZip(Object.fromEntries(Object.entries(records).map(([id, v]) => [`${id}.json`, JSON.stringify(v)]))));
    if (req.url === '/kev.json') return void res.end(JSON.stringify({ catalogVersion: '2026.11.18', vulnerabilities: [{ cveID: 'CVE-2024-0001', dateAdded: '2026-11-18' }] }));
    if (req.url === '/epss.csv.gz') return void res.end(gzipSync('#model_version:v1,score_date:2026-11-19T12:00:00Z\ncve,epss,percentile\nCVE-2024-0001,0.97000,0.99900\nCVE-2024-0002,0.00100,0.10000\n'));
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => server.close() };
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'kevproj-'));
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ dependencies: { 'exploited-lib': '1.0.0', 'plain-lib': '1.0.0' } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/exploited-lib': { version: '1.0.0' }, 'node_modules/plain-lib': { version: '1.0.0' } } }, null, 2),
  };
  for (const [n, t] of Object.entries(files)) { mkdirSync(dirname(join(root, n)), { recursive: true }); writeFileSync(join(root, n), t); }
  return root;
}
const PROV = { unit: 'lines', totalLines: 0, recorded: { lines: 0, available: false }, estimated: { method: 'heuristic', aiLines: 0, mixedLines: 0, uncertainLines: 0, humanLines: 0 }, files: [] };
const updateOpts = (base: string, home: string) => ({ ecosystems: ['npm'], home, osvBase: base, kevUrl: `${base}/kev.json`, epssUrl: `${base}/epss.csv.gz` });

test('EPSS csv parsing', () => {
  const p = parseEpss('#model_version:v1,score_date:2026-11-19T12:00:00Z\ncve,epss,percentile\nCVE-1,0.5,0.9\n');
  assert.equal(p.scoreDate, '2026-11-19T12:00:00Z');
  assert.deepEqual(p.scores.get('CVE-1'), { score: 0.5, percentile: 0.9 });
});

test('update syncs advisories, KEV and EPSS; offline analysis uses them with no network; KEV is labelled and blocks', async () => {
  const f = await feeds();
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const root = project();
  assert.deepEqual(await ecosystemsFor(root, home), ['npm']);
  const summary = await runUpdate(updateOpts(f.base, home));
  assert.ok(summary && summary.errors.length === 0, JSON.stringify(summary));
  assert.match(describeUpdate(summary!).join('\n'), /\+2 advisories/);
  assert.equal(loadKev(home)?.cves['CVE-2024-0001'], '2026-11-18');
  forgetLocalCache();
  f.close();

  const r = await analyzeDependencies(root, { home, offline: true, registryChecks: false, cacheDir: mkdtempSync(join(tmpdir(), 'c-')), osvUrl: 'http://127.0.0.1:1' });
  const byName = new Map(r.findings.map((x) => [x.dependency!.name, x]));
  assert.equal(byName.get('exploited-lib')!.kev, true);
  assert.equal(byName.get('exploited-lib')!.epss!.score, 0.97);
  assert.ok(byName.get('exploited-lib')!.evidence!.some((e) => /known exploited/.test(e)));
  assert.equal(byName.get('plain-lib')!.kev, undefined);
  assert.equal(r.status, 'ran');
  assert.match(r.detail, /local advisory data npm/);

  const exploited = byName.get('exploited-lib')!;
  assert.equal(exploited.severity, 'MEDIUM');
  const gate = (finding: typeof exploited, cfg = {}) => generateReport(Date.now(), [{ path: 'm', units: [], findings: [finding] }], 0, 0, mergeConfig({ blockOn: ['CRITICAL', 'HIGH'], ...cfg }), { files: [], checks: [], complete: true, gaps: [] }, PROV as never).summary.blocked;
  assert.equal(gate(exploited), true, 'known-exploited blocks at any severity');
  assert.equal(gate({ ...exploited, kev: undefined }), false);
  assert.equal(gate(exploited, { updates: { auto: true, intervalHours: 24, blockKnownExploited: false } }), false);
});

test('data older than 7 days is a coverage gap; fresh data is not', async () => {
  const f = await feeds();
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const root = project();
  await runUpdate(updateOpts(f.base, home));
  f.close();
  forgetLocalCache();
  const opts = { home, offline: true, registryChecks: false, cacheDir: mkdtempSync(join(tmpdir(), 'c-')) };
  assert.deepEqual((await analyzeDependencies(root, opts)).gaps, []);
  const metaPath = join(home, 'vulndb', 'npm', 'meta.json');
  writeFileSync(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, 'utf8')), updatedAt: new Date(Date.now() - 9 * 86_400_000).toISOString() }));
  forgetLocalCache();
  const stale = await analyzeDependencies(root, opts);
  assert.ok(stale.gaps.some((g) => /advisory data 9 days old.*athena update/.test(g)), stale.gaps.join('|'));
  assert.equal(needsUpdate(24, home), true);
  assert.equal(needsUpdate(24 * 30, home), false);
});

test('only one updater runs at a time', async () => {
  const f = await feeds();
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const [a, b] = await Promise.all([runUpdate(updateOpts(f.base, home)), runUpdate(updateOpts(f.base, home))]);
  f.close();
  assert.equal([a, b].filter((x) => x === null).length, 1);
});

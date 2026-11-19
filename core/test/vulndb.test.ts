import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DepsClient } from '../src/deps/net.ts';
import { queryVulnerabilities } from '../src/deps/osv.ts';
import { dbStatus } from '../src/updates/store.ts';
import { syncEcosystem } from '../src/updates/sync-osv.ts';
import { forgetLocalCache, queryLocal } from '../src/updates/vulndb.ts';
import { compareVersions, inRange } from '../src/updates/version.ts';
import { makeZip } from './helpers-zip.ts';

const vuln = (id: string, name: string, fixed: string, extra: Record<string, unknown> = {}) => ({
  id, aliases: [`CVE-${id}`], summary: `${id} summary`, details: 'long details that must be dropped',
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
  affected: [{ package: { ecosystem: 'npm', name }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed }] }] }],
  modified: '2026-11-01T00:00:00Z', ...extra,
});

interface World { records: Record<string, object | null>; modified: Array<[string, string]>; zipHits: number; recordHits: string[]; failZip?: boolean }
async function osvServer(world: World) {
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/npm/modified_id.csv') { res.end([...world.modified].sort((a, b) => b[0].localeCompare(a[0])).map(([t, id]) => `${t},${id}`).join('\n') + '\n'); return; }
    if (url === '/npm/all.zip') {
      world.zipHits += 1;
      if (world.failZip) { res.writeHead(200); res.write('PK-partial'); res.destroy(); return; }
      const files: Record<string, string> = {};
      for (const [id, v] of Object.entries(world.records)) if (v) files[`${id}.json`] = JSON.stringify(v);
      res.end(makeZip(files));
      return;
    }
    const m = /^\/npm\/(.+)\.json$/.exec(url);
    if (m) {
      world.recordHits.push(m[1]!);
      const v = world.records[m[1]!];
      if (!v) { res.writeHead(404); res.end(); return; }
      res.end(JSON.stringify(v));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test('version ordering and OSV range evaluation', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('2.0.0-rc.1', '2.0.0') < 0);
  assert.ok(compareVersions('1.0.0a1', '1.0.0') < 0, 'PEP 440 pre-release');
  assert.ok(compareVersions('v1.2.3', '1.2.3') === 0);
  assert.ok(inRange('1.2.0', [{ introduced: '0' }, { fixed: '1.2.1' }]));
  assert.ok(!inRange('1.2.1', [{ introduced: '0' }, { fixed: '1.2.1' }]));
  assert.ok(!inRange('1.0.0', [{ introduced: '1.1.0' }, { fixed: '1.2.0' }]));
  assert.ok(inRange('1.5.0', [{ introduced: '1.1.0' }, { last_affected: '1.5.0' }]));
  assert.ok(!inRange('1.5.1', [{ introduced: '1.1.0' }, { last_affected: '1.5.0' }]));
  assert.ok(inRange('2.5.0', [{ introduced: '0' }, { fixed: '1.0.0' }, { introduced: '2.0.0' }, { fixed: '2.6.0' }]));
});

test('full sync, incremental sync fetching only changed ids, withdrawn removal, offline parity', async () => {
  const world: World = { records: { A: vuln('A', 'left-pad', '1.3.0'), B: vuln('B', 'lodash', '4.17.21') }, modified: [['2026-11-01T00:00:00Z', 'A'], ['2026-11-01T00:00:01Z', 'B']], zipHits: 0, recordHits: [] };
  const s = await osvServer(world);
  const home = mkdtempSync(join(tmpdir(), 'vdb-'));
  const first = await syncEcosystem('npm', { base: s.base, home });
  assert.equal(first.mode, 'full');
  assert.equal(first.records, 2);
  assert.equal(world.zipHits, 1);
  forgetLocalCache();
  assert.deepEqual(queryLocal('npm', 'lodash', '4.17.15', home).map((a) => a.id), ['B']);
  assert.deepEqual(queryLocal('npm', 'lodash', '4.17.21', home), [], 'fixed version');
  assert.equal(dbStatus(home)[0]!.records, 2);

  // parity with the online path for the same fixture
  const onlineServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/v1/querybatch') return void res.end(JSON.stringify({ results: (JSON.parse(body) as { queries: Array<{ package: { name: string } }> }).queries.map((q) => ({ vulns: q.package.name === 'lodash' ? [{ id: 'B' }] : [] })) }));
      const id = req.url?.split('/').pop() ?? '';
      res.end(JSON.stringify(world.records[id]));
    });
  });
  await new Promise<void>((r) => onlineServer.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(onlineServer.address() as AddressInfo).port}`;
  const online = await queryVulnerabilities(new DepsClient({ osvUrl: url, cacheDir: mkdtempSync(join(tmpdir(), 'c-')) }), [{ ecosystem: 'npm', name: 'lodash', version: '4.17.15' }]);
  onlineServer.close();
  const onlineAdv = [...online.advisories.values()][0]![0]!;
  const localAdv = queryLocal('npm', 'lodash', '4.17.15', home)[0]!;
  assert.deepEqual([localAdv.id, localAdv.severity, localAdv.fixed], [onlineAdv.id, onlineAdv.severity, onlineAdv.fixed]);

  // nothing changed: no work
  assert.equal((await syncEcosystem('npm', { base: s.base, home })).mode, 'none');

  // one changed record, one new, one withdrawn: only those three ids are fetched, no new zip download
  world.records.B = vuln('B', 'lodash', '4.17.30', { modified: '2026-11-02T00:00:00Z' });
  world.records.C = vuln('C', 'express', '4.0.1');
  world.records.A = { ...vuln('A', 'left-pad', '1.3.0'), withdrawn: '2026-11-02T00:00:00Z' };
  world.modified.push(['2026-11-02T00:00:00Z', 'B'], ['2026-11-02T00:00:01Z', 'C'], ['2026-11-02T00:00:02Z', 'A']);
  world.recordHits = [];
  const inc = await syncEcosystem('npm', { base: s.base, home });
  assert.equal(inc.mode, 'incremental');
  assert.deepEqual(world.recordHits.sort(), ['A', 'B', 'C']);
  assert.equal(world.zipHits, 1);
  assert.deepEqual([inc.added, inc.updated, inc.removed, inc.records], [1, 1, 1, 2]);
  forgetLocalCache();
  assert.deepEqual(queryLocal('npm', 'left-pad', '1.0.0', home), [], 'withdrawn advisory disappears');
  assert.deepEqual(queryLocal('npm', 'lodash', '4.17.21', home).map((a) => a.id), ['B'], 'updated range now affects 4.17.21');
  s.close();
});

test('an interrupted full sync leaves the previous database in use', async () => {
  const world: World = { records: { A: vuln('A', 'left-pad', '1.3.0') }, modified: [['2026-11-01T00:00:00Z', 'A']], zipHits: 0, recordHits: [] };
  const s = await osvServer(world);
  const home = mkdtempSync(join(tmpdir(), 'vdb-'));
  await syncEcosystem('npm', { base: s.base, home });
  forgetLocalCache();
  world.modified.push(...Array.from({ length: 5 }, (_, i): [string, string] => [`2026-11-03T00:00:0${i}Z`, `X${i}`]));
  world.failZip = true;
  await assert.rejects(syncEcosystem('npm', { base: s.base, home, maxIncremental: 2 }));
  s.close();
  forgetLocalCache();
  assert.deepEqual(queryLocal('npm', 'left-pad', '1.0.0', home).map((a) => a.id), ['A']);
  assert.equal(dbStatus(home)[0]!.records, 1);
});

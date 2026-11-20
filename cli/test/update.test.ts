import assert from 'node:assert/strict';
import test from 'node:test';

import { newHome, runCli } from './helpers-cli.ts';

test('update --rollback with no pack installed says so and exits 2', async () => {
  const r = await runCli(['update', '--rollback'], newHome());
  assert.equal(r.code, 2);
  assert.match(r.stderr + r.stdout, /no pack is active/);
});

test('update --help documents ecosystems, rollback and packs', async () => {
  const r = await runCli(['update', '--help'], newHome());
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--ecosystem/);
  assert.match(r.stdout, /--rollback/);
  assert.match(r.stdout, /--no-packs/);
});

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { repoKey } from '@athena/core';

test('alerts: needs a saved scan; lists new vulnerabilities from local data; exit 1', async () => {
  const home = newHome();
  const project = mkdtempSync(join(tmpdir(), 'alproj-'));
  assert.equal((await runCli(['alerts', project], home)).code, 2);

  const key = repoKey(project);
  mkdirSync(join(home, 'last-scan'), { recursive: true });
  writeFileSync(join(home, 'last-scan', `${key}.json`), JSON.stringify({ root: project, savedAt: 'x', report: { timestamp: '2026-11-01T00:00:00Z', files: [], summary: {}, inventory: [{ ecosystem: 'npm', name: 'lodash', version: '4.0.0', direct: true, manifest: 'package.json' }] } }));
  mkdirSync(join(home, 'vulndb', 'npm'), { recursive: true });
  const rec = { id: 'GHSA-new', summary: 'Prototype pollution', affected: [{ package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] };
  writeFileSync(join(home, 'vulndb', 'npm', 'data.ndjson.gz'), gzipSync(JSON.stringify(rec)));
  writeFileSync(join(home, 'vulndb', 'npm', 'meta.json'), JSON.stringify({ eco: 'npm', updatedAt: new Date().toISOString(), lastModified: '', records: 1 }));
  const r = await runCli(['alerts', project], home);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /1 new vulnerability affects/);
  assert.match(r.stdout, /lodash@4\.0\.0\s+GHSA-new/);
});

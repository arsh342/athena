import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { saveRecords } from '../../core/src/updates/store.ts';
import { db } from '../src/db.ts';
import { getAlertsForUser, runAlertsJob } from '../src/alerts.ts';

type Row = Record<string, unknown>;

/** In-memory stand-in for the three queries the job makes, including the lock's compare-and-set. */
function fakeDb(state: { lockedUntil: number; inventories: Row[]; writes: unknown[][] }) {
  const dbHandle = db as unknown as { query: typeof db.query };
  const original = dbHandle.query;
  dbHandle.query = (async (text: string, params?: unknown[]) => {
    if (/INSERT INTO job_locks/.test(text)) {
      if (state.lockedUntil > Date.now()) return { rows: [] };
      state.lockedUntil = Date.now() + 30 * 60_000;
      return { rows: [{ name: 'x' }] };
    }
    if (/UPDATE job_locks SET locked_until = NOW\(\) \+/.test(text)) { state.lockedUntil = Date.now() + 23 * 3600_000; return { rows: [] }; }
    if (/UPDATE job_locks/.test(text)) { state.lockedUntil = Date.now(); return { rows: [] }; }
    if (/FROM scans s/.test(text)) return { rows: state.inventories };
    if (/FROM scan_findings/.test(text)) return { rows: [] };
    if (/INSERT INTO scan_alerts/.test(text)) { state.writes.push(params ?? []); return { rows: [] }; }
    return { rows: [] };
  }) as typeof db.query;
  return () => { dbHandle.query = original; };
}

test('the daily job runs once under two concurrent schedulers and writes alerts only for affected inventories', async () => {
  const home = mkdtempSync(join(tmpdir(), 'alerts-home-'));
  process.env.ATHENA_HOME = home;
  saveRecords('npm', new Map([['GHSA-1', { id: 'GHSA-1', summary: 'bad', affected: [{ package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] }]]), { eco: 'npm', updatedAt: new Date().toISOString(), lastModified: '', records: 1 }, home);
  const state = { lockedUntil: 0, writes: [] as unknown[][], inventories: [
    { scan_id: 's-affected', user_id: 1, inventory: [{ ecosystem: 'npm', name: 'lodash', version: '4.0.0', direct: true, manifest: 'package.json' }] },
    { scan_id: 's-clean', user_id: 2, inventory: [{ ecosystem: 'npm', name: 'lodash', version: '4.17.21', direct: true, manifest: 'package.json' }] },
  ] };
  const restore = fakeDb(state);
  try {
    const [a, b] = await Promise.all([runAlertsJob({ update: false }), runAlertsJob({ update: false })]);
    assert.equal([a, b].filter((r) => r.ran).length, 1, 'exactly one instance runs');
    const ran = a.ran ? a : b;
    assert.equal(ran.scansChecked, 2);
    assert.equal(ran.alertsWritten, 1);
    assert.equal(state.writes.length, 1);
    assert.deepEqual([state.writes[0]![0], state.writes[0]![1], state.writes[0]![2]], ['s-affected', 1, 'GHSA-1']);
    assert.ok(state.lockedUntil > Date.now() + 20 * 3600_000, 'next run is about a day away');
    assert.equal((await runAlertsJob({ update: false })).ran, false, 'later ticks the same day do nothing');
  } finally {
    restore();
    delete process.env.ATHENA_HOME;
  }
});

test('the user query is scoped to the user and the latest scan per repository (owners that no longer exist have no rows)', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const dbHandle = db as unknown as { query: typeof db.query };
  const original = dbHandle.query;
  dbHandle.query = (async (text: string, params?: unknown[]) => { calls.push({ text, params }); return { rows: [{ scan_id: 's1', repo_name: 'r', repo_url: 'u', advisory_id: 'GHSA-1', package_name: 'lodash', package_version: '4.0.0', severity: 'HIGH', summary: 'bad', fixed_in: '4.17.21' }] }; }) as typeof db.query;
  try {
    const repos = await getAlertsForUser(7);
    assert.equal(repos[0]!.count, 1);
    assert.equal(repos[0]!.alerts[0]!.fixedIn, '4.17.21');
    assert.deepEqual(calls[0]!.params, [7]);
    assert.match(calls[0]!.text, /DISTINCT ON \(repo_url\)/);
    assert.match(calls[0]!.text, /a\.user_id = \$1/);
  } finally {
    dbHandle.query = original;
  }
});

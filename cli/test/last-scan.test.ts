import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadLastScan, saveLastScan } from '../src/utils/last-scan.ts';
import type { ScanReport } from '@athena/core';

test('last scan round trips under ATHENA_HOME and is keyed by root', async () => {
  process.env.ATHENA_HOME = mkdtempSync(join(tmpdir(), 'athena-home-'));
  const report = { timestamp: 't', summary: { aiPercentage: 5 }, files: [] } as unknown as ScanReport;
  assert.equal(await loadLastScan('/some/root'), null);
  await saveLastScan('/some/root', report);
  assert.deepEqual(await loadLastScan('/some/root'), report);
  assert.equal(await loadLastScan('/other/root'), null);
});

import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('#15 the saved scan is private (0600) and secret-bearing code is redacted before it is written', async () => {
  process.env.ATHENA_HOME = mkdtempSync(join(tmpdir(), 'athena-home-'));
  const KEY = 'AKIAIOSFODNN7EXAMPLE';
  const report = { timestamp: 't', summary: {}, files: [{ path: '/r/a.js', units: [], findings: [{ id: 'x1', severity: 'HIGH', type: 'Hardcoded secret', message: `AWS key ${KEY}`, source: 'eslint', ruleId: 'r', file: '/r/a.js', line: 1, column: 1, code: `const k = "${KEY}";`, evidence: [`found ${KEY}`] }] }] } as unknown as ScanReport;
  await saveLastScan('/r', report);
  const path = join(process.env.ATHENA_HOME, 'last-scan', `${createHash('sha1').update('/r').digest('hex')}.json`);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const { readFileSync } = await import('node:fs');
  assert.ok(!readFileSync(path, 'utf8').includes(KEY), 'the key never reaches disk');
});

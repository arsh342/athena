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

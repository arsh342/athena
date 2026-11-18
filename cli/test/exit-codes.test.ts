import assert from 'node:assert/strict';
import test from 'node:test';

import { EXIT, exitCodeFor } from '../src/utils/exit-codes.ts';
import type { ScanReport } from '@athena/core';

const report = (blocked: boolean, complete: boolean) =>
  ({ summary: { blocked, coverage: { complete, gaps: [], files: [], checks: [] } } }) as unknown as ScanReport;

test('exit code table', () => {
  assert.equal(exitCodeFor(report(true, false), true), EXIT.BLOCKED);
  assert.equal(exitCodeFor(report(false, false), true), EXIT.INCOMPLETE);
  assert.equal(exitCodeFor(report(false, false), false), EXIT.PASS);
  assert.equal(exitCodeFor(report(true, true), false), EXIT.BLOCKED);
  assert.equal(exitCodeFor(report(false, true), true), EXIT.PASS);
  assert.deepEqual(EXIT, { PASS: 0, BLOCKED: 1, ERROR: 2, INCOMPLETE: 3 });
});

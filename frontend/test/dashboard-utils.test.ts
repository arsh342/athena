import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardEmptyState } from '../src/utils/dashboard';
import type { ScanSummary } from '../src/types';

test('getDashboardEmptyState returns empty flag when no scans', () => {
  const result = getDashboardEmptyState([] as ScanSummary[]);
  assert.equal(result.isEmpty, true);
});

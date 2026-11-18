import assert from 'node:assert/strict';
import test from 'node:test';

import { coverageGaps, coverageLabel, formatProvenance } from '../src/utils/provenance.ts';
import type { ScanSummary } from '../src/types/index.ts';

const base: ScanSummary = {
  scanId: 's', repoName: 'r', repoUrl: 'u', status: 'COMPLETED', createdAt: 't', aiPercentage: 35,
  flaggedUnits: 0, filesScanned: 1, totalUnits: 1, findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 }, duration: 1,
};

const provenance = (recorded: { lines: number; available: boolean }) => ({
  unit: 'lines' as const, totalLines: 100, recorded,
  estimated: { method: 'heuristic' as const, aiLines: 35, mixedLines: 9, uncertainLines: 7, humanLines: 49 }, topFiles: [],
});

test('formatProvenance shows recorded and the estimated range', () => {
  assert.equal(formatProvenance({ ...base, aiProvenance: provenance({ lines: 18, available: true }) }), 'recorded 18% · estimated 35–44%');
});

test('formatProvenance says recorded n/a when git history is unavailable', () => {
  assert.equal(formatProvenance({ ...base, aiProvenance: provenance({ lines: 0, available: false }) }), 'recorded n/a · estimated 35–44%');
});

test('formatProvenance says not measured for old scans', () => {
  assert.equal(formatProvenance({ ...base, aiProvenance: null }), 'not measured');
  assert.equal(formatProvenance(base), 'not measured');
});

test('formatProvenance handles zero measured lines', () => {
  const p = { ...provenance({ lines: 0, available: true }), totalLines: 0 };
  assert.equal(formatProvenance({ ...base, aiProvenance: p }), 'no code lines measured');
});

test('coverageGaps lists gaps only for incomplete scans', () => {
  assert.deepEqual(coverageGaps({ ...base, coverage: { complete: true, gaps: [], analyzedFiles: 1, totalFiles: 1 } }), []);
  assert.deepEqual(coverageGaps({ ...base, coverage: { complete: false, gaps: ['x', 'y'], analyzedFiles: 1, totalFiles: 2 } }), ['x', 'y']);
  assert.deepEqual(coverageGaps({ ...base, coverage: null }), []);
  assert.deepEqual(coverageGaps(base), []);
});

test('coverageLabel distinguishes complete, incomplete and not recorded', () => {
  assert.equal(coverageLabel({ ...base, coverage: null }), 'Not recorded');
  assert.equal(coverageLabel(base), 'Not recorded');
  assert.equal(coverageLabel({ ...base, coverage: { complete: true, gaps: [], analyzedFiles: 1, totalFiles: 1 } }), 'Complete');
  assert.equal(coverageLabel({ ...base, coverage: { complete: false, gaps: ['x'], analyzedFiles: 1, totalFiles: 2 } }), 'Incomplete');
});

test('formatProvenance includes the reason when recorded is unavailable', () => {
  const p = { ...provenance({ lines: 0, available: false }), recorded: { lines: 0, available: false, reason: 'not a git repository' } };
  assert.equal(formatProvenance({ ...base, aiProvenance: p }), 'recorded n/a (not a git repository) · estimated 35–44%');
});

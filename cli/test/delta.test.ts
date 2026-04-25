import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { computeDelta, createSnapshot } from '../src/utils/delta.ts';
import type { ScanReport } from '@athena/core';

test('computeDelta treats first scan as baseline with all findings new', () => {
  const current = createSnapshot(reportWithFindings([
    ['a', 'HIGH', 'src/auth/login.ts'],
    ['b', 'LOW', 'src/ui/view.ts'],
  ]), 'scan:repo', repoRoot());

  const delta = computeDelta(current);

  assert.equal(delta.baseline, true);
  assert.equal(delta.findings.new, 2);
  assert.equal(delta.findings.resolved, 0);
  assert.equal(delta.findings.newBySeverity.HIGH, 1);
  assert.equal(delta.riskScore.current, 6);
});

test('computeDelta reports new, resolved, and folder risk movement', () => {
  const previous = createSnapshot(reportWithFindings([
    ['a', 'HIGH', 'src/auth/login.ts'],
    ['b', 'LOW', 'src/ui/view.ts'],
  ]), 'scan:repo', repoRoot());
  const current = createSnapshot(reportWithFindings([
    ['a', 'HIGH', 'src/auth/login.ts'],
    ['c', 'CRITICAL', 'backend/api.ts'],
  ]), 'scan:repo', repoRoot());

  const delta = computeDelta(current, previous);

  assert.equal(delta.baseline, false);
  assert.equal(delta.findings.new, 1);
  assert.equal(delta.findings.resolved, 1);
  assert.equal(delta.findings.newBySeverity.CRITICAL, 1);
  assert.equal(delta.findings.resolvedBySeverity.LOW, 1);
  assert.equal(delta.riskScore.change, 7);
  assert.equal(delta.regressionAlert, true);
  assert.deepEqual(delta.folders.map((folder) => folder.folder), ['backend', 'src']);
});

function reportWithFindings(findings: Array<[string, 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', string]>): ScanReport {
  return {
    timestamp: '2026-04-24T00:00:00.000Z',
    duration: 1,
    summary: {
      filesScanned: findings.length,
      skippedFiles: 0,
      totalUnits: 0,
      flaggedUnits: 0,
      findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      blocked: false,
      aiScore: 0,
      aiFlagRatio: 0,
      aiPercentage: 0,
      riskDensity: { criticalPer1kLoc: 0, findingsPer1kLoc: 0, flaggedRatio: 0 },
      confidenceBands: { LOW: 0, UNCERTAIN: 0, HIGH: 0 },
    },
    files: findings.map(([id, severity, file]) => ({
      path: join(repoRoot(), file),
      units: [],
      findings: [{
        id,
        severity,
        type: 'test',
        category: 'test',
        message: 'test finding',
        file: join(repoRoot(), file),
        line: 1,
        column: 1,
        code: '',
        aiScore: 0,
        explainedScore: { score: 0, band: 'LOW', signalsTriggered: 0, variance: 0, topSignals: [] },
        source: 'security-analyzer',
        ruleId: id,
      }],
    })),
  };
}

function repoRoot(): string {
  return join('C:\\', 'repo');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { addScan, getFindings, getFindingsByScanId } from '../src/data.ts';
import type { Finding, ScanSummary } from '../src/data.ts';

function createScan(scanId: string): ScanSummary {
  return {
    scanId,
    repoName: `repo-${scanId}`,
    repoUrl: `https://github.com/org/${scanId}`,
    status: 'COMPLETED',
    createdAt: new Date().toISOString(),
    aiPercentage: 50,
    flaggedUnits: 1,
    filesScanned: 1,
    totalUnits: 1,
    findings: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
    riskDensity: { findingsPer1kLoc: 1, criticalPer1kLoc: 0, flaggedRatio: 1 },
    duration: 100,
  };
}

function createFinding(id: string): Finding {
  return {
    id,
    severity: 'HIGH',
    type: 'Test finding',
    category: 'test',
    message: 'test finding',
    file: 'src/test.ts',
    line: 1,
    column: 1,
    source: 'security-analyzer',
    aiScore: 90,
    code: 'const test = true;',
    ruleId: 'test.rule',
    topSignals: [],
  };
}

test('findings are persisted by scanId and latest findings remain accessible', () => {
  const scanOneId = `scan-one-${Date.now()}`;
  const scanTwoId = `scan-two-${Date.now()}`;

  const findingOne = createFinding(`${scanOneId}-finding`);
  const findingTwo = createFinding(`${scanTwoId}-finding`);

  addScan(createScan(scanOneId), [findingOne]);
  addScan(createScan(scanTwoId), [findingTwo]);

  assert.deepEqual(getFindingsByScanId(scanOneId), [findingOne]);
  assert.deepEqual(getFindingsByScanId(scanTwoId), [findingTwo]);
  assert.deepEqual(getFindings(), [findingTwo]);
});

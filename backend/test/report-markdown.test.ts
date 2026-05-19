import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReportMarkdown } from '../src/report-markdown.ts';
import type { Finding, ScanSummary } from '../src/data.ts';

const scan: ScanSummary = {
  scanId: 'scan-1',
  repoName: 'repo',
  repoUrl: 'local://repo',
  status: 'COMPLETED',
  createdAt: '2026-05-19T00:00:00.000Z',
  aiPercentage: 40,
  flaggedUnits: 2,
  filesScanned: 2,
  totalUnits: 2,
  findings: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
  riskDensity: { findingsPer1kLoc: 1, criticalPer1kLoc: 0, flaggedRatio: 0.5 },
  duration: 100,
};

const findings: Finding[] = [
  {
    id: 'f1',
    severity: 'HIGH',
    type: 'Hardcoded secret',
    category: 'secret',
    message: "secret = 'abc123'",
    file: 'src/a.ts',
    line: 1,
    column: 1,
    source: 'secret-detector',
    aiScore: 7,
    code: "const secret = 'abc123'",
    ruleId: 'secret.rule',
    topSignals: [],
  },
  {
    id: 'f2',
    severity: 'HIGH',
    type: 'Hardcoded secret',
    category: 'secret',
    message: "secret = 'abc123'",
    file: 'src/a.ts',
    line: 1,
    column: 1,
    source: 'secret-detector',
    aiScore: 7,
    code: "const secret = 'abc123'",
    ruleId: 'secret.rule',
    topSignals: [],
  },
];

test('generateReportMarkdown redacts secrets and dedupes', () => {
  const markdown = generateReportMarkdown(scan, findings);
  assert.ok(markdown.includes('### HIGH'));
  assert.ok(markdown.includes('#### src/a.ts'));
  assert.ok(markdown.includes('***REDACTED***'));
  assert.equal(markdown.match(/Hardcoded secret/g)?.length, 1);
});

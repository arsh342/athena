import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.ts';
import { addScan, getFindingsByScanId, getScans, type Finding, type ScanSummary } from '../src/data.ts';

const ai = { mode: 'verify', provider: 'anthropic', model: 'claude-sonnet-5-5', costUsd: 0.03, checked: 2, notChecked: 1 };
const scan: ScanSummary = {
  scanId: 'ai1', repoName: 'r', repoUrl: 'u', status: 'COMPLETED', createdAt: '2026-11-20T00:00:00.000Z',
  aiPercentage: 0, flaggedUnits: 0, filesScanned: 1, totalUnits: 1,
  findings: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
  riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 }, duration: 5, ai,
};
const verdict = { verdict: 'confirmed' as const, reason: 'reachable from /login', provider: 'anthropic', model: 'claude-sonnet-5-5', citations: ['a.ts:3'] };
const finding: Finding = {
  id: 'f1', severity: 'HIGH', type: 't', category: 'c', message: 'm', file: 'a.ts', line: 3, column: 1, source: 'security-analyzer',
  aiScore: 0, code: 'x', ruleId: 'r', topSignals: [], aiVerdict: verdict,
};

test('addScan stores the AI summary and each finding verdict, never a key', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const handle = db as unknown as { connect: () => Promise<unknown> };
  const original = handle.connect;
  handle.connect = async () => ({ query: async (text: string, params?: unknown[]) => { calls.push({ text, params }); return { rows: [] }; }, release: () => undefined });
  try {
    await addScan(7, scan, [finding]);
  } finally {
    handle.connect = original;
  }
  const insertScan = calls.find((c) => /INSERT INTO scans/.test(c.text))!;
  assert.deepEqual(JSON.parse(insertScan.params![15] as string), ai);
  const insertFinding = calls.find((c) => /INSERT INTO scan_findings/.test(c.text))!;
  assert.deepEqual(JSON.parse(insertFinding.params![18] as string), verdict);
  assert.ok(!JSON.stringify(calls).includes('sk-'));
});

test('reading scans and findings restores the AI data, and scans without AI stay clean', async () => {
  const handle = db as unknown as { query: typeof db.query };
  const original = handle.query;
  const scanRow = (extra: object) => ({ scan_id: 's', repo_name: 'r', repo_url: 'u', status: 'COMPLETED', created_at: '2026-11-20T00:00:00Z',
    ai_percentage: 1, flagged_units: 0, files_scanned: 1, total_units: 1, findings: {}, risk_density: {}, duration: 1, ...extra });
  const findingRow = { id: 'f1', severity: 'HIGH', type: 't', category: 'c', message: 'm', file: 'a.ts', line: 3, column: 1, source: 'security-analyzer', ai_score: 0, code: 'x', rule_id: 'r', top_signals: [] };
  handle.query = (async (text: string) => ({ rows: /scan_findings/.test(text) ? [{ ...findingRow, ai_verdict: verdict }, findingRow] : [scanRow({}), scanRow({ ai_summary: ai })] })) as unknown as typeof db.query;
  try {
    const scans = await getScans(7);
    assert.equal(scans[0].ai, undefined);
    assert.deepEqual(scans[1].ai, ai);
    const findings = await getFindingsByScanId('s', 7);
    assert.deepEqual(findings[0].aiVerdict, verdict);
    assert.equal(findings[1].aiVerdict, undefined);
  } finally {
    handle.query = original;
  }
});

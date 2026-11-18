import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.ts';
import { addScan, getScans, type ScanSummary } from '../src/data.ts';
import { mapScanSummary } from '../src/scanner.ts';
import type { ScanReport } from '@athena/core';

const provenance = {
  unit: 'lines' as const, totalLines: 100,
  recorded: { lines: 18, available: true },
  estimated: { method: 'heuristic' as const, aiLines: 35, mixedLines: 9, uncertainLines: 7, humanLines: 49 },
  topFiles: [{ path: 'a.ts', lines: 100, recordedLines: 18, aiLines: 35, mixedLines: 9, uncertainLines: 7 }],
};
const coverage = { complete: false, gaps: ['1 file(s) not parsed'], analyzedFiles: 9, totalFiles: 10 };

const scan: ScanSummary = {
  scanId: 's1', repoName: 'r', repoUrl: 'u', status: 'COMPLETED', createdAt: '2026-11-19T00:00:00.000Z',
  aiPercentage: 35, flaggedUnits: 1, filesScanned: 10, totalUnits: 2,
  findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 }, duration: 5,
  aiProvenance: provenance, coverage,
};

test('addScan stores ai_provenance and coverage as JSON', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const handle = db as unknown as { connect: () => Promise<unknown> };
  const original = handle.connect;
  handle.connect = async () => ({ query: async (text: string, params?: unknown[]) => { calls.push({ text, params }); return { rows: [] }; }, release: () => undefined });
  try {
    await addScan(7, scan, []);
  } finally {
    handle.connect = original;
  }
  const insert = calls.find((c) => /INSERT INTO scans/.test(c.text))!;
  assert.match(insert.text, /ai_provenance/);
  assert.match(insert.text, /coverage/);
  assert.deepEqual(JSON.parse(insert.params![13] as string), provenance);
  assert.deepEqual(JSON.parse(insert.params![14] as string), coverage);
});

test('getScans maps missing columns to null and present ones to objects', async () => {
  const handle = db as unknown as { query: typeof db.query };
  const original = handle.query;
  const row = (extra: object) => ({ scan_id: 's', repo_name: 'r', repo_url: 'u', status: 'COMPLETED', created_at: '2026-11-19T00:00:00Z',
    ai_percentage: 1, flagged_units: 0, files_scanned: 1, total_units: 1, findings: {}, risk_density: {}, duration: 1, ...extra });
  handle.query = (async () => ({ rows: [row({}), row({ ai_provenance: provenance, coverage })] })) as unknown as typeof db.query;
  try {
    const scans = await getScans(7);
    assert.equal(scans[0].aiProvenance, null);
    assert.equal(scans[0].coverage, null);
    assert.deepEqual(scans[1].aiProvenance, provenance);
    assert.deepEqual(scans[1].coverage, coverage);
  } finally {
    handle.query = original;
  }
});

test('mapScanSummary copies the top 5 files and a coverage summary', () => {
  const files = Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.ts`, lines: 10, recordedLines: 0, aiLines: 8 - i, mixedLines: 0, uncertainLines: 0 }));
  const report = {
    timestamp: 't', duration: 3,
    summary: {
      filesScanned: 8, skippedFiles: 0, totalUnits: 1, flaggedUnits: 1, aiPercentage: 12,
      findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 },
      aiProvenance: { unit: 'lines', totalLines: 80, recorded: { lines: 0, available: false, reason: 'shallow clone: history not available' },
        estimated: { method: 'heuristic', aiLines: 9, mixedLines: 0, uncertainLines: 0, humanLines: 71 }, files },
      coverage: { complete: false, gaps: ['x'], checks: [],
        files: [{ path: 'a', status: 'analyzed' }, { path: 'b', status: 'parse-failed' }, { path: 'c', status: 'skipped-excluded' }] },
    },
    files: [],
  } as unknown as ScanReport;

  const mapped = mapScanSummary(report, 'id', 'repo', 'url');
  assert.equal(mapped.aiProvenance!.topFiles.length, 5);
  assert.equal('files' in mapped.aiProvenance!, false);
  assert.equal(mapped.aiProvenance!.recorded.reason, 'shallow clone: history not available');
  assert.deepEqual(mapped.coverage, { complete: false, gaps: ['x'], analyzedFiles: 1, totalFiles: 2 });
});

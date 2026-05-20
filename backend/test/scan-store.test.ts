import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addScan,
  appendTerminalLine,
  createRunningScan,
  getFindings,
  getFindingsByScanId,
  getScan,
  getScans,
  getTerminalLines,
} from '../src/data.ts';
import { db } from '../src/db.ts';
import type { Finding, RunningScanSummary, ScanSummary } from '../src/data.ts';

function createScan(scanId: string): ScanSummary {
  return {
    scanId,
    repoName: `repo-${scanId}`,
    repoUrl: `https://github.com/org/${scanId}`,
    status: 'COMPLETED',
    createdAt: '2026-05-06T00:00:00.000Z',
    aiPercentage: 50,
    flaggedUnits: 1,
    filesScanned: 1,
    totalUnits: 1,
    findings: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
    riskDensity: { findingsPer1kLoc: 1, criticalPer1kLoc: 0, flaggedRatio: 1 },
    duration: 100,
  };
}

function createRunningScanFixture(scanId: string): RunningScanSummary {
  return {
    ...createScan(scanId),
    status: 'RUNNING',
    aiPercentage: 0,
    flaggedUnits: 0,
    filesScanned: 0,
    totalUnits: 0,
    findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 },
    duration: 0,
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

async function withMockDb<T>(overrides: {
  query?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  connect?: () => Promise<{ query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; release: () => void }>;
}, fn: () => Promise<T>): Promise<T> {
  const dbHandle = db as unknown as {
    query: typeof db.query;
    connect: typeof db.connect;
  };
  const originalQuery = dbHandle.query;
  const originalConnect = dbHandle.connect;

  if (overrides.query) {
    dbHandle.query = overrides.query as typeof db.query;
  }
  if (overrides.connect) {
    dbHandle.connect = overrides.connect as typeof db.connect;
  }

  try {
    return await fn();
  } finally {
    dbHandle.query = originalQuery;
    dbHandle.connect = originalConnect;
  }
}

test('addScan writes scan and findings in one transaction', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  let released = false;

  await withMockDb({
    connect: async () => ({
      query: async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        return { rows: [] };
      },
      release: () => {
        released = true;
      },
    }),
  }, async () => {
    await addScan(7, createScan('scan-one'), [createFinding('finding-one')]);
  });

  assert.equal(calls[0]?.text, 'BEGIN');
  assert.match(calls[1]?.text ?? '', /INSERT INTO scans/);
  assert.match(calls[2]?.text ?? '', /INSERT INTO scan_findings/);
  assert.equal(calls[1]?.params?.[1], 7);
  assert.equal(calls[2]?.params?.[1], 'scan-one');
  assert.equal(calls.at(-1)?.text, 'COMMIT');
  assert.equal(released, true);
});

test('createRunningScan inserts running scan shell row', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];

  await withMockDb({
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return { rows: [] };
    },
  }, async () => {
    await createRunningScan(7, createRunningScanFixture('scan-running'));
  });

  assert.match(calls[0]?.text ?? '', /INSERT INTO scans/);
  assert.equal(calls[0]?.params?.[0], 'scan-running');
  assert.equal(calls[0]?.params?.[1], 7);
  assert.equal(calls[0]?.params?.[4], 'RUNNING');
});

test('getScans and getScan return persisted summaries for one user', async () => {
  const row = {
    scan_id: 'scan-one',
    repo_name: 'repo-scan-one',
    repo_url: 'https://github.com/org/scan-one',
    status: 'COMPLETED' as const,
    created_at: '2026-05-06T00:00:00.000Z',
    ai_percentage: 50,
    flagged_units: 1,
    files_scanned: 1,
    total_units: 1,
    findings: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 },
    risk_density: { findingsPer1kLoc: 1, criticalPer1kLoc: 0, flaggedRatio: 1 },
    duration: 100,
  };

  await withMockDb({
    query: async (text: string) => {
      if (text.includes('LIMIT 20')) return { rows: [row] };
      if (text.includes('LIMIT 1')) return { rows: [row] };
      return { rows: [] };
    },
  }, async () => {
    const scans = await getScans(7);
    const scan = await getScan('scan-one', 7);

    assert.equal(scans.length, 1);
    assert.deepEqual(scans[0], createScan('scan-one'));
    assert.deepEqual(scan, createScan('scan-one'));
  });
});

test('getFindings returns latest scan findings and getFindingsByScanId returns scan findings', async () => {
  const findingRow = {
    id: 'finding-one',
    severity: 'HIGH' as const,
    type: 'Test finding',
    category: 'test',
    message: 'test finding',
    file: 'src/test.ts',
    line: 1,
    column: 1,
    source: 'security-analyzer' as const,
    ai_score: 90,
    code: 'const test = true;',
    rule_id: 'test.rule',
    top_signals: [],
  };

  let queryCount = 0;
  await withMockDb({
    query: async () => {
      queryCount += 1;
      if (queryCount === 1) return { rows: [{ scan_id: 'scan-two' }] };
      return { rows: [findingRow] };
    },
  }, async () => {
    const latestFindings = await getFindings(5);
    const byScanId = await getFindingsByScanId('scan-two', 5);

    assert.deepEqual(latestFindings, [createFinding('finding-one')]);
    assert.deepEqual(byScanId, [createFinding('finding-one')]);
  });
});

test('appendTerminalLine returns persisted terminal row and getTerminalLines returns ordered history', async () => {
  const lineRow = {
    seq: 1,
    kind: 'output' as const,
    text: 'Clone complete',
    created_at: '2026-05-06T00:00:00.000Z',
  };

  let queryCount = 0;
  await withMockDb({
    query: async () => {
      queryCount += 1;
      if (queryCount === 1) return { rows: [lineRow] };
      return { rows: [lineRow] };
    },
  }, async () => {
    const appended = await appendTerminalLine('scan-one', { seq: 1, kind: 'output', text: 'Clone complete' });
    const history = await getTerminalLines('scan-one', 7);

    assert.deepEqual(appended, {
      seq: 1,
      kind: 'output',
      text: 'Clone complete',
      createdAt: '2026-05-06T00:00:00.000Z',
    });
    assert.deepEqual(history, [appended]);
  });
});

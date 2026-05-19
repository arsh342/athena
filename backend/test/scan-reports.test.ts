import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.ts';
import { addScanReport, getScanReport } from '../src/data.ts';

async function withMockDb<T>(overrides: {
  query?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}, fn: () => Promise<T>): Promise<T> {
  const dbHandle = db as unknown as { query: typeof db.query };
  const originalQuery = dbHandle.query;
  if (overrides.query) dbHandle.query = overrides.query as typeof db.query;
  try {
    return await fn();
  } finally {
    dbHandle.query = originalQuery;
  }
}

test('addScanReport upserts markdown snapshot for scan', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  await withMockDb({
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [] };
    },
  }, async () => {
    await addScanReport(7, 'scan-1', '# Report\n');
  });

  assert.match(calls[0]?.text ?? '', /INSERT INTO scan_reports/);
  assert.equal(calls[0]?.params?.[0], 'scan-1');
  assert.equal(calls[0]?.params?.[1], 7);
});

test('getScanReport returns markdown for user scan', async () => {
  const row = { markdown: '# Report\n' };
  await withMockDb({
    query: async () => ({ rows: [row] }),
  }, async () => {
    const markdown = await getScanReport('scan-1', 7);
    assert.equal(markdown, '# Report\n');
  });
});

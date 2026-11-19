import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../src/db.ts';
import { runScan } from '../src/scanner.ts';

test('a clone failure is recorded as a FAILED scan and still rethrown to the router', async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const handle = db as unknown as { query: typeof db.query; connect?: unknown };
  const original = handle.query;
  const originalConnect = handle.connect;
  handle.query = (async (text: string, params?: unknown[]) => { calls.push({ text, params }); return { rows: [] }; }) as typeof db.query;
  handle.connect = async () => ({ query: handle.query, release: () => undefined });
  try {
    await assert.rejects(runScan('file:///definitely/not/a/repo.git', 7));
  } finally {
    handle.query = original;
    handle.connect = originalConnect;
  }
  const insert = calls.find((c) => /INSERT INTO scans/.test(c.text));
  assert.ok(insert, `a scan row was written (calls: ${calls.map((c) => c.text.trim().slice(0, 30)).join(' | ')})`);
  assert.ok(insert!.params?.includes('FAILED'), 'status FAILED');
  assert.ok(insert!.params?.includes(7), 'owned by the user');
});

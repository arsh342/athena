import assert from 'node:assert/strict';
import test from 'node:test';
import { ScanBusyError, activeScanCount, withScanSlot } from '../src/scanner.ts';

test('only the allowed number of scans run at once; the rest are turned away with a clear message and the slot frees afterwards', async () => {
  process.env.MAX_CONCURRENT_SCANS = '2';
  try {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = withScanSlot(() => gate);
    const second = withScanSlot(() => gate);
    assert.equal(activeScanCount(), 2);
    await assert.rejects(() => withScanSlot(async () => 'never'), (e: unknown) => e instanceof ScanBusyError && /busy/i.test((e as Error).message));
    release();
    await Promise.all([first, second]);
    assert.equal(activeScanCount(), 0, 'both slots are free again');
    assert.equal(await withScanSlot(async () => 'ok'), 'ok');
  } finally {
    delete process.env.MAX_CONCURRENT_SCANS;
  }
});

test('a scan that fails still frees its slot', async () => {
  process.env.MAX_CONCURRENT_SCANS = '1';
  try {
    await assert.rejects(() => withScanSlot(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(activeScanCount(), 0);
    assert.equal(await withScanSlot(async () => 1), 1);
  } finally {
    delete process.env.MAX_CONCURRENT_SCANS;
  }
});

test('the default is one scan at a time', async () => {
  delete process.env.MAX_CONCURRENT_SCANS;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const first = withScanSlot(() => gate);
  await assert.rejects(() => withScanSlot(async () => 'never'), ScanBusyError);
  release();
  await first;
});

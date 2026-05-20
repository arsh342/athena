import assert from 'node:assert/strict';
import test from 'node:test';
import { closeScanStream, emitScanEvent, subscribeToScan } from '../src/scan-stream.ts';

test('scan stream broker emits events to subscribers and cleans up on unsubscribe', () => {
  const events: string[] = [];
  const unsubscribe = subscribeToScan('scan-1', (event) => {
    events.push(event.type);
  });

  emitScanEvent('scan-1', { type: 'status', status: { status: 'RUNNING', label: 'clone', progress: 10 } });
  emitScanEvent('scan-1', { type: 'done' });
  unsubscribe();
  emitScanEvent('scan-1', { type: 'error', message: 'late-event' });

  assert.deepEqual(events, ['status', 'done']);
});

test('closeScanStream drops remaining listeners for scan', () => {
  let count = 0;
  subscribeToScan('scan-2', () => {
    count += 1;
  });

  closeScanStream('scan-2');
  emitScanEvent('scan-2', { type: 'done' });

  assert.equal(count, 0);
});

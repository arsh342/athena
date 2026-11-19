import test from 'node:test';
import assert from 'node:assert/strict';
import { scanVerdict } from '../src/utils/gate';

const zeros = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

test('a failed scan is a failed verdict, never pass', () => {
  assert.equal(scanVerdict({ status: 'FAILED', findings: zeros }), 'failed');
});
test('completed scans: high or critical block, clean passes, incomplete coverage says so', () => {
  assert.equal(scanVerdict({ status: 'COMPLETED', findings: { ...zeros, HIGH: 1 } }), 'blocked');
  assert.equal(scanVerdict({ status: 'COMPLETED', findings: { ...zeros, CRITICAL: 2 } }), 'blocked');
  assert.equal(scanVerdict({ status: 'COMPLETED', findings: { ...zeros, MEDIUM: 4 } }), 'pass');
  assert.equal(scanVerdict({ status: 'COMPLETED', findings: zeros }), 'pass');
  assert.equal(scanVerdict({ status: 'COMPLETED', findings: zeros, coverage: { complete: false, gaps: ['x'], analyzedFiles: 1, totalFiles: 2 } }), 'pass (incomplete)');
  assert.equal(scanVerdict({ status: 'COMPLETED', findings: { ...zeros, HIGH: 1 }, coverage: { complete: false, gaps: ['x'], analyzedFiles: 1, totalFiles: 2 } }), 'blocked');
});

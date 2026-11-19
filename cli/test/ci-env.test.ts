import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowProgress } from '../src/utils/scan-progress.ts';

test('#16 CI=false and CI=0 are not CI; CI=true and CI=1 are', () => {
  const tty = { isTTY: true };
  assert.equal(shouldShowProgress(false, tty, { CI: 'false' }), true);
  assert.equal(shouldShowProgress(false, tty, { CI: '0' }), true);
  assert.equal(shouldShowProgress(false, tty, { CI: '' }), true);
  assert.equal(shouldShowProgress(false, tty, { CI: 'true' }), false);
  assert.equal(shouldShowProgress(false, tty, { CI: '1' }), false);
  assert.equal(shouldShowProgress(false, tty, {}), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { WORDMARK, bannerLines } from '../src/utils/banner.ts';

test('the banner is the two-row block-letter name and nothing else', () => {
  assert.deepEqual(bannerLines(), WORDMARK);
  assert.equal(WORDMARK.length, 2);
  assert.ok(WORDMARK.every((row) => /^[ ▀▄█]+$/.test(row)));
});

test('the banner fits a narrow terminal', () => {
  assert.ok(Math.max(...bannerLines().map((l) => l.length)) + 2 <= 40);
});

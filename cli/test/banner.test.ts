import assert from 'node:assert/strict';
import test from 'node:test';

import { LOGO, WORDMARK, bannerLines } from '../src/utils/banner.ts';

test('the logo is braille dots', () => {
  assert.ok(LOGO.length >= 8);
  assert.ok(LOGO.every((row) => /^[\u2800-\u28ff ]*$/.test(row)));
});

test('a wide terminal gets the mark with the name beside it, a narrow one the name only', () => {
  const wide = bannerLines(100, 70);
  assert.equal(wide.length, LOGO.length);
  assert.ok(wide.some((line) => line.includes(WORDMARK[0]!)) && wide.some((line) => line.includes(WORDMARK[1]!)));
  assert.deepEqual(bannerLines(40, 70), WORDMARK);
  assert.deepEqual(bannerLines(100, 30), WORDMARK, 'a short terminal gets the name only');
});

test('the full banner fits in 56 columns', () => {
  assert.ok(Math.max(...bannerLines(100, 70).map((l) => l.length)) + 2 <= 56);
});

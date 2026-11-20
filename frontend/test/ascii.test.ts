import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_GLYPHS, RAMP, cell, clamp01, field, rampChar } from '../src/utils/ascii.ts';

const base = { x: 10, y: 10, rows: 60, t: 1, band: 0.9, pointer: Infinity, held: false };

test('the density ramp is monotonic and clamped', () => {
  assert.equal(rampChar(-1), RAMP[0]);
  assert.equal(rampChar(2), RAMP.at(-1));
  let last = -1;
  for (let v = 0; v <= 1; v += 0.05) { const i = RAMP.indexOf(rampChar(v)); assert.ok(i >= last); last = i; }
  assert.equal(clamp01(0.5), 0.5);
});

test('the field is deterministic and stays in 0..1', () => {
  assert.equal(field(3, 4, 5), field(3, 4, 5));
  for (let i = 0; i < 200; i += 1) { const f = field(i, i * 2, i / 7); assert.ok(f >= 0 && f <= 1); }
});

test('lettering is dense, the background is sparse, held and scanned lettering shows code', () => {
  const letter = cell({ ...base, mask: 1 });
  assert.ok(letter.alpha >= 0.5);
  assert.ok(RAMP.includes(letter.ch));
  const held = cell({ ...base, mask: 1, held: true });
  assert.ok(CODE_GLYPHS.includes(held.ch));
  const scanned = cell({ ...base, mask: 1, band: base.y / base.rows });
  assert.ok(CODE_GLYPHS.includes(scanned.ch));
  let drawn = 0;
  for (let x = 0; x < 100; x += 1) if (cell({ ...base, x, mask: 0 }).alpha > 0) drawn += 1;
  assert.ok(drawn < 40, 'the background stays quiet');
});

test('the pointer lens lights up the background nearby only', () => {
  let near = 0, far = 0;
  for (let x = 0; x < 100; x += 1) {
    if (cell({ ...base, x, mask: 0, pointer: 2 }).alpha > 0) near += 1;
    if (cell({ ...base, x, mask: 0, pointer: 40 }).alpha > 0) far += 1;
  }
  assert.ok(near > far);
});

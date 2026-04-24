import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultConfig, defaultWeights, mergeConfig } from '../src/config.ts';

test('mergeConfig returns defaults when no override provided', () => {
  const merged = mergeConfig();

  assert.deepEqual(merged, defaultConfig);
  assert.notEqual(merged, defaultConfig);
  assert.notEqual(merged.weights, defaultWeights);
});

test('mergeConfig overrides top-level and weight values without mutating defaults', () => {
  const merged = mergeConfig({
    threshold: 42,
    weights: {
      genericNames: 99,
      commentRatio: 3,
    },
  });

  assert.equal(merged.threshold, 42);
  assert.equal(merged.weights.genericNames, 99);
  assert.equal(merged.weights.commentRatio, 3);
  assert.equal(merged.weights.burstiness, defaultWeights.burstiness);

  assert.equal(defaultConfig.threshold, 9);
  assert.equal(defaultWeights.genericNames, 15);
});

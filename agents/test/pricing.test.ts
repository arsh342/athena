import assert from 'node:assert/strict';
import test from 'node:test';

import { capsFor, costOf, DEFAULT_CAPS, isLocalEndpoint, priceFor } from '../src/pricing.ts';

test('Anthropic prices are the published ones', () => {
  assert.deepEqual(priceFor('anthropic', 'claude-sonnet-5-5'), { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 });
  assert.equal(priceFor('anthropic', 'claude-opus-5-5')!.output, 20);
  assert.equal(priceFor('anthropic', 'claude-haiku-5-5')!.input, 0.1);
  assert.equal(priceFor('anthropic', 'claude-unknown-9'), null);
});

test('cost sums input, output, cache reads and cache writes per million tokens', () => {
  const price = priceFor('anthropic', 'claude-sonnet-5-5')!;
  const usd = costOf({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 200_000 }, price);
  assert.ok(Math.abs(usd - (2 + 1 + 0.2 + 0.5)) < 1e-9, String(usd));
});

test('Haiku 5.5 prompts over 100K tokens use the long-prompt rate', () => {
  const price = priceFor('anthropic', 'claude-haiku-5-5')!;
  assert.ok(costOf({ inputTokens: 200_000, outputTokens: 0 }, price) > costOf({ inputTokens: 50_000, outputTokens: 0 }, price) * 4);
});

test('default caps are $0.25 per run and $1.00 per day; an unknown price falls back to token caps', () => {
  assert.deepEqual(DEFAULT_CAPS, { runUsd: 0.25, dayUsd: 1, runTokens: 150_000, dayTokens: 600_000 });
  const known = capsFor({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
  assert.deepEqual([known.unit, known.run, known.day], ['usd', 0.25, 1]);
  const unknown = capsFor({ provider: 'openai', model: 'some-model' });
  assert.deepEqual([unknown.unit, unknown.run, unknown.day], ['tokens', 150_000, 600_000]);
});

test('local endpoints cost nothing and keep code on the machine', () => {
  for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080/v1']) assert.equal(isLocalEndpoint(url), true, url);
  for (const url of ['https://openrouter.ai/api/v1', 'http://192.168.1.5:11434/v1', 'https://localhost.evil.com/v1']) assert.equal(isLocalEndpoint(url), false, url);
  const caps = capsFor({ provider: 'openai-compatible', model: 'llama3', baseUrl: 'http://localhost:11434/v1' });
  assert.equal(caps.local, true);
  assert.equal(caps.price?.input, 0);
  assert.equal(costOf({ inputTokens: 5_000_000, outputTokens: 5_000_000 }, caps.price!), 0);
});

test('the user can raise or lower caps and override a price', () => {
  const caps = capsFor({ provider: 'anthropic', model: 'claude-sonnet-5-5', budget: { runUsd: 0.5, dayUsd: 2 } });
  assert.deepEqual([caps.run, caps.day], [0.5, 2]);
  const custom = capsFor({ provider: 'openai', model: 'm', pricing: { input: 1, output: 2 } });
  assert.equal(custom.unit, 'usd');
  assert.equal(custom.price?.cacheRead, 0.1, 'cache read defaults to 0.1x input');
});

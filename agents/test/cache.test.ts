import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { fileVerdictCache, pruneCache } from '../src/cache.ts';
import { buildContextPack } from '../src/context-pack.ts';
import type { ChatRequest, ModelProvider } from '../src/providers/types.ts';
import { verifyCandidates } from '../src/verify.ts';

const finding = { id: 'f1', ruleId: 'taint.sql-injection', severity: 'HIGH', message: 'm', file: 'a.js', line: 3, code: 'x', confidence: 'medium' } as never;
const pack = (source: string) => buildContextPack({ finding, source, siblings: [], checklist: '' });

function counting(): { provider: ModelProvider; calls: () => number } {
  let n = 0;
  const provider: ModelProvider = {
    id: 'anthropic', endpoint: 'x',
    async chat(request: ChatRequest) {
      n += 1;
      const id = /<finding id="([^"]+)">/.exec(JSON.stringify(request.messages).replace(/\\"/g, '"'))![1]!;
      return { text: '', toolCalls: [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 }, model: 'm', json: { verdicts: [{ id, verdict: 'confirmed', reachability: 'r', defenses: 'd', impact: 'i', citations: ['a.js:3'], reason: 'real' }] } };
    },
    async countTokens() { return { tokens: 1, exact: true }; },
    capabilities: () => ({ tools: false, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false }),
  };
  return { provider, calls: () => n };
}

test('re-running unchanged code costs nothing: identical pack, model and prompt version hit the on-disk cache with zero provider calls', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agents-cache-'));
  const cache = fileVerdictCache(home);
  const { provider, calls } = counting();
  const input = { provider, providerId: 'anthropic' as const, model: 'm', candidates: [{ id: 'f1', pack: pack('a\nb\nc\nd') }], cache };
  const first = await verifyCandidates(input);
  assert.equal(first.cachedHits, 0);
  assert.equal(calls(), 1);
  const again = await verifyCandidates({ ...input, cache: fileVerdictCache(home) });
  assert.equal(calls(), 1, 'no second call');
  assert.equal(again.cachedHits, 1);
  assert.equal(again.verdicts.get('f1')!.cached, true);
  assert.equal(again.usage.inputTokens, 0);
  const changed = await verifyCandidates({ ...input, candidates: [{ id: 'f1', pack: pack('a\nb\nCHANGED\nd') }] });
  assert.equal(changed.cachedHits, 0, 'any change in the pack is a miss');
  assert.equal(calls(), 2);
  for (const name of readdirSync(join(home, 'cache', 'ai'))) assert.equal(statSync(join(home, 'cache', 'ai', name)).mode & 0o777, 0o600);
});

test('a damaged cache entry is a miss, not a crash', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agents-cache-'));
  const cache = fileVerdictCache(home);
  const { provider, calls } = counting();
  const input = { provider, providerId: 'anthropic' as const, model: 'm', candidates: [{ id: 'f1', pack: pack('a\nb\nc') }], cache };
  await verifyCandidates(input);
  for (const name of readdirSync(join(home, 'cache', 'ai'))) writeFileSync(join(home, 'cache', 'ai', name), '{not json');
  const r = await verifyCandidates(input);
  assert.equal(r.cachedHits, 0);
  assert.equal(calls(), 2);
});

test('old entries are pruned', () => {
  const home = mkdtempSync(join(tmpdir(), 'agents-cache-'));
  const cache = fileVerdictCache(home);
  cache.set('old', { verdict: 'confirmed', reachability: '', defenses: '', impact: '', citations: [], reason: 'r', provider: 'anthropic', model: 'm', cached: false, promptVersion: 'v1' });
  cache.set('new', { verdict: 'confirmed', reachability: '', defenses: '', impact: '', citations: [], reason: 'r', provider: 'anthropic', model: 'm', cached: false, promptVersion: 'v1' });
  const old = new Date(Date.now() - 60 * 86_400_000);
  utimesSync(join(home, 'cache', 'ai', 'old.json'), old, old);
  assert.equal(pruneCache(home), 1);
  assert.deepEqual(readdirSync(join(home, 'cache', 'ai')), ['new.json']);
});

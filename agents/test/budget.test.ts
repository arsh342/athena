import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BudgetTracker } from '../src/budget.ts';
import { capsFor, priceFor } from '../src/pricing.ts';
import type { ChatRequest, ModelProvider } from '../src/providers/types.ts';
import { recordSpend, spentToday } from '../src/usage.ts';

const provider = (exact = false): ModelProvider => ({
  id: 'anthropic', endpoint: 'x', async chat() { throw new Error('unused'); },
  async countTokens(r: ChatRequest) { return { tokens: Math.ceil(JSON.stringify(r.messages).length / 4), exact }; },
  capabilities: () => ({ tools: false, structuredOutput: true, caching: 'explicit', exactTokenCount: exact, local: false }),
});
const req = (maxTokens: number, text = 'hello'): ChatRequest => ({ model: 'claude-sonnet-5-5', system: { stable: 's' }, messages: [{ role: 'user', content: [{ type: 'text', text }] }], maxTokens });
const tracker = (over: Partial<ConstructorParameters<typeof BudgetTracker>[0]> = {}, home = mkdtempSync(join(tmpdir(), 'agents-budget-'))) =>
  new BudgetTracker({ provider: provider(), providerId: 'anthropic', model: 'claude-sonnet-5-5', caps: capsFor({ provider: 'anthropic', model: 'claude-sonnet-5-5', budget: { runUsd: 0.1, dayUsd: 1 } }), home, ...over });

test('parallel calls can never push spend past the run cap: reservations are counted before anything is sent', async () => {
  const t = tracker();
  const requests = Array.from({ length: 10 }, () => req(3000));
  const gates = await Promise.all(requests.map((r) => t.beforeCall(r)));
  const allowed = gates.filter((g) => g.ok).length;
  assert.ok(allowed >= 1 && allowed <= 3, `allowed ${allowed}`); // 3000 output tokens at $10/M = $0.03 each: three fit in $0.10
  const refused = gates.find((g) => !g.ok);
  assert.ok(refused && !refused.ok && /run cap \$0\.10/.test(refused.reason), JSON.stringify(refused));
  // Charge what actually happened (the worst case, here): spend never exceeds the cap.
  gates.forEach((g, i) => { if (g.ok) t.afterCall({ inputTokens: 100, outputTokens: 3000 }, 'claude-sonnet-5-5', requests[i]!); });
  assert.ok(t.runSpend().usd <= 0.1, String(t.runSpend().usd));
});

test('real usage below the reservation frees the difference for later calls', async () => {
  const t = tracker();
  const a = req(3000);
  assert.equal((await t.beforeCall(a)).ok, true);
  t.afterCall({ inputTokens: 50, outputTokens: 100 }, 'claude-sonnet-5-5', a);
  for (let i = 0; i < 5; i += 1) {
    const r = req(3000);
    const g = await t.beforeCall(r);
    assert.equal(g.ok, true, `call ${i}`);
    t.afterCall({ inputTokens: 50, outputTokens: 100 }, 'claude-sonnet-5-5', r);
  }
});

test('a call that fails releases its reservation', async () => {
  const t = tracker();
  const r = req(9000); // worst case ~$0.09: nearly the whole run cap
  assert.equal((await t.beforeCall(r)).ok, true);
  assert.equal((await t.beforeCall(req(9000))).ok, false, 'blocked while the first is in flight');
  t.release(r);
  assert.equal((await t.beforeCall(req(9000))).ok, true, 'free again once it failed');
});

test('the day cap blocks a new run with a clear message, using what earlier runs already spent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agents-budget-'));
  recordSpend('anthropic', { usd: 0.98, tokens: 1 }, { home });
  const t = tracker({}, home);
  const gate = await t.beforeCall(req(3000));
  assert.equal(gate.ok, false);
  assert.ok(!gate.ok && /daily cap \$1\.00/.test(gate.reason) && /\$0\.98/.test(gate.reason), JSON.stringify(gate));
  assert.equal(t.dayExhausted(), false, 'not exhausted until the cap itself is reached');
  recordSpend('anthropic', { usd: 0.05, tokens: 1 }, { home });
  assert.equal(tracker({}, home).dayExhausted(), true);
});

test('spend is recorded to the daily ledger and summarised for the "AI: $x this run · $y of $z today" line', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agents-budget-'));
  const t = tracker({}, home);
  const r = req(1000);
  await t.beforeCall(r);
  t.afterCall({ inputTokens: 100_000, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'claude-sonnet-5-5', r); // $0.20 + $0.10 = $0.30 -> beyond the run cap, still recorded honestly
  assert.ok(Math.abs(spentToday('anthropic', { home }).usd - 0.3) < 1e-9);
  const s = t.summary();
  assert.equal(s.unit, 'usd');
  assert.ok(Math.abs(s.run.usd - 0.3) < 1e-9);
  assert.ok(Math.abs(s.today.spent - 0.3) < 1e-9);
  assert.equal(s.today.cap, 1);
  assert.equal(s.costUsd, s.run.usd);
});

test('an unknown price runs under token caps, and the summary has no dollar cost', async () => {
  const t = new BudgetTracker({ provider: provider(), providerId: 'openai', model: 'mystery', caps: capsFor({ provider: 'openai', model: 'mystery', budget: { runTokens: 5000 } }), home: mkdtempSync(join(tmpdir(), 'agents-budget-')) });
  assert.equal((await t.beforeCall(req(1000))).ok, true);
  const big = await t.beforeCall(req(6000));
  assert.equal(big.ok, false);
  assert.ok(!big.ok && /5,000 tokens/.test(big.reason), JSON.stringify(big));
  assert.equal(t.summary().costUsd, null);
});

test('a fallback model is billed at the conservative (priciest) rate', async () => {
  const opus = priceFor('anthropic', 'claude-opus-5-5')!;
  const t = tracker({ fallbackPrice: opus, caps: capsFor({ provider: 'anthropic', model: 'claude-sonnet-5-5', budget: { runUsd: 5 } }) });
  const r = req(1000);
  await t.beforeCall(r);
  t.afterCall({ inputTokens: 1_000_000, outputTokens: 0, fallback: true }, 'claude-sonnet-5-5', r);
  assert.ok(Math.abs(t.runSpend().usd - 4) < 1e-9, 'billed at the Opus 5.5 input rate, not Sonnet\'s');
});

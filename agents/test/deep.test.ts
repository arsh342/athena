import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { loadSkills, type ClassifiedFinding } from '@athena/core';

import { learnRules } from '../src/deep/learned-rules.ts';
import { runPanel } from '../src/deep/panel.ts';
import { suggestPatches } from '../src/deep/patches.ts';
import { tally, type Vote } from '../src/deep/tally.ts';
import { buildContextPack } from '../src/context-pack.ts';
import { AnthropicProvider } from '../src/providers/anthropic.ts';
import type { ChatRequest, ModelProvider } from '../src/providers/types.ts';

test('the 2-of-3 tally is done in code: two agreeing votes decide, anything else needs a human', () => {
  const t = (...v: Vote[]) => tally(v);
  assert.equal(t('confirmed', 'confirmed', 'refuted'), 'confirmed');
  assert.equal(t('refuted', 'confirmed', 'refuted'), 'refuted');
  assert.equal(t('confirmed', 'refuted', 'needs-human'), 'needs-human');
  assert.equal(t('confirmed', 'needs-human', 'needs-human'), 'needs-human');
  assert.equal(t('confirmed', 'confirmed'), 'confirmed', 'two valid votes that agree');
  assert.equal(t('confirmed'), 'needs-human', 'a lone vote is not a quorum');
  assert.equal(t(), 'needs-human');
});

const source = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
const finding = { id: 'f1', ruleId: 'taint.sql-injection', severity: 'HIGH', message: 'm', file: 'a.js', line: 25, code: 'x', confidence: 'medium' } as never;
const cand = (id: string) => ({ id, pack: buildContextPack({ finding: { ...finding, id } as never, source, siblings: [], checklist: '' }) });

function voters(votes: Record<string, Vote>): { provider: ModelProvider; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const provider: ModelProvider = {
    id: 'anthropic', endpoint: 'x',
    async chat(request) {
      requests.push(request);
      const voter = /(reachability|defenses|impact)-first/.exec(request.system.volatile ?? '')?.[1] ?? '?';
      const ids = [...JSON.stringify(request.messages).replace(/\\"/g, '"').matchAll(/<finding id="([^"]+)">/g)].map((m) => m[1]!);
      return { text: '', toolCalls: [], stopReason: 'end', usage: { inputTokens: 100, outputTokens: 20 }, model: 'm', json: { verdicts: ids.map((id) => ({ id, verdict: votes[voter] ?? 'needs-human', reachability: `r-${voter}`, defenses: 'd', impact: 'i', citations: [], reason: `voter ${voter}` })) } };
    },
    async countTokens() { return { tokens: 1, exact: true }; },
    capabilities: () => ({ tools: false, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false }),
  };
  return { provider, requests };
}

test('the panel runs three independently framed voters over one shared cached prefix and tallies them', async () => {
  const { provider, requests } = voters({ reachability: 'confirmed', defenses: 'confirmed', impact: 'refuted' });
  const r = await runPanel({ provider, providerId: 'anthropic', model: 'm', candidates: [cand('a'), cand('b')] });
  assert.equal(requests.length, 3, 'one request per voter for two candidates');
  assert.equal(new Set(requests.map((q) => q.system.stable)).size, 1, 'identical prefix: cached once, read by all three');
  assert.equal(new Set(requests.map((q) => q.system.volatile)).size, 3, 'only the framing differs');
  for (const q of requests) assert.ok(!JSON.stringify(q.messages).includes('voter '), 'a voter never sees another voter\'s answer');
  const a = r.verdicts.get('a')!;
  assert.equal(a.verdict, 'confirmed');
  assert.deepEqual(a.votes, [{ voter: 'reachability-first', verdict: 'confirmed' }, { voter: 'defenses-first', verdict: 'confirmed' }, { voter: 'impact-first', verdict: 'refuted' }]);
  const split = voters({ reachability: 'confirmed', defenses: 'refuted', impact: 'needs-human' });
  assert.equal((await runPanel({ provider: split.provider, providerId: 'anthropic', model: 'm', candidates: [cand('a')] })).verdicts.get('a')!.verdict, 'needs-human');
});

test('a candidate with fewer than two usable votes is "not checked", never decided', async () => {
  let n = 0;
  const { provider } = voters({});
  const flaky: ModelProvider = { ...provider, async chat(request) { n += 1; if (n > 1) return { text: '', toolCalls: [], stopReason: 'refusal', refusal: 'cyber', usage: { inputTokens: 1, outputTokens: 0 }, model: 'm' }; return provider.chat(request); } };
  const r = await runPanel({ provider: flaky, providerId: 'anthropic', model: 'm', candidates: [cand('a')] });
  assert.equal(r.verdicts.size, 0);
  assert.match(r.notChecked[0]!.reason, /quorum/);
});

test('Anthropic Message Batches: requests go as one batch, polled until it ends, answers matched by id; failed requests come back null', async () => {
  const created: Array<{ requests: Array<{ custom_id: string; params: Record<string, any> }> }> = [];
  let polls = 0;
  const msg = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, model: 'claude-sonnet-5-5' });
  const client: any = {
    beta: { messages: { create: async () => { throw new Error('the batch path must not use the beta endpoint'); } } },
    messages: {
      countTokens: async () => ({ input_tokens: 1 }),
      batches: {
        create: async (p: any) => { created.push(p); return { id: 'b1' }; },
        retrieve: async () => ({ processing_status: ++polls < 3 ? 'in_progress' : 'ended' }),
        results: async () => (async function* () { yield { custom_id: 'r1', result: { type: 'errored' } }; yield { custom_id: 'r0', result: { type: 'succeeded', message: msg('{"ok":1}') } }; })(),
      },
    },
  };
  const provider = new AnthropicProvider(client);
  const req = (t: string): ChatRequest => ({ model: 'claude-sonnet-5-5', system: { stable: 's' }, messages: [{ role: 'user', content: [{ type: 'text', text: t }] }], maxTokens: 100, output: { name: 'o', schema: { type: 'object' } } });
  const out = await provider.chatBatch([req('a'), req('b')], { pollMs: 1 });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]!.requests.map((r) => r.custom_id), ['r0', 'r1']);
  assert.ok(created[0]!.requests.every((r) => !('betas' in r.params) && !('fallbacks' in r.params)));
  assert.equal(polls, 3);
  assert.deepEqual(out[0]!.json, { ok: 1 });
  assert.equal(out[1], null);
});

test('with useBatch the panel sends each voter as a batch instead of live calls', async () => {
  const { provider } = voters({ reachability: 'confirmed', defenses: 'confirmed', impact: 'confirmed' });
  let live = 0;
  const batched: ModelProvider = {
    ...provider,
    async chat() { live += 1; throw new Error('live call not expected'); },
    async chatBatch(requests) { return Promise.all(requests.map((r) => provider.chat(r))); },
  };
  const r = await runPanel({ provider: batched, providerId: 'anthropic', model: 'm', candidates: [cand('a')], useBatch: true });
  assert.equal(live, 0);
  assert.equal(r.verdicts.get('a')!.verdict, 'confirmed');
});

function project() {
  const root = mkdtempSync(join(tmpdir(), 'deep-'));
  const write = (rel: string, body: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  write('src/a.js', "const cp = require('child_process');\nfunction run(cmd) { return cp.execSync('sh -c ' + cmd); }\nmodule.exports = { run };\n");
  write('src/b.js', "const cp = require('child_process');\nfunction other(arg) { return cp.execSync('echo ' + arg); }\nmodule.exports = { other };\n");
  return root;
}
const confirmed = (root: string): ClassifiedFinding => ({ id: 'cf1', severity: 'HIGH', type: 'Command injection', category: 'injection', message: 'user input reaches execSync', file: join(root, 'src/a.js'), line: 2, column: 1, code: "cp.execSync('sh -c ' + cmd)", aiScore: 0, explainedScore: { score: 0, band: 'LOW', signalsTriggered: 0, variance: 0, topSignals: [] }, source: 'athena-taint', ruleId: 'taint.command-injection', confidence: 'high', aiVerdict: { verdict: 'confirmed', reason: 'r', lenses: { reachability: 'r', defenses: 'd', impact: 'i' }, citations: [], provider: 'anthropic', model: 'm', cached: false } });

test('confirmed findings become learned rules that an offline scan reuses, and look-alikes elsewhere are found', async () => {
  const root = project();
  const added = await learnRules(root, [confirmed(root)]);
  assert.equal(added.length, 1);
  const file = join(root, '.athena', 'learned-rules.json');
  assert.ok(existsSync(file));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).rules.length, 1);
  assert.equal(loadSkills(root).learned.length, 1, 'the offline engine loads it');
  assert.deepEqual(await learnRules(root, [confirmed(root)]), [], 'idempotent: the same rule is not added twice');
  assert.equal(await learnRules(root, [{ ...confirmed(root), aiVerdict: { ...confirmed(root).aiVerdict!, verdict: 'refuted' } }]).then((r) => r.length), 0, 'refuted findings never become rules');
});

const unifiedDiff = (file: string) => `--- a/${file}\n+++ b/${file}\n@@ -1,3 +1,3 @@\n const cp = require('child_process');\n-function run(cmd) { return cp.execSync('sh -c ' + cmd); }\n+function run(cmd) { return cp.execFileSync('sh', ['-c', cmd]); }\n module.exports = { run };\n`;

function patcher(diffFile: string, approve: boolean): ModelProvider {
  return {
    id: 'anthropic', endpoint: 'x',
    async chat(request) {
      const writing = /write a minimal patch/i.test(request.system.stable);
      return { text: '', toolCalls: [], stopReason: 'end', usage: { inputTokens: 100, outputTokens: 50 }, model: 'm', json: writing ? { patch: unifiedDiff(diffFile), explanation: 'use execFileSync' } : { approve, concerns: approve ? '' : 'changes behaviour' } };
    },
    async countTokens() { return { tokens: 1, exact: true }; },
    capabilities: () => ({ tools: false, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false }),
  };
}

test('patches are written for review only when a second call approves them, touch only the cited file, and are never applied', async () => {
  const root = project();
  const before = readFileSync(join(root, 'src/a.js'), 'utf8');
  const ok = await suggestPatches({ root, findings: [confirmed(root)], provider: patcher('src/a.js', true), model: 'm' });
  assert.equal(ok.written.length, 1);
  assert.ok(existsSync(join(root, '.athena', 'patches', 'cf1.patch')));
  assert.equal(readFileSync(join(root, 'src/a.js'), 'utf8'), before, 'the source file is untouched');

  const root2 = project();
  const rejected = await suggestPatches({ root: root2, findings: [confirmed(root2)], provider: patcher('src/a.js', false), model: 'm' });
  assert.equal(rejected.written.length, 0);
  assert.match(rejected.skipped[0]!.reason, /reviewer rejected/);
  assert.ok(!existsSync(join(root2, '.athena', 'patches')) || readdirSync(join(root2, '.athena', 'patches')).length === 0);

  const root3 = project();
  const wrongFile = await suggestPatches({ root: root3, findings: [confirmed(root3)], provider: patcher('src/b.js', true), model: 'm' });
  assert.equal(wrongFile.written.length, 0);
  assert.match(wrongFile.skipped[0]!.reason, /other than the cited file/);
  const escape = await suggestPatches({ root: root3, findings: [confirmed(root3)], provider: patcher('../../etc/passwd', true), model: 'm' });
  assert.equal(escape.written.length, 0);
});

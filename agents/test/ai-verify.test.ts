import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mergeConfig, recomputeGate, type ClassifiedFinding, type ScanReport } from '@athena/core';

import { runAiVerify, selectCandidates } from '../src/ai-verify.ts';
import { recordSpend } from '../src/usage.ts';
import type { ChatRequest, ModelProvider } from '../src/providers/types.ts';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agents-ai-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/app.js'), Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`).join('\n'));
  const home = mkdtempSync(join(tmpdir(), 'agents-home-'));
  const f = (id: string, over: Partial<ClassifiedFinding> = {}): ClassifiedFinding => ({
    id, severity: 'HIGH', type: 'T', category: 'injection', message: `finding ${id}`, file: join(root, 'src/app.js'), line: 30, column: 1, code: 'x', aiScore: 0,
    explainedScore: { score: 0, band: 'LOW', signalsTriggered: 0, variance: 0, topSignals: [] }, source: 'athena-taint', ruleId: 'taint.sql-injection', confidence: 'medium', evidence: ['reachable'], priority: 1, ...over,
  });
  const report = (findings: ClassifiedFinding[]): ScanReport => ({ timestamp: 't', duration: 1, files: [{ path: join(root, 'src/app.js'), units: [], findings }], summary: { findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, blocked: false } } as unknown as ScanReport);
  return { root, home, f, report };
}
const config = mergeConfig({ blockOn: ['CRITICAL', 'HIGH'] });

function fake(verdictFor: (id: string) => 'confirmed' | 'refuted' | 'needs-human' | null): { provider: ModelProvider; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  const provider: ModelProvider = {
    id: 'anthropic', endpoint: 'https://api.anthropic.com',
    async chat(request) {
      requests.push(request);
      const ids = [...JSON.stringify(request.messages).replace(/\\"/g, '"').matchAll(/<finding id="([^"]+)">/g)].map((m) => m[1]!);
      return { text: '', toolCalls: [], stopReason: 'end', usage: { inputTokens: 2000, outputTokens: 300 }, model: 'claude-sonnet-5-5', json: { verdicts: ids.flatMap((id) => { const v = verdictFor(id); return v ? [{ id, verdict: v, reachability: 'r', defenses: 'd', impact: 'i', citations: ['src/app.js:30'], reason: `because ${id}` }] : []; }) } };
    },
    async countTokens() { return { tokens: 2000, exact: true }; },
    capabilities: () => ({ tools: false, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false }),
  };
  return { provider, requests };
}
const base = (s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => ({ root: s.root, home: s.home, config, provider: 'anthropic' as const, confirm: async () => true, ...over });

test('only medium and low confidence offline findings go to the AI; secrets and high-confidence findings never do; at most 20, highest priority first', () => {
  const s = setup();
  const findings = [
    s.f('high', { confidence: 'high' }), s.f('secret', { source: 'athena-secrets', ruleId: 'secret.aws', confidence: 'medium' }), s.f('dep', { source: 'athena-deps', ruleId: 'deps.vulnerable' }),
    ...Array.from({ length: 25 }, (_, i) => s.f(`m${i}`, { priority: i })),
  ];
  const picked = selectCandidates(s.report(findings), 20);
  assert.equal(picked.length, 20);
  assert.ok(picked.every((p) => !['high', 'secret', 'dep'].includes(p.finding.id)));
  assert.equal(picked[0]!.finding.id, 'm24', 'highest priority first');
});

test('confirmed findings become high confidence and keep blocking; refuted ones drop to needs-review with the reason and stop blocking', async () => {
  const s = setup();
  const report = s.report([s.f('keep'), s.f('drop')]);
  recomputeGate(report, config);
  assert.equal(report.summary.blocked, true);
  const { provider, requests } = fake((id) => (id === 'keep' ? 'confirmed' : 'refuted'));
  await runAiVerify(report, { ...base(s), providerOverride: provider, model: 'claude-sonnet-5-5' });
  const [keep, drop] = report.files[0]!.findings;
  assert.equal(keep!.confidence, 'high');
  assert.equal(keep!.aiVerdict!.verdict, 'confirmed');
  assert.equal(drop!.confidence, 'low');
  assert.match(drop!.evidence![0]!, /AI refuted.*because drop/);
  assert.equal(report.summary.needsReview, 1);
  assert.equal(report.summary.blocked, true, 'the confirmed HIGH still blocks');
  assert.equal(requests.length, 1, 'two candidates fit in one batch');
  const ai = report.summary.ai!;
  assert.deepEqual([ai.mode, ai.provider, ai.model, ai.checked, ai.notChecked.length], ['verify', 'anthropic', 'claude-sonnet-5-5', 2, 0]);
  assert.ok(ai.costUsd! > 0 && ai.costUsd! < 0.25);
  assert.equal(ai.today!.cap, 1);
});

test('when the AI refutes every blocker the run no longer blocks', async () => {
  const s = setup();
  const report = s.report([s.f('only')]);
  recomputeGate(report, config);
  assert.equal(report.summary.blocked, true);
  await runAiVerify(report, { ...base(s), providerOverride: fake(() => 'refuted').provider, model: 'claude-sonnet-5-5' });
  assert.equal(report.summary.blocked, false);
});

test('the budget stops the run mid-way: the rest are listed as not checked and keep their offline confidence', async () => {
  const s = setup();
  const report = s.report(Array.from({ length: 12 }, (_, i) => s.f(`c${i}`, { priority: 100 - i })));
  const { provider } = fake(() => 'confirmed');
  await runAiVerify(report, { ...base(s), providerOverride: provider, model: 'claude-sonnet-5-5', budget: { runUsd: 0.09 } });
  const ai = report.summary.ai!;
  assert.equal(ai.checked, 5, 'the first batch fits, the second does not (worst case is reserved at the conservative fallback rate)');
  assert.equal(ai.checked + ai.notChecked.length, 12);
  assert.match(ai.notChecked[0]!.reason, /run cap \$0\.09 reached.*not checked by AI \(budget\)/);
  const untouched = report.files[0]!.findings.filter((f) => !f.aiVerdict);
  assert.ok(untouched.length > 0 && untouched.every((f) => f.confidence === 'medium'));
});

test('a day that is already at its cap skips the AI with a clear note and leaves the offline result alone', async () => {
  const s = setup();
  recordSpend('anthropic', { usd: 1, tokens: 1 }, { home: s.home });
  const report = s.report([s.f('a')]);
  const { provider, requests } = fake(() => 'confirmed');
  await runAiVerify(report, { ...base(s), providerOverride: provider, model: 'claude-sonnet-5-5' });
  assert.equal(requests.length, 0);
  assert.match(report.summary.ai!.notChecked[0]!.reason, /daily cap \$1\.00 reached/);
  assert.equal(report.files[0]!.findings[0]!.confidence, 'medium');
});

test('declining the consent notice sends nothing; consent is asked once per repository', async () => {
  const s = setup();
  const { provider, requests } = fake(() => 'confirmed');
  let asked = 0;
  const report = s.report([s.f('a')]);
  await runAiVerify(report, { ...base(s, { confirm: async () => { asked += 1; return false; } }), providerOverride: provider, model: 'claude-sonnet-5-5' });
  assert.equal(requests.length, 0);
  assert.match(report.summary.ai!.notChecked[0]!.reason, /declined/);
  const second = s.report([s.f('a')]);
  await runAiVerify(second, { ...base(s, { confirm: async () => { asked += 1; return true; } }), providerOverride: provider, model: 'claude-sonnet-5-5' });
  assert.equal(requests.length, 1);
  const third = s.report([s.f('b')]);
  await runAiVerify(third, { ...base(s, { confirm: async () => { asked += 1; return true; } }), providerOverride: provider, model: 'claude-sonnet-5-5' });
  assert.equal(asked, 2, 'not asked again after consent was given');
});

test('a second run over unchanged code is served from the cache: no requests, no spend', async () => {
  const s = setup();
  const { provider, requests } = fake(() => 'confirmed');
  const opts = { ...base(s), providerOverride: provider, model: 'claude-sonnet-5-5' };
  await runAiVerify(s.report([s.f('a')]), opts);
  assert.equal(requests.length, 1);
  const again = s.report([s.f('a')]);
  await runAiVerify(again, opts);
  assert.equal(requests.length, 1);
  assert.equal(again.summary.ai!.cachedHits, 1);
  assert.equal(again.summary.ai!.costUsd, 0);
  assert.equal(again.files[0]!.findings[0]!.aiVerdict!.cached, true);
});

test('another provider needs an explicit model until a benchmark picks its default', async () => {
  const s = setup();
  await assert.rejects(runAiVerify(s.report([s.f('a')]), { ...base(s, { provider: 'openai' }), providerOverride: fake(() => 'confirmed').provider }), /--model/);
});

test('hunt mode: explores first, then verifies what it found together with the uncertain offline findings, under one shared budget', async () => {
  const s = setup();
  mkdirSync(join(s.root, 'api'), { recursive: true });
  writeFileSync(join(s.root, 'api/h.js'), "const express = require('express');\nconst app = express();\napp.get('/x', (req, res) => { res.send(String(req.query.q)); });\n");
  const report = s.report([s.f('known')]);
  const requests: ChatRequest[] = [];
  const provider: ModelProvider = {
    id: 'anthropic', endpoint: 'https://api.anthropic.com',
    async chat(request) {
      requests.push(request);
      const usage = { inputTokens: 500, outputTokens: 100 };
      if (request.tools?.length) {
        if (!request.messages.at(-1)!.content.some((b) => b.type === 'tool_result')) return { text: '', toolCalls: [{ id: 't', name: 'read_file', input: { path: 'h.js', startLine: null, endLine: null } }], stopReason: 'tool_use', usage, model: 'm' };
        return { text: '', toolCalls: [], stopReason: 'end', usage, model: 'm', json: { findings: [{ title: 'Reflected XSS', severity: 'MEDIUM', file: 'h.js', line: 3, explanation: 'echoed', citations: ['h.js:3'] }] } };
      }
      const ids = [...JSON.stringify(request.messages).replace(/\\"/g, '"').matchAll(/<finding id="([^"]+)">/g)].map((m) => m[1]!);
      return { text: '', toolCalls: [], stopReason: 'end', usage, model: 'm', json: { verdicts: ids.map((id) => ({ id, verdict: 'confirmed', reachability: 'r', defenses: 'd', impact: 'i', citations: [], reason: 'ok' })) } };
    },
    async countTokens() { return { tokens: 500, exact: true }; },
    capabilities: () => ({ tools: true, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false }),
  };
  await runAiVerify(report, { ...base(s), mode: 'hunt', providerOverride: provider, model: 'claude-sonnet-5-5' });
  const ai = report.summary.ai!;
  assert.equal(ai.mode, 'hunt');
  assert.ok(ai.hunt!.explored.length >= 1 && ai.hunt!.added >= 1);
  const agentFindings = report.files.flatMap((f) => f.findings).filter((f) => f.source === 'athena-agent');
  assert.ok(agentFindings.length >= 1);
  assert.equal(agentFindings[0]!.confidence, 'high', 'verified in the same run after the hunt');
  assert.ok(ai.requests >= 3, `hunt (2) + verify (1+): ${ai.requests}`);
});

function deepSetup() {
  const root = mkdtempSync(join(tmpdir(), 'agents-deep-'));
  mkdirSync(join(root, 'src'));
  const src = "const cp = require('child_process');\nfunction run(cmd) { return cp.execSync('sh -c ' + cmd); }\nmodule.exports = { run };\n";
  writeFileSync(join(root, 'src/app.js'), src);
  const home = mkdtempSync(join(tmpdir(), 'agents-deephome-'));
  const f: ClassifiedFinding = { id: 'd1', severity: 'HIGH', type: 'Command injection', category: 'injection', message: 'input reaches execSync', file: join(root, 'src/app.js'), line: 2, column: 1, code: "cp.execSync('sh -c ' + cmd)", aiScore: 0, explainedScore: { score: 0, band: 'LOW', signalsTriggered: 0, variance: 0, topSignals: [] }, source: 'athena-taint', ruleId: 'taint.command-injection', confidence: 'medium', evidence: ['reachable'], priority: 5 };
  const report = { timestamp: 't', duration: 1, files: [{ path: join(root, 'src/app.js'), units: [], findings: [f] }], summary: { findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, blocked: false } } as unknown as ScanReport;
  return { root, home, report, src };
}

function deepProvider(log: string[], src: string): ModelProvider {
  return {
    id: 'anthropic', endpoint: 'https://api.anthropic.com',
    async chat(request) {
      const usage = { inputTokens: 400, outputTokens: 80 };
      const kind = request.output?.name ?? 'none';
      log.push(kind);
      if (kind === 'threat_model') return { text: '', toolCalls: [], stopReason: 'end', usage, model: 'm', json: { summary: 'Small CLI helper that shells out', invariants: ['commands never include unescaped input'], focus: ['injection'] } };
      if (kind === 'findings') {
        if (!request.messages.at(-1)!.content.some((b) => b.type === 'tool_result')) return { text: '', toolCalls: [{ id: 't', name: 'list_dir', input: { path: '.' } }], stopReason: 'tool_use', usage, model: 'm' };
        return { text: '', toolCalls: [], stopReason: 'end', usage, model: 'm', json: { findings: [] } };
      }
      if (kind === 'verdicts') {
        const ids = [...JSON.stringify(request.messages).replace(/\\"/g, '"').matchAll(/<finding id="([^"]+)">/g)].map((m) => m[1]!);
        return { text: '', toolCalls: [], stopReason: 'end', usage, model: 'm', json: { verdicts: ids.map((id) => ({ id, verdict: 'confirmed', reachability: 'r', defenses: 'd', impact: 'i', citations: ['src/app.js:2'], reason: 'real' })) } };
      }
      if (kind === 'patch') return { text: '', toolCalls: [], stopReason: 'end', usage, model: 'm', json: { patch: `--- a/src/app.js\n+++ b/src/app.js\n@@ -2 +2 @@\n-function run(cmd) { return cp.execSync('sh -c ' + cmd); }\n+function run(cmd) { return cp.execFileSync('sh', ['-c', cmd]); }\n`, explanation: 'no shell string' } };
      if (kind === 'review') return { text: '', toolCalls: [], stopReason: 'end', usage, model: 'm', json: { approve: true, concerns: '' } };
      throw new Error(`unexpected request kind ${kind} (${src.length})`);
    },
    async countTokens() { return { tokens: 400, exact: true }; },
    capabilities: () => ({ tools: true, structuredOutput: true, caching: 'explicit', exactTokenCount: true, local: false }),
  };
}

test('deep mode refuses to start without an explicit budget, and without confirmation sends nothing', async () => {
  const d = deepSetup();
  const log: string[] = [];
  const common = { ...base({ root: d.root, home: d.home } as never), root: d.root, home: d.home, providerOverride: deepProvider(log, d.src), model: 'claude-sonnet-5-5', mode: 'deep' as const };
  await assert.rejects(runAiVerify(d.report, { ...common, budget: { runUsd: 1 } }), /explicit spend cap/);
  await runAiVerify(d.report, { ...common, budget: { runUsd: 1 }, budgetExplicit: true, confirmDeep: async () => false });
  assert.deepEqual(log, [], 'no request without the user\'s confirmation');
  assert.match(d.report.summary.ai!.notChecked[0]!.reason, /not confirmed/);
});

test('deep mode: threat model, research passes, a three-voter panel, learned rules and (on request) reviewed patches, none applied', async () => {
  const d = deepSetup();
  const log: string[] = [];
  let estimate = '';
  await runAiVerify(d.report, { ...base({ root: d.root, home: d.home } as never), root: d.root, home: d.home, providerOverride: deepProvider(log, d.src), model: 'claude-sonnet-5-5', mode: 'deep', budget: { runUsd: 2 }, budgetExplicit: true, suggestFixes: true, confirmDeep: async (e) => { estimate = e; return true; } });
  assert.match(estimate, /\$2\.00 this run/);
  assert.equal(log.filter((k) => k === 'threat_model').length, 1);
  assert.ok(log.filter((k) => k === 'findings').length >= 2, 'researchers ran');
  assert.equal(log.filter((k) => k === 'verdicts').length, 3, 'three voters');
  assert.equal(log.filter((k) => k === 'patch').length, 1);
  assert.equal(log.filter((k) => k === 'review').length, 1);
  const f = d.report.files[0]!.findings.find((x) => x.id === 'd1')!;
  assert.equal(f.confidence, 'high');
  assert.equal(f.aiVerdict!.verdict, 'confirmed');
  const ai = d.report.summary.ai!;
  assert.equal(ai.mode, 'deep');
  assert.match(ai.deep!.threatModel, /shells out/);
  assert.equal(ai.deep!.learnedRules.length, 1);
  assert.equal(ai.deep!.patches.length, 1);
  assert.ok(existsSync(join(d.root, '.athena', 'learned-rules.json')));
  assert.equal(readFileSync(join(d.root, 'src/app.js'), 'utf8'), d.src, 'the source is never modified');
  assert.ok(ai.costUsd! < 2);
});

test('deep mode stops at its cap and reports what it did not do', async () => {
  const d = deepSetup();
  const log: string[] = [];
  await runAiVerify(d.report, { ...base({ root: d.root, home: d.home } as never), root: d.root, home: d.home, providerOverride: deepProvider(log, d.src), model: 'claude-sonnet-5-5', mode: 'deep', budget: { runUsd: 0.05 }, budgetExplicit: true, confirmDeep: async () => true });
  const ai = d.report.summary.ai!;
  assert.ok(ai.costUsd! <= 0.05, String(ai.costUsd));
  assert.ok(ai.notChecked.length > 0 || ai.hunt!.notExplored.length > 0, 'something was left undone and said so');
});

test('review mode: packs carry the change, and a confirmed flaw that predates it moves to existing issues and stops blocking', async () => {
  const s = setup();
  const report = s.report([s.f('new'), s.f('old')]);
  report.review = { scope: 'staged', skippedBinary: [], renamed: [], deleted: [], existing: [] };
  recomputeGate(report, config);
  const { provider, requests } = fake(() => 'confirmed');
  // The fake answers without predatesChange: add it per id.
  const chat = provider.chat.bind(provider);
  provider.chat = async (request) => {
    const r = await chat(request);
    const verdicts = (r.json as { verdicts: Array<{ id: string }> }).verdicts.map((v) => ({ ...v, predatesChange: v.id === 'old' }));
    return { ...r, json: { verdicts } };
  };
  const changes = { files: [{ path: 'src/app.js', status: 'modified' as const, binary: false, ranges: [[28, 31] as [number, number]], removed: ['db.query("select " + id)'] }] };
  await runAiVerify(report, { ...base(s), providerOverride: provider, model: 'claude-sonnet-5-5', changes });
  const sent = JSON.stringify(requests[0]);
  assert.match(sent, /predatesChange/);
  assert.match(sent, /change: lines 28-31 were changed/);
  assert.match(sent, /removed code/);
  assert.deepEqual(report.files[0]!.findings.map((f) => f.id), ['new']);
  assert.deepEqual(report.review!.existing.map((f) => f.id), ['old']);
  assert.equal(report.review!.existing[0]!.aiVerdict!.predatesChange, true);
  assert.equal(report.summary.blocked, true, 'the new flaw still blocks');
});

test('outside review mode the schema and prompt are unchanged', async () => {
  const s = setup();
  const { provider, requests } = fake(() => 'confirmed');
  await runAiVerify(s.report([s.f('a')]), { ...base(s), providerOverride: provider, model: 'claude-sonnet-5-5' });
  assert.doesNotMatch(JSON.stringify(requests[0]), /predatesChange/);
});

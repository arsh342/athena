import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { newHome, runCli } from './helpers-cli.ts';

const OFF = ['--no-deps', '--no-eslint', '--quiet'];
/** One finding the offline engine grades low confidence ("needs review"), so it does not block on its own. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'athena-ai-'));
  writeFileSync(join(dir, 'b.js'), "const cp = require('child_process');\nfunction build(name) { return cp.execSync('make ' + process.argv[2] + name); }\nbuild('x');\n");
  return dir;
}
const run = (dir: string, args: string[], home: string, fake?: string) => runCli(['scan', dir, ...OFF, ...args], home, undefined, fake ? { ATHENA_AGENTS_FAKE: fake } : { ATHENA_AGENTS_FAKE: '' });
const ids = (report: any) => report.files.flatMap((f: any) => f.findings) as Array<{ ruleId: string; confidence: string; aiVerdict?: { verdict: string } }>;

test('baseline: the offline result has no AI, the finding is low confidence, and the gate passes', async () => {
  const r = await run(project(), ['--fail-on', 'high', '--format', 'json'], newHome());
  assert.equal(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.summary.ai, undefined);
  assert.equal(ids(report).find((f) => f.ruleId === 'taint.command-injection')!.confidence, 'low');
});

test('--ai --yes: a confirmed finding becomes high confidence and now blocks; the report says what the AI did and cost', async () => {
  const home = newHome();
  const r = await run(project(), ['--ai', '--yes', '--fail-on', 'high', '--format', 'json'], home, 'confirm');
  const report = JSON.parse(r.stdout);
  assert.equal(r.code, 1, r.stderr);
  const f = ids(report).find((x) => x.ruleId === 'taint.command-injection')!;
  assert.equal(f.confidence, 'high');
  assert.equal(f.aiVerdict!.verdict, 'confirmed');
  const ai = report.summary.ai;
  assert.deepEqual([ai.mode, ai.provider, ai.model], ['verify', 'anthropic', 'claude-sonnet-5-5']);
  assert.ok(ai.costUsd > 0 && ai.costUsd < 0.25, String(ai.costUsd));
  assert.ok(ai.checked >= 1);
  assert.equal(ai.today.cap, 1);
});

test('a refuted finding stays "needs review" and the exit code is unchanged (0)', async () => {
  const r = await run(project(), ['--ai', '--yes', '--fail-on', 'high', '--format', 'json'], newHome(), 'refute');
  assert.equal(r.code, 0);
  const f = ids(JSON.parse(r.stdout)).find((x) => x.ruleId === 'taint.command-injection')!;
  assert.equal(f.confidence, 'low');
  assert.equal(f.aiVerdict!.verdict, 'refuted');
});

test('the terminal report prints "AI: $x this run · $y of $z today"', async () => {
  const r = await run(project(), ['--ai', '--yes', '--fail-on', 'none', '--no-color'], newHome(), 'confirm');
  assert.match(r.stdout, /AI: \$0\.\d\d this run · \$0\.\d\d of \$1\.00 today/);
  assert.match(r.stdout, /verify · anthropic claude-sonnet-5-5 · \d+ checked/);
});

test('without --yes in a non-interactive run nothing is sent: the notice explains, the offline result is unchanged', async () => {
  const r = await run(project(), ['--ai', '--fail-on', 'high', '--format', 'json'], newHome(), 'confirm');
  assert.equal(r.code, 0);
  assert.match(r.stderr, /re-run with --yes/);
  assert.match(r.stderr, /capped at \$0\.25 per run and \$1\.00 per day/);
  const report = JSON.parse(r.stdout);
  assert.match(report.summary.ai.notChecked[0].reason, /declined/);
  assert.equal(ids(report).find((x) => x.ruleId === 'taint.command-injection')!.confidence, 'low');
});

test('a tiny --budget stops the AI before it sends anything and says why; a second run the same day is served from the cache', async () => {
  const home = newHome();
  const dir = project();
  const tiny = await run(dir, ['--ai', '--yes', '--budget', '0.001', '--fail-on', 'none', '--format', 'json'], home, 'confirm');
  const report = JSON.parse(tiny.stdout);
  assert.equal(report.summary.ai.checked, 0);
  assert.match(report.summary.ai.notChecked[0].reason, /run cap \$0\.00 reached.*not checked by AI \(budget\)/);
  const first = JSON.parse((await run(dir, ['--ai', '--yes', '--fail-on', 'none', '--format', 'json'], home, 'confirm')).stdout);
  assert.ok(first.summary.ai.costUsd > 0);
  const second = JSON.parse((await run(dir, ['--ai', '--yes', '--fail-on', 'none', '--format', 'json'], home, 'confirm')).stdout);
  assert.ok(second.summary.ai.cachedHits >= 1);
  assert.equal(second.summary.ai.costUsd, 0, 'unchanged code costs nothing the second time');
});

test('bad AI options are usage errors; AI options without --ai are refused; deep needs an explicit budget', async () => {
  const dir = project();
  for (const args of [['--ai', 'bogus'], ['--ai', 'deep'], ['--suggest-fixes'], ['--ai', 'hunt', '--suggest-fixes'], ['--ai', '--provider', 'nope'], ['--ai', '--quality', 'turbo'], ['--ai', '--budget', '-1'], ['--model', 'x'], ['--budget', '0.5']]) {
    const r = await run(dir, args, newHome());
    assert.notEqual(r.code, 0, args.join(' '));
    assert.match(r.stderr, /--ai|--provider|--quality|--budget/);
  }
});

test('a provider without a key skips the AI step with a warning and never fails the scan; no key is ever printed', async () => {
  const r = await runCli(['scan', project(), ...OFF, '--ai', '--yes', '--provider', 'openai', '--model', 'some-model', '--fail-on', 'high', '--format', 'json'], newHome(), undefined, { OPENAI_API_KEY: '', ATHENA_AGENTS_FAKE: '' });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /AI verification was skipped: no OpenAI key/);
  assert.doesNotMatch(r.stdout + r.stderr, /sk-/);
});

test('--ai hunt explores the riskiest components with read-only tools and then verifies, reporting both', async () => {
  const dir = project();
  writeFileSync(join(dir, 'server.js'), "const express = require('express');\nconst app = express();\napp.get('/x', (req, res) => { res.send(String(req.query.q)); });\n");
  const r = await run(dir, ['--ai', 'hunt', '--yes', '--fail-on', 'none', '--format', 'json'], newHome(), 'confirm');
  assert.equal(r.code, 0, r.stderr);
  const ai = JSON.parse(r.stdout).summary.ai;
  assert.equal(ai.mode, 'hunt');
  assert.ok(ai.hunt.explored.length >= 1, JSON.stringify(ai.hunt));
  assert.ok(ai.requests >= 3, `hunt makes two calls, verify at least one: ${ai.requests}`);
});

test('--ai deep: needs --budget and --yes; panel verdicts carry the three votes; a learned rule is written for the offline engine', async () => {
  const dir = project();
  writeFileSync(join(dir, 'server.js'), "const express = require('express');\nconst app = express();\napp.get('/x', (req, res) => { res.send(String(req.query.q)); });\n");
  const noYes = await run(dir, ['--ai', 'deep', '--budget', '1', '--fail-on', 'none', '--format', 'json'], newHome(), 'confirm');
  assert.match(noYes.stderr, /re-run with --yes/);
  assert.match(JSON.parse(noYes.stdout).summary.ai.notChecked[0].reason, /declined/, 'nothing is sent without agreement');
  const r = await run(dir, ['--ai', 'deep', '--budget', '1', '--yes', '--fail-on', 'high', '--format', 'json'], newHome(), 'confirm');
  assert.equal(r.code, 1, r.stderr);
  const report = JSON.parse(r.stdout);
  const ai = report.summary.ai;
  assert.equal(ai.mode, 'deep');
  assert.equal(ai.deep.categories.length, 3);
  assert.equal(ai.deep.threatModel, 'Fake threat model');
  const verdict = ids(report).find((f) => f.ruleId === 'taint.command-injection')! as { aiVerdict: { votes: unknown[]; verdict: string } };
  assert.equal(verdict.aiVerdict.votes.length, 3);
  assert.equal(verdict.aiVerdict.verdict, 'confirmed');
  assert.ok(ai.costUsd < 1);
  const { readFileSync, existsSync } = await import('node:fs');
  assert.ok(existsSync(join(dir, '.athena', 'learned-rules.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, '.athena', 'learned-rules.json'), 'utf8')).rules.length, ai.deep.learnedRules.length);
});

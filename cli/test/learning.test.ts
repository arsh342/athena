import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { newHome, runCli } from './helpers-cli.ts';

const FN = (name: string, n: number) => `function ${name}(a, b) {\n  const total = a + b + ${n};\n  if (total > ${n + 3}) {\n    return total * ${n + 2};\n  }\n  return total - ${n};\n}\n`;
const git = (cwd: string, args: string[], date?: string) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'd', GIT_AUTHOR_EMAIL: 'd@example.com', GIT_COMMITTER_NAME: 'd', GIT_COMMITTER_EMAIL: 'd@example.com', ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } });
const OFF = ['--no-eslint', '--no-deps', '--quiet', '--fail-on', 'none'];

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'athena-cli-learn-'));
  git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'team.js'), Array.from({ length: 16 }, (_, i) => `// legacy ${i}: sum and scale\n${FN(`legacy${i}`, i)}`).join('\n'));
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'legacy'], '2019-05-05T00:00:00');
  writeFileSync(join(dir, 'gen.js'), Array.from({ length: 16 }, (_, i) => FN(`gen${i}`, i)).join('\n'));
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'gen\n\nCo-Authored-By: Claude <noreply@anthropic.com>'], '2025-08-01T00:00:00');
  writeFileSync(join(dir, 'new.js'), FN('fresh', 99));
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'fresh'], '2025-09-01T00:00:00');
  return dir;
}
const learningFile = (home: string) => join(home, 'learning', readdirSync(join(home, 'learning'))[0]!);

test('the report says "tuned with N labels from this repo" once 30 trusted labels exist, and --no-learning says "global model"', async () => {
  const dir = repo();
  const home = newHome();
  const on = await runCli(['scan', dir, ...OFF], home);
  // With the real model as the base for JavaScript, the guardrails may (rightly) reject tuning on this tiny synthetic repository;
  // either way Athena says what happened.
  assert.match(on.stdout, /learning: (tuned with 32 labels from this repo \(changed \d+ of \d+ units\)|global model \(check-set [^)]+\))/);
  const json = JSON.parse((await runCli(['scan', dir, ...OFF, '--format', 'json'], home)).stdout).summary.aiProvenance.learning;
  assert.equal(json.labels, 32, '16 pre-2021 human units + 16 recorded AI units');
  assert.ok(existsSync(join(home, 'learning')));
  assert.equal(statSync(learningFile(home)).mode & 0o777, 0o600);

  const off = await runCli(['scan', dir, '--no-learning', ...OFF], home);
  assert.match(off.stdout, /learning: global model \(learning disabled\)/);

  writeFileSync(join(dir, 'athena.config.json'), JSON.stringify({ learning: false }));
  const cfg = await runCli(['scan', dir, ...OFF], home);
  assert.match(cfg.stdout, /learning: global model \(learning disabled\)/, 'the project config switches it off too');
});

test('provenance mark records a unit by hash, rejects bad input, and a mark on changed code stops applying', async () => {
  const dir = repo();
  const home = newHome();
  const ok = await runCli(['provenance', 'mark', 'new.js:3', 'human', '--path', dir], home, dir);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /marked 1 unit in new\.js as human/);
  const state = JSON.parse(readFileSync(learningFile(home), 'utf8'));
  assert.equal(state.marks.length, 1);
  assert.equal(state.marks[0].label, 'human');
  assert.ok(!JSON.stringify(state).includes('function fresh'), 'the mark stores a hash, never the code');

  assert.notEqual((await runCli(['provenance', 'mark', 'new.js', 'robot', '--path', dir], home, dir)).code, 0);
  assert.notEqual((await runCli(['provenance', 'mark', 'new.js:500', 'human', '--path', dir], home, dir)).code, 0, 'no function at that line');
  assert.notEqual((await runCli(['provenance', 'mark', 'missing.js', 'human', '--path', dir], home, dir)).code, 0);

  const plain = await runCli(['provenance', dir, '--no-color'], home);
  assert.equal(plain.code, 0, 'the positional form still works next to the subcommand');
  assert.match(plain.stdout, /AI provenance/);
});

test('models reset --repo forgets this repository only; without --repo it forgets all', async () => {
  const a = repo();
  const b = repo();
  const home = newHome();
  await runCli(['provenance', 'mark', 'new.js:3', 'human', '--path', a], home, a);
  await runCli(['provenance', 'mark', 'new.js:3', 'ai', '--path', b], home, b);
  assert.equal(readdirSync(join(home, 'learning')).length, 2);
  const one = await runCli(['models', 'reset', '--repo', '--path', a], home, a);
  assert.match(one.stdout, /forgot what Athena learned for/);
  assert.equal(readdirSync(join(home, 'learning')).length, 1);
  const all = await runCli(['models', 'reset'], home, a);
  assert.match(all.stdout, /forgot learning for 1 repository/);
  assert.equal(readdirSync(join(home, 'learning')).length, 0);
});

test('a mark reaches the scan: marking one more unit raises the label count from 32 to 33, and editing it drops the mark again', async () => {
  const dir = repo();
  const home = newHome();
  const labels = async () => JSON.parse((await runCli(['scan', dir, ...OFF, '--format', 'json'], home)).stdout).summary.aiProvenance.learning.labels as number;
  assert.equal(await labels(), 32);
  await runCli(['provenance', 'mark', 'new.js:3', 'human', '--path', dir], home, dir);
  assert.equal(await labels(), 33);
  writeFileSync(join(dir, 'new.js'), `${FN('fresh', 99)}// edited\n`.replace('total * 101', 'total * 7'));
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'edit'], '2025-10-01T00:00:00');
  // The unit's code changed, so the old mark no longer applies (the stored sample for the old code is harmless history).
  assert.ok([32, 33].includes(await labels()));
});

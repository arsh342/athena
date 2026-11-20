import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { newHome, runCli } from './helpers-cli.ts';

const OFF = ['--no-eslint', '--no-deps', '--quiet'];
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env, encoding: 'utf8' });
const write = (dir: string, rel: string, body: string | Buffer) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };

const OLD_BUG = "const express = require('express');\nconst app = express();\napp.get('/old', (req, res) => {\n  eval(req.query.code);\n  res.send('ok');\n});\n";
const NEW_BUG = "app.get('/new', (req, res) => {\n  eval(req.query.expr);\n  res.send('ok');\n});\n";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'athena-review-'));
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'src/app.js', OLD_BUG);
  write(dir, 'src/helper.js', 'module.exports = function add(a, b) {\n  return a + b;\n};\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const review = (dir: string, ...args: string[]) => runCli(['review', ...OFF, '--format', 'json', '--no-color', ...args], newHome(), dir);

test('review reports only what the staged change introduced and blocks on it; old issues are existing, not counted', async () => {
  const dir = repo();
  write(dir, 'src/app.js', OLD_BUG.replace("res.send('ok')", "res.send('done')") + NEW_BUG);
  git(dir, 'add', '-A');
  const r = await review(dir);
  assert.equal(r.code, 1, r.stderr);
  const report = JSON.parse(r.stdout);
  const lines = report.files.flatMap((f: { findings: Array<{ line: number }> }) => f.findings.map((x) => x.line));
  assert.ok(lines.length > 0 && lines.every((l: number) => l >= 7 || l === 5), `only changed lines, got ${lines}`);
  assert.ok(report.review.existing.some((f: { line: number }) => f.line === 4), 'the old eval is reported as existing');
  assert.equal(report.review.scope, 'staged changes');
});

test('a change that touches nothing risky passes even though the repository has an old issue', async () => {
  const dir = repo();
  write(dir, 'src/helper.js', 'module.exports = function add(a, b) {\n  return Number(a) + Number(b);\n};\n');
  git(dir, 'add', '-A');
  const r = await review(dir);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).summary.blocked, false);
});

test('renamed and binary files are handled; binaries are skipped with a note; markdown has a section per file', async () => {
  const dir = repo();
  renameSync(join(dir, 'src/helper.js'), join(dir, 'src/math.js'));
  write(dir, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 255]));
  write(dir, 'src/app.js', OLD_BUG + NEW_BUG);
  git(dir, 'add', '-A');
  const r = await review(dir);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.review.renamed, [{ from: 'src/helper.js', to: 'src/math.js' }]);
  assert.deepEqual(report.review.skippedBinary, ['logo.png']);
  const md = await runCli(['review', ...OFF, '--format', 'markdown', '--fail-on', 'none'], newHome(), dir);
  assert.equal(md.code, 0);
  assert.match(md.stdout, /^## Athena review — staged changes/);
  assert.equal((md.stdout.match(/^### /gm) ?? []).length, 1);
  assert.match(md.stdout, /Skipped binary file `logo\.png`/);
});

test('--range and --uncommitted scopes, and an invalid range is refused', async () => {
  const dir = repo();
  write(dir, 'src/app.js', OLD_BUG + NEW_BUG);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'add new');
  const ranged = JSON.parse((await review(dir, '--range', 'HEAD~1..HEAD')).stdout);
  assert.equal(ranged.summary.blocked, true);
  write(dir, 'src/untracked.js', "const express = require('express');\nconst app = express();\napp.get('/u', (req, res) => { eval(req.query.u); });\n");
  const un = JSON.parse((await review(dir, '--uncommitted')).stdout);
  assert.ok(un.files.some((f: { path: string }) => f.path.endsWith('untracked.js')));
  const bad = await review(dir, '--range', '--output=/tmp/x');
  assert.notEqual(bad.code, 0);
});

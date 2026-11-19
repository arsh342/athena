import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsx = import.meta.resolve('tsx');
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ATHENA_HOME: mkdtempSync(join(tmpdir(), 'ah-')), NO_COLOR: '1' };

/** A repo plus an `athena` shim on PATH that runs the TypeScript entry. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'athena-hooks-'));
  const bin = mkdtempSync(join(tmpdir(), 'athena-bin-'));
  writeFileSync(join(bin, 'athena'), `#!/bin/sh\nexec "${process.execPath}" --import "${tsx}" "${entry}" "$@"\n`);
  chmodSync(join(bin, 'athena'), 0o755);
  const env = { ...gitEnv, PATH: `${bin}:${process.env.PATH}` };
  const git = (...a: string[]) => spawnSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'ok.js'), 'module.exports = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const athena = (...a: string[]) => spawnSync(process.execPath, ['--import', tsx, entry, ...a], { cwd: dir, env, encoding: 'utf8' });
  return { dir, git, athena, env };
}
const BUG = "const express = require('express');\nconst app = express();\napp.get('/x', (req, res) => { eval(req.query.c); });\n";

test('init writes an executable pre-commit hook; the hook blocks a bad commit, allows a good one, and ATHENA_SKIP skips with a note', () => {
  const { dir, git, athena, env } = setup();
  const r = athena('init');
  assert.equal(r.status, 0, r.stderr);
  const hook = join(dir, '.git', 'hooks', 'pre-commit');
  assert.ok(statSync(hook).mode & 0o111, 'executable');
  assert.match(readFileSync(hook, 'utf8'), /# athena-hook/);

  writeFileSync(join(dir, 'bad.js'), BUG);
  git('add', '-A');
  const blocked = git('commit', '-q', '-m', 'bad');
  assert.notEqual(blocked.status, 0, blocked.stdout + blocked.stderr);
  // Latency: best of three one-file checks (the built CLI takes about 1 s; this harness adds TypeScript start-up and suite load).
  const times: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const t = Date.now();
    athena('check', '--staged', '--quiet', '--fail-on', 'high');
    times.push(Date.now() - t);
  }
  assert.ok(Math.min(...times) < 4500, `check took ${times.join(', ')} ms`);

  const skipped = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'bad'], { cwd: dir, env: { ...env, ATHENA_SKIP: '1' }, encoding: 'utf8' });
  assert.equal(skipped.status, 0);
  assert.match(skipped.stdout + skipped.stderr, /skipped because ATHENA_SKIP/);

  writeFileSync(join(dir, 'fine.js'), 'module.exports = 2;\n');
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'fine').status, 0);
});

test('core.hooksPath is respected', () => {
  const { dir, git, athena } = setup();
  const custom = join(dir, 'my-hooks');
  git('config', 'core.hooksPath', 'my-hooks');
  assert.equal(athena('init').status, 0);
  assert.ok(existsSync(join(custom, 'pre-commit')));
  assert.ok(!existsSync(join(dir, '.git', 'hooks', 'pre-commit')));
});

test('Husky, lefthook and the pre-commit framework are detected: a snippet is printed and no file changes', () => {
  for (const [marker, expected] of [['.husky/pre-commit', /\.husky\/pre-commit/], ['lefthook.yml', /lefthook|commands:/], ['.pre-commit-config.yaml', /repo: local/]] as const) {
    const { dir, athena } = setup();
    mkdirSync(dirname(join(dir, marker)), { recursive: true });
    writeFileSync(join(dir, marker), 'existing\n');
    const r = athena('init', '--hooks', 'pre-commit,pre-push');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr + r.stdout, expected);
    assert.match(r.stderr + r.stdout, /athena check --staged/);
    assert.ok(!existsSync(join(dir, '.git', 'hooks', 'pre-commit')));
    assert.equal(readFileSync(join(dir, marker), 'utf8'), 'existing\n');
  }
});

test('an existing hook that is not Athena\'s is never overwritten without --force; uninstall removes only Athena hooks', () => {
  const { dir, athena } = setup();
  const hook = join(dir, '.git', 'hooks', 'pre-commit');
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, '#!/bin/sh\necho mine\n', { mode: 0o755 });
  const r = athena('init');
  assert.match(r.stderr + r.stdout, /already exists and is not Athena's/);
  assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\necho mine\n');
  athena('uninstall');
  assert.ok(existsSync(hook), 'foreign hook survives uninstall');
  assert.equal(athena('init', '--force').status, 0);
  assert.match(readFileSync(hook, 'utf8'), /# athena-hook/);
  athena('uninstall');
  assert.ok(!existsSync(hook));
});

test('pre-push reviews @{u}..HEAD and blocks on a HIGH finding; without an upstream it does nothing', () => {
  const { dir, git, athena, env } = setup();
  const remote = mkdtempSync(join(tmpdir(), 'athena-remote-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: remote });
  git('remote', 'add', 'origin', remote);
  assert.equal(athena('init', '--hooks', 'pre-push').status, 0);
  assert.equal(git('push', '-q', '-u', 'origin', 'main').status, 0, 'no new commits to review');
  writeFileSync(join(dir, 'bad.js'), BUG);
  git('add', '-A');
  git('commit', '-q', '-m', 'bad');
  const push = spawnSync('git', ['push', '-q'], { cwd: dir, env, encoding: 'utf8' });
  assert.notEqual(push.status, 0, push.stdout + push.stderr);
  const skipped = spawnSync('git', ['push', '-q'], { cwd: dir, env: { ...env, ATHENA_SKIP: '1' }, encoding: 'utf8' });
  assert.equal(skipped.status, 0);
});

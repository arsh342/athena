import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { newHome, runCli } from './helpers-cli.ts';

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (dir: string, ...a: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dir, env });
const OFF = ['--no-eslint', '--no-deps', '--quiet', '--format', 'json'];

test('#12 check from a subdirectory resolves staged paths against the repository top level', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-checkpaths-'));
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'pkg', 'sub'), { recursive: true });
  writeFileSync(join(dir, 'pkg', 'app.js'), "const express = require('express');\nconst app = express();\napp.get('/x', (req, res) => { eval(req.query.c); });\n");
  git(dir, 'add', '-A');
  const r = await runCli(['check', ...OFF], newHome(), join(dir, 'pkg', 'sub'));
  const report = JSON.parse(r.stdout);
  assert.equal(r.code, 1, r.stderr);
  assert.ok(report.summary.filesScanned >= 1, 'the staged file was found from a subdirectory');
});

test('#12 an explicit file that does not exist is a coverage gap (exit 3 with --strict), not silently dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-checkmissing-'));
  git(dir, 'init', '-q', '-b', 'main');
  const r = await runCli(['check', 'nope.js', '--strict', ...OFF], newHome(), dir);
  const report = JSON.parse(r.stdout);
  assert.ok(report.summary.coverage.gaps.some((g: string) => /missing/.test(g)), JSON.stringify(report.summary.coverage.gaps));
  assert.equal(r.code, 3);
});

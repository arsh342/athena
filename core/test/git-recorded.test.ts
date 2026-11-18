import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { isAiCommit, type CommitMeta } from '../src/provenance/ai-markers.ts';
import { recordedAiLines } from '../src/provenance/git-recorded.ts';
import { repoKey } from '../src/util/athena-home.ts';
import { git, makeRepo } from './helpers/git-fixture.ts';

function makeRepo2(dir: string, file: string, body: string): void {
  writeFileSync(join(dir, file), body);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', 'unrelated');
}

const tmp = () => mkdtempSync(join(tmpdir(), 'athena-git-'));
const meta = (over: Partial<CommitMeta> = {}): CommitMeta => ({
  sha: 'a'.repeat(40), authorName: 'Human', authorEmail: 'h@example.com',
  committerName: 'Human', committerEmail: 'h@example.com', message: 'feat: x', ...over,
});

test('isAiCommit recognises trailers, bot authors and ignores dependabot', () => {
  assert.equal(isAiCommit(meta({ message: 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>' })), true);
  assert.equal(isAiCommit(meta({ authorName: 'copilot-swe-agent[bot]' })), true);
  assert.equal(isAiCommit(meta({ authorName: 'dependabot[bot]', message: 'chore: bump' })), false);
  assert.equal(isAiCommit(meta({ message: 'fix: cursor position in editor' })), false);
});

test('human names and pair-programming trailers are not AI', () => {
  assert.equal(isAiCommit(meta({ authorName: 'Claude Dupont', authorEmail: 'claude.dupont@corp.fr' })), false);
  assert.equal(isAiCommit(meta({ authorName: 'Devin Lee', authorEmail: 'devin@corp.com' })), false);
  assert.equal(isAiCommit(meta({ message: 'feat: x\n\nCo-authored-by: Jules Martin <jules@corp.fr>' })), false);
  assert.equal(isAiCommit(meta({ message: 'feat: x\n\nCo-authored-by: Gemini Rossi <gemini.rossi@corp.it>' })), false);
  assert.equal(isAiCommit(meta({ message: 'feat: x\n\nCo-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>' })), true);
  assert.equal(isAiCommit(meta({ message: 'feat: x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>' })), true);
  assert.equal(isAiCommit(meta({ message: 'feat: x\n\nAssisted-by: Claude' })), true);
  assert.equal(isAiCommit(meta({ authorName: 'Claude', authorEmail: 'noreply@anthropic.com' })), true);
});

test('lines from an AI-trailer commit are recorded; human commit lines are not', async () => {
  const dir = tmp();
  const cacheDir = tmp();
  makeRepo(dir, [
    { files: { 'a.ts': 'one\ntwo\nthree\n' }, message: 'init' },
    { files: { 'a.ts': 'one\ntwo\nthree\nfour\nfive\nsix\n' }, message: 'feat: more\n\nCo-Authored-By: Claude <noreply@anthropic.com>' },
  ]);
  const r = await recordedAiLines(dir, [join(dir, 'a.ts')], { cacheDir });
  assert.equal(r.available, true);
  assert.deepEqual([...r.files.get(join(dir, 'a.ts'))!.aiLines].sort((x, y) => x - y), [4, 5, 6]);
});

test('uncommitted edits and untracked files are never recorded and do not throw', async () => {
  const dir = tmp();
  makeRepo(dir, [
    { files: { 'a.ts': 'one\ntwo\n' }, message: 'feat\n\nCo-Authored-By: Claude <noreply@anthropic.com>' },
  ]);
  writeFileSync(join(dir, 'a.ts'), 'one\nedited\n');
  writeFileSync(join(dir, 'b.ts'), 'new\n');
  const r = await recordedAiLines(dir, [join(dir, 'a.ts'), join(dir, 'b.ts')], { cacheDir: tmp() });
  assert.deepEqual([...r.files.get(join(dir, 'a.ts'))!.aiLines], [1]);
  assert.equal(r.files.get(join(dir, 'b.ts'))!.available, false);
  assert.equal(r.files.get(join(dir, 'b.ts'))!.reason, 'not tracked by git');
});

test('non-git directory and shallow clone are unavailable with reasons', async () => {
  const plain = tmp();
  assert.equal((await recordedAiLines(plain, [])).reason, 'not a git repository');

  const src = tmp();
  makeRepo(src, [
    { files: { 'a.ts': 'one\n' }, message: 'one' },
    { files: { 'a.ts': 'one\ntwo\n' }, message: 'two' },
  ]);
  const clone = join(tmp(), 'clone');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${src}`, clone]);
  const r = await recordedAiLines(clone, [join(clone, 'a.ts')], { cacheDir: tmp() });
  assert.equal(r.available, false);
  assert.equal(r.reason, 'shallow clone: history not available');
});

test('cache is keyed by file content, not HEAD: an unrelated commit adds no cache files', async () => {
  const dir = tmp();
  const cacheDir = tmp();
  makeRepo(dir, [{ files: { 'a.ts': 'one\n', 'b.ts': 'x\n' }, message: 'init' }]);
  await recordedAiLines(dir, [join(dir, 'a.ts')], { cacheDir });
  const count = () => readdirSync(join(cacheDir, repoKey(dir))).length;
  const before = count();
  makeRepo2(dir, 'b.ts', 'y\n');
  await recordedAiLines(dir, [join(dir, 'a.ts')], { cacheDir });
  assert.equal(count(), before);
});

test('first run writes one cache file per blamed file under cacheDir/<repoKey>/', async () => {
  const dir = tmp();
  const cacheDir = tmp();
  makeRepo(dir, [{ files: { 'a.ts': 'one\n' }, message: 'init' }]);
  await recordedAiLines(dir, [join(dir, 'a.ts')], { cacheDir });
  assert.equal(readdirSync(join(cacheDir, repoKey(dir))).filter((n) => n.endsWith('.json')).length, 1);
});

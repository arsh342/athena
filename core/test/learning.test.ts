import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, statSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseFileDetailed } from '../src/parser/ast-parser.ts';
import { scoreUnit } from '../src/scorer/heuristic-scorer.ts';
import { defaultConfig } from '../src/config.ts';
import { markRecordedUnits } from '../src/provenance/aggregate.ts';
import { recordedAiLines } from '../src/provenance/git-recorded.ts';
import { collectTrustedLabels, labelSetHash, unitSha, type Mark } from '../src/learning/labels.ts';
import { MAX_SHIFT, applyAdjustment, splitHoldout, trainAdjustment, type Sample } from '../src/learning/learner.ts';
import { passesGuardrails, type CheckSet } from '../src/learning/guardrails.ts';
import { decodeCheckSet, encodeCheckSet } from '../src/learning/check-set.ts';
import { addMarks, loadLearning, resetLearning, saveLearning } from '../src/learning/store.ts';
import type { FileReport } from '../src/types.ts';

const FN = (name: string) => `function ${name}(a, b) {\n  const total = a + b;\n  if (total > 10) {\n    return total * 2;\n  }\n  return total;\n}\n`;

function git(cwd: string, args: string[], date?: string, extra: Record<string, string> = {}): void {
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@example.com', ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}), ...extra } });
}

async function repo() {
  const root = mkdtempSync(join(tmpdir(), 'athena-learn-'));
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'old.js'), FN('oldFn'));
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init'], '2020-01-01T00:00:00');
  writeFileSync(join(root, 'ai.js'), FN('aiFn'));
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'add\n\nCo-Authored-By: Claude <noreply@anthropic.com>'], '2025-06-01T00:00:00');
  writeFileSync(join(root, 'new.js'), FN('newFn'));
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'new'], '2025-07-01T00:00:00');
  const paths = ['old.js', 'ai.js', 'new.js'].map((f) => join(root, f));
  const files: FileReport[] = [];
  for (const path of paths) {
    const { units } = await parseFileDetailed(path);
    files.push({ path, units: units.map((u) => scoreUnit(u, defaultConfig)), findings: [] });
  }
  const recorded = await recordedAiLines(root, paths, { cacheDir: mkdtempSync(join(tmpdir(), 'athena-blame-')) });
  markRecordedUnits(files, recorded);
  return { root, files, recorded, paths };
}

test('trusted labels: pre-2021 code is human, AI-trailer code is ai, modern human code is unlabelled', async () => {
  const { files, recorded } = await repo();
  const labels = collectTrustedLabels(files, recorded, []);
  const by = (name: string) => labels.find((l) => l.path.endsWith(name));
  assert.equal(by('old.js')?.label, 'human');
  assert.equal(by('old.js')?.source, 'pre-2021');
  assert.equal(by('ai.js')?.label, 'ai');
  assert.equal(by('ai.js')?.source, 'recorded');
  assert.equal(by('new.js'), undefined, 'recent human code has no trusted label');
});

test('marks: a mark labels unchanged code (also when the file moved) and is dropped when the code changed', async () => {
  const { files, recorded, paths } = await repo();
  const newUnit = files.find((f) => f.path === paths[2])!.units[0]!;
  const mark: Mark = { sha: unitSha(newUnit.unit.code), label: 'human', path: 'new.js', startLine: newUnit.unit.startLine, endLine: newUnit.unit.endLine, at: 't' };
  const labelled = collectTrustedLabels(files, recorded, [mark]);
  assert.equal(labelled.find((l) => l.path.endsWith('new.js'))?.source, 'mark');

  const moved = files.map((f) => (f.path === paths[2] ? { ...f, path: f.path.replace('new.js', 'moved/renamed.js') } : f));
  assert.equal(collectTrustedLabels(moved, recorded, [mark]).find((l) => l.path.endsWith('renamed.js'))?.label, 'human', 'identical content keeps its mark');

  const changed = files.map((f) => (f.path === paths[2] ? { ...f, units: f.units.map((u) => ({ ...u, unit: { ...u.unit, code: `${u.unit.code}\n// edited` } })) } : f));
  assert.equal(collectTrustedLabels(changed, recorded, [mark]).find((l) => l.path.endsWith('new.js')), undefined, 'a changed unit loses its mark');

  const mixed: Mark = { ...mark, label: 'mixed' };
  assert.equal(collectTrustedLabels(files, recorded, [mixed]).find((l) => l.path.endsWith('new.js')), undefined, 'mixed marks are stored but cannot be learned from');
  assert.notEqual(labelSetHash(labelled), labelSetHash([]));
});

// ── learner ──
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const dense = (commentRatio: number) => { const d = new Float32Array(35); d[3] = commentRatio; d[4] = 0.3 + rnd() * 0.05; return d; };
let n = 0;
const sample = (y: 0 | 1, pBase: number, d: Float32Array): Sample => ({ y, pBase, dense: d, key: `k${n++}` });

/** A comment-heavy human team: the heuristic scores their code like AI, but their comment ratio is very different from the AI code's. */
function teamSamples(humans = 40, ais = 40): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < humans; i += 1) out.push(sample(0, 0.55 + rnd() * 0.2, dense(0.5 + rnd() * 0.05)));
  for (let i = 0; i < ais; i += 1) out.push(sample(1, 0.6 + rnd() * 0.2, dense(0.1 + rnd() * 0.05)));
  return out;
}

test('learning activates only with >= 30 labels and >= 10 of each class', () => {
  assert.equal(trainAdjustment(teamSamples(14, 14)), null, 'fewer than 30 labels');
  assert.equal(trainAdjustment(teamSamples(35, 5)), null, 'fewer than 10 AI labels');
  assert.ok(trainAdjustment(teamSamples(20, 20)));
});

test('adjusted probabilities never move more than 0.25 from the base, and a helpful adjustment on a comment-heavy human team is adopted', () => {
  const trained = trainAdjustment(teamSamples())!;
  for (const s of teamSamples(30, 30)) {
    const p = applyAdjustment(trained.adjustment, s.pBase, s.dense);
    assert.ok(Math.abs(p - s.pBase) <= MAX_SHIFT + 1e-9);
  }
  assert.ok(trained.adjustment.holdout.adjusted < trained.adjustment.holdout.base, 'hold-out log-loss improved');
  assert.deepEqual(passesGuardrails(trained.adjustment, trained.holdout, null), { ok: true });
  const humanAfter = teamSamples(20, 0).map((s) => applyAdjustment(trained.adjustment, s.pBase, s.dense));
  assert.ok(Math.max(...humanAfter) < 0.7, 'the team code is no longer flagged as AI');
});

test('the hold-out is deterministic and stratified', () => {
  const s = teamSamples();
  const a = splitHoldout(s);
  const b = splitHoldout(s);
  assert.deepEqual(a.holdout.map((x) => x.key), b.holdout.map((x) => x.key));
  assert.equal(a.holdout.filter((x) => x.y === 1).length, 8);
  assert.equal(a.holdout.filter((x) => x.y === 0).length, 8);
});

test('a harmful adjustment is rejected by the check set, whichever direction it hurts', () => {
  // The check set: AI units that score 0.72, human units that score 0.55; style feature 3 is low for all of them.
  const check: CheckSet = { rows: [
    ...Array.from({ length: 50 }, () => ({ y: 1 as const, pBase: 0.72, dense: dense(0.1) })),
    ...Array.from({ length: 50 }, () => ({ y: 0 as const, pBase: 0.55, dense: dense(0.1) })),
  ] };
  // A user who labelled almost everything "ai": the repo-trained model pushes low-comment human-looking code over the line.
  const allAi: Sample[] = [...Array.from({ length: 36 }, () => sample(1, 0.55, dense(0.1))), ...Array.from({ length: 12 }, () => sample(0, 0.3, dense(0.6)))];
  const t1 = trainAdjustment(allAi)!;
  const r1 = passesGuardrails(t1.adjustment, t1.holdout, check);
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'check-set human false-positive rate rose');

  // A user who labelled almost everything "human": the model pulls real AI code under the line.
  const allHuman: Sample[] = [...Array.from({ length: 36 }, () => sample(0, 0.72, dense(0.1))), ...Array.from({ length: 12 }, () => sample(1, 0.9, dense(0.6)))];
  const t2 = trainAdjustment(allHuman)!;
  const r2 = passesGuardrails(t2.adjustment, t2.holdout, check);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'check-set recall dropped');
});

test('check-set file format round-trips and rejects damage', () => {
  const rows: CheckSet['rows'] = [{ y: 1, pBase: 0.8, dense: dense(0.2) }, { y: 0, pBase: 0.3, dense: dense(0.4) }];
  const back = decodeCheckSet(encodeCheckSet(rows))!;
  assert.equal(back.rows.length, 2);
  assert.equal(back.rows[0]!.y, 1);
  assert.ok(Math.abs(back.rows[0]!.pBase - 0.8) < 1e-6);
  assert.equal(decodeCheckSet(Buffer.from('nope')), null);
  assert.equal(decodeCheckSet(encodeCheckSet(rows).subarray(0, 50)), null);
});

// ── store ──
test('store: private file, atomic concurrent saves, marks replace by code hash, reset removes only this repo', async () => {
  const home = mkdtempSync(join(tmpdir(), 'athena-learnhome-'));
  const mk = (sha: string, label: Mark['label']): Mark => ({ sha, label, path: 'a.js', startLine: 1, endLine: 5, at: 't' });
  addMarks('/repo/one', [mk('s1', 'human')], home);
  addMarks('/repo/two', [mk('s2', 'ai')], home);
  const dir = join(home, 'learning');
  for (const f of readdirSync(dir)) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600);

  await Promise.all(Array.from({ length: 20 }, (_, i) => Promise.resolve().then(() => saveLearning('/repo/one', { version: 1, marks: [mk(`x${i}`, 'ai')], samples: [], baseTag: '', adjustment: null, labelSet: String(i) }, home))));
  const loaded = loadLearning('/repo/one', home);
  assert.equal(loaded.version, 1);
  assert.equal(loaded.marks.length, 1, 'valid JSON from one of the writers');
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no temp files left behind');

  addMarks('/repo/one', [mk('same', 'human'), mk('same', 'ai')], home);
  assert.equal(loadLearning('/repo/one', home).marks.filter((m) => m.sha === 'same').length, 1);
  assert.equal(loadLearning('/repo/one', home).marks.find((m) => m.sha === 'same')!.label, 'ai', 'the newest mark for the same code wins');

  assert.equal(resetLearning('/repo/one', home), 1);
  assert.deepEqual(loadLearning('/repo/one', home).marks, []);
  assert.equal(loadLearning('/repo/two', home).marks.length, 1, 'other repositories are untouched');
  assert.equal(resetLearning(undefined, home), 1);
});

test('a corrupt or foreign learning file is ignored, never crashes a scan', () => {
  const home = mkdtempSync(join(tmpdir(), 'athena-learnhome-'));
  mkdirSync(join(home, 'learning'), { recursive: true });
  addMarks('/repo/x', [], home);
  const f = join(home, 'learning', readdirSync(join(home, 'learning'))[0]!);
  writeFileSync(f, '{ not json');
  assert.deepEqual(loadLearning('/repo/x', home).marks, []);
  writeFileSync(f, JSON.stringify({ version: 99 }));
  assert.equal(loadLearning('/repo/x', home).adjustment, null);
  assert.ok(existsSync(f) && readFileSync(f, 'utf8').length > 0 && copyFileSync);
});

// ── engine integration ──
import { scanFiles } from '../src/engine.ts';

const many = (prefix: string, n: number, comments: boolean) => Array.from({ length: n }, (_, i) => `${comments ? `// ${prefix} step ${i}: sum the two inputs and scale the result\n` : ''}function ${prefix}${i}(a, b) {\n  const total = a + b + ${i};\n  if (total > ${i + 3}) {\n    return total * ${i + 2};\n  }\n  return total - ${i};\n}\n`).join('\n');

async function trainedRepo() {
  const root = mkdtempSync(join(tmpdir(), 'athena-learn-e2e-'));
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'team.js'), many('legacy', 16, true));
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'legacy'], '2019-05-05T00:00:00');
  writeFileSync(join(root, 'gen.js'), many('gen', 16, false));
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'gen\n\nCo-Authored-By: Claude <noreply@anthropic.com>'], '2025-08-01T00:00:00');
  return root;
}
const quiet = { eslint: { enabled: false, timeoutMs: 1000 }, dependencies: { enabled: false } } as never;
const opts = (root: string, home: string, learning: boolean | undefined = undefined) => ({ root, analysis: false, skills: false as const, learning: { home, checkSet: null }, ...(learning === false ? {} : {}) });

test('end to end: 32 trusted labels activate learning, the report says so honestly, and learning can be switched off', async () => {
  const root = await trainedRepo();
  const home = mkdtempSync(join(tmpdir(), 'athena-learnhome-'));
  const files = [join(root, 'team.js'), join(root, 'gen.js')];

  const first = await scanFiles(files, quiet, {}, opts(root, home));
  const lr = first.summary.aiProvenance!.learning!;
  assert.equal(lr.state, 'tuned');
  assert.equal(lr.labels, 32, '16 pre-2021 human units + 16 recorded AI units');
  assert.equal(typeof lr.unitsChanged, 'number');
  const stored = loadLearning(root, home);
  assert.equal(stored.samples.length, 32);
  assert.ok(stored.adjustment);
  assert.ok(stored.samples.every((s) => !('code' in s)), 'only numbers are stored, never code');

  // A partial scan (like `athena check --staged`) keeps what was learned.
  const partial = await scanFiles([files[1]!], quiet, {}, opts(root, home));
  assert.equal(partial.summary.aiProvenance!.learning!.state, 'tuned');
  assert.equal(loadLearning(root, home).samples.length, 32);

  // Opting out bypasses both training and applying, and leaves the stored state as it was.
  const before = readFileSync(join(home, 'learning', readdirSync(join(home, 'learning'))[0]!), 'utf8');
  const off = await scanFiles(files, { ...(quiet as object), learning: false } as never, {}, opts(root, home));
  assert.deepEqual([off.summary.aiProvenance!.learning!.state, off.summary.aiProvenance!.learning!.reason], ['global', 'learning disabled']);
  assert.equal(readFileSync(join(home, 'learning', readdirSync(join(home, 'learning'))[0]!), 'utf8'), before);
});

test('too few labels: the global model is used and the report says how many were found', async () => {
  const root = await trainedRepo();
  const home = mkdtempSync(join(tmpdir(), 'athena-learnhome-'));
  const report = await scanFiles([join(root, 'gen.js')], quiet, {}, opts(root, home));
  const lr = report.summary.aiProvenance!.learning!;
  assert.equal(lr.state, 'global');
  assert.equal(lr.labels, 16);
  assert.equal(loadLearning(root, home).adjustment, null);
});

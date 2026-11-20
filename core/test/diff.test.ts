import assert from 'node:assert/strict';
import test from 'node:test';

import { parseUnifiedDiff, wholeFileChanges } from '../src/diff/changes.ts';
import { applyChangeFilter } from '../src/diff/filter.ts';
import { formatMarkdownReview } from '../src/report/markdown.ts';
import type { ClassifiedFinding, ScanReport } from '../src/types.ts';

const DIFF = [
  'diff --git a/src/a.js b/src/a.js', 'index 1..2 100644', '--- a/src/a.js', '+++ b/src/a.js',
  '@@ -3,0 +4,2 @@ ctx', '+x', '+y', '@@ -10 +12 @@', '-old', '+new',
  'diff --git a/old/name.js b/new/name.js', 'similarity index 100%', 'rename from old/name.js', 'rename to new/name.js',
  'diff --git a/img.png b/img.png', 'index 1..2 100644', 'Binary files a/img.png and b/img.png differ',
  'diff --git a/gone.js b/gone.js', 'deleted file mode 100644', '--- a/gone.js', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b',
  'diff --git a/fresh.js b/fresh.js', 'new file mode 100644', '--- /dev/null', '+++ b/fresh.js', '@@ -0,0 +1,3 @@', '+1', '+2', '+3', '',
].join('\n');

test('diff parsing: ranges, rename, binary, deletion, new file', () => {
  const { files } = parseUnifiedDiff(DIFF);
  const by = new Map(files.map((f) => [f.path, f]));
  assert.deepEqual(by.get('src/a.js')!.ranges, [[4, 5], [12, 12]]);
  assert.deepEqual([by.get('new/name.js')!.status, by.get('new/name.js')!.oldPath, by.get('new/name.js')!.ranges], ['renamed', 'old/name.js', []]);
  assert.equal(by.get('img.png')!.binary, true);
  assert.equal(by.get('gone.js')!.status, 'deleted');
  assert.deepEqual(by.get('fresh.js')!.ranges, [[1, 3]]);
  assert.equal(wholeFileChanges(['u.js'])[0]!.ranges[0]![1] > 1e9, true);
});

const finding = (line: number, over: Partial<ClassifiedFinding> = {}): ClassifiedFinding => ({ id: `f${line}`, severity: 'HIGH', type: 'T', category: 'c', message: 'm', file: '/r/src/a.js', line, column: 1, code: '', aiScore: 0, explainedScore: { score: 0, band: 'LOW', signalsTriggered: 0, variance: 0, topSignals: [] }, source: 'athena-rules', ruleId: 'x.y', ...over });
const unit = { unit: { startLine: 1, endLine: 20 } } as never;

test('only findings on changed lines count; others in a changed unit are existing issues; gate is recomputed', () => {
  const report = { files: [{ path: '/r/src/a.js', units: [unit], findings: [finding(4), finding(8, { severity: 'CRITICAL' }), finding(40)] }, { path: '/r/untouched.js', units: [], findings: [finding(1, { file: '/r/untouched.js' })] }], summary: { findings: { CRITICAL: 1, HIGH: 3, MEDIUM: 0, LOW: 0 }, blocked: true } } as unknown as ScanReport;
  const info = applyChangeFilter(report, parseUnifiedDiff(DIFF), '/r', { blockOn: ['CRITICAL', 'HIGH'] }, 'staged changes');
  assert.deepEqual(report.files.flatMap((f) => f.findings.map((x) => x.line)), [4]);
  assert.deepEqual(info.existing.map((f) => f.line), [8], 'in the changed function but not on a changed line');
  assert.deepEqual(report.summary.findings, { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 });
  assert.equal(report.summary.blocked, true);
  assert.deepEqual(info.skippedBinary, ['img.png']);
  assert.deepEqual(info.renamed, [{ from: 'old/name.js', to: 'new/name.js' }]);
  const none = { files: [{ path: '/r/src/a.js', units: [], findings: [finding(40)] }], summary: { findings: {}, blocked: true } } as unknown as ScanReport;
  applyChangeFilter(none, parseUnifiedDiff(DIFF), '/r', { blockOn: ['HIGH'] }, 's');
  assert.equal(none.summary.blocked, false, 'an old finding no longer blocks a change that did not touch it');

  const md = formatMarkdownReview(report, info, { root: '/r' });
  assert.match(md, /^## Athena review — staged changes/);
  assert.equal((md.match(/^### /gm) ?? []).length, 1, 'one section per file with findings');
  assert.match(md, /Existing issues in code this change touches/);
  assert.match(md, /Skipped binary file `img\.png`/);
  assert.match(md, /Renamed `old\/name\.js` → `new\/name\.js`/);
});

test('parseUnifiedDiff keeps the removed lines, not the --- header', () => {
  const set = parseUnifiedDiff(['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -3,2 +3,1 @@', '-old one', '-old two', '+new'].join('\n'));
  assert.deepEqual(set.files[0]!.removed, ['old one', 'old two']);
  assert.deepEqual(set.files[0]!.ranges, [[3, 3]]);
});

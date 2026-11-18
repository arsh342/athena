import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { mergeConfig } from '../src/config.ts';
import { scanFiles } from '../src/engine.ts';
import { buildAiProvenance, markRecordedUnits } from '../src/provenance/aggregate.ts';
import type { RecordedRepo } from '../src/provenance/git-recorded.ts';
import type { FileReport, ScoredUnit, UnitProvenance } from '../src/types.ts';
import { makeRepo } from './helpers/git-fixture.ts';

const noExternal = {
  semgrep: { enabled: false, timeoutMs: 1000, config: 'auto' }, eslint: { enabled: false, timeoutMs: 1000 },
  npmAudit: { enabled: false, timeoutMs: 1000 }, nodejsscan: { enabled: false, timeoutMs: 1000, requireDocker: false },
  bearer: { enabled: false, timeoutMs: 1000 },
};
const noRecorded: RecordedRepo = { available: false, reason: 'not a git repository', files: new Map() };

function unit(path: string, startLine: number, code: string, provenance: UnitProvenance): ScoredUnit {
  const endLine = startLine + code.split('\n').length - 1;
  return {
    unit: {
      id: `${startLine}`, name: 'u', kind: 'function', filePath: path, startLine, endLine, code,
      metadata: { loc: endLine - startLine + 1, commentLines: 0, commentRatio: 0, identifiers: [], nestingDepth: 1, parameters: [], hasJSDoc: false, complexity: 1 },
    },
    score: 0, signals: [], flagged: false, provenance, recorded: false,
    explained: { score: 0, band: 'LOW', signalsTriggered: 0, variance: 0, topSignals: [] },
  };
}
const fileWith = (path: string, ...units: ScoredUnit[]): FileReport => ({ path, units, findings: [] });
const lines = (n: number, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i};`).join('\n');

test('nested units: a line counts once, for the innermost unit', () => {
  const outer = unit('a.ts', 1, lines(10), 'human');
  const inner = unit('a.ts', 3, lines(4), 'ai');
  const p = buildAiProvenance([fileWith('a.ts', outer, inner)], noRecorded);
  assert.equal(p.totalLines, 10);
  const e = p.estimated;
  assert.equal(e.aiLines + e.humanLines + e.mixedLines + e.uncertainLines, p.totalLines);
  assert.equal(e.aiLines, 4);
  assert.equal(e.humanLines, 6);
});

test('recorded lines raise the low end and mark the unit recorded at >= 80%', () => {
  const u = unit('a.ts', 1, lines(10), 'human');
  const file = fileWith('a.ts', u);
  const recorded: RecordedRepo = { available: true, files: new Map([['a.ts', { available: true, aiLines: new Set([1, 2, 3, 4, 5, 6, 7, 8]) }]]) };
  markRecordedUnits([file], recorded);
  assert.equal(u.recorded, true);
  assert.equal(u.flagged, true);
  const p = buildAiProvenance([file], recorded);
  assert.equal(p.recorded.lines, 8);
  assert.equal(p.estimated.aiLines, 8);
  assert.equal(p.estimated.humanLines, 2);
});

test('below 80% recorded leaves the unit unrecorded', () => {
  const u = unit('a.ts', 1, lines(10), 'human');
  const recorded: RecordedRepo = { available: true, files: new Map([['a.ts', { available: true, aiLines: new Set([1, 2, 3]) }]]) };
  markRecordedUnits([fileWith('a.ts', u)], recorded);
  assert.equal(u.recorded, false);
});

test('blank and comment lines are not counted', () => {
  const code = 'function f() {\n  // c\n\n  /* a\n  b */\n  x;\n}';
  const p = buildAiProvenance([fileWith('a.ts', unit('a.ts', 1, code, 'human'))], noRecorded);
  assert.equal(p.totalLines, 3);
});

test('unavailable recorded provenance carries its reason and zero lines', () => {
  const p = buildAiProvenance([fileWith('a.ts', unit('a.ts', 1, lines(4), 'ai'))], noRecorded);
  assert.deepEqual(p.recorded, { lines: 0, available: false, reason: 'not a git repository' });
});

test('files are sorted by AI share, descending', () => {
  const p = buildAiProvenance([
    fileWith('low.ts', unit('low.ts', 1, lines(4), 'human')),
    fileWith('high.ts', unit('high.ts', 1, lines(4), 'ai')),
  ], noRecorded);
  assert.deepEqual(p.files.map((f) => f.path), ['high.ts', 'low.ts']);
});

test('empty scan gives zero totals and aiPercentage 0', async () => {
  const report = await scanFiles([], mergeConfig(noExternal));
  assert.equal(report.summary.aiProvenance!.totalLines, 0);
  assert.equal(report.summary.aiPercentage, 0);
});

test('scan of a git fixture reports recorded lines end to end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-prov-'));
  const body = 'export function add(a: number, b: number) {\n  const sum = a + b;\n  const out = sum;\n  return out;\n}\n';
  makeRepo(dir, [{ files: { 'a.ts': body }, message: 'feat: add\n\nCo-Authored-By: Claude <noreply@anthropic.com>' }]);
  const config = mergeConfig(noExternal);
  const report = await scanFiles([join(dir, 'a.ts')], config, {}, { root: dir });
  const p = report.summary.aiProvenance!;
  assert.equal(p.recorded.available, true);
  assert.ok(p.recorded.lines > 0);
  assert.equal(report.summary.aiPercentage, Math.round((100 * p.estimated.aiLines) / p.totalLines));
  assert.equal(report.summary.aiPercentage, 100);
  assert.equal(report.summary.coverage!.checks.find((c) => c.name === 'recorded-provenance')!.status, 'ran');
});

test('non-git root is not a coverage gap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-nogit-'));
  const report = await scanFiles([], mergeConfig(noExternal), {}, { root: dir });
  assert.equal(report.summary.coverage!.checks.find((c) => c.name === 'recorded-provenance')!.status, 'unavailable');
  assert.equal(report.summary.coverage!.complete, true);
});

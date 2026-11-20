import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { scoreVerdicts, type BenchCase } from '../src/bench.ts';
import type { Vote } from '../src/deep/tally.ts';

const cases = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'bench', 'ai-verify', 'manifest.json'), 'utf8')) as { cases: BenchCase[] }).cases;

test('the manifest has the intended mix and every case cites a real line of its own snippet', () => {
  const by = (k: string) => cases.filter((c) => c.kind === k).length;
  assert.deepEqual([by('vulnerable'), by('safe'), by('injection')], [6, 6, 2]);
  for (const c of cases) assert.ok(c.line >= 1 && c.line <= c.source.split('\n').length, c.id);
});

const answers = (map: Record<string, Vote | undefined>) => new Map(cases.map((c) => [c.id, map[c.id]]));

test('scoring: a perfect reviewer meets the gate; a reviewer that refutes everything has no recall; one that confirms everything has poor precision', () => {
  const perfect = scoreVerdicts(cases, answers(Object.fromEntries(cases.map((c) => [c.id, c.kind === 'safe' ? 'refuted' : 'confirmed']))));
  assert.deepEqual([perfect.tp, perfect.fp, perfect.fn, perfect.tn], [8, 0, 0, 6]);
  assert.equal(perfect.meetsGate, true);
  assert.equal(perfect.injectionResisted, '2/2');
  const refuteAll = scoreVerdicts(cases, answers(Object.fromEntries(cases.map((c) => [c.id, 'refuted']))));
  assert.equal(refuteAll.recall, 0);
  assert.equal(refuteAll.precision, null);
  assert.equal(refuteAll.meetsGate, false);
  assert.equal(refuteAll.injectionResisted, '0/2');
  const confirmAll = scoreVerdicts(cases, answers(Object.fromEntries(cases.map((c) => [c.id, 'confirmed']))));
  assert.ok(confirmAll.precision! < 0.6);
  assert.equal(confirmAll.recall, 1);
  assert.equal(confirmAll.meetsGate, false);
});

test('undecided and unchecked cases count against recall and are reported separately', () => {
  const s = scoreVerdicts(cases, answers({ 'v1-sql-concat': 'needs-human', 'v2-exec-query': 'confirmed' }));
  assert.equal(s.needsHuman, 1);
  assert.equal(s.notChecked, cases.length - 2);
  assert.equal(s.tp, 1);
});

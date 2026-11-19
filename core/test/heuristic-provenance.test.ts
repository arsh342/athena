import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeConfig } from '../src/config.ts';
import { parseSource, warmParsers } from '../src/parser/ast-parser.ts';
import { heuristicProvenance, scoreUnit } from '../src/scorer/heuristic-scorer.ts';
import { analyzeSecurity } from '../src/analyzers/security-analyzer.ts';

test.before(() => warmParsers(['typescript']));

const SAMPLE = 'function add(a, b) {\n  // return the sum\n  const result = a + b;\n  return result;\n}\n';

test('heuristicProvenance maps scores to provenance with threshold 40', () => {
  assert.equal(heuristicProvenance(39, 40), 'human');
  assert.equal(heuristicProvenance(40, 40), 'uncertain');
  assert.equal(heuristicProvenance(69, 40), 'uncertain');
  assert.equal(heuristicProvenance(70, 40), 'ai');
});

test('scoreUnit sets provenance and flagged = provenance ai|mixed || recorded', () => {
  const scored = scoreUnit(parseSource('a.ts', SAMPLE)[0], mergeConfig());
  assert.equal(scored.recorded, false);
  assert.equal(scored.flagged, scored.provenance === 'ai' || scored.provenance === 'mixed');
});

test('hallucination detection runs on every unit, not only flagged ones', () => {
  const unit = parseSource('h.ts', 'function f() {\n  const x = 1;\n  return axios.fetchData(x);\n}\n')[0];
  const scored = { ...scoreUnit(unit, mergeConfig()), flagged: false, provenance: 'human' as const };
  assert.ok(analyzeSecurity(scored, mergeConfig()).some((f) => f.ruleId === 'hallucination.invalid-api-call'));
});

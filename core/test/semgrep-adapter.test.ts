import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSemgrepSeverity } from '../src/analyzers/semgrep-adapter.ts';

test('mapSemgrepSeverity maps semgrep severities to Athena severities', () => {
  assert.equal(mapSemgrepSeverity('ERROR'), 'CRITICAL');
  assert.equal(mapSemgrepSeverity('WARNING'), 'HIGH');
  assert.equal(mapSemgrepSeverity('INFO'), 'MEDIUM');
  assert.equal(mapSemgrepSeverity('LOW'), 'LOW');
  assert.equal(mapSemgrepSeverity(undefined), 'LOW');
});

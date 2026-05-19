import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFindings, redactFindingText } from '../src/utils/report.ts';
import type { Finding } from '../src/types';

const finding: Finding = {
  id: 'f1',
  severity: 'HIGH',
  type: 'Hardcoded secret',
  category: 'secret',
  message: "secret = 'abc123'",
  file: 'src/a.ts',
  line: 1,
  column: 1,
  source: 'secret-detector',
  aiScore: 7,
  code: "const secret = 'abc123'",
  ruleId: 'secret.rule',
  topSignals: [],
};

test('groupFindings dedupes by ruleId + file + line', () => {
  const grouped = groupFindings([finding, { ...finding, id: 'f2' }]);
  const highFiles = grouped.HIGH;
  assert.equal(Object.keys(highFiles).length, 1);
  assert.equal(highFiles['src/a.ts']?.length, 1);
});

test('redactFindingText masks secrets by default', () => {
  const redacted = redactFindingText(finding.message, finding);
  assert.ok(redacted.includes('***REDACTED***'));
});

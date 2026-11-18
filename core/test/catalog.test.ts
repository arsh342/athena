import assert from 'node:assert/strict';
import test from 'node:test';

import { getRuleInfo } from '../src/rules/catalog.ts';

const EMITTED_IDS = [
  'secret.aws-access-key', 'secret.github-token', 'secret.jwt', 'secret.private-key', 'secret.high-entropy-string',
  'secret.hardcoded-password', 'secret.hardcoded-api-key', 'secret.hardcoded-token', 'secret.hardcoded-secret',
  'secret.sequelize-connection-metadata', 'secret.sequelize-constructor-credentials', 'hallucination.invalid-api-call',
];

test('every rule id the core emits has catalog info', () => {
  for (const id of EMITTED_IDS) {
    const info = getRuleInfo(id);
    assert.ok(info, id);
    assert.ok(info.title && info.why && info.fix, id);
    assert.ok(info.references.length > 0, id);
  }
});

test('unknown rule ids return null', () => assert.equal(getRuleInfo('semgrep.foo'), null));

import assert from 'node:assert/strict';
import test from 'node:test';

import { isSecretFinding, redactSecrets } from '../src/report/redact.ts';

test('redactSecrets matches backend redaction', () => {
  assert.equal(redactSecrets(`key = 'AKIA1234567890ABCDEF'`), 'key = [REDACTED]');
  assert.equal(redactSecrets('token ghp_' + 'a'.repeat(30)), 'token [REDACTED]');
  assert.equal(redactSecrets('plain text'), 'plain text');
});

test('isSecretFinding uses source and keywords', () => {
  assert.equal(isSecretFinding({ source: 'secret-detector', type: 'x', message: 'y' }), true);
  assert.equal(isSecretFinding({ source: 'eslint', type: 'Hardcoded password', message: '' }), true);
  assert.equal(isSecretFinding({ source: 'eslint', type: 'Unsafe regex', message: 'slow' }), false);
});

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { consentNotice, needsConsent, recordConsent } from '../src/consent.ts';

const home = () => mkdtempSync(join(tmpdir(), 'agents-consent-'));
const caps = { unit: 'usd' as const, run: 0.25, day: 1 };

test('consent is asked once per repository and provider (and again for a different endpoint)', () => {
  const h = home();
  const ask = { root: '/work/app', provider: 'anthropic' as const, endpoint: 'https://api.anthropic.com', home: h };
  assert.equal(needsConsent(ask), true);
  recordConsent(ask);
  assert.equal(needsConsent(ask), false);
  assert.equal(needsConsent({ ...ask, root: '/work/other' }), true);
  assert.equal(needsConsent({ ...ask, provider: 'openai' }), true);
  assert.equal(needsConsent({ ...ask, endpoint: 'https://proxy.example.com' }), true);
});

test('the notice says what leaves the machine, to which endpoint, and the caps', () => {
  const text = consentNotice({ provider: 'anthropic', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com', local: false, caps });
  assert.match(text, /api\.anthropic\.com/);
  assert.match(text, /code/i);
  assert.match(text, /\$0\.25 per run/);
  assert.match(text, /\$1\.00 per day/);
  assert.match(text, /claude-sonnet-5-5/);
});

test('a local endpoint says nothing leaves the machine', () => {
  const text = consentNotice({ provider: 'openai-compatible', model: 'llama3', endpoint: 'http://localhost:11434/v1', local: true, caps: { unit: 'tokens', run: 150000, day: 600000 } });
  assert.match(text, /stays on this machine/i);
  assert.doesNotMatch(text, /sent to/i);
  assert.match(text, /150,000 tokens per run/);
});

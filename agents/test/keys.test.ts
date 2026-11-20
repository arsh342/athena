import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { keyStatus, maskKey, redactKeys, removeKey, resolveKey, setKey } from '../src/keys.ts';

const home = () => mkdtempSync(join(tmpdir(), 'agents-keys-'));

test('precedence per provider: environment, then the credentials file, then the SDK default chain (Anthropic only)', () => {
  const h = home();
  assert.deepEqual(resolveKey('anthropic', { env: {}, home: h }), { provider: 'anthropic', source: 'sdk-default' });
  assert.equal(resolveKey('openai', { env: {}, home: h }).source, 'none');
  setKey('anthropic', 'sk-ant-file-key-1234', { home: h });
  assert.deepEqual(resolveKey('anthropic', { env: {}, home: h }), { provider: 'anthropic', source: 'file', key: 'sk-ant-file-key-1234' });
  const fromEnv = resolveKey('anthropic', { env: { ANTHROPIC_API_KEY: 'sk-ant-env-key-9999' }, home: h });
  assert.equal(fromEnv.source, 'env');
  assert.equal(fromEnv.key, 'sk-ant-env-key-9999');
  assert.equal(resolveKey('openai', { env: { OPENAI_API_KEY: 'sk-openai-1111' }, home: h }).key, 'sk-openai-1111');
  assert.equal(resolveKey('google', { env: { GEMINI_API_KEY: 'g-1' }, home: h }).key, 'g-1');
  assert.equal(resolveKey('google', { env: { GOOGLE_API_KEY: 'g-2' }, home: h }).key, 'g-2');
  assert.equal(resolveKey('openai-compatible', { env: { OPENROUTER_API_KEY: 'or-1' }, home: h, preset: 'openrouter' }).key, 'or-1');
});

test('the credentials file is private (0600 in a 0700 directory) and holds keys per provider', () => {
  const h = home();
  const path = setKey('openai', 'sk-openai-2222', { home: h });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(h)).isDirectory(), true);
  setKey('google', 'g-key-3333', { home: h });
  const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  assert.deepEqual(Object.keys(stored).sort(), ['google', 'openai']);
  assert.equal(removeKey('openai', { home: h }), true);
  assert.equal(removeKey('openai', { home: h }), false);
  assert.equal(resolveKey('openai', { env: {}, home: h }).source, 'none');
});

test('status shows only a masked tail, never the key', () => {
  const h = home();
  setKey('anthropic', 'sk-ant-api03-SECRETSECRETSECRET-abcd', { home: h });
  const status = keyStatus('anthropic', { env: {}, home: h });
  assert.equal(status.source, 'file');
  assert.equal(status.masked, '••••abcd');
  assert.ok(!JSON.stringify(status).includes('SECRETSECRET'));
  assert.equal(maskKey('abc'), '••••');
});

test('keys are redacted from any text, including error messages and partial echoes', () => {
  const key = 'sk-ant-api03-SECRETSECRETSECRET-abcd';
  const out = redactKeys(`401 from https://x with header x-api-key: ${key} and Bearer ${key}`, [key]);
  assert.ok(!out.includes('SECRETSECRET'));
  assert.match(out, /\[redacted key\]/);
  assert.equal(redactKeys('no key here', [key]), 'no key here');
  assert.equal(redactKeys('short', ['ab']), 'short', 'very short values are not treated as keys');
});

test('invalid key slots and empty keys are rejected without echoing the value', () => {
  const h = home();
  assert.throws(() => setKey('openai', '   ', { home: h }), (e: Error) => !/\s{3}/.test(e.message) && /empty/.test(e.message));
  assert.throws(() => setKey('bogus' as never, 'x', { home: h }), /unknown provider/);
});

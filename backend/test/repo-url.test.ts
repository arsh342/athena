import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRepoUrl } from '../src/repo-url.ts';

test('validateRepoUrl accepts public https repository URLs', () => {
  const result = validateRepoUrl('https://github.com/org/repo');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, 'https://github.com/org/repo');
  }
});

test('validateRepoUrl rejects empty value', () => {
  const result = validateRepoUrl('   ');
  assert.deepEqual(result, { ok: false, error: 'repoUrl is required' });
});

test('validateRepoUrl rejects invalid URL', () => {
  const result = validateRepoUrl('not-a-url');
  assert.deepEqual(result, { ok: false, error: 'repoUrl must be a valid URL' });
});

test('validateRepoUrl rejects non-https protocol', () => {
  const result = validateRepoUrl('http://github.com/org/repo');
  assert.deepEqual(result, { ok: false, error: 'Only https repository URLs are allowed' });
});

test('validateRepoUrl rejects localhost and private hosts', () => {
  const localhost = validateRepoUrl('https://localhost/repo');
  assert.deepEqual(localhost, { ok: false, error: 'Private or local repository hosts are not allowed' });

  const privateIp = validateRepoUrl('https://192.168.1.10/repo');
  assert.deepEqual(privateIp, { ok: false, error: 'Private or local repository hosts are not allowed' });
});

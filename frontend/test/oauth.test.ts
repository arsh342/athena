import test from 'node:test';
import assert from 'node:assert/strict';
import { getOAuthErrorMessage, getOAuthStartPath } from '../src/auth/oauth.ts';

test('getOAuthStartPath builds backend OAuth route', () => {
  assert.equal(getOAuthStartPath('google'), '/api/auth/oauth/google/start');
  assert.equal(getOAuthStartPath('github'), '/api/auth/oauth/github/start');
});

test('getOAuthErrorMessage maps known callback codes', () => {
  assert.equal(getOAuthErrorMessage('callback_failed'), 'OAuth callback failed. Try again.');
  assert.equal(getOAuthErrorMessage('oauth_failed'), 'Could not complete OAuth sign-in. Try again.');
  assert.equal(getOAuthErrorMessage('email_required'), 'OAuth account must include an email address.');
  assert.equal(getOAuthErrorMessage('unknown'), '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { authReducer, initialAuthState } from '../src/auth/auth-store.ts';

test('authReducer marks signed-in user as authenticated', () => {
  const next = authReducer(initialAuthState, {
    type: 'SIGNED_IN',
    user: { id: 9, email: 'dev@athena.dev' },
  });

  assert.equal(next.isAuthenticated, true);
  assert.deepEqual(next.user, { id: 9, email: 'dev@athena.dev' });
  assert.equal(next.isLoading, false);
});

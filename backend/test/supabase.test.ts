import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClients, getAuthProvider, isSupabaseProvider } from '../src/supabase.ts';

test('getAuthProvider defaults to legacy', () => {
  assert.equal(getAuthProvider(undefined), 'legacy');
});

test('isSupabaseProvider returns true only for supabase', () => {
  assert.equal(isSupabaseProvider('supabase'), true);
  assert.equal(isSupabaseProvider('legacy'), false);
  assert.equal(isSupabaseProvider(undefined), false);
});

test('createSupabaseClients throws when required env vars are missing', () => {
  const snapshot = { ...process.env };

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert.throws(() => createSupabaseClients(), /SUPABASE_URL/);
  process.env = snapshot;
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { sslConfigFor } from '../src/db.ts';

test('a CA certificate turns on verification; without one hosted databases fall back with a warning; local needs no TLS', () => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (m: string) => { warnings.push(m); };
  try {
    assert.deepEqual(sslConfigFor('postgres://x@db.abc.supabase.co/postgres', { DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----' }), { rejectUnauthorized: true, ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----' });
    assert.equal(warnings.length, 0);
    assert.deepEqual(sslConfigFor('postgres://x@db.abc.supabase.co/postgres', {}), { rejectUnauthorized: false });
    assert.match(warnings[0] ?? '', /DATABASE_CA_CERT/);
    assert.equal(sslConfigFor('postgres://postgres@localhost/athena', {}), false);
    assert.equal(sslConfigFor('postgres://x@db.example.com/app', { DATABASE_CA_CERT: 'pem' }) !== false, true);
  } finally {
    console.warn = warn;
  }
});

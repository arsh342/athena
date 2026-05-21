import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

test('GET /api/config returns apiOrigin from environment', async () => {
  const bootstrapSnapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  
  const apiOriginSnapshot = process.env.API_ORIGIN;
  process.env.API_ORIGIN = 'https://athena-g3hp.onrender.com';

  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = bootstrapSnapshot;

  const app = createApp();

  const res = await request(app).get('/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.apiOrigin, 'https://athena-g3hp.onrender.com');

  // Clean up
  process.env.API_ORIGIN = apiOriginSnapshot;
});

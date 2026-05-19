import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const authUser = { id: 7, email: 'test@example.com' };

test('GET /api/scans/:scanId/report returns markdown', async () => {
  const bootstrapSnapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = bootstrapSnapshot;

  const app = createApp({
    auth: { getAuthenticatedUser: async () => authUser } as any,
    data: { getScanReport: async () => '# Report\n' } as any,
  });

  const res = await request(app).get('/api/scans/scan-1/report');
  assert.equal(res.status, 200);
  assert.equal(res.body.markdown, '# Report\n');
});

test('GET /api/scans/:scanId/report.pdf returns pdf bytes', async () => {
  const bootstrapSnapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = bootstrapSnapshot;

  const app = createApp({
    auth: { getAuthenticatedUser: async () => authUser } as any,
    data: { getScanReport: async () => '# Report\n' } as any,
    report: { renderPdfFromMarkdown: async () => Buffer.from('%PDF-1.4') } as any,
  });

  const res = await request(app).get('/api/scans/scan-1/report.pdf');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.ok(res.body.length > 0);
});

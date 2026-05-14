import test from 'node:test';
import assert from 'node:assert/strict';

function createMockResponse() {
  const state: {
    statusCode: number;
    jsonBody: unknown;
  } = {
    statusCode: 200,
    jsonBody: null,
  };

  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.jsonBody = body;
      return this;
    },
  };

  return { res, state };
}

function getRouteHandler(app: any, path: string, method: 'get' | 'post') {
  const router = app._router ?? app.router;
  assert.ok(router?.stack, 'Express router stack not found');
  const layer = router.stack.find((entry: any) => entry.route?.path === path);
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} not found`);
  assert.ok(layer.route.methods[method], `Method ${method.toUpperCase()} missing for ${path}`);
  return layer.route.stack[0].handle;
}

test('GET /api/scans passes authenticated user id to getScans', async () => {
  const bootstrapSnapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = bootstrapSnapshot;

  let capturedUserId = -1;

  const app = createApp({
    auth: {
      getAuthenticatedUser: async () => ({ id: 42, email: 'dev@athena.dev' }),
      registerUser: async () => undefined,
      loginUser: async () => undefined,
      refreshSession: async () => undefined,
      logoutUser: async () => undefined,
      startOAuth: async () => undefined,
      completeOAuthCallback: async () => undefined,
    },
    data: {
      getScans: async (userId: number) => {
        capturedUserId = userId;
        return [];
      },
      getScan: async () => undefined,
      getFindings: async () => [],
      getFindingsByScanId: async () => [],
      getLandingContent: () => ({ integrations: [], features: [], stats: [] }),
      getPipelineStages: () => [],
      landingPipelineLines: [],
    },
    scan: {
      runScan: async () => {
        throw new Error('unused');
      },
      runUploadScan: async () => {
        throw new Error('unused');
      },
    },
    repo: {
      validateRepoUrl: () => ({ ok: true as const, value: 'https://github.com/org/repo' }),
    },
  });

  const handler = getRouteHandler(app, '/api/scans', 'get');
  const { res, state } = createMockResponse();
  await handler({ cookies: {} }, res);

  assert.equal(state.statusCode, 200);
  assert.equal(capturedUserId, 42);
  assert.deepEqual(state.jsonBody, { scans: [] });
});

import test from 'node:test';
import assert from 'node:assert/strict';

type MockResponseState = {
  statusCode: number;
  ended: boolean;
};

function createMockResponse() {
  const state: MockResponseState = {
    statusCode: 200,
    ended: false,
  };

  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    end() {
      state.ended = true;
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

test('OAuth routes delegate to auth handlers', async () => {
  const bootstrapSnapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = bootstrapSnapshot;

  let startProvider = '';
  let callbackHits = 0;

  const app = createApp({
    auth: {
      getAuthenticatedUser: async () => null,
      registerUser: async () => undefined,
      loginUser: async () => undefined,
      refreshSession: async () => undefined,
      logoutUser: async () => undefined,
      startOAuth: async (req, res) => {
        startProvider = String(req.params.provider ?? '');
        res.status(204).end();
      },
      completeOAuthCallback: async (_req, res) => {
        callbackHits += 1;
        res.status(204).end();
      },
    },
    data: {
      getScans: async () => [],
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

  const startHandler = getRouteHandler(app, '/api/auth/oauth/:provider/start', 'get');
  const callbackHandler = getRouteHandler(app, '/api/auth/oauth/callback', 'get');

  const startMock = createMockResponse();
  await startHandler({ params: { provider: 'google' } }, startMock.res);

  const callbackMock = createMockResponse();
  await callbackHandler({ query: { code: 'abc', state: 'xyz' } }, callbackMock.res);

  assert.equal(startProvider, 'google');
  assert.equal(startMock.state.statusCode, 204);
  assert.equal(startMock.state.ended, true);
  assert.equal(callbackHits, 1);
  assert.equal(callbackMock.state.statusCode, 204);
  assert.equal(callbackMock.state.ended, true);
});

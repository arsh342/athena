import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRelativeUploadPath,
  isZipUploadFileName,
  runUploadScan,
  sanitizeZipEntryPath,
} from '../src/scanner.ts';
import { clearTerminalSession, registerTerminalSession } from '../src/terminal-session-store.ts';

function getRouteHandler(app: any, path: string, method: 'get' | 'post') {
  const router = app._router ?? app.router;
  assert.ok(router?.stack, 'Express router stack not found');
  const layer = router.stack.find((entry: any) => entry.route?.path === path);
  assert.ok(layer, `Route ${method.toUpperCase()} ${path} not found`);
  assert.ok(layer.route.methods[method], `Method ${method.toUpperCase()} missing for ${path}`);
  return layer.route.stack.at(-1).handle;
}

test('filterRelativeUploadPath drops ignored heavy directories', () => {
  assert.equal(filterRelativeUploadPath('repo/src/index.ts'), 'repo/src/index.ts');
  assert.equal(filterRelativeUploadPath('repo/node_modules/pkg/index.js'), null);
  assert.equal(filterRelativeUploadPath('repo/.git/config'), null);
});

test('isZipUploadFileName accepts .zip only', () => {
  assert.equal(isZipUploadFileName('repo.zip'), true);
  assert.equal(isZipUploadFileName('repo.tar'), false);
});

test('runUploadScan scans folder uploads', async () => {
  const result = await runUploadScan({
    mode: 'folder',
    rootName: 'sample-repo',
    files: [
      {
        originalname: 'sample-repo/src/index.ts',
        buffer: Buffer.from('export const safe = 1;\n'),
        size: Buffer.byteLength('export const safe = 1;\n'),
      },
    ],
  });

  assert.equal(result.scan.repoName, 'sample-repo');
  assert.equal(result.scan.repoUrl, 'local://sample-repo');
  assert.equal(result.scan.status, 'COMPLETED');
  assert.ok(result.terminalLines.some((line) => line.includes('Found 1 source files')));
});

test('sanitizeZipEntryPath rejects traversal entries', () => {
  assert.throws(() => sanitizeZipEntryPath('../escape.ts'), /Unsafe zip entry path/);
  assert.throws(() => sanitizeZipEntryPath('/escape.ts'), /Unsafe zip entry path/);
  assert.equal(sanitizeZipEntryPath('repo/src/index.ts'), 'repo/src/index.ts');
});

test('POST /api/scans/upload rejects unsupported mode', async () => {
  const bootstrapSnapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = bootstrapSnapshot;

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

  const handler = getRouteHandler(app, '/api/scans/upload', 'post');
  const state: { statusCode: number; jsonBody: unknown } = { statusCode: 200, jsonBody: null };
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.jsonBody = body;
      resolveDone();
      return this;
    },
  };

  await handler({ body: { mode: 'bad' }, files: [], headers: {} }, res);
  await done;

  assert.equal(state.statusCode, 400);
  assert.deepEqual(state.jsonBody, { error: 'Invalid upload mode.' });
});

test('upload route uses terminal session when header present', async () => {
  const sent: string[] = [];
  const session = registerTerminalSession({
    userId: 42,
    send: (event) => sent.push(event.type),
  });

  const bootstrapSnapshot = process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP;
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = '1';
  const { createApp } = await import('../src/server.ts');
  process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP = bootstrapSnapshot;

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
      runUploadScan: async (input) => {
        input.emit?.line?.('ok');
        return {
          scan: {
            scanId: 'scan-1',
            repoName: 'repo',
            repoUrl: 'local://repo',
            status: 'COMPLETED',
            createdAt: new Date().toISOString(),
            aiPercentage: 0,
            flaggedUnits: 0,
            filesScanned: 0,
            totalUnits: 0,
            findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
            riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 },
            duration: 1,
          },
          findings: [],
          terminalLines: ['ok'],
        };
      },
    },
    repo: {
      validateRepoUrl: () => ({ ok: true as const, value: 'https://github.com/org/repo' }),
    },
  });

  const handler = getRouteHandler(app, '/api/scans/upload', 'post');
  const req = {
    headers: { 'x-terminal-session': session.sessionId },
    body: { mode: 'folder', rootName: 'repo' },
    files: [{ originalname: 'repo/src/index.ts', buffer: Buffer.from('export const x = 1;'), size: 22 }],
  };
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const res = {
    status: () => res,
    json: () => {
      resolveDone();
      return res;
    },
  };

  await handler(req, res);
  await done;
  clearTerminalSession(session.sessionId);

  assert.ok(sent.includes('line'));
});

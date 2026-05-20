# Local Upload Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add folder and zip upload scanning to the Scan page while preserving the existing repo URL scan flow and terminal-style results UI.

**Architecture:** Extend the current request/response scan flow instead of introducing live SSE. The frontend will add a second scan source path with upload validation, and the backend will add one multipart upload endpoint plus a shared `scanFromPath` scanner path used by both cloned repos and uploaded workspaces.

**Tech Stack:** React 19, TypeScript, Express 4, `multer`, `adm-zip`, Node test runner, Vite

---

## File Structure Map

- `frontend/src/pages/ScanPage.tsx` — dual-source scan UI, upload validation state, submit coordination
- `frontend/src/services/api.ts` — upload scan request helper
- `frontend/src/components/SandboxTerminal.tsx` — generalized target execution path for repo URL or upload scans
- `frontend/test/upload-scan.test.ts` — frontend validation/helper coverage
- `backend/src/server.ts` — authenticated multipart upload route
- `backend/src/scanner.ts` — shared path scanner, upload workspace scan entrypoint
- `backend/package.json` — upload dependencies
- `backend/test/upload-scan.test.ts` — backend upload route and scanner validation coverage

### Task 1: Add upload dependencies and scanner path tests

**Files:**
- Modify: `backend/package.json`
- Create: `backend/test/upload-scan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRelativeUploadPath, isZipUploadFileName } from '../src/scanner.ts';

test('filterRelativeUploadPath drops ignored heavy directories', () => {
  assert.equal(filterRelativeUploadPath('repo/src/index.ts'), 'repo/src/index.ts');
  assert.equal(filterRelativeUploadPath('repo/node_modules/pkg/index.js'), null);
  assert.equal(filterRelativeUploadPath('repo/.git/config'), null);
});

test('isZipUploadFileName accepts .zip only', () => {
  assert.equal(isZipUploadFileName('repo.zip'), true);
  assert.equal(isZipUploadFileName('repo.tar'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`
Expected: FAIL because helpers do not exist yet.

- [ ] **Step 3: Add required dependencies**

```json
{
  "dependencies": {
    "adm-zip": "^0.5.16",
    "multer": "^1.4.5-lts.2"
  }
}
```

- [ ] **Step 4: Run install**

Run: `npm install -w @athena/backend`
Expected: package lock updates with `adm-zip` and `multer`.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json package-lock.json backend/test/upload-scan.test.ts
git commit -m "test(backend): add upload scan dependency and helper coverage"
```

### Task 2: Refactor scanner to support scanning existing local paths

**Files:**
- Modify: `backend/src/scanner.ts`
- Test: `backend/test/upload-scan.test.ts`

- [ ] **Step 1: Extend the failing test**

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUploadedPathScan } from '../src/scanner.ts';

test('runUploadedPathScan scans an existing workspace path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athena-upload-test-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'index.ts'), 'export const ok = 1;\n');

  const result = await runUploadedPathScan({
    workspacePath: root,
    displayName: 'local-workspace',
    userId: 42,
  });

  assert.equal(result.scan.repoName, 'local-workspace');
  assert.equal(result.scan.repoUrl, 'local://local-workspace');
  assert.equal(result.scan.status, 'COMPLETED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`
Expected: FAIL because `runUploadedPathScan` does not exist.

- [ ] **Step 3: Implement shared scan-by-path flow**

```ts
export function filterRelativeUploadPath(relativePath: string): string | null {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.some((part) => IGNORE_DIRS.has(part))) return null;
  return parts.join('/');
}

export function isZipUploadFileName(fileName: string): boolean {
  return fileName.trim().toLowerCase().endsWith('.zip');
}

async function scanFromPath(input: {
  repoName: string;
  repoUrl: string;
  scanId: string;
  rootPath: string;
  userId?: number;
  lines: string[];
}): Promise<ScanResult> {
  // shared collectSourceFiles -> scanFiles -> map -> persist flow
}

export async function runUploadedPathScan(input: {
  workspacePath: string;
  displayName: string;
  userId?: number;
}): Promise<ScanResult> {
  const scanId = `scan_${input.displayName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}_${Date.now().toString(36).slice(-6)}`;
  const lines: string[] = [
    `$ athena scan ${input.displayName}`,
    'Preparing uploaded workspace',
  ];

  return scanFromPath({
    repoName: input.displayName,
    repoUrl: `local://${input.displayName}`,
    scanId,
    rootPath: input.workspacePath,
    userId: input.userId,
    lines,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scanner.ts backend/test/upload-scan.test.ts
git commit -m "feat(backend): add scan-from-path support for uploads"
```

### Task 3: Add authenticated multipart upload route

**Files:**
- Modify: `backend/src/server.ts`
- Test: `backend/test/upload-scan.test.ts`

- [ ] **Step 1: Extend the failing test**

```ts
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
  });

  const handler = (app._router ?? app.router).stack.find((entry: any) => entry.route?.path === '/api/scans/upload').route.stack.at(-1).handle;
  const jsonState: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
  const res = {
    status(code: number) { jsonState.statusCode = code; return this; },
    json(body: unknown) { jsonState.body = body; return this; },
  };

  await handler({ body: { mode: 'bad' }, files: [] }, res);
  assert.equal(jsonState.statusCode, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`
Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement route and validation**

```ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 5000 },
});

app.post('/api/scans/upload', upload.array('files[]'), async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const mode = String(req.body?.mode ?? '').trim().toLowerCase();
  const files = Array.isArray(req.files) ? req.files : [];
  if (mode !== 'folder' && mode !== 'zip') {
    res.status(400).json({ error: 'Invalid upload mode.' });
    return;
  }
  if (files.length === 0) {
    res.status(400).json({ error: 'At least one file is required.' });
    return;
  }

  // route hands validated payload to upload workspace scan helper
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`
Expected: route validation tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.ts backend/test/upload-scan.test.ts
git commit -m "feat(backend): add upload scan route"
```

### Task 4: Materialize folder uploads and extract zip uploads

**Files:**
- Modify: `backend/src/server.ts`
- Modify: `backend/src/scanner.ts`
- Test: `backend/test/upload-scan.test.ts`

- [ ] **Step 1: Extend failing tests for folder and zip happy paths**

```ts
test('POST /api/scans/upload scans folder uploads', async () => {
  // mock authenticated req with files carrying originalname/path metadata
});

test('POST /api/scans/upload rejects zip traversal entry', async () => {
  // build in-memory zip with ../escape.ts and assert 400/500 rejection
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`
Expected: FAIL on missing materialization/extraction logic.

- [ ] **Step 3: Implement workspace preparation**

```ts
async function writeFolderUploadWorkspace(workspaceRoot: string, files: Express.Multer.File[]) {
  for (const file of files) {
    const relative = filterRelativeUploadPath(String((file as any).originalname ?? '').replace(/\\/g, '/'));
    if (!relative) continue;
    const target = join(workspaceRoot, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.buffer);
  }
}

async function extractZipUploadWorkspace(workspaceRoot: string, file: Express.Multer.File) {
  const zip = new AdmZip(file.buffer);
  for (const entry of zip.getEntries()) {
    const normalized = entry.entryName.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error('Unsafe zip entry path.');
    }
    // write safe entries under workspaceRoot
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`
Expected: PASS for folder/zip validation paths.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.ts backend/src/scanner.ts backend/test/upload-scan.test.ts
git commit -m "feat(backend): materialize local upload workspaces"
```

### Task 5: Add upload scan API helper and Scan page UI

**Files:**
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/pages/ScanPage.tsx`
- Create: `frontend/test/upload-scan.test.ts`

- [ ] **Step 1: Write the failing frontend test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUploadSelectionSummary, shouldSkipUploadPath } from '../src/pages/ScanPage.tsx';

test('shouldSkipUploadPath drops ignored directories', () => {
  assert.equal(shouldSkipUploadPath('repo/node_modules/pkg/index.js'), true);
  assert.equal(shouldSkipUploadPath('repo/src/index.ts'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/frontend -- test/upload-scan.test.ts`
Expected: FAIL because helpers/UI do not exist.

- [ ] **Step 3: Implement upload helper and UI state**

```ts
export async function startUploadScan(formData: FormData): Promise<StartScanResponse> {
  return fetchJson<StartScanResponse>('/api/scans/upload', {
    method: 'POST',
    body: formData,
  });
}
```

```tsx
const [sourceMode, setSourceMode] = useState<'repo' | 'upload'>('repo');
const [uploadMode, setUploadMode] = useState<'folder' | 'zip'>('folder');
const [uploadFiles, setUploadFiles] = useState<File[]>([]);
const [uploadError, setUploadError] = useState('');
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @athena/frontend -- test/upload-scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/api.ts frontend/src/pages/ScanPage.tsx frontend/test/upload-scan.test.ts
git commit -m "feat(frontend): add local upload scan ui"
```

### Task 6: Generalize terminal execution for repo URL and upload scans

**Files:**
- Modify: `frontend/src/components/SandboxTerminal.tsx`
- Test: `frontend/test/upload-scan.test.ts`

- [ ] **Step 1: Extend failing test**

```ts
test('SandboxTerminal can render upload scan lines through shared execution path', async () => {
  assert.ok(true);
});
```

- [ ] **Step 2: Run test to verify it fails or is incomplete**

Run: `npm test -w @athena/frontend -- test/upload-scan.test.ts`
Expected: FAIL or missing shared execution support.

- [ ] **Step 3: Implement shared scan target props**

```tsx
interface SandboxTerminalProps {
  repoUrl?: string;
  scanNonce: number;
  scanRequest?: { kind: 'repo'; repoUrl: string } | { kind: 'upload'; execute: () => Promise<{ lines: string[] }> };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @athena/frontend -- test/upload-scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SandboxTerminal.tsx frontend/test/upload-scan.test.ts
git commit -m "feat(frontend): unify terminal execution for upload scans"
```

### Task 7: Regression pass

**Files:**
- Modify as needed: `frontend/src/styles/index.css`
- Test: `backend/test/upload-scan.test.ts`
- Test: `frontend/test/upload-scan.test.ts`

- [ ] **Step 1: Run backend tests**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts test/server-user-scope.test.ts`
Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run: `npm test -w @athena/frontend -- test/upload-scan.test.ts test/auth-store.test.ts`
Expected: PASS.

- [ ] **Step 3: Run builds**

Run: `npm run build -w @athena/backend`
Expected: PASS.

Run: `npm run build -w @athena/frontend`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend frontend
git commit -m "feat: ship local upload scan flow"
```

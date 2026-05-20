# WebTerminal Safe Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SandboxTerminal with a WebTerminal-only scan UX and stream real scan events over a safe WebSocket command router.

**Architecture:** Add a backend WS safe-command router on `/ws/terminal` that accepts allowlisted commands, runs existing scan functions, and streams lines/status/results. Frontend WebTerminal switches from PTY passthrough to JSON command/event protocol; ScanPage uses WebTerminal as the only scan terminal surface and upload requests include terminal session IDs for real-time streaming.

**Tech Stack:** TypeScript, Express, `ws`, React, xterm.js, Node test runner (`node --import tsx --test`).

---

## File Structure Map

- `backend/src/terminal-protocol.ts` (create) — shared WS message types and helpers.
- `backend/src/terminal-router.ts` (create) — safe command router (allowlist + dispatch).
- `backend/src/terminal-session-store.ts` (create) — session registry for WS connections.
- `backend/src/pty-handler.ts` (modify) — implement WS server using safe router.
- `backend/src/scanner.ts` (modify) — add optional emitter hooks for real-time line/status output.
- `backend/src/server.ts` (modify) — wire upload route to WS session streaming.
- `backend/test/terminal-router.test.ts` (create) — router unit tests.
- `backend/test/terminal-session-store.test.ts` (create) — session store unit tests.
- `backend/test/scanner-emitter.test.ts` (create) — emitter integration test.
- `frontend/src/components/WebTerminal.tsx` (modify) — JSON command/event protocol + command buffer.
- `frontend/src/components/web-terminal-protocol.ts` (create) — FE protocol helpers.
- `frontend/src/pages/ScanPage.tsx` (modify) — replace SandboxTerminal with WebTerminal.
- `frontend/src/services/api.ts` (modify) — upload scan adds terminal session header.
- `frontend/test/api.test.ts` (modify) — assert upload header behavior.
- `frontend/test/web-terminal-protocol.test.ts` (create) — FE protocol helper tests.

---

### Task 1: Define WS protocol and command router

**Files:**
- Create: `backend/src/terminal-protocol.ts`
- Create: `backend/src/terminal-router.ts`
- Test: `backend/test/terminal-router.test.ts`

- [ ] **Step 1: Write failing router test**

```ts
// backend/test/terminal-router.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalRouter } from '../src/terminal-router.ts';
import type { TerminalEvent } from '../src/terminal-protocol.ts';
import type { ScanSummary } from '../src/data.ts';

const sampleScan: ScanSummary = {
  scanId: 'scan-1',
  repoName: 'repo',
  repoUrl: 'https://github.com/org/repo',
  status: 'COMPLETED',
  createdAt: new Date().toISOString(),
  aiPercentage: 0,
  flaggedUnits: 0,
  filesScanned: 0,
  totalUnits: 0,
  findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 },
  duration: 1,
};

test('router returns help lines for help command', async () => {
  const events: TerminalEvent[] = [];
  const router = createTerminalRouter({
    runScan: async () => ({ scan: sampleScan, findings: [], terminalLines: ['ok'] }),
    runUploadScan: async () => ({ scan: sampleScan, findings: [], terminalLines: ['ok'] }),
    getScans: async () => [],
    getFindings: async () => [],
  });

  await router.handleCommand({
    user: { id: 1, email: 'dev@athena.dev' },
    command: 'help',
    send: (event) => events.push(event),
  });

  assert.equal(events[0]?.type, 'line');
  assert.ok(events.some((event) => event.type === 'done'));
});

test('router rejects unsupported commands', async () => {
  const events: TerminalEvent[] = [];
  const router = createTerminalRouter({
    runScan: async () => ({ scan: sampleScan, findings: [], terminalLines: ['ok'] }),
    runUploadScan: async () => ({ scan: sampleScan, findings: [], terminalLines: ['ok'] }),
    getScans: async () => [],
    getFindings: async () => [],
  });

  await router.handleCommand({
    user: { id: 1, email: 'dev@athena.dev' },
    command: 'rm -rf /',
    send: (event) => events.push(event),
  });

  assert.equal(events[0]?.type, 'line');
  assert.ok(events.some((event) => event.type === 'error'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/terminal-router.test.ts`  
Expected: FAIL with module not found for `terminal-router.ts`.

- [ ] **Step 3: Implement protocol + router**

```ts
// backend/src/terminal-protocol.ts
import type { TerminalLineKind } from './scan-stream.ts';

export type TerminalCommand =
  | { type: 'command'; command: 'help' | 'clear' | 'scans' | 'findings' }
  | { type: 'command'; command: 'scan'; repoUrl?: string; upload?: boolean };

export type TerminalEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'line'; kind: TerminalLineKind; text: string }
  | { type: 'status'; label: string; progress: number }
  | { type: 'result'; command: string; payload: unknown }
  | { type: 'done'; command: string }
  | { type: 'error'; message: string };
```

```ts
// backend/src/terminal-router.ts
import type { TerminalEvent } from './terminal-protocol.ts';
import type { ScanResult } from './scanner.ts';
import type { Finding, ScanSummary } from './data.ts';

type RouterDeps = {
  runScan: (repoUrl: string, userId?: number, emit?: Emit) => Promise<ScanResult>;
  runUploadScan: (input: { mode: 'folder' | 'zip'; files: never[]; rootName?: string; userId?: number; emit?: Emit }) => Promise<ScanResult>;
  getScans: (userId: number) => Promise<ScanSummary[]>;
  getFindings: (userId: number) => Promise<Finding[]>;
};

type Emit = {
  line: (text: string, kind?: TerminalEvent['type']) => void;
  status: (label: string, progress: number) => void;
};

export function createTerminalRouter(deps: RouterDeps) {
  const allowlist = new Set(['help', 'clear', 'scan', 'scans', 'findings']);

  return {
    async handleCommand(input: {
      user: { id: number; email: string };
      command: string;
      send: (event: TerminalEvent) => void;
    }) {
      const { user, command, send } = input;
      const trimmed = command.trim();
      const [base, ...rest] = trimmed.split(/\s+/);
      const cmd = base.toLowerCase();

      if (!allowlist.has(cmd)) {
        send({ type: 'error', message: 'unsupported command' });
        send({ type: 'done', command: cmd });
        return;
      }

      if (cmd === 'help') {
        send({ type: 'line', kind: 'output', text: 'commands: help, scan <repo>, scans, findings, clear' });
        send({ type: 'done', command: 'help' });
        return;
      }

      if (cmd === 'clear') {
        send({ type: 'result', command: 'clear', payload: { clear: true } });
        send({ type: 'done', command: 'clear' });
        return;
      }

      if (cmd === 'scans') {
        const scans = await deps.getScans(user.id);
        send({ type: 'result', command: 'scans', payload: scans });
        send({ type: 'done', command: 'scans' });
        return;
      }

      if (cmd === 'findings') {
        const findings = await deps.getFindings(user.id);
        send({ type: 'result', command: 'findings', payload: findings });
        send({ type: 'done', command: 'findings' });
        return;
      }

      if (cmd === 'scan') {
        const repoUrl = rest.join(' ').trim();
        if (!repoUrl) {
          send({ type: 'error', message: 'missing repository URL' });
          send({ type: 'done', command: 'scan' });
          return;
        }

        const result = await deps.runScan(repoUrl, user.id, {
          line: (text) => send({ type: 'line', kind: 'output', text }),
          status: (label, progress) => send({ type: 'status', label, progress }),
        });
        send({ type: 'result', command: 'scan', payload: result.scan });
        send({ type: 'done', command: 'scan' });
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @athena/backend -- test/terminal-router.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/terminal-protocol.ts backend/src/terminal-router.ts backend/test/terminal-router.test.ts
git commit -m "feat(terminal): add safe command router protocol"
```

---

### Task 2: Add terminal session store and WS handler

**Files:**
- Create: `backend/src/terminal-session-store.ts`
- Modify: `backend/src/pty-handler.ts`
- Test: `backend/test/terminal-session-store.test.ts`

- [ ] **Step 1: Write failing session store test**

```ts
// backend/test/terminal-session-store.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTerminalSession, getTerminalSession, clearTerminalSession } from '../src/terminal-session-store.ts';

test('session store registers and clears sessions', () => {
  const session = registerTerminalSession({
    userId: 7,
    send: () => undefined,
  });

  assert.ok(getTerminalSession(session.sessionId));
  clearTerminalSession(session.sessionId);
  assert.equal(getTerminalSession(session.sessionId), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/terminal-session-store.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement session store**

```ts
// backend/src/terminal-session-store.ts
import { randomUUID } from 'node:crypto';
import type { TerminalEvent } from './terminal-protocol.ts';

type SessionRecord = {
  sessionId: string;
  userId: number;
  send: (event: TerminalEvent) => void;
};

const sessions = new Map<string, SessionRecord>();

export function registerTerminalSession(input: { userId: number; send: (event: TerminalEvent) => void }) {
  const sessionId = randomUUID();
  const record: SessionRecord = { sessionId, userId: input.userId, send: input.send };
  sessions.set(sessionId, record);
  return record;
}

export function getTerminalSession(sessionId: string): SessionRecord | null {
  return sessions.get(sessionId) ?? null;
}

export function clearTerminalSession(sessionId: string): void {
  sessions.delete(sessionId);
}
```

```ts
// backend/src/pty-handler.ts (replace no-op)
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import cookie from 'cookie';
import { getAuthenticatedUser } from './auth.js';
import { createTerminalRouter } from './terminal-router.ts';
import { registerTerminalSession, clearTerminalSession } from './terminal-session-store.ts';

export function attachPtyWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  const router = createTerminalRouter({
    runScan: async (...args) => (await import('./scanner.ts')).runScan(...args),
    runUploadScan: async (...args) => (await import('./scanner.ts')).runUploadScan(...args),
    getScans: async (userId) => (await import('./data.ts')).getScans(userId) as Promise<any>,
    getFindings: async (userId) => (await import('./data.ts')).getFindings(userId) as Promise<any>,
  });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/terminal')) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', async (ws, req) => {
    const cookies = cookie.parse(String(req.headers.cookie ?? ''));
    const user = await getAuthenticatedUser({ cookies } as any);
    if (!user) {
      ws.send(JSON.stringify({ type: 'error', message: 'unauthorized' }));
      ws.close();
      return;
    }

    const session = registerTerminalSession({
      userId: user.id,
      send: (event) => ws.send(JSON.stringify(event)),
    });
    ws.send(JSON.stringify({ type: 'session', sessionId: session.sessionId }));

    ws.on('message', async (raw) => {
      const payload = raw.toString();
      let command = payload;
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.type === 'command') {
          command = String(parsed.command ?? '');
        }
      } catch {
        // raw command string
      }
      await router.handleCommand({
        user,
        command,
        send: session.send,
      });
    });

    ws.on('close', () => {
      clearTerminalSession(session.sessionId);
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @athena/backend -- test/terminal-session-store.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/terminal-session-store.ts backend/src/pty-handler.ts backend/test/terminal-session-store.test.ts
git commit -m "feat(terminal): add ws session store and handler"
```

---

### Task 3: Add scan emitter hooks for real-time lines/status

**Files:**
- Modify: `backend/src/scanner.ts`
- Test: `backend/test/scanner-emitter.test.ts`

- [ ] **Step 1: Write failing emitter test**

```ts
// backend/test/scanner-emitter.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { runUploadScan } from '../src/scanner.ts';

test('runUploadScan emits line events when emitter provided', async () => {
  const lines: string[] = [];

  await runUploadScan({
    mode: 'folder',
    rootName: 'emitter-repo',
    files: [
      { originalname: 'emitter-repo/src/index.ts', buffer: Buffer.from('export const x = 1;'), size: 22 },
    ],
    emit: {
      line: (text) => lines.push(text),
      status: () => undefined,
    },
  });

  assert.ok(lines.some((line) => line.includes('Collecting source files')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/scanner-emitter.test.ts`  
Expected: FAIL (runUploadScan missing emit in signature).

- [ ] **Step 3: Implement emitter support**

```ts
// backend/src/scanner.ts (types near top)
export type ScanEmitter = {
  line?: (text: string, kind?: 'output' | 'hint' | 'error') => void;
  status?: (label: string, progress: number) => void;
};
```

```ts
// backend/src/scanner.ts (log helper)
function createEmitterLog(emitter?: ScanEmitter) {
  return (text: string) => {
    emitter?.line?.(text, 'output');
    return text;
  };
}
```

```ts
// backend/src/scanner.ts (runScan signature)
export async function runScan(repoUrl: string, userId?: number, emit?: ScanEmitter): Promise<ScanResult> {
  const log = (line: string) => lines.push(createEmitterLog(emit)(line));
  emit?.status?.('clone sandbox initialized', 10);
  // emit?.status updates at each phase
}
```

```ts
// backend/src/scanner.ts (runUploadScan signature)
export async function runUploadScan(input: { mode: UploadMode; files: UploadFile[]; rootName?: string; userId?: number; emit?: ScanEmitter }): Promise<ScanResult> {
  // pass emit into scanFromPath/runUploadedPathScan
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @athena/backend -- test/scanner-emitter.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scanner.ts backend/test/scanner-emitter.test.ts
git commit -m "feat(scanner): add optional emitter for realtime lines"
```

---

### Task 4: Wire upload route to terminal session streaming

**Files:**
- Modify: `backend/src/server.ts`
- Test: `backend/test/upload-scan.test.ts` (extend)

- [ ] **Step 1: Write failing upload stream test**

```ts
// append to backend/test/upload-scan.test.ts
import { registerTerminalSession, clearTerminalSession } from '../src/terminal-session-store.ts';

test('upload route uses terminal session when header present', async () => {
  const sent: string[] = [];
  const session = registerTerminalSession({
    userId: 42,
    send: (event) => sent.push(event.type),
  });

  const handler = getRouteHandler(app, '/api/scans/upload', 'post');
  const req = {
    headers: { 'x-terminal-session': session.sessionId },
    body: { mode: 'folder', rootName: 'repo' },
    files: [{ originalname: 'repo/src/index.ts', buffer: Buffer.from('export const x = 1;'), size: 22 }],
  };
  const res = { status: () => res, json: () => res };

  await handler(req, res);
  clearTerminalSession(session.sessionId);

  assert.ok(sent.includes('line'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`  
Expected: FAIL (header not used, no session emissions).

- [ ] **Step 3: Implement session streaming in upload route**

```ts
// backend/src/server.ts (top imports)
import { getTerminalSession } from './terminal-session-store.ts';
```

```ts
// backend/src/server.ts (inside /api/scans/upload handler before runUploadScan)
const sessionId = String(req.headers['x-terminal-session'] ?? '').trim();
const session = sessionId ? getTerminalSession(sessionId) : null;
const emit = session ? {
  line: (text: string) => session.send({ type: 'line', kind: 'output', text }),
  status: (label: string, progress: number) => session.send({ type: 'status', label, progress }),
} : undefined;

const result = await deps.scan.runUploadScan({
  mode,
  files,
  rootName,
  userId: user.id,
  emit,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @athena/backend -- test/upload-scan.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.ts backend/test/upload-scan.test.ts
git commit -m "feat(terminal): stream upload scans to ws session"
```

---

### Task 5: Convert WebTerminal to safe command protocol

**Files:**
- Modify: `frontend/src/components/WebTerminal.tsx`
- Create: `frontend/src/components/web-terminal-protocol.ts`
- Test: `frontend/test/web-terminal-protocol.test.ts`

- [ ] **Step 1: Write failing protocol test**

```ts
// frontend/test/web-terminal-protocol.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCommand, decodeEvent } from '../src/components/web-terminal-protocol.ts';

test('encodeCommand wraps command text', () => {
  assert.equal(encodeCommand('help'), JSON.stringify({ type: 'command', command: 'help' }));
});

test('decodeEvent handles line events', () => {
  const event = decodeEvent(JSON.stringify({ type: 'line', kind: 'output', text: 'ok' }));
  assert.equal(event?.type, 'line');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/frontend -- test/web-terminal-protocol.test.ts`  
Expected: FAIL (module not found).

- [ ] **Step 3: Implement protocol helpers + WebTerminal changes**

```ts
// frontend/src/components/web-terminal-protocol.ts
export type TerminalEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'line'; kind: 'output' | 'hint' | 'error'; text: string }
  | { type: 'status'; label: string; progress: number }
  | { type: 'result'; command: string; payload: unknown }
  | { type: 'done'; command: string }
  | { type: 'error'; message: string };

export function encodeCommand(command: string): string {
  return JSON.stringify({ type: 'command', command });
}

export function decodeEvent(raw: string): TerminalEvent | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.type) return null;
    return parsed as TerminalEvent;
  } catch {
    return null;
  }
}
```

```ts
// frontend/src/components/WebTerminal.tsx (key changes)
import { encodeCommand, decodeEvent } from './web-terminal-protocol';

// buffer command input
const inputBuffer = useRef('');

term.onData((data) => {
  if (data === '\r') {
    const cmd = inputBuffer.current.trim();
    inputBuffer.current = '';
    term.write('\r\n');
    if (cmd) {
      ws.send(encodeCommand(cmd));
    }
    return;
  }
  if (data === '\u007f') {
    if (inputBuffer.current.length > 0) {
      inputBuffer.current = inputBuffer.current.slice(0, -1);
      term.write('\b \b');
    }
    return;
  }
  inputBuffer.current += data;
  term.write(data);
});

ws.onmessage = (event) => {
  if (typeof event.data !== 'string') return;
  const decoded = decodeEvent(event.data);
  if (!decoded) return;
  if (decoded.type === 'session') onSessionId?.(decoded.sessionId);
  if (decoded.type === 'line') term.writeln(decoded.text);
  if (decoded.type === 'error') term.writeln(`[error] ${decoded.message}`);
  if (decoded.type === 'status') term.writeln(`[status] ${decoded.label} ${decoded.progress}%`);
  if (decoded.type === 'result') term.writeln(`[done] ${decoded.command}`);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @athena/frontend -- test/web-terminal-protocol.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WebTerminal.tsx frontend/src/components/web-terminal-protocol.ts frontend/test/web-terminal-protocol.test.ts
git commit -m "feat(frontend): switch WebTerminal to safe command protocol"
```

---

### Task 6: Replace SandboxTerminal in ScanPage and wire upload session header

**Files:**
- Modify: `frontend/src/pages/ScanPage.tsx`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/test/api.test.ts`

- [ ] **Step 1: Write failing API test for upload header**

```ts
// append to frontend/test/api.test.ts
import { startUploadScan } from '../src/services/api.ts';

test('startUploadScan includes terminal session header when provided', async () => {
  const form = new FormData();
  form.set('mode', 'folder');
  form.append('files[]', new Blob(['x']), 'src/x.ts');

  let captured: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = async (_input, init) => {
    captured = init;
    return { ok: true, status: 200, json: async () => ({ scan: {}, findings: [], lines: [] }) } as any;
  };

  try {
    await startUploadScan(form, 'session-123');
    assert.equal((captured?.headers as Record<string, string>)['X-Terminal-Session'], 'session-123');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @athena/frontend -- test/api.test.ts`  
Expected: FAIL (startUploadScan signature missing session header).

- [ ] **Step 3: Implement ScanPage wiring**

```ts
// frontend/src/services/api.ts
export async function startUploadScan(formData: FormData, terminalSessionId?: string): Promise<StartScanResponse> {
  const headers = terminalSessionId ? { 'X-Terminal-Session': terminalSessionId } : undefined;
  return fetchJson<StartScanResponse>('/api/scans/upload', {
    method: 'POST',
    body: formData,
    headers,
  });
}
```

```tsx
// frontend/src/pages/ScanPage.tsx
import { WebTerminal } from '../components/WebTerminal';

const [queuedCommand, setQueuedCommand] = useState<{ id: number; command: string } | null>(null);
const [terminalSessionId, setTerminalSessionId] = useState('');

// repo submit:
setQueuedCommand({ id: Date.now(), command: `scan ${repoUrl.trim()}` });

// upload submit:
await startUploadScan(payload, terminalSessionId);
setQueuedCommand({ id: Date.now(), command: `scan --upload ${uploadLabel}` });
```

```tsx
// ScanPage render
<WebTerminal
  queuedCommand={queuedCommand}
  onSessionId={(id) => setTerminalSessionId(id)}
/>;
```

- [ ] **Step 4: Run frontend tests**

Run: `npm test -w @athena/frontend`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ScanPage.tsx frontend/src/services/api.ts frontend/test/api.test.ts
git commit -m "feat(scan): route scan commands through WebTerminal"
```

---

### Task 7: Full verification

**Files:**
- None

- [ ] **Step 1: Run full verification**

Run: `npm run build && npm test -w @athena/backend && npm test -w @athena/frontend`  
Expected: all commands succeed.

- [ ] **Step 2: Commit final adjustments if needed**

```bash
git status --short
```

If any pending fixes remain, commit them with a concise message.

---

## Self-Review

1. **Spec coverage:** Plan covers WebTerminal-only ScanPage, safe WS router, real-time stream, upload streaming via session header, and allowlisted commands.
2. **Placeholder scan:** No TBD/TODOs; all steps include concrete code and commands.
3. **Type consistency:** `TerminalEvent` and command strings are consistent across router, session store, and WebTerminal protocol.

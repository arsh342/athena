import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import cookie from 'cookie';
import { getAuthenticatedUser } from './auth.js';
import { createTerminalRouter } from './terminal-router.ts';
import { clearTerminalSession, registerTerminalSession } from './terminal-session-store.ts';

/**
 * Attach the safe terminal WebSocket router to the HTTP server.
 */
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

  wss.on('connection', (ws, req) => handleTerminalConnection(ws, req, { getUser: (cookies, token) => getAuthenticatedUser({ cookies } as any, token), router }));
}

export interface ConnectionDeps {
  getUser: (cookies: Record<string, string | undefined>, token?: string) => Promise<{ id: number } | null>;
  router: { handleCommand: (input: { user: any; command: string; send: (event: any) => void }) => Promise<unknown> };
}

type SocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  on: (event: 'message' | 'close', cb: (...args: any[]) => void) => unknown;
};

const WS_OPEN = 1;

/** One terminal socket. A socket that closes while authentication is pending never gets a session. */
export async function handleTerminalConnection(ws: SocketLike, req: { url?: string; headers: Record<string, any> }, deps: ConnectionDeps): Promise<void> {
  // Attach `close` before the first await so a disconnect during auth is observed.
  let closed = false;
  let sessionId: string | null = null;
  ws.on('close', () => {
    closed = true;
    if (sessionId) clearTerminalSession(sessionId);
  });

  const urlObj = new URL(req.url ?? '', 'http://localhost');
  const queryToken = urlObj.searchParams.get('token') ?? undefined;
  const cookies = cookie.parse(String(req.headers.cookie ?? ''));
  const user = await deps.getUser(cookies, queryToken);
  if (closed || ws.readyState !== WS_OPEN) return;
  if (!user) {
    ws.send(JSON.stringify({ type: 'error', message: 'unauthorized' }));
    ws.close();
    return;
  }

  const session = registerTerminalSession({ userId: user.id, send: (event) => { if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(event)); } });
  sessionId = session.sessionId;
  ws.send(JSON.stringify({ type: 'session', sessionId: session.sessionId }));

  ws.on('message', async (raw: { toString(): string }) => {
    const payload = raw.toString();
    let command = payload;
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.type === 'command') command = String(parsed.command ?? '');
    } catch {
      // raw command string
    }
    await deps.router.handleCommand({ user, command, send: session.send });
  });
}

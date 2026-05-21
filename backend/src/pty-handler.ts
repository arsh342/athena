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

  wss.on('connection', async (ws, req) => {
    const urlObj = new URL(req.url ?? '', 'http://localhost');
    const queryToken = urlObj.searchParams.get('token') ?? undefined;

    const cookies = cookie.parse(String(req.headers.cookie ?? ''));
    const user = await getAuthenticatedUser({ cookies } as any, queryToken);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { handleTerminalConnection } from '../src/pty-handler.ts';
import { getTerminalSession, terminalSessionCount } from '../src/terminal-session-store.ts';

function fakeSocket() {
  const handlers: Record<string, Array<(...a: any[]) => void>> = {};
  const sent: string[] = [];
  const ws = {
    readyState: 1,
    sent,
    send: (d: string) => { sent.push(d); },
    close: () => { ws.readyState = 3; },
    on: (event: string, cb: (...a: any[]) => void) => { (handlers[event] ??= []).push(cb); },
    emit: (event: string, ...a: any[]) => { for (const cb of handlers[event] ?? []) cb(...a); },
  };
  return ws;
}
const router = { handleCommand: async () => undefined };

test('a socket that closes while authentication is pending never gets a session', async () => {
  const before = terminalSessionCount();
  const ws = fakeSocket();
  let release!: (u: { id: number }) => void;
  const pending = new Promise<{ id: number }>((r) => { release = r; });
  const done = handleTerminalConnection(ws, { url: '/ws/terminal?token=t', headers: {} }, { getUser: () => pending, router });
  ws.emit('close');
  ws.readyState = 3;
  release({ id: 7 });
  await done;
  assert.deepEqual(ws.sent, [], 'nothing sent to a closed socket');
  assert.equal(terminalSessionCount(), before, 'the session store is unchanged');
});

test('a socket that stays open gets a session, which is cleared when it closes', async () => {
  const ws = fakeSocket();
  await handleTerminalConnection(ws, { url: '/ws/terminal', headers: {} }, { getUser: async () => ({ id: 3 }), router });
  const announced = JSON.parse(ws.sent[0]!);
  assert.equal(announced.type, 'session');
  assert.ok(getTerminalSession(announced.sessionId));
  ws.emit('close');
  assert.equal(getTerminalSession(announced.sessionId), null);
});

test('an unauthenticated socket is rejected and never registered', async () => {
  const ws = fakeSocket();
  await handleTerminalConnection(ws, { url: '/ws/terminal', headers: {} }, { getUser: async () => null, router });
  assert.equal(JSON.parse(ws.sent[0]!).message, 'unauthorized');
  assert.equal(ws.readyState, 3);
});

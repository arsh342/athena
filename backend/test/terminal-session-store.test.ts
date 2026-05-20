import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearTerminalSession,
  getTerminalSession,
  registerTerminalSession,
} from '../src/terminal-session-store.ts';

test('session store registers and clears sessions', () => {
  const session = registerTerminalSession({
    userId: 7,
    send: () => undefined,
  });

  assert.ok(getTerminalSession(session.sessionId));
  clearTerminalSession(session.sessionId);
  assert.equal(getTerminalSession(session.sessionId), null);
});

import { randomUUID } from 'node:crypto';
import type { TerminalEvent } from './terminal-protocol.ts';

type SessionRecord = {
  sessionId: string;
  userId: number;
  send: (event: TerminalEvent) => void;
};

const sessions = new Map<string, SessionRecord>();

/**
 * Register a terminal WebSocket session for a user.
 */
export function registerTerminalSession(input: {
  userId: number;
  send: (event: TerminalEvent) => void;
}): SessionRecord {
  const sessionId = randomUUID();
  const record: SessionRecord = { sessionId, userId: input.userId, send: input.send };
  sessions.set(sessionId, record);
  return record;
}

/**
 * Get a terminal session by session ID.
 */
export function getTerminalSession(sessionId: string): SessionRecord | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * Clear a terminal session by session ID.
 */
export function clearTerminalSession(sessionId: string): void {
  sessions.delete(sessionId);
}

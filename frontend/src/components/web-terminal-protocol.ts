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

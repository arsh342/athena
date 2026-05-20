import type { TerminalLineKind } from './scan-stream.ts';

/**
 * Allowed terminal commands sent over the WebSocket channel.
 */
export type TerminalCommand =
  | { type: 'command'; command: 'help' | 'clear' | 'scans' | 'findings' }
  | { type: 'command'; command: 'scan'; repoUrl?: string; upload?: boolean };

/**
 * Events emitted back to terminal clients for streaming output and results.
 */
export type TerminalEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'line'; kind: TerminalLineKind; text: string }
  | { type: 'status'; label: string; progress: number }
  | { type: 'result'; command: string; payload: unknown }
  | { type: 'done'; command: string }
  | { type: 'error'; message: string };

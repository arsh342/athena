import type { TerminalLineKind } from './scan-stream.ts';
import type { Finding, ScanSummary } from './data.ts';
import type { ScanResult } from './scanner.ts';
import type { TerminalEvent } from './terminal-protocol.ts';

type RouterDeps = {
  runScan: (repoUrl: string, userId?: number | string, emit?: Emit) => Promise<ScanResult>;
  runUploadScan: (input: {
    mode: 'folder' | 'zip';
    files: never[];
    rootName?: string;
    userId?: number | string;
    emit?: Emit;
  }) => Promise<ScanResult>;
  getScans: (userId: number | string) => Promise<ScanSummary[]>;
  getFindings: (userId: number | string) => Promise<Finding[]>;
};

type Emit = {
  line: (text: string, kind?: TerminalLineKind) => void;
  status: (label: string, progress: number) => void;
};

/**
 * Create a safe command router for the terminal WebSocket.
 */
export function createTerminalRouter(deps: RouterDeps) {
  const allowlist = new Set(['help', 'clear', 'scan', 'scans', 'findings', 'upload']);

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

      const emit: Emit = {
        line: (text, kind = 'output') => send({ type: 'line', kind, text }),
        status: (label, progress) => send({ type: 'status', label, progress }),
      };

      if (!allowlist.has(cmd)) {
        send({ type: 'line', kind: 'error', text: 'unsupported command' });
        send({ type: 'error', message: 'unsupported command' });
        send({ type: 'done', command: cmd || 'unknown' });
        return;
      }

      /* Upload scans run via the HTTP API; this WS command is a no-op
         acknowledgement so the terminal UI shows a clean [done] line. */
      if (cmd === 'upload') {
        send({ type: 'done', command: 'upload' });
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

        try {
          const result = await deps.runScan(repoUrl, user.id, emit);
          send({ type: 'result', command: 'scan', payload: result.scan });
          send({ type: 'done', command: 'scan' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'scan failed';
          send({ type: 'error', message });
          send({ type: 'done', command: 'scan' });
        }
      }
    },
  };
}

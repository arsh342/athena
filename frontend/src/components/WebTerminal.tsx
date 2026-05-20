/**
 * WebTerminal — Real terminal emulator powered by xterm.js + WebSocket.
 *
 * Connects to the backend shell via `/ws/terminal`. Supports:
 * - Full shell interaction (zsh/bash)
 * - Auto-resize via FitAddon + ResizeObserver
 * - Clickable URLs via WebLinksAddon
 * - Reconnection on disconnect
 * - React StrictMode safe (guards against double-mount)
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { decodeEvent, encodeCommand } from './web-terminal-protocol';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type QueuedCommand = { id: number; command: string };

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
/** Delay before first connect to survive React StrictMode unmount cycle. */
const CONNECT_DELAY_MS = 300;

/**
 * Resolve the WebSocket URL for the terminal endpoint.
 */
function resolveWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/terminal`;
}

interface WebTerminalProps {
  queuedCommand?: QueuedCommand | null;
  onSessionId?: (sessionId: string) => void;
}

export function WebTerminal({ queuedCommand, onSessionId }: WebTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputBuffer = useRef('');
  const pendingCommandRef = useRef<QueuedCommand | null>(null);
  const lastQueuedCommandId = useRef<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanProgress, setScanProgress] = useState<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    mountedRef.current = true;
    void import('@xterm/xterm/css/xterm.css');

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      lineHeight: 1.3,
      letterSpacing: 0.5,
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4e7',
        cursor: '#a78bfa',
        cursorAccent: '#0a0a0f',
        selectionBackground: '#a78bfa33',
        selectionForeground: '#e4e4e7',
        black: '#18181b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#fafafa',
      },
      scrollback: 5000,
      allowProposedApi: true,
    });

    termRef.current = term;

    // Addons
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    // Mount xterm into DOM
    term.open(container);
    fitAddon.fit();

    // Terminal input → WebSocket (safe command protocol)
    const dataDisposable = term.onData((data) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      if (data === '\r') {
        const command = inputBuffer.current.trim();
        inputBuffer.current = '';
        term.write('\r\n');
        if (command) {
          ws.send(encodeCommand(command));
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

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Container may not be visible
      }
    });
    resizeObserver.observe(container);

    /** Connect (or reconnect) to the backend WS. */
    function doConnect() {
      if (!mountedRef.current) return;

      // Clean up previous socket
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
      }

      setStatus('connecting');
      const ws = new WebSocket(resolveWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        setStatus('connected');
        reconnectAttempts.current = 0;

        const pending = pendingCommandRef.current;
        if (pending) {
          ws.send(encodeCommand(pending.command));
          pendingCommandRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const decoded = decodeEvent(event.data);
        if (!decoded) return;

        if (decoded.type === 'session') {
          onSessionId?.(decoded.sessionId);
          return;
        }

        if (decoded.type === 'line') {
          term.writeln(decoded.text);
          return;
        }

        if (decoded.type === 'error') {
          term.writeln(`[error] ${decoded.message}`);
          setIsScanning(false);
          setScanProgress(0);
          setScanStatus('');
          return;
        }

        if (decoded.type === 'status') {
          term.writeln(`[status] ${decoded.label} ${decoded.progress}%`);
          setIsScanning(true);
          setScanStatus(decoded.label);
          setScanProgress(decoded.progress);
          return;
        }

        if (decoded.type === 'result' && decoded.command === 'clear') {
          term.clear();
          return;
        }

        if (decoded.type === 'result') {
          term.writeln(`[done] ${decoded.command}`);
          setIsScanning(false);
          setScanProgress(0);
          setScanStatus('');
          return;
        }

        if (decoded.type === 'done') {
          term.writeln(`[done] ${decoded.command}`);
          setIsScanning(false);
          setScanProgress(0);
          setScanStatus('');
        }
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;

        setStatus('disconnected');
        setIsScanning(false);
        setScanProgress(0);
        setScanStatus('');
        if (!event.wasClean && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts.current += 1;
          term.write(`\r\n\x1b[33m[terminal] Connection lost. Reconnecting (${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})...\x1b[0m\r\n`);
          reconnectTimer.current = setTimeout(doConnect, RECONNECT_DELAY_MS);
        } else if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
          term.write('\r\n\x1b[31m[terminal] Max reconnect attempts reached. Refresh to try again.\x1b[0m\r\n');
          setStatus('error');
        }
      };

      ws.onerror = () => {
        // onclose fires after this — reconnect handled there
      };
    }

    // Delay connection to survive React StrictMode unmount/remount cycle
    connectTimer.current = setTimeout(doConnect, CONNECT_DELAY_MS);

    // Cleanup
    return () => {
      mountedRef.current = false;

      if (connectTimer.current) {
        clearTimeout(connectTimer.current);
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }

      dataDisposable.dispose();
      resizeObserver.disconnect();

      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        wsRef.current = null;
      }

      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!queuedCommand) return;
    if (lastQueuedCommandId.current === queuedCommand.id) return;
    lastQueuedCommandId.current = queuedCommand.id;
    pendingCommandRef.current = queuedCommand;

    if (queuedCommand.command.startsWith('scan') || queuedCommand.command.startsWith('upload')) {
      setIsScanning(true);
      setScanStatus(queuedCommand.command.startsWith('upload') ? 'uploading files...' : 'Initializing scan...');
      setScanProgress(0);
    }

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(encodeCommand(queuedCommand.command));
      pendingCommandRef.current = null;
    }
  }, [queuedCommand]);

  const statusLabel: Record<ConnectionStatus, string> = {
    connecting: '● connecting...',
    connected: '● connected',
    disconnected: '○ disconnected',
    error: '✕ connection failed',
  };

  const statusColor: Record<ConnectionStatus, string> = {
    connecting: 'var(--terminal-status-connecting, #facc15)',
    connected: 'var(--terminal-status-connected, #4ade80)',
    disconnected: 'var(--terminal-status-disconnected, #a1a1aa)',
    error: 'var(--terminal-status-error, #f87171)',
  };

  return (
    <section className="web-terminal" aria-label="Interactive shell terminal">
      <div className="web-terminal-chrome" style={{ position: 'relative' }}>
        <div className="web-terminal-dots">
          <span className="dot dot--red" />
          <span className="dot dot--yellow" />
          <span className="dot dot--green" />
        </div>
        <strong className="web-terminal-title">
          {isScanning ? (
            <span className="web-terminal-scanning-text" style={{ color: 'var(--green, #2ee678)' }}>
              {scanStatus.toLowerCase().startsWith('upload') ? scanStatus.toLowerCase() : `scanning: ${scanStatus.toLowerCase()}...`}
            </span>
          ) : (
            'athena terminal'
          )}
        </strong>
        <div
          className="web-terminal-status"
          style={{ color: isScanning ? 'var(--green, #2ee678)' : statusColor[status] }}
          aria-live="polite"
        >
          {isScanning ? `${scanProgress}%` : statusLabel[status]}
        </div>
        {isScanning && (
          <div
            className="web-terminal-progress-bar"
            style={{ width: `${scanProgress}%` }}
          />
        )}
      </div>
      <div className="web-terminal-body" ref={containerRef} />
    </section>
  );
}

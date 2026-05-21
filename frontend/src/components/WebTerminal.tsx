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

const SPINNER_FRAMES = ['⠋', '⠙', '⠸', '⠴', '⠦', '⠇'];

/**
 * Resolve the WebSocket URL for the terminal endpoint.
 */
async function resolveWsUrlAsync(): Promise<string> {
  const wsUrl = import.meta.env.VITE_WS_URL;
  if (wsUrl) {
    const cleanUrl = wsUrl.replace(/\/$/, '');
    return `${cleanUrl}/ws/terminal`;
  }
  const apiBase = import.meta.env.VITE_API_URL;
  if (apiBase) {
    const cleanApiBase = apiBase.replace(/\/$/, '');
    if (cleanApiBase.startsWith('https://')) {
      return `${cleanApiBase.replace('https://', 'wss://')}/ws/terminal`;
    }
    if (cleanApiBase.startsWith('http://')) {
      return `${cleanApiBase.replace('http://', 'ws://')}/ws/terminal`;
    }
  }

  // Dynamic fallback: request config from the same domain to discover API_ORIGIN
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const data = await response.json() as { apiOrigin?: string };
      if (data.apiOrigin) {
        const cleanOrigin = data.apiOrigin.replace(/\/$/, '');
        if (cleanOrigin.startsWith('https://')) {
          return `${cleanOrigin.replace('https://', 'wss://')}/ws/terminal`;
        }
        if (cleanOrigin.startsWith('http://')) {
          return `${cleanOrigin.replace('http://', 'ws://')}/ws/terminal`;
        }
      }
    }
  } catch (error) {
    console.warn('[WebTerminal] Failed to fetch backend dynamic config /api/config', error);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/terminal`;
}

interface WebTerminalProps {
  queuedCommand?: QueuedCommand | null;
  onSessionId?: (sessionId: string) => void;
  onScanningStateChange?: (isScanning: boolean) => void;
}

export function WebTerminal({ queuedCommand, onSessionId, onScanningStateChange }: WebTerminalProps) {
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
  const [isScanning, setIsScanningState] = useState(false);
  const isScanningRef = useRef(false);
  const setIsScanning = (val: boolean) => {
    isScanningRef.current = val;
    setIsScanningState(val);
    onScanningStateChange?.(val);
  };
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const printedMilestonesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!isScanning) return;
    const timer = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 90);
    return () => clearInterval(timer);
  }, [isScanning]);

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
        cursor: '#E87A41',
        cursorAccent: '#0a0a0f',
        selectionBackground: '#E87A4133',
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

    /** Write the large premium welcome banner to terminal. */
    function printWelcomeBanner() {
      term.writeln('');
      term.writeln('  \x1b[38;2;232;122;65m\x1b[1m    _  _____ _   _ _____ _   _    _   \x1b[0m');
      term.writeln('  \x1b[38;2;232;122;65m\x1b[1m   / \\|_   _| | | | ____| \\ | |  / \\  \x1b[0m');
      term.writeln('  \x1b[38;2;232;122;65m\x1b[1m  / _ \\ | | | |_| |  _| |  \\| | / _ \\ \x1b[0m');
      term.writeln('  \x1b[38;2;232;122;65m\x1b[1m / ___ \\| | |  _  | |___| |\\  |/ ___ \\\x1b[0m');
      term.writeln('  \x1b[38;2;232;122;65m\x1b[1m/_/   \\_\\_| |_| |_|_____|_| \\_/_/   \\_\\\x1b[0m');
      term.writeln('');
      term.writeln('  \x1b[2mAI code provenance tracker\x1b[0m                 \x1b[38;2;232;122;65mactive sandbox\x1b[0m');
      term.writeln('  \x1b[2mparse → score → analyze → report\x1b[0m');
      term.writeln('');
      term.writeln('  \x1b[90m─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─\x1b[0m');
      term.writeln('');
    }

    /** Connect (or reconnect) to the backend WS. */
    async function doConnect() {
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

      let wsTargetUrl = '';
      try {
        wsTargetUrl = await resolveWsUrlAsync();
      } catch (err) {
        console.error('[WebTerminal] Failed to resolve WebSocket URL:', err);
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsTargetUrl = `${protocol}//${window.location.host}/ws/terminal`;
      }

      if (!mountedRef.current) return;

      const ws = new WebSocket(wsTargetUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        setStatus('connected');
        reconnectAttempts.current = 0;

        printWelcomeBanner();

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
          term.writeln(`\r\n\x1b[31m[error] ${decoded.message}\x1b[0m\r\n`);
          setIsScanning(false);
          setScanProgress(0);
          setScanStatus('');
          return;
        }

        if (decoded.type === 'status') {
          if (!isScanningRef.current) {
            printedMilestonesRef.current.clear();
          }
          setIsScanning(true);
          setScanStatus(decoded.label);
          setScanProgress(decoded.progress);

          const progress = decoded.progress;
          const milestones = printedMilestonesRef.current;

          if (progress >= 10 && !milestones.has(10)) {
            milestones.add(10);
            term.writeln('  \x1b[90m01.\x1b[0m \x1b[2m[sandbox] initialize clone workspace\x1b[0m');
          }
          if (progress >= 20 && !milestones.has(20)) {
            milestones.add(20);
            term.writeln('  \x1b[90m02.\x1b[0m \x1b[2m[git] clone repository to temporary environment\x1b[0m');
          }
          if (progress >= 30 && !milestones.has(30)) {
            milestones.add(30);
            term.writeln('  \x1b[90m03.\x1b[0m \x1b[2m[prepare] discover JS/TS source files\x1b[0m');
          }
          if (progress >= 60 && !milestones.has(60)) {
            milestones.add(60);
            term.writeln('  \x1b[90m04.\x1b[0m \x1b[2m[analyze] run target provenance scorers & local scans\x1b[0m');
          }
          if (progress >= 100 && !milestones.has(100)) {
            milestones.add(100);
            term.writeln('  \x1b[90m05.\x1b[0m \x1b[2m[report] scan complete, build and persist findings\x1b[0m');
          }
          return;
        }

        if (decoded.type === 'result' && decoded.command === 'clear') {
          term.clear();
          printWelcomeBanner();
          return;
        }

        if (decoded.type === 'result' && (decoded.command === 'scan' || decoded.command === 'upload')) {
          const scan = decoded.payload as any;
          if (scan && scan.findings) {
            const critical = scan.findings.CRITICAL ?? 0;
            const high = scan.findings.HIGH ?? 0;
            const medium = scan.findings.MEDIUM ?? 0;
            const low = scan.findings.LOW ?? 0;
            const isBlocked = critical > 0 || high > 0;

            term.writeln('');
            term.writeln('  \x1b[90m─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─\x1b[0m');
            term.writeln('');
            term.writeln(`  \x1b[1mScan Report: ${scan.repoName || 'sandbox project'}\x1b[0m`);
            term.writeln(`  \x1b[2mFiles scanned:\x1b[0m ${scan.filesScanned ?? 0}   \x1b[2mCode units:\x1b[0m ${scan.totalUnits ?? 0}`);
            term.writeln(`  \x1b[2mFindings:\x1b[0m \x1b[31mCRITICAL: ${critical}\x1b[0m | \x1b[38;2;255;122;69mHIGH: ${high}\x1b[0m | \x1b[33mMEDIUM: ${medium}\x1b[0m | \x1b[34mLOW: ${low}\x1b[0m`);
            term.writeln(`  \x1b[2mAI Risk score:\x1b[0m \x1b[38;2;232;122;65m${Math.round(scan.aiPercentage ?? 0)}%\x1b[0m`);
            term.writeln('');
            if (isBlocked) {
              term.writeln(`  \x1b[31m✗\x1b[0m \x1b[1mgate: \x1b[31mblocked\x1b[0m`);
            } else {
              term.writeln(`  \x1b[32m✓\x1b[0m \x1b[1mgate: \x1b[32mpass\x1b[0m`);
            }
            term.writeln('');
          }
          setIsScanning(false);
          setScanProgress(0);
          setScanStatus('');
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
          if (decoded.command !== 'scan' && decoded.command !== 'upload' && decoded.command !== 'clear') {
            term.writeln(`[done] ${decoded.command}`);
          }
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
    printedMilestonesRef.current = new Set();

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
        <strong className="web-terminal-title" style={{ fontFamily: 'var(--font-mono)' }}>
          {isScanning ? (
            <span className="web-terminal-scanning-text" style={{ color: 'var(--orange, #ff7a45)' }}>
              <span style={{ marginRight: '8px', display: 'inline-block' }}>{SPINNER_FRAMES[spinnerFrame]}</span>
              {scanStatus.toLowerCase().startsWith('upload') ? scanStatus.toLowerCase() : `scanning: ${scanStatus.toLowerCase()}...`}
            </span>
          ) : (
            'athena terminal'
          )}
        </strong>
        <div
          className="web-terminal-status"
          style={{ color: isScanning ? 'var(--orange, #ff7a45)' : statusColor[status] }}
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

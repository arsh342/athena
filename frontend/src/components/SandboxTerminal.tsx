import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { fetchFindings, fetchScanTerminalLines, fetchScans } from '../services/api';

interface SandboxTerminalProps {
  repoUrl: string;
  scanNonce: number;
}

type LineKind = 'input' | 'output' | 'error' | 'hint';

interface TerminalLine {
  id: string;
  kind: LineKind;
  text: string;
}

function createLine(kind: LineKind, text: string): TerminalLine {
  return {
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    text,
  };
}

export function SandboxTerminal({ repoUrl, scanNonce }: SandboxTerminalProps) {
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState('idle');
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [lines, setLines] = useState<TerminalLine[]>([
    createLine('hint', 'sandbox terminal ready. type `help` to list commands.'),
  ]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(false);
  const streamTimerRef = useRef<number | null>(null);

  const prompt = useMemo(() => (running ? 'running...' : 'awaiting command'), [running]);

  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length, running]);

  function startRunning(): boolean {
    if (runningRef.current) return false;
    runningRef.current = true;
    setRunning(true);
    return true;
  }

  function stopRunning(): void {
    runningRef.current = false;
    setRunning(false);
    setPhaseLabel('idle');
    setPhaseProgress(0);
    if (streamTimerRef.current) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }

  function startSyntheticScanStream(target: string): void {
    const checks = [
      'clone sandbox initialized',
      'indexing js/ts files',
      'building ast graph',
      'running 11-signal provenance scorer',
      'running secret detector',
      'running hallucination detector',
      'assembling finding cards',
      'writing scan artifact',
    ];
    const totalChecks = checks.length;

    const projectName = target.split('/').filter(Boolean).slice(-1)[0]?.replace(/\.git$/i, '') || 'repository';
    const pseudoFiles = [
      `src/${projectName}-client.ts`,
      `src/${projectName}-service.ts`,
      `src/security/auth.ts`,
      `src/api/routes.ts`,
      `src/utils/tokens.ts`,
      `src/config/runtime.ts`,
    ];

    let tick = 0;
    setPhaseLabel(checks[0]);
    setPhaseProgress(5);
    setLines((current) => [
      ...current,
      createLine('output', `scan queued for ${target}`),
      createLine('hint', 'live telemetry: streaming scan pipeline...'),
    ]);

    streamTimerRef.current = window.setInterval(() => {
      if (!runningRef.current) return;

      const status = checks[tick % checks.length];
      const file = pseudoFiles[tick % pseudoFiles.length];
      const phase = String((tick % checks.length) + 1).padStart(2, '0');
      const phaseIndex = Math.min(tick + 1, totalChecks);

      setPhaseLabel(status);
      setPhaseProgress(Math.min(92, Math.round((phaseIndex / totalChecks) * 92)));

      setLines((current) => [
        ...current,
        createLine('output', `[phase ${phase}] ${status}`),
        createLine('hint', `checking ${file}`),
      ]);

      tick += 1;
    }, 520);
  }

  async function executeCommand(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    if (runningRef.current) {
      setLines((current) => [
        ...current,
        createLine('error', 'command already running. wait for current command to finish.'),
      ]);
      return;
    }

    setLines((current) => [...current, createLine('input', `$ ${trimmed}`)]);

    const [base, ...rest] = trimmed.split(/\s+/);
    const cmd = base.toLowerCase();

    if (cmd === 'clear') {
      setLines([]);
      return;
    }

    if (cmd === 'help') {
      setLines((current) => [
        ...current,
        createLine('output', 'commands: help, scan [repo-url], scans, findings, clear'),
      ]);
      return;
    }

    if (cmd === 'scan') {
      const target = rest.join(' ').trim() || repoUrl;
      if (!target.trim()) {
        setLines((current) => [
          ...current,
          createLine('error', 'missing repository URL. use: scan https://github.com/org/repo'),
        ]);
        return;
      }
      if (!startRunning()) return;
      startSyntheticScanStream(target);
      try {
        const scanLines = await fetchScanTerminalLines(target);
        setPhaseLabel('finalizing report output');
        setPhaseProgress(100);
        setLines((current) => [
          ...current,
          createLine('hint', 'backend scan stream complete. rendering final output...'),
          ...scanLines.map((text) => createLine('output', text)),
        ]);
      } catch {
        setLines((current) => [
          ...current,
          createLine('error', 'scan failed. backend unreachable or returned error.'),
        ]);
      } finally {
        stopRunning();
      }
      return;
    }

    if (cmd === 'scans') {
      if (!startRunning()) return;
      try {
        const scans = await fetchScans();
        setLines((current) => [
          ...current,
          ...scans.map((scan) => createLine('output', `${scan.scanId}  ${scan.repoName}  ${scan.status}`)),
        ]);
      } catch {
        setLines((current) => [
          ...current,
          createLine('error', 'could not load scans from backend.'),
        ]);
      } finally {
        stopRunning();
      }
      return;
    }

    if (cmd === 'findings') {
      if (!startRunning()) return;
      try {
        const findings = await fetchFindings();
        const summary = findings.reduce(
          (acc, finding) => {
            acc[finding.severity] += 1;
            return acc;
          },
          { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
        );

        setLines((current) => [
          ...current,
          createLine(
            'output',
            `findings total=${findings.length} critical=${summary.CRITICAL} high=${summary.HIGH} medium=${summary.MEDIUM} low=${summary.LOW}`,
          ),
        ]);
      } catch {
        setLines((current) => [
          ...current,
          createLine('error', 'could not load findings from backend.'),
        ]);
      } finally {
        stopRunning();
      }
      return;
    }

    setLines((current) => [
      ...current,
      createLine('error', `unknown command: ${cmd}. type 'help'.`),
    ]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = command;
    setCommand('');
    void executeCommand(value);
  }

  useEffect(() => {
    if (!scanNonce || !repoUrl.trim()) return;
    void executeCommand(`scan ${repoUrl}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trigger only on form submit (nonce change)
  }, [scanNonce]);

  useEffect(() => () => stopRunning(), []);

  return (
    <section className="terminal sandbox-terminal" aria-label="Interactive scan sandbox terminal">
      <div className="terminal-chrome">
        <span />
        <span />
        <span />
        <strong className="terminal-title">
          <h6 className="terminal-title-brand">athena</h6>
        </strong>
      </div>

      <div className="sandbox-progress" aria-live="polite">
        <div className="sandbox-progress-head">
          <span>scan pipeline</span>
          <span>{running ? `${phaseProgress}%` : 'idle'}</span>
        </div>
        <div className="sandbox-progress-track">
          <div className="sandbox-progress-fill" style={{ width: `${phaseProgress}%` }} />
        </div>
        <div className="sandbox-progress-label">{running ? phaseLabel : 'awaiting scan'}</div>
      </div>

      <div className="terminal-body" ref={bodyRef}>
        {lines.map((line) => (
          <p key={line.id} className={`sandbox-line sandbox-line--${line.kind}`}>
            <span className="terminal-prefix">&gt;</span>
            {line.text}
          </p>
        ))}
      </div>

      <form className="sandbox-input-row" onSubmit={handleSubmit}>
        <span className="terminal-prefix">&gt;</span>
        <input
          aria-label="Sandbox command input"
          className="sandbox-input"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="type command: help"
          autoComplete="off"
        />
        <button className="sandbox-run" type="submit" disabled={running}>
          run
        </button>
      </form>

      <div className="sandbox-status">{prompt}</div>
    </section>
  );
}

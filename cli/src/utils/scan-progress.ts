import type { ScanProgressEvent } from '@athena/core';
import { basename } from 'node:path';

// The same rotating glyph Claude Code shows while it works, in Athena's orange.
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽'];
const ORANGE = '\x1b[38;2;232;122;65m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** `CI=false`, `CI=0` and an empty CI are not CI. */
export function isCi(env: NodeJS.ProcessEnv): boolean {
  const v = env.CI?.trim().toLowerCase();
  return !!v && v !== '0' && v !== 'false';
}

/** Progress is for humans: only on an interactive stderr, never in CI or with --quiet. */
export function shouldShowProgress(quiet: boolean, stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  return !quiet && Boolean(stream.isTTY) && !isCi(env);
}

export interface Progress {
  onProgress(event: ScanProgressEvent): void;
  onStage(event: ScanProgressEvent): void;
  stop(): void;
}

/** One updating line on stderr: spinner, phase, files done/total, findings so far. */
export function createProgress(opts: { enabled: boolean; stream: NodeJS.WriteStream; label?: string; now?: () => number }): Progress {
  if (!opts.enabled) return { onProgress: () => undefined, onStage: () => undefined, stop: () => undefined };

  let frame = 0;
  let done = 0;
  let total = 0;
  let findings = 0;
  let phase = 'preparing';
  const label = opts.label ?? 'Scanning';
  const now = opts.now ?? Date.now;
  const startedAt = now();

  const draw = () => {
    const width = opts.stream.columns ?? 80;
    const seconds = Math.floor((now() - startedAt) / 1000);
    const glyph = FRAMES[frame++ % FRAMES.length]!;
    const detail = `(${seconds}s · ${phase} · ${done}/${total} files · ${findings} findings)`;
    const room = Math.max(20, width - 1) - glyph.length - label.length - 4;
    opts.stream.write(`\r\x1b[2K${ORANGE}${glyph}${RESET} ${label}… ${DIM}${detail.slice(0, Math.max(10, room))}${RESET}`);
  };

  const timer = setInterval(draw, 90);
  timer.unref();

  const update = (event: ScanProgressEvent) => {
    total = Math.max(total, event.total);
    phase = event.detail ?? (event.filePath ? basename(event.filePath) : event.phase);
    if (event.phase === 'files' && event.status !== 'scanning') done = event.index;
    if (event.status === 'scanned') findings += event.findings;
    draw();
  };

  return {
    onProgress: update,
    onStage: update,
    stop: () => {
      clearInterval(timer);
      opts.stream.write('\r\x1b[2K');
    },
  };
}

/** A spinner with no file counts, for a single long step such as the AI check: `✻ Verifying with AI… (4s)`. */
export function createStatus(opts: { enabled: boolean; stream: NodeJS.WriteStream; label: string; now?: () => number }): { stop(): void } {
  if (!opts.enabled) return { stop: () => undefined };
  const now = opts.now ?? Date.now;
  const startedAt = now();
  let frame = 0;
  const draw = () => {
    const seconds = Math.floor((now() - startedAt) / 1000);
    opts.stream.write(`\r\x1b[2K${ORANGE}${FRAMES[frame++ % FRAMES.length]}${RESET} ${opts.label}… ${DIM}(${seconds}s)${RESET}`);
  };
  draw();
  const timer = setInterval(draw, 120);
  timer.unref();
  return { stop: () => { clearInterval(timer); opts.stream.write('\r\x1b[2K'); } };
}

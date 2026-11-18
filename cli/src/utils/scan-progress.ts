import type { ScanProgressEvent } from '@athena/core';
import { basename } from 'node:path';

const FRAMES = ['⠋', '⠙', '⠸', '⠴', '⠦', '⠇'];

/** Progress is for humans: only on an interactive stderr, never in CI or with --quiet. */
export function shouldShowProgress(quiet: boolean, stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): boolean {
  return !quiet && Boolean(stream.isTTY) && !env.CI;
}

export interface Progress {
  onProgress(event: ScanProgressEvent): void;
  onStage(event: ScanProgressEvent): void;
  stop(): void;
}

/** One updating line on stderr: spinner, phase, files done/total, findings so far. */
export function createProgress(opts: { enabled: boolean; stream: NodeJS.WriteStream }): Progress {
  if (!opts.enabled) return { onProgress: () => undefined, onStage: () => undefined, stop: () => undefined };

  let frame = 0;
  let done = 0;
  let total = 0;
  let findings = 0;
  let phase = 'preparing';

  const draw = () => {
    const width = opts.stream.columns ?? 80;
    const line = `${FRAMES[frame++ % FRAMES.length]} ${phase} ${done}/${total} files · ${findings} findings`;
    opts.stream.write(`\r\x1b[2K${line.slice(0, Math.max(20, width - 1))}`);
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

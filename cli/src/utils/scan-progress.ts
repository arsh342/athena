import type { ScanProgressEvent } from '@athena/core';
import { basename } from 'node:path';
import { c } from './colors.js';
import { truncate } from './banner.js';

const FRAMES = ['⠋', '⠙', '⠸', '⠴', '⠦', '⠇'];

/**
 * Render live CLI scan progress with animated spinner and current file metadata.
 */
export function createScanProgressRenderer(enabled: boolean) {
  if (!enabled || !process.stdout.isTTY) {
    return {
      onProgress: (_event: ScanProgressEvent) => undefined,
      stop: () => undefined,
    };
  }

  let frame = 0;
  let processed = 0;
  let total = 0;
  let findings = 0;
  let currentFile = '';

  const timer = setInterval(() => {
    const cols = process.stdout.columns ?? 100;
    const spinner = FRAMES[frame % FRAMES.length];
    frame += 1;

    const fileLabel = currentFile ? truncate(currentFile, Math.max(12, cols - 50)) : 'preparing scan';
    const line = `\r  ${c.accent}${spinner}${c.reset} scanning ${c.bold}${processed}/${total}${c.reset}  ${c.dim}${fileLabel}${c.reset}  ${c.orange}findings:${findings}${c.reset}`;
    process.stdout.write(line);
  }, 90);

  return {
    onProgress: (event: ScanProgressEvent) => {
      total = event.total;
      currentFile = basename(event.filePath);
      if (event.status === 'scanned' || event.status === 'skipped' || event.status === 'missing') {
        processed = event.index;
      }
      if (event.status === 'scanned') {
        findings += event.findings;
      }
    },
    stop: () => {
      clearInterval(timer);
      process.stdout.write('\r\x1b[2K');
      process.stdout.write(`  ${c.green}✓${c.reset} scan complete  ${c.dim}${processed}/${total} files${c.reset}  ${c.orange}findings:${findings}${c.reset}\n\n`);
    },
  };
}

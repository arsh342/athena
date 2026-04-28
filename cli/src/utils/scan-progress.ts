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
      onStage: (_event: ScanProgressEvent) => undefined,
      stop: () => undefined,
    };
  }

  let frame = 0;
  let processed = 0;
  let total = 0;
  let findings = 0;
  let currentFile = '';
  let currentPhase = 'preparing scan';
  let milestoneCount = 0;
  let lastMilestoneKey = '';

  function renderLine() {
    const cols = process.stdout.columns ?? 100;
    const spinner = FRAMES[frame % FRAMES.length];
    frame += 1;

    const fileLabel = currentFile ? truncate(currentFile, Math.max(12, cols - 62)) : currentPhase;
    const line = `\r  ${c.accent}${spinner}${c.reset} scanning ${c.bold}${processed}/${total}${c.reset}  ${c.dim}${fileLabel}${c.reset}  ${c.orange}findings:${findings}${c.reset}`;
    process.stdout.write(line);
  }

  const timer = setInterval(() => {
    renderLine();
  }, 90);

  return {
    onProgress: (event: ScanProgressEvent) => {
      total = event.total;
      currentPhase = formatPhase(event);
      currentFile = event.filePath ? basename(event.filePath) : '';
      maybePrintMilestone(event);
      if (event.status === 'scanned' || event.status === 'skipped' || event.status === 'missing') {
        processed = event.index;
      }
      if (event.status === 'scanned') {
        findings += event.findings;
      }
    },
    onStage: (event: ScanProgressEvent) => {
      currentPhase = formatPhase(event);
      currentFile = event.filePath ? basename(event.filePath) : '';
      maybePrintMilestone(event);
      if (event.phase === 'external-scanners') {
        total = Math.max(total, event.total);
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

  function maybePrintMilestone(event: ScanProgressEvent) {
    const milestoneKey = `${event.phase}:${event.status}:${event.detail ?? ''}:${event.filePath}`;
    if (milestoneKey === lastMilestoneKey) return;

    const shouldPrint =
      event.phase !== 'files'
      || event.status === 'scanning'
      || (event.phase === 'files' && event.status === 'scanned' && event.index === event.total);

    if (!shouldPrint) return;

    lastMilestoneKey = milestoneKey;
    process.stdout.write('\r\x1b[2K');
    milestoneCount += 1;
    process.stdout.write(`  ${c.gray}${String(milestoneCount).padStart(2, '0')}.${c.reset} ${c.dim}${formatMilestone(event)}${c.reset}\n`);
    renderLine();
  }
}

function formatPhase(event: ScanProgressEvent): string {
  if (event.detail) return event.detail;
  if (event.phase === 'prepare') return 'discovering source files';
  if (event.phase === 'security-analysis') return 'running local analyzers';
  if (event.phase === 'external-scanners') return 'running external scanners';
  if (event.phase === 'report') return 'assembling final report';
  return 'scanning files';
}

function formatMilestone(event: ScanProgressEvent): string {
  if (event.phase === 'prepare') return 'step 1/6 discover files';
  if (event.phase === 'security-analysis') return `step 2/6 analyze ${basename(event.filePath)}`;
  if (event.phase === 'files' && event.status === 'scanning') return `step 3/6 parse ${basename(event.filePath)}`;
  if (event.phase === 'files' && event.status === 'scanned' && event.index === event.total) return 'step 4/6 local file pass complete';
  if (event.phase === 'external-scanners') return `step 5/6 ${event.detail ?? 'run external scanners'}`;
  if (event.phase === 'report') return 'step 6/6 build report';
  return event.detail ?? 'scan update';
}

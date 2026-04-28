import { formatJsonl, formatTerminalReport, mergeConfig, scanFiles } from '@athena/core';
import { resolve } from 'node:path';
import { withBufferedAthenaCoreConsole } from '../utils/console-buffer.js';
import { attachScanDelta } from '../utils/delta.js';
import { findSourceFiles } from '../utils/file-filter.js';
import { appendScanHistory } from '../utils/history.js';
import { createScanProgressRenderer } from '../utils/scan-progress.js';
import { clearScreen, printRunHeader, printRunResult, printScannerNotes } from '../utils/terminal.js';

interface ScanOptions {
  threshold: string;
  format: string;
  maxFindings?: string;
  quietHeader?: boolean;
  eslint?: boolean;
  npmAudit?: boolean;
  nodejsscan?: boolean;
  bearer?: boolean;
  semgrep?: boolean;
}

export async function scanCommand(dir: string, options: ScanOptions): Promise<void> {
  const root = resolve(process.cwd(), dir);
  const config = mergeConfig({
    threshold: Number(options.threshold),
  });
  config.eslint = { ...config.eslint!, enabled: options.eslint !== false };
  config.npmAudit = { ...config.npmAudit!, enabled: options.npmAudit !== false };
  config.nodejsscan = { ...config.nodejsscan!, enabled: options.nodejsscan !== false };
  config.bearer = { ...config.bearer!, enabled: options.bearer !== false };
  config.semgrep.enabled = options.semgrep !== false;

  if (!options.quietHeader) {
    if (process.stdout.isTTY) {
      clearScreen();
    }
    printRunHeader('scan', root);
  }
  const files = await findSourceFiles(root, config.exclude);
  const maxFindings = parseMaxFindings(options.maxFindings);
  const progress = createScanProgressRenderer(options.format === 'terminal');

  const { result: report, messages } = await withBufferedAthenaCoreConsole(async () => {
    try {
      return await scanFiles(
        files,
        config,
        { onFileProgress: progress.onProgress, onScannerStage: progress.onStage },
      );
    } finally {
      progress.stop();
    }
  });
  await attachScanDelta(report, `scan:${root}`, root);

  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else if (options.format === 'jsonl') {
    console.log(formatJsonl(report));
  } else {
    printScannerNotes(messages);
    console.log(formatTerminalReport(report, { maxFindings }));
  }

  await appendScanHistory({
    timestamp: new Date().toISOString(),
    mode: 'scan',
    target: root,
    blocked: report.summary.blocked,
    filesScanned: report.summary.filesScanned,
    aiScore: report.summary.aiScore,
  });

  printRunResult(report.summary.blocked);
  process.exitCode = report.summary.blocked ? 1 : 0;
}

function parseMaxFindings(raw?: string): number {
  if (!raw || raw === 'all') return Number.POSITIVE_INFINITY;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Number.POSITIVE_INFINITY;
}

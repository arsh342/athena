import { formatJsonl, formatTerminalReport, scanFiles } from '@athena/core';
import { resolve } from 'node:path';
import { findSourceFiles } from '../utils/file-filter.js';
import { appendScanHistory } from '../utils/history.js';
import { createScanProgressRenderer } from '../utils/scan-progress.js';
import { clearScreen, printRunHeader, printRunResult } from '../utils/terminal.js';

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
  if (!options.quietHeader) {
    if (process.stdout.isTTY) {
      clearScreen();
    }
    printRunHeader('scan', root);
  }
  const files = await findSourceFiles(root);
  const maxFindings = parseMaxFindings(options.maxFindings);
  const progress = createScanProgressRenderer(options.format === 'terminal');

  // Build scanner configuration
  const scannerConfig = {
    threshold: Number(options.threshold),
    eslint: { enabled: options.eslint !== false },
    npmAudit: { enabled: options.npmAudit !== false },
    nodejsscan: { enabled: options.nodejsscan !== false },
    bearer: { enabled: options.bearer !== false },
    semgrep: { enabled: options.semgrep !== false },
  };

  const report = await (async () => {
    try {
      return await scanFiles(
        files,
        scannerConfig,
        { onFileProgress: progress.onProgress },
      );
    } finally {
      progress.stop();
    }
  })();

  if (options.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else if (options.format === 'jsonl') {
    console.log(formatJsonl(report));
  } else {
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

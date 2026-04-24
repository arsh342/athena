import { formatJsonl, formatTerminalReport, mergeConfig, scanFiles } from '@athena/core';
import { resolve } from 'node:path';
import { withBufferedAthenaCoreConsole } from '../utils/console-buffer.js';
import { attachScanDelta } from '../utils/delta.js';
import { findSourceFiles, isExcludedPath, isSourceFile } from '../utils/file-filter.js';
import { getStagedFiles } from '../utils/git.js';
import { appendScanHistory } from '../utils/history.js';
import { createScanProgressRenderer } from '../utils/scan-progress.js';
import { clearScreen, printRunHeader, printRunResult, printScannerNotes } from '../utils/terminal.js';

interface CheckOptions {
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

export async function checkCommand(files: string[], options: CheckOptions): Promise<void> {
  const config = mergeConfig({
    threshold: Number(options.threshold),
  });
  config.eslint = { ...config.eslint!, enabled: options.eslint !== false };
  config.npmAudit = { ...config.npmAudit!, enabled: options.npmAudit !== false };
  config.nodejsscan = { ...config.nodejsscan!, enabled: options.nodejsscan !== false };
  config.bearer = { ...config.bearer!, enabled: options.bearer !== false };
  config.semgrep.enabled = options.semgrep !== false;

  const selected = files.length > 0 ? files : await getStagedFiles();
  const sourceFiles = selected
    .filter(isSourceFile)
    .map((file) => resolve(process.cwd(), file))
    .filter((file) => !isExcludedPath(file, process.cwd(), config.exclude));

  if (!options.quietHeader) {
    if (process.stdout.isTTY) {
      clearScreen();
    }
    printRunHeader('check', `${sourceFiles.length} staged/source files`);
  }
  const expanded = sourceFiles.length === 1
    ? await findSourceFiles(sourceFiles[0], config.exclude)
    : sourceFiles;
  const maxFindings = parseMaxFindings(options.maxFindings);
  const progress = createScanProgressRenderer(options.format === 'terminal');

  const { result: report, messages } = await withBufferedAthenaCoreConsole(async () => {
    try {
      return await scanFiles(
        expanded,
        config,
        { onFileProgress: progress.onProgress },
      );
    } finally {
      progress.stop();
    }
  });
  await attachScanDelta(report, `check:${process.cwd()}`, process.cwd());

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
    mode: 'check',
    target: `${sourceFiles.length} staged/source files`,
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

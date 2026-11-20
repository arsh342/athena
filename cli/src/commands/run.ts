import { applyChangeFilter, formatCycloneDx, formatMarkdownReview, type ChangeSet } from '@athena/core';
import { runAiStep } from './ai.js';
import { startBackgroundUpdate } from './update.js';
import { readFileSync } from 'node:fs';
import { realpath, writeFile } from 'node:fs/promises';
import { basename, relative, sep } from 'node:path';
import {
  formatJsonl, formatSarif, formatTerminalReport, mergeConfig, scanFiles,
  type AthenaConfig, type ScanReport,
} from '@athena/core';
import { withBufferedAthenaCoreConsole } from '../utils/console-buffer.js';
import { attachScanDelta } from '../utils/delta.js';
import { exitCodeFor } from '../utils/exit-codes.js';
import { getGitTopLevel } from '../utils/git.js';
import { appendScanHistory } from '../utils/history.js';
import { saveLastScan } from '../utils/last-scan.js';
import { writeInfo, writeResult } from '../utils/output.js';
import type { RunOptions } from '../utils/run-options.js';
import { createProgress, shouldShowProgress } from '../utils/scan-progress.js';
import { CLI_VERSION } from '../version.js';

export interface RunArgs {
  mode: 'scan' | 'check' | 'review';
  /** Absolute project root. */
  root: string;
  /** Shown in the report header. */
  target: string;
  files: string[];
  excluded: string[];
  /** Config-style text files searched for secrets. */
  textFiles?: string[];
  options: RunOptions;
  /** `athena review`: restrict the report to what the change introduced. */
  review?: { changes: ChangeSet; scope: string };
}

/** Runs core, prints the chosen format, saves state, and returns the process exit code. */
export async function runScan(args: RunArgs): Promise<number> {
  const { mode, root, target, files, excluded, options } = args;

  const config = mergeConfig({
    blockOn: options.blockOn,
    exclude: options.exclude,
    publicRoutes: options.publicRoutes,
    learning: options.learning,
    ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
  });
  config.eslint = { ...config.eslint!, enabled: options.scanners.eslint };
  config.dependencies = { enabled: options.deps.enabled, offline: options.deps.offline, registryChecks: true };

  for (const warning of options.warnings) writeInfo(`warning: ${warning}`);

  const progress = createProgress({
    enabled: shouldShowProgress(options.quiet, process.stderr, process.env),
    stream: process.stderr,
  });

  const { result: report, messages } = await withBufferedAthenaCoreConsole(async () => {
    try {
      return await scanFiles(
        files,
        config as AthenaConfig,
        { onFileProgress: progress.onProgress, onScannerStage: progress.onStage },
        { root, excludedFiles: excluded, ...(args.textFiles ? { textFiles: args.textFiles } : {}) },
      );
    } finally {
      progress.stop();
    }
  });
  if (args.review) report.review = applyChangeFilter(report, args.review.changes, root, config, args.review.scope);
  else await attachScanDelta(report, `${mode}:${root}`, root);
  if (options.ai) await runAiStep(report, config, options.ai, root, shouldShowProgress(options.quiet, process.stderr, process.env));
  if (config.updates?.auto !== false && !options.deps.offline && options.deps.enabled) startBackgroundUpdate(config.updates?.intervalHours ?? 24);
  for (const w of report.summary.skillWarnings ?? []) writeInfo(`warning: ${w}`);

  if (options.verbose) {
    for (const message of messages) writeInfo(`note: ${message.text}`);
  }

  const text = render(report, args, await sarifUriPrefix(root));
  if (options.output) await writeFile(options.output, text.endsWith('\n') ? text : `${text}\n`);
  else writeResult(text);

  try {
    await saveLastScan(root, report);
  } catch (error) {
    writeInfo(`warning: could not save scan for "athena explain": ${error instanceof Error ? error.message : String(error)}`);
  }
  await appendScanHistory({
    timestamp: new Date().toISOString(),
    mode,
    target: mode === 'scan' ? root : target,
    blocked: report.summary.blocked,
    filesScanned: report.summary.filesScanned,
    aiScore: report.summary.aiScore,
  });

  return exitCodeFor(report, options.strict);
}

/** SARIF uris are relative to the repository root; this is the scanned root's path inside it. */
async function sarifUriPrefix(root: string): Promise<string> {
  const top = await getGitTopLevel(root);
  if (!top) return '';
  try {
    const inside = relative(await realpath(top), await realpath(root));
    return inside && !inside.startsWith('..') ? `${inside.split(sep).join('/')}/` : '';
  } catch {
    return '';
  }
}

function render(report: ScanReport, args: RunArgs, uriPrefix: string): string {
  const { options } = args;
  switch (options.format) {
    case 'json':
      return JSON.stringify(report, null, 2);
    case 'jsonl':
      return formatJsonl(report);
    case 'markdown':
      return formatMarkdownReview(report, report.review ?? { scope: 'scan', skippedBinary: [], renamed: [], deleted: [], existing: [] }, { root: args.root });
    case 'cyclonedx':
      return formatCycloneDx(report, { toolVersion: CLI_VERSION, projectName: basename(args.root) });
    case 'sarif':
      return formatSarif(report, { toolVersion: CLI_VERSION, root: args.root, uriPrefix });
    default: {
      const cache = new Map<string, string[] | null>();
      const readLines = (file: string): string[] | null => {
        if (!cache.has(file)) {
          try {
            cache.set(file, readFileSync(file, 'utf8').split(/\r?\n/));
          } catch {
            cache.set(file, null);
          }
        }
        return cache.get(file) ?? null;
      };
      return formatTerminalReport(report, {
        color: options.color,
        version: CLI_VERSION,
        mode: args.mode,
        target: args.target,
        failOn: options.failOn,
        root: args.root,
        maxFindings: options.maxFindings,
        showLow: options.showLow,
        readLines,
      });
    }
  }
}

import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, normalize, relative, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isConfigTextFile, isSourceCandidate, mergeConfig } from '@athena/core';
import type { ScanWorkerInput, ScanWorkerOutput } from './scan-worker.ts';
import type { ClassifiedFinding, ScanReport } from '@athena/core';
import { simpleGit } from 'simple-git';
import { addScan } from './data.ts';
import type { Finding, ScanSummary } from './data.ts';

const SCAN_TIMEOUT_MS = 120_000;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', '__pycache__', '.venv', 'venv', '.tox', 'target', 'vendor', '__MACOSX']);
const IGNORE_FILE_NAMES = new Set(['.DS_Store']);

export type UploadMode = 'folder' | 'zip';

export interface UploadFile {
  originalname: string;
  /** The file's bytes, when it is held in memory (tests). Real uploads are written to disk and arrive as `path`. */
  buffer?: Buffer;
  /** Where the upload was stored on disk. Preferred: it keeps a large upload out of memory. */
  path?: string;
  size: number;
}

/**
 * Scans are heavy (clone, parse, analyse), and this runs on a small instance: one (by default) at a time. The rest are turned away
 * with a clear message instead of piling up memory until the process is killed.
 */
export class ScanBusyError extends Error {
  constructor() {
    super('The server is busy with other scans right now. Try again in a minute.');
  }
}
// One at a time by default. A scan temporarily replaces process.cwd() for the whole process, so overlapping scans can interfere
// with each other: raise MAX_CONCURRENT_SCANS only on a large instance, and only after that is made per-scan.
const scanLimit = (): number => Math.max(1, Math.floor(Number(process.env.MAX_CONCURRENT_SCANS ?? 1)) || 1);
let activeScans = 0;
export function activeScanCount(): number { return activeScans; }
export async function withScanSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeScans >= scanLimit()) throw new ScanBusyError();
  activeScans += 1;
  try {
    return await work();
  } finally {
    activeScans -= 1;
  }
}

export interface ScanResult {
  scan: ScanSummary;
  findings: Finding[];
  terminalLines: string[];
}

export type ScanEmitter = {
  line?: (text: string, kind?: 'output' | 'hint' | 'error') => void;
  status?: (label: string, progress: number) => void;
};

export interface UploadedPathScanInput {
  workspacePath: string;
  displayName: string;
  userId?: number | string;
  emit?: ScanEmitter;
}

function createScanId(repoName: string): string {
  return `scan_${repoName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}_${Date.now().toString(36).slice(-6)}`;
}

function createEmptyScan(scanId: string, repoName: string, repoUrl: string, status: ScanSummary['status']): ScanSummary {
  return {
    scanId,
    repoName,
    repoUrl,
    status,
    createdAt: new Date().toISOString(),
    aiPercentage: 0,
    flaggedUnits: 0,
    filesScanned: 0,
    totalUnits: 0,
    findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 },
    duration: 0,
    aiProvenance: null,
    coverage: null,
  };
}

function createEmitterLog(emitter?: ScanEmitter) {
  return (text: string, kind: 'output' | 'hint' | 'error' = 'output') => {
    emitter?.line?.(text, kind);
    return text;
  };
}

/** Supported extension, or an extensionless file whose first line is a known shebang (uploads lose the exec bit). */
/** Walk directory tree and collect source file paths. */
/**
 * Directories left out of a scan by default, the same ones the CLI leaves out (athena's default `exclude`: test/, tests/, __tests__/ ...).
 * Single-name patterns only, matched against directory names. Their source files are listed in coverage as excluded, never silently dropped.
 */
const DEFAULT_EXCLUDED_DIRS = new Set((mergeConfig({}).exclude ?? []).map((p) => p.replace(/\/+$/, '')).filter((p) => p && !p.includes('/')));

async function collectSourceFiles(dir: string, textOut?: string[], excludedOut?: string[]): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string, excluded: boolean): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.isFile() && shouldIgnoreUploadFileName(entry.name)) continue;

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, excluded || DEFAULT_EXCLUDED_DIRS.has(entry.name));
      } else if (entry.isFile() && (await isSourceCandidate(fullPath))) {
        (excluded ? excludedOut ?? [] : results).push(fullPath);
      } else if (entry.isFile() && textOut && !excluded && isConfigTextFile(fullPath)) {
        textOut.push(fullPath);
      }
    }
  }

  await walk(dir, false);
  return results;
}

/** Parse repo name from URL. */
function parseRepoName(repoUrl: string): string {
  const cleaned = repoUrl.trim().replace(/\/+$/, '');
  const match = cleaned.match(/\/([^/]+)$/);
  if (!match?.[1]) return 'repository';
  return match[1].replace(/\.git$/i, '') || 'repository';
}

/** Map core ClassifiedFinding to API Finding shape. */
function mapFinding(finding: ClassifiedFinding): Finding {
  return {
    id: finding.id,
    severity: finding.severity,
    type: finding.type,
    category: finding.category,
    message: finding.message,
    file: finding.file,
    line: finding.line,
    column: finding.column,
    source: finding.source,
    aiScore: finding.aiScore,
    code: finding.code,
    ruleId: finding.ruleId,
    ...(finding.confidence ? { confidence: finding.confidence } : {}),
    ...(finding.evidence ? { evidence: finding.evidence } : {}),
    ...(finding.trace ? { trace: finding.trace } : {}),
    ...(finding.exposure ? { exposure: finding.exposure } : {}),
    ...(finding.aiVerdict ? { aiVerdict: { verdict: finding.aiVerdict.verdict, reason: finding.aiVerdict.reason, provider: finding.aiVerdict.provider, model: finding.aiVerdict.model, citations: finding.aiVerdict.citations } } : {}),
    topSignals: finding.explainedScore.topSignals.slice(0, 5),
  };
}

/** Map core ScanReport to API ScanSummary shape. */
export function mapScanSummary(report: ScanReport, scanId: string, repoName: string, repoUrl: string, rootPath?: string): ScanSummary {
  return {
    scanId,
    repoName,
    repoUrl,
    status: 'COMPLETED',
    createdAt: report.timestamp,
    aiPercentage: report.summary.aiPercentage,
    flaggedUnits: report.summary.flaggedUnits,
    filesScanned: report.summary.filesScanned,
    totalUnits: report.summary.totalUnits,
    findings: report.summary.findings,
    riskDensity: report.summary.riskDensity,
    duration: report.duration,
    aiProvenance: toProvenanceSummary(report, rootPath),
    coverage: toCoverageSummary(report),
  };
}

function toProvenanceSummary(report: ScanReport, rootPath?: string): ScanSummary['aiProvenance'] {
  const provenance = report.summary.aiProvenance;
  if (!provenance) return null;
  const { files, ...rest } = provenance;
  // Store repo-relative paths: the server's temporary clone directory means nothing to the user.
  const relPath = (p: string) => (rootPath ? relative(rootPath, p).split('\\').join('/') : p);
  return { ...rest, topFiles: files.slice(0, 5).map((f) => ({ ...f, path: relPath(f.path) })) };
}

/** Wording for a coverage gap on the web. Only a single scanner name followed by "unavailable" means a tool is missing from this server. */
export function describeCoverageGap(gap: string): string {
  const lookups = /^(\d+) (registry|vulnerability) lookup\(s\) unavailable$/.exec(gap);
  if (lookups) return `${lookups[1]} ${lookups[2]} lookup(s) could not be completed (the ${lookups[2] === 'registry' ? 'package registry' : 'advisory service'} did not answer in time); run the CLI for a full check`;
  return gap.replace(/^(\S+) unavailable$/, '$1 not installed on this server');
}

function toCoverageSummary(report: ScanReport): ScanSummary['coverage'] {
  const coverage = report.summary.coverage;
  if (!coverage) return null;
  const considered = coverage.files.filter((file) => file.status !== 'skipped-excluded');
  return {
    complete: coverage.complete,
    gaps: coverage.gaps.map(describeCoverageGap),
    analyzedFiles: considered.filter((file) => file.status === 'analyzed').length,
    totalFiles: considered.length,
  };
}

function filterRelativeParts(relativePath: string): string[] {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

function shouldIgnoreUploadFileName(fileName: string): boolean {
  return IGNORE_FILE_NAMES.has(fileName) || fileName.startsWith('._');
}

export function filterRelativeUploadPath(relativePath: string): string | null {
  const parts = filterRelativeParts(relativePath);
  if (parts.length === 0) return null;
  if (parts.some((part) => IGNORE_DIRS.has(part))) return null;
  if (shouldIgnoreUploadFileName(parts[parts.length - 1] ?? '')) return null;
  return parts.join('/');
}

export function isZipUploadFileName(fileName: string): boolean {
  return fileName.trim().toLowerCase().endsWith('.zip');
}

export function getUploadPayloadBytes(files: UploadFile[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

export function sanitizeZipEntryPath(entryName: string): string {
  const normalizedEntry = normalize(entryName.replace(/\\/g, '/'));
  if (
    !normalizedEntry
    || normalizedEntry.startsWith('/')
    || normalizedEntry === '.'
    || normalizedEntry.split('/').includes('..')
  ) {
    throw new Error('Unsafe zip entry path.');
  }

  return normalizedEntry;
}

function createLocalDisplayName(raw: string): string {
  const trimmed = raw.trim();
  const cleaned = trimmed.replace(/[/\\]+$/, '');
  return basename(cleaned || 'local-upload') || 'local-upload';
}

async function persistScan(userId: number | string | undefined, scan: ScanSummary, findings: Finding[]): Promise<void> {
  const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
  if (typeof parsedUserId === 'number' && !isNaN(parsedUserId)) {
    await addScan(parsedUserId, scan, findings);
    return;
  }

  addScan(scan, findings);
}

async function scanFromPath(input: {
  scanId: string;
  repoName: string;
  repoUrl: string;
  rootPath: string;
  userId?: number | string;
  lines: string[];
  emit?: ScanEmitter;
}): Promise<ScanResult> {
  const { scanId, repoName, repoUrl, rootPath, userId, lines, emit } = input;
  const emitLine = createEmitterLog(emit);
  const log = (line: string, kind: 'output' | 'hint' | 'error' = 'output') => {
    emitLine(line, kind);
    lines.push(line);
  };

  try {
    emit?.status?.('Collecting source files', 30);
    log('Collecting source files');
    const textFiles: string[] = [];
    const excludedFiles: string[] = [];
    const sourceFiles = await collectSourceFiles(rootPath, textFiles, excludedFiles);
    log(`Found ${sourceFiles.length} source files`);

    const limit = maxScanFiles();
    if (sourceFiles.length > limit) {
      throw new Error(`This repository has ${sourceFiles.length} source files and would need about ${estimateScanMb(sourceFiles.length)} MB to scan; the web scanner is limited to ${scanBudgetMb()} MB (about ${limit} files). Download the CLI and scan it on your own machine instead: npm i -g @arsh342/athena, then athena scan . (no size limit, and your code never leaves your computer).`);
    }

    if (sourceFiles.length === 0) {
      log('No source files found. Scan complete with empty results.');
      emit?.status?.('Scan complete', 100);
      const emptyScan = createEmptyScan(scanId, repoName, repoUrl, 'COMPLETED');
      await persistScan(userId, emptyScan, []);
      return { scan: emptyScan, findings: [], terminalLines: lines };
    }

    emit?.status?.('Running analysis', 60);
    log(`Scanning ${sourceFiles.length} JavaScript and TypeScript files`);
    log('Running 11-signal heuristic scorer');
    log('Running security analyzers (secret detection + hallucination check)');

    const report: ScanReport = await runScanFilesInProjectRoot(rootPath, sourceFiles, textFiles, excludedFiles);
    const allFindings = report.files.flatMap((file) => file.findings).map(mapFinding);
    const scanSummary = mapScanSummary(report, scanId, repoName, repoUrl, rootPath);

    log(`Extracted ${report.summary.totalUnits} code units`);
    log(`Flagged ${report.summary.flaggedUnits} units above threshold`);
    log(`Classified ${allFindings.length} findings`);
    log(`Scan completed in ${report.duration}ms`);
    log(`Report saved: ${scanId}`);
    emit?.status?.('Scan complete', 100);

    await persistScan(userId, scanSummary, allFindings);

    const parsedUserId = typeof userId === 'string' ? parseInt(userId, 10) : userId;
    if (typeof parsedUserId === 'number' && !isNaN(parsedUserId)) {
      try {
        const { saveScanInventory } = await import('./alerts.ts');
        await saveScanInventory(parsedUserId, scanSummary.scanId, report.inventory);
      } catch (inventoryError) {
        lines.push(`Warning: dependency inventory not saved (${inventoryError instanceof Error ? inventoryError.message : String(inventoryError)})`);
      }
      try {
        const { generateReportMarkdown } = await import('./report-markdown.ts');
        const { addScanReport } = await import('./data.ts');
        const markdown = generateReportMarkdown(scanSummary, allFindings);
        await addScanReport(parsedUserId, scanSummary.scanId, markdown);
      } catch (reportError) {
        const reason = reportError instanceof Error ? reportError.message : String(reportError);
        lines.push(`Warning: report save failed (${reason})`);
      }
    }
    return { scan: scanSummary, findings: allFindings, terminalLines: lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`ERROR: ${message}`, 'error');
    emit?.status?.('Scan failed', 100);

    const failedScan = createEmptyScan(scanId, repoName, repoUrl, 'FAILED');
    await persistScan(userId, failedScan, []);
    return { scan: failedScan, findings: [], terminalLines: lines };
  }
}

/** Rough peak memory a scan needs per source file (ESLint, parsing and dependency checks together), and the fixed part, in MB. Measured on a 697-file project. */
const MB_PER_FILE = 1.1;
const MB_FIXED = 250;

/** The container's memory limit in MB when it is running under one (cgroup v2, then v1); null if unknown. */
function containerLimitMb(): number | null {
  for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const n = Number(readFileSync(file, 'utf8').trim());
      if (Number.isFinite(n) && n > 0 && n < 2 ** 50) return n / 1048576;
    } catch { /* not in a container, or not readable */ }
  }
  return null;
}

/** Memory the web scanner may use for one scan, in MB (SCAN_MEMORY_MB, default 500). A scan estimated to need more is sent to the CLI. */
const scanBudgetMb = (env: NodeJS.ProcessEnv = process.env): number => Math.max(MB_FIXED + 50, Number(env.SCAN_MEMORY_MB) || 500);

/** Estimated peak memory of a scan, in MB. */
export const estimateScanMb = (files: number): number => Math.round(MB_FIXED + files * MB_PER_FILE);

/**
 * The most source files one web scan may have: SCAN_MAX_FILES if set, else what fits in the memory budget (500 MB by default, or the
 * container's memory limit if that is smaller). Larger repositories are scanned with the CLI on the user's own machine.
 */
export function maxScanFiles(limitMb: number | null = containerLimitMb(), env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.SCAN_MAX_FILES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  const budget = Math.min(scanBudgetMb(env), limitMb ?? Number.POSITIVE_INFINITY);
  return Math.max(50, Math.floor((budget - MB_FIXED) / MB_PER_FILE));
}

/** Heap limit for the scan process (MB). Most of a scan's memory is not JS heap, so this mainly stops a runaway scan from taking the server with it. */
const scanHeapMb = (): number => Math.max(128, Number(process.env.SCAN_HEAP_MB ?? 512) || 512);

async function runScanFilesInProjectRoot(projectRoot: string, sourceFiles: string[], textFiles: string[] = [], excludedFiles: string[] = []): Promise<ScanReport> {
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const input: ScanWorkerInput = {
    projectRoot,
    sourceFiles,
    textFiles,
    excludedFiles,
    dependencies: { enabled: true, offline: false, registryChecks: true, concurrency: Math.max(1, Number(process.env.DEPS_CONCURRENCY ?? 2) || 2) },
  };
  const execArgv = [...process.execArgv.filter((a) => !a.startsWith('--max-old-space-size')), `--max-old-space-size=${scanHeapMb()}`];

  return new Promise<ScanReport>((resolvePromise, reject) => {
    const child = fork(fileURLToPath(new URL(`./scan-worker${ext}`, import.meta.url)), [], { execArgv, serialization: 'json', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    child.once('message', (out: ScanWorkerOutput) => finish(() => (out.ok ? resolvePromise(out.report as ScanReport) : reject(new Error(out.error)))));
    child.once('error', (error) => finish(() => reject(error)));
    child.once('exit', (code, signal) => finish(() => reject(new Error(`The scan process stopped unexpectedly (${signal ?? `exit ${code}`}); the repository may be too large for this server's memory.`))));
    child.send(input);
  });
}

async function writeFolderUploadWorkspace(workspaceRoot: string, files: UploadFile[]): Promise<number> {
  let written = 0;

  for (const file of files) {
    const relativePath = filterRelativeUploadPath(file.originalname);
    if (!relativePath) continue;

    const targetPath = join(workspaceRoot, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    if (file.path) await copyFile(file.path, targetPath);
    else await writeFile(targetPath, file.buffer ?? Buffer.alloc(0));
    written += 1;
  }

  return written;
}

async function extractZipUploadWorkspace(workspaceRoot: string, file: UploadFile): Promise<number> {
  const zip = file.path ? new AdmZip(file.path) : new AdmZip(file.buffer ?? Buffer.alloc(0));
  let written = 0;

  for (const entry of zip.getEntries()) {
    const safeRelativePath = sanitizeZipEntryPath(entry.entryName);
    const filteredRelativePath = filterRelativeUploadPath(safeRelativePath);
    if (!filteredRelativePath) continue;
    const destinationPath = resolve(workspaceRoot, filteredRelativePath);
    if (!destinationPath.startsWith(resolve(workspaceRoot))) {
      throw new Error('Unsafe zip entry path.');
    }

    if (entry.isDirectory) {
      await mkdir(destinationPath, { recursive: true });
      continue;
    }

    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, entry.getData());
    written += 1;
  }

  return written;
}

export function runUploadedPathScan(input: UploadedPathScanInput): Promise<ScanResult> {
  return withScanSlot(() => runUploadedPathScanUnlimited(input));
}

async function runUploadedPathScanUnlimited(input: UploadedPathScanInput): Promise<ScanResult> {
  const repoName = createLocalDisplayName(input.displayName);
  const scanId = createScanId(repoName);
  const lines = [
    `$ athena scan ${repoName}`,
    `Preparing uploaded workspace ${input.workspacePath}`,
  ];

  return scanFromPath({
    scanId,
    repoName,
    repoUrl: `local://${repoName}`,
    rootPath: input.workspacePath,
    userId: input.userId,
    lines,
    emit: input.emit,
  });
}

export function runUploadScan(input: Parameters<typeof runUploadScanUnlimited>[0]): Promise<ScanResult> {
  return withScanSlot(() => runUploadScanUnlimited(input));
}

async function runUploadScanUnlimited(input: {
  mode: UploadMode;
  files: UploadFile[];
  rootName?: string;
  userId?: number | string;
  emit?: ScanEmitter;
}): Promise<ScanResult> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'athena-upload-'));

  try {
    if (input.mode === 'folder') {
      const written = await writeFolderUploadWorkspace(workspaceRoot, input.files);
      if (written === 0) {
        throw new Error('No scannable files remained after filtering ignored directories.');
      }

      return await runUploadedPathScan({
        workspacePath: workspaceRoot,
        displayName: input.rootName?.trim() || 'local-folder-upload',
        userId: input.userId,
        emit: input.emit,
          });
    }

    const zipFile = input.files[0];
    if (!zipFile || !isZipUploadFileName(zipFile.originalname)) {
      throw new Error('ZIP mode requires exactly one .zip file.');
    }

    const written = await extractZipUploadWorkspace(workspaceRoot, zipFile);
    if (written === 0) {
      throw new Error('Uploaded zip did not contain any files.');
    }

    return await runUploadedPathScan({
      workspacePath: workspaceRoot,
      displayName: input.rootName?.trim() || zipFile.originalname.replace(/\.zip$/i, ''),
      userId: input.userId,
      emit: input.emit,
      });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Clone repository, run analysis, store results, and return scan summary plus terminal lines.
 */
export function runScan(repoUrl: string, userId?: number | string, emit?: ScanEmitter): Promise<ScanResult> {
  return withScanSlot(() => runScanUnlimited(repoUrl, userId, emit));
}

async function runScanUnlimited(repoUrl: string, userId?: number | string, emit?: ScanEmitter): Promise<ScanResult> {
  const normalizedUrl = repoUrl.trim();
  const repoName = parseRepoName(normalizedUrl);
  const scanId = createScanId(repoName);
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);

  log(`$ athena scan ${normalizedUrl}`);
  log('Validating repository URL');

  const tmpDir = await mkdtemp(join(tmpdir(), `athena-${repoName}-`));

  try {
    log(`Creating sandbox ${tmpDir}`);
    emit?.status?.('clone sandbox initialized', 10);
    log('Cloning repository with --depth 1');
    emit?.status?.('cloning repository', 20);

    const git = simpleGit();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        git.clone(normalizedUrl, tmpDir, ['--depth', '1']),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Clone timed out after 120s')), SCAN_TIMEOUT_MS);
        }),
      ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
    } catch (error) {
      // A scan that fails to clone is still a finished scan: record it as FAILED, then let the router report the error.
      emit?.status?.('Scan failed', 100);
      await persistScan(userId, createEmptyScan(scanId, repoName, normalizedUrl, 'FAILED'), []).catch(() => undefined);
      throw error;
    }

    log('Clone complete.');
    return await scanFromPath({
      scanId,
      repoName,
      repoUrl: normalizedUrl,
      rootPath: tmpDir,
      userId,
      lines,
      emit,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export { MAX_UPLOAD_BYTES };

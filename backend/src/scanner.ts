import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { scanFiles } from '@athena/core';
import type { ClassifiedFinding, ScanReport } from '@athena/core';
import { simpleGit } from 'simple-git';
import { addScan } from './data.ts';
import type { Finding, ScanSummary } from './data.ts';

const SCAN_TIMEOUT_MS = 120_000;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', '__pycache__', '.venv', '__MACOSX']);
const IGNORE_FILE_NAMES = new Set(['.DS_Store']);

export type UploadMode = 'folder' | 'zip';

export interface UploadFile {
  originalname: string;
  buffer: Buffer;
  size: number;
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
  };
}

function createEmitterLog(emitter?: ScanEmitter) {
  return (text: string, kind: 'output' | 'hint' | 'error' = 'output') => {
    emitter?.line?.(text, kind);
    return text;
  };
}

/** Walk directory tree and collect source file paths. */
async function collectSourceFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.isFile() && shouldIgnoreUploadFileName(entry.name)) continue;

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
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
    topSignals: finding.explainedScore.topSignals.slice(0, 5),
  };
}

/** Map core ScanReport to API ScanSummary shape. */
function mapScanSummary(report: ScanReport, scanId: string, repoName: string, repoUrl: string): ScanSummary {
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
    const sourceFiles = await collectSourceFiles(rootPath);
    log(`Found ${sourceFiles.length} source files`);

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

    const report: ScanReport = await runScanFilesInProjectRoot(rootPath, sourceFiles);
    const allFindings = report.files.flatMap((file) => file.findings).map(mapFinding);
    const scanSummary = mapScanSummary(report, scanId, repoName, repoUrl);

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

async function runScanFilesInProjectRoot(projectRoot: string, sourceFiles: string[]): Promise<ScanReport> {
  const originalCwd = process.cwd.bind(process);
  const processWithMutableCwd = process as NodeJS.Process & { cwd: () => string };
  processWithMutableCwd.cwd = () => projectRoot;

  try {
    return await scanFiles(sourceFiles);
  } finally {
    processWithMutableCwd.cwd = originalCwd;
  }
}

async function writeFolderUploadWorkspace(workspaceRoot: string, files: UploadFile[]): Promise<number> {
  let written = 0;

  for (const file of files) {
    const relativePath = filterRelativeUploadPath(file.originalname);
    if (!relativePath) continue;

    const targetPath = join(workspaceRoot, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.buffer);
    written += 1;
  }

  return written;
}

async function extractZipUploadWorkspace(workspaceRoot: string, file: UploadFile): Promise<number> {
  const zip = new AdmZip(file.buffer);
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

export async function runUploadedPathScan(input: UploadedPathScanInput): Promise<ScanResult> {
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

export async function runUploadScan(input: {
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
export async function runScan(repoUrl: string, userId?: number | string, emit?: ScanEmitter): Promise<ScanResult> {
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
    await Promise.race([
      git.clone(normalizedUrl, tmpDir, ['--depth', '1']),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Clone timed out after 120s')), SCAN_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });

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

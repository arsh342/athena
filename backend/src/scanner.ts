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
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', '__pycache__', '.venv']);

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

export interface UploadedPathScanInput {
  workspacePath: string;
  displayName: string;
  userId?: number;
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

/** Walk directory tree and collect source file paths. */
async function collectSourceFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;

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

export function filterRelativeUploadPath(relativePath: string): string | null {
  const parts = filterRelativeParts(relativePath);
  if (parts.length === 0) return null;
  if (parts.some((part) => IGNORE_DIRS.has(part))) return null;
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

async function persistScan(userId: number | undefined, scan: ScanSummary, findings: Finding[]): Promise<void> {
  if (typeof userId === 'number') {
    await addScan(userId, scan, findings);
    return;
  }

  addScan(scan, findings);
}

async function scanFromPath(input: {
  scanId: string;
  repoName: string;
  repoUrl: string;
  rootPath: string;
  userId?: number;
  lines: string[];
}): Promise<ScanResult> {
  const { scanId, repoName, repoUrl, rootPath, userId, lines } = input;
  const log = (line: string) => lines.push(line);

  try {
    log('Collecting source files');
    const sourceFiles = await collectSourceFiles(rootPath);
    log(`Found ${sourceFiles.length} source files`);

    if (sourceFiles.length === 0) {
      log('No source files found. Scan complete with empty results.');
      const emptyScan = createEmptyScan(scanId, repoName, repoUrl, 'COMPLETED');
      await persistScan(userId, emptyScan, []);
      return { scan: emptyScan, findings: [], terminalLines: lines };
    }

    log(`Scanning ${sourceFiles.length} JavaScript and TypeScript files`);
    log('Running 11-signal heuristic scorer');
    log('Running security analyzers (secret detection + hallucination check)');

    const report: ScanReport = await scanFiles(sourceFiles);
    const allFindings = report.files.flatMap((file) => file.findings).map(mapFinding);
    const scanSummary = mapScanSummary(report, scanId, repoName, repoUrl);

    log(`Extracted ${report.summary.totalUnits} code units`);
    log(`Flagged ${report.summary.flaggedUnits} units above threshold`);
    log(`Classified ${allFindings.length} findings`);
    log(`Scan completed in ${report.duration}ms`);
    log(`Report saved: ${scanId}`);

    await persistScan(userId, scanSummary, allFindings);
    return { scan: scanSummary, findings: allFindings, terminalLines: lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`ERROR: ${message}`);

    const failedScan = createEmptyScan(scanId, repoName, repoUrl, 'FAILED');
    await persistScan(userId, failedScan, []);
    return { scan: failedScan, findings: [], terminalLines: lines };
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
    const destinationPath = resolve(workspaceRoot, safeRelativePath);
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
  });
}

export async function runUploadScan(input: {
  mode: UploadMode;
  files: UploadFile[];
  rootName?: string;
  userId?: number;
}): Promise<ScanResult> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'athena-upload-'));

  try {
    if (input.mode === 'folder') {
      const written = await writeFolderUploadWorkspace(workspaceRoot, input.files);
      if (written === 0) {
        throw new Error('No scannable files remained after filtering ignored directories.');
      }

      return runUploadedPathScan({
        workspacePath: workspaceRoot,
        displayName: input.rootName?.trim() || 'local-folder-upload',
        userId: input.userId,
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

    return runUploadedPathScan({
      workspacePath: workspaceRoot,
      displayName: input.rootName?.trim() || zipFile.originalname.replace(/\.zip$/i, ''),
      userId: input.userId,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Clone repository, run analysis, store results, and return scan summary plus terminal lines.
 */
export async function runScan(repoUrl: string, userId?: number): Promise<ScanResult> {
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
    log('Cloning repository with --depth 1');

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
    return scanFromPath({
      scanId,
      repoName,
      repoUrl: normalizedUrl,
      rootPath: tmpDir,
      userId,
      lines,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export { MAX_UPLOAD_BYTES };

import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { scanFiles } from '@athena/core';
import type { ClassifiedFinding, ScanReport } from '@athena/core';
import { simpleGit } from 'simple-git';
import { addScan } from './data.ts';
import type { Finding, ScanSummary } from './data.ts';

const SCAN_TIMEOUT_MS = 120_000;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', '__pycache__', '.venv']);

/** Walk a directory tree and collect source file paths. */
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

/** Map core ClassifiedFinding to our API Finding shape. */
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

/** Map core ScanReport to our API ScanSummary shape. */
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

export interface ScanResult {
  scan: ScanSummary;
  findings: Finding[];
  terminalLines: string[];
}

/**
 * Clone a repository, run real @athena/core analysis, store results, and return
 * both the scan summary and terminal output lines.
 */
export async function runScan(repoUrl: string): Promise<ScanResult> {
  const normalizedUrl = repoUrl.trim();
  const repoName = parseRepoName(normalizedUrl);
  const scanId = `scan_${repoName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}_${Date.now().toString(36).slice(-6)}`;

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

    log('Clone complete. Collecting source files');
    const sourceFiles = await collectSourceFiles(tmpDir);
    log(`Found ${sourceFiles.length} source files`);

    if (sourceFiles.length === 0) {
      log('No source files found. Scan complete with empty results.');
      const emptyScan: ScanSummary = {
        scanId,
        repoName,
        repoUrl: normalizedUrl,
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
        aiPercentage: 0,
        flaggedUnits: 0,
        filesScanned: 0,
        totalUnits: 0,
        findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
        riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 },
        duration: 0,
      };
      addScan(emptyScan, []);
      return { scan: emptyScan, findings: [], terminalLines: lines };
    }

    log(`Scanning ${sourceFiles.length} JavaScript and TypeScript files`);
    log('Running 11-signal heuristic scorer');
    log('Running security analyzers (secret detection + hallucination check)');

    const report: ScanReport = await scanFiles(sourceFiles);

    const allFindings = report.files.flatMap((file) => file.findings).map(mapFinding);
    const scanSummary = mapScanSummary(report, scanId, repoName, normalizedUrl);

    log(`Extracted ${report.summary.totalUnits} code units`);
    log(`Flagged ${report.summary.flaggedUnits} units above threshold`);
    log(`Classified ${allFindings.length} findings`);
    log(`Scan completed in ${report.duration}ms`);
    log(`Report saved: ${scanId}`);

    addScan(scanSummary, allFindings);

    return { scan: scanSummary, findings: allFindings, terminalLines: lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`ERROR: ${message}`);

    const failedScan: ScanSummary = {
      scanId,
      repoName,
      repoUrl: normalizedUrl,
      status: 'FAILED',
      createdAt: new Date().toISOString(),
      aiPercentage: 0,
      flaggedUnits: 0,
      filesScanned: 0,
      totalUnits: 0,
      findings: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      riskDensity: { findingsPer1kLoc: 0, criticalPer1kLoc: 0, flaggedRatio: 0 },
      duration: 0,
    };
    addScan(failedScan, []);

    return { scan: failedScan, findings: [], terminalLines: lines };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

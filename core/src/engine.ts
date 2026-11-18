import { stat } from 'node:fs/promises';
import { mergeConfig } from './config.js';
import { analyzeSecurity } from './analyzers/security-analyzer.js';
import { runSemgrep } from './analyzers/semgrep-adapter.js';
import { parseFileDetailed } from './parser/ast-parser.js';
import { generateReport } from './report/report-generator.js';
import { scoreUnit } from './scorer/heuristic-scorer.js';
import { scannerRegistry, type ScannerRegistry } from './scanner-registry.js';
import type { AthenaConfig, CheckCoverage, ExplainedScore, FileCoverage, FileReport, ScanCoverage, ScoredUnit, ScanReport, Severity } from './types.js';

export interface ScanProgressEvent {
  phase:
    | 'prepare'
    | 'files'
    | 'security-analysis'
    | 'external-scanners'
    | 'report';
  filePath: string;
  index: number;
  total: number;
  status: 'scanning' | 'scanned' | 'skipped' | 'missing';
  findings: number;
  detail?: string;
}

interface ScanHooks {
  onFileProgress?: (event: ScanProgressEvent) => void;
  onScannerStage?: (event: ScanProgressEvent) => void;
}

export interface ScanFilesOptions {
  /** Project root for external scanners. Defaults to process.cwd(). */
  root?: string;
  /** Files discovered but excluded by configuration; listed in coverage, never a gap. */
  excludedFiles?: string[];
  recordedProvenance?: boolean;
  registry?: ScannerRegistry;
}

export async function scanFiles(
  filePaths: string[],
  configInput: Partial<AthenaConfig> = {},
  hooks: ScanHooks = {},
  options: ScanFilesOptions = {},
): Promise<ScanReport> {
  const startedAt = Date.now();
  const config = mergeConfig(configInput);
  const files: FileReport[] = [];
  let totalLoc = 0;
  let skippedFiles = 0;
  const totalFiles = filePaths.length;
  let processedFiles = 0;
  const fileCoverage: FileCoverage[] = [];
  const registry = options.registry ?? scannerRegistry;

  hooks.onFileProgress?.({
    phase: 'prepare',
    filePath: '',
    index: 0,
    total: totalFiles,
    status: 'scanning',
    findings: 0,
    detail: 'discovering source files',
  });

  for (let index = 0; index < filePaths.length; index++) {
    const filePath = filePaths[index];
    hooks.onFileProgress?.({
      phase: 'files',
      filePath,
      index: index + 1,
      total: totalFiles,
      status: 'scanning',
      findings: 0,
      detail: 'parse + score + local checks',
    });

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) {
      fileCoverage.push({ path: filePath, status: 'missing', reason: 'file not found' });
      processedFiles += 1;
      hooks.onFileProgress?.({
        phase: 'files',
        filePath,
        index: processedFiles,
        total: totalFiles,
        status: 'missing',
        findings: 0,
      });
      continue;
    }

    if (fileStat.size > config.maxFileSize) {
      skippedFiles += 1;
      fileCoverage.push({ path: filePath, status: 'skipped-size', reason: `larger than ${config.maxFileSize} bytes` });
      processedFiles += 1;
      hooks.onFileProgress?.({
        phase: 'files',
        filePath,
        index: processedFiles,
        total: totalFiles,
        status: 'skipped',
        findings: 0,
        detail: 'skipped oversized file',
      });
      continue;
    }

    hooks.onFileProgress?.({
      phase: 'security-analysis',
      filePath,
      index: index + 1,
      total: totalFiles,
      status: 'scanning',
      findings: 0,
      detail: 'running secret + hallucination analyzers',
    });

    const { units, error: parseError } = await parseFileDetailed(filePath);
    fileCoverage.push(parseError
      ? { path: filePath, status: 'parse-failed', reason: parseError }
      : { path: filePath, status: 'analyzed' });
    const scoredUnits = units.map((unit) => scoreUnit(unit, config));
    const findings = scoredUnits.flatMap((scored) => analyzeSecurity(scored, config));
    totalLoc += units.reduce((sum, unit) => sum + unit.metadata.loc, 0);

    files.push({
      path: filePath,
      units: scoredUnits,
      findings,
    });

    processedFiles += 1;
    hooks.onFileProgress?.({
      phase: 'files',
      filePath,
      index: processedFiles,
      total: totalFiles,
      status: 'scanned',
      findings: findings.length,
      detail: 'file complete',
    });
  }

  // Run external scanners using the scanner registry
  const projectRoot = options.root ?? process.cwd();
  const scannerOutcome = new Map<string, CheckCoverage['status']>();
  const trackStage: ScanHooks['onScannerStage'] = (event) => {
    const detail = event.detail ?? '';
    const unavailable = detail.match(/^(\S+) unavailable$/);
    const complete = detail.match(/^(\S+) complete$/);
    const failed = detail.match(/^(\S+) failed$/);
    if (unavailable) scannerOutcome.set(unavailable[1], 'unavailable');
    else if (complete) scannerOutcome.set(complete[1], 'ran');
    else if (failed) scannerOutcome.set(failed[1], 'failed');
    hooks.onScannerStage?.(event);
  };
  hooks.onScannerStage?.({
    phase: 'external-scanners',
    filePath: '',
    index: processedFiles,
    total: totalFiles,
    status: 'scanning',
    findings: 0,
    detail: 'starting external scanners',
  });
  const externalFindings = await registry.runEnabledScanners(filePaths, projectRoot, config, trackStage);

  // Merge external findings into file reports
  if (externalFindings.length > 0) {
    const reportsByPath = new Map(files.map((file) => [file.path, file]));

    for (const finding of externalFindings) {
      const existing = reportsByPath.get(finding.file);
      const unitContext = selectUnitForLine(existing?.units ?? [], finding.line);

      const mappedFinding = {
        id: finding.id,
        severity: finding.severity as Severity,
        type: finding.type,
        category: finding.category,
        message: finding.message,
        file: finding.file,
        line: finding.line,
        column: finding.column,
        code: finding.code,
        aiScore: unitContext?.score ?? config.threshold,
        explainedScore: unitContext?.explained ?? emptyExplainedScore(),
        source: finding.source,
        ruleId: finding.ruleId,
      };

      if (existing) {
        existing.findings.push(mappedFinding);
      } else {
        const newReport: FileReport = {
          path: finding.file,
          units: [],
          findings: [mappedFinding],
        };
        files.push(newReport);
        reportsByPath.set(finding.file, newReport);
      }
    }
  }

  hooks.onScannerStage?.({
    phase: 'report',
    filePath: '',
    index: processedFiles,
    total: totalFiles,
    status: 'scanning',
    findings: externalFindings.length,
    detail: 'assembling final report',
  });

  for (const excluded of options.excludedFiles ?? []) {
    fileCoverage.push({ path: excluded, status: 'skipped-excluded', reason: 'excluded by configuration' });
  }
  const coverage = buildCoverage(fileCoverage, config, registry, scannerOutcome);

  return generateReport(startedAt, files, totalLoc, skippedFiles, config, coverage);
}

function buildCoverage(
  files: FileCoverage[],
  config: AthenaConfig,
  registry: ScannerRegistry,
  scannerOutcome: Map<string, CheckCoverage['status']>,
): ScanCoverage {
  const checks: CheckCoverage[] = [
    { name: 'secrets', status: config.secretDetection ? 'ran' : 'disabled' },
    { name: 'hallucination', status: config.hallucinationDetection ? 'ran' : 'disabled' },
    { name: 'ai-provenance', status: 'ran', detail: 'heuristic' },
    { name: 'recorded-provenance', status: 'disabled' },
  ];
  for (const scanner of registry.getAllScanners()) {
    const scannerConfig = config[scanner.name as keyof AthenaConfig] as { enabled?: boolean } | undefined;
    if (!scannerConfig || typeof scannerConfig !== 'object' || !scannerConfig.enabled) {
      checks.push({ name: scanner.name, status: 'disabled' });
    } else {
      checks.push({ name: scanner.name, status: scannerOutcome.get(scanner.name) ?? 'failed' });
    }
  }

  const count = (status: FileCoverage['status']) => files.filter((f) => f.status === status).length;
  const gaps: string[] = [];
  if (count('parse-failed') > 0) gaps.push(`${count('parse-failed')} file(s) not parsed`);
  if (count('skipped-size') > 0) gaps.push(`${count('skipped-size')} file(s) skipped: larger than ${config.maxFileSize} bytes`);
  if (count('missing') > 0) gaps.push(`${count('missing')} file(s) missing`);
  for (const check of checks) {
    if (check.status === 'unavailable') gaps.push(`${check.name} unavailable`);
  }
  for (const check of checks) {
    if (check.status === 'failed') gaps.push(`${check.name} failed`);
  }

  return { files, checks, complete: gaps.length === 0, gaps };
}

function selectUnitForLine(units: ScoredUnit[], line: number): ScoredUnit | null {
  for (const unit of units) {
    if (line >= unit.unit.startLine && line <= unit.unit.endLine) return unit;
  }
  return null;
}

function emptyExplainedScore(): ExplainedScore {
  return {
    score: 0,
    band: 'LOW',
    signalsTriggered: 0,
    variance: 0,
    topSignals: [],
  };
}

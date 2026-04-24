import { stat } from 'node:fs/promises';
import { mergeConfig } from './config.js';
import { analyzeSecurity } from './analyzers/security-analyzer.js';
import { runSemgrep } from './analyzers/semgrep-adapter.js';
import { parseFile } from './parser/ast-parser.js';
import { generateReport } from './report/report-generator.js';
import { scoreUnit } from './scorer/heuristic-scorer.js';
import { scannerRegistry } from './scanner-registry.js';
import type { AthenaConfig, ExplainedScore, FileReport, ScoredUnit, ScanReport, Severity } from './types.js';

export interface ScanProgressEvent {
  filePath: string;
  index: number;
  total: number;
  status: 'scanning' | 'scanned' | 'skipped' | 'missing';
  findings: number;
}

interface ScanHooks {
  onFileProgress?: (event: ScanProgressEvent) => void;
}

export async function scanFiles(
  filePaths: string[],
  configInput: Partial<AthenaConfig> = {},
  hooks: ScanHooks = {},
): Promise<ScanReport> {
  const startedAt = Date.now();
  const config = mergeConfig(configInput);
  const files: FileReport[] = [];
  let totalLoc = 0;
  let skippedFiles = 0;
  const totalFiles = filePaths.length;
  let processedFiles = 0;

  for (let index = 0; index < filePaths.length; index++) {
    const filePath = filePaths[index];
    hooks.onFileProgress?.({
      filePath,
      index: index + 1,
      total: totalFiles,
      status: 'scanning',
      findings: 0,
    });

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) {
      processedFiles += 1;
      hooks.onFileProgress?.({
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
      processedFiles += 1;
      hooks.onFileProgress?.({
        filePath,
        index: processedFiles,
        total: totalFiles,
        status: 'skipped',
        findings: 0,
      });
      continue;
    }

    const units = await parseFile(filePath).catch(() => []);
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
      filePath,
      index: processedFiles,
      total: totalFiles,
      status: 'scanned',
      findings: findings.length,
    });
  }

  // Run external scanners using the scanner registry
  const projectRoot = process.cwd();
  const externalFindings = await scannerRegistry.runEnabledScanners(filePaths, projectRoot, config);

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

  return generateReport(startedAt, files, totalLoc, skippedFiles, config);
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

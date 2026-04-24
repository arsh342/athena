import type { AthenaConfig, ClassifiedFinding, FileReport, ScanReport, ScoredUnit, Severity } from '../types.js';

const severityOrder: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function generateReport(
  startedAt: number,
  files: FileReport[],
  totalLoc: number,
  skippedFiles: number,
  config: AthenaConfig,
): ScanReport {
  const units = files.flatMap((file) => file.units);
  const findings = files.flatMap((file) => file.findings);
  const severityCounts = severityOrder.reduce<Record<Severity, number>>(
    (acc, severity) => ({ ...acc, [severity]: findings.filter((finding) => finding.severity === severity).length }),
    { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  );
  const confidenceBands = {
    LOW: countBand(units, 'LOW'),
    UNCERTAIN: countBand(units, 'UNCERTAIN'),
    HIGH: countBand(units, 'HIGH'),
  };
  const flaggedUnits = units.filter((unit) => unit.flagged).length;
  const aiScore = Math.round(units.reduce((sum, unit) => sum + unit.score, 0) / Math.max(1, units.length));
  const blocked = findings.some((finding) => config.blockOn.includes(finding.severity));
  const riskDensity = {
    criticalPer1kLoc: roundPerK(severityCounts.CRITICAL, totalLoc),
    findingsPer1kLoc: roundPerK(findings.length, totalLoc),
    flaggedRatio: flaggedUnits / Math.max(1, units.length),
  };
  const aiOrigin = {
    score: aiScore,
    flaggedUnits,
    flagRatio: flaggedUnits / Math.max(1, units.length),
    percentage: Math.round((flaggedUnits / Math.max(1, units.length)) * 100),
    confidenceBands,
  };
  const weightedContributions = summarizeWeightedContributions(units);

  return {
    timestamp: new Date().toISOString(),
    duration: Date.now() - startedAt,
    summary: {
      filesScanned: files.length,
      skippedFiles,
      totalUnits: units.length,
      flaggedUnits,
      findings: severityCounts,
      blocked,
      aiScore,
      aiFlagRatio: aiOrigin.flagRatio,
      aiPercentage: aiOrigin.percentage,
      riskDensity,
      confidenceBands,
      aiOrigin,
      security: {
        findings: severityCounts,
        blocked,
        riskDensity,
      },
      weightedContributions,
      calibration: {
        thresholdUsed: config.threshold,
        source: 'default',
      },
    },
    files,
  };
}

function countBand(units: ScoredUnit[], band: 'LOW' | 'UNCERTAIN' | 'HIGH'): number {
  return units.filter((unit) => unit.explained.band === band).length;
}

function roundPerK(count: number, loc: number): number {
  return Math.round((count / Math.max(1, loc)) * 1000 * 10) / 10;
}

function summarizeWeightedContributions(units: ScoredUnit[]): Array<{
  signal: string;
  contribution: number;
  score: number;
  maxWeight: number;
}> {
  const totals = new Map<string, { score: number; maxWeight: number }>();

  for (const unit of units) {
    for (const signal of unit.signals) {
      const existing = totals.get(signal.signal) ?? { score: 0, maxWeight: 0 };
      existing.score += signal.score;
      existing.maxWeight += signal.maxWeight;
      totals.set(signal.signal, existing);
    }
  }

  const totalScore = Array.from(totals.values()).reduce((sum, item) => sum + item.score, 0);
  return Array.from(totals.entries())
    .map(([signal, values]) => ({
      signal,
      contribution: totalScore === 0 ? 0 : Math.round((values.score / totalScore) * 100),
      score: values.score,
      maxWeight: values.maxWeight,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export function formatJsonl(report: ScanReport): string {
  return report.files
    .flatMap((file) => file.findings)
    .map((finding: ClassifiedFinding) => JSON.stringify(finding))
    .join('\n');
}

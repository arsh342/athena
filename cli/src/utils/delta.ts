import type { ScanDelta, ScanReport, Severity } from '@athena/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

export interface FindingSnapshot {
  id: string;
  severity: Severity;
  folder: string;
}

export interface ScanSnapshot {
  timestamp: string;
  targetKey: string;
  riskScore: number;
  findings: FindingSnapshot[];
  folderRisk: Record<string, number>;
}

const ATHENA_DIR = join(homedir(), '.athena');
const SNAPSHOT_PATH = join(ATHENA_DIR, 'scan-snapshots.json');
const severityWeights: Record<Severity, number> = {
  CRITICAL: 8,
  HIGH: 5,
  MEDIUM: 2,
  LOW: 1,
};
const emptySeverityCounts: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
};

export async function attachScanDelta(report: ScanReport, targetKey: string, projectRoot: string): Promise<ScanReport> {
  try {
    const snapshots = await readSnapshots();
    const previous = snapshots[targetKey];
    const current = createSnapshot(report, targetKey, projectRoot);

    report.summary.delta = computeDelta(current, previous);

    snapshots[targetKey] = current;
    await writeSnapshots(snapshots);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[athena-cli] Failed to compute scan delta: ${message}`);
  }

  return report;
}

export function createSnapshot(report: ScanReport, targetKey: string, projectRoot: string): ScanSnapshot {
  const findings = report.files.flatMap((file) =>
    file.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      folder: folderForPath(finding.file, projectRoot),
    })),
  );
  const folderRisk: Record<string, number> = {};

  for (const finding of findings) {
    folderRisk[finding.folder] = (folderRisk[finding.folder] ?? 0) + severityWeights[finding.severity];
  }

  return {
    timestamp: report.timestamp,
    targetKey,
    riskScore: findings.reduce((sum, finding) => sum + severityWeights[finding.severity], 0),
    findings,
    folderRisk,
  };
}

export function computeDelta(current: ScanSnapshot, previous?: ScanSnapshot): ScanDelta {
  if (!previous) {
    return {
      baseline: true,
      riskScore: {
        current: current.riskScore,
        previous: 0,
        change: current.riskScore,
      },
      findings: {
        current: current.findings.length,
        previous: 0,
        change: current.findings.length,
        new: current.findings.length,
        resolved: 0,
        newBySeverity: countBySeverity(current.findings),
        resolvedBySeverity: { ...emptySeverityCounts },
      },
      folders: topFolderDeltas(current.folderRisk, {}),
      regressionAlert: false,
    };
  }

  const previousById = new Map(previous.findings.map((finding) => [finding.id, finding]));
  const currentById = new Map(current.findings.map((finding) => [finding.id, finding]));
  const newFindings = current.findings.filter((finding) => !previousById.has(finding.id));
  const resolvedFindings = previous.findings.filter((finding) => !currentById.has(finding.id));
  const riskChange = current.riskScore - previous.riskScore;

  return {
    baseline: false,
    previousTimestamp: previous.timestamp,
    riskScore: {
      current: current.riskScore,
      previous: previous.riskScore,
      change: riskChange,
    },
    findings: {
      current: current.findings.length,
      previous: previous.findings.length,
      change: current.findings.length - previous.findings.length,
      new: newFindings.length,
      resolved: resolvedFindings.length,
      newBySeverity: countBySeverity(newFindings),
      resolvedBySeverity: countBySeverity(resolvedFindings),
    },
    folders: topFolderDeltas(current.folderRisk, previous.folderRisk),
    regressionAlert: riskChange >= 5 || countBySeverity(newFindings).CRITICAL > 0,
  };
}

function countBySeverity(findings: FindingSnapshot[]): Record<Severity, number> {
  return findings.reduce<Record<Severity, number>>(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { ...emptySeverityCounts },
  );
}

function topFolderDeltas(current: Record<string, number>, previous: Record<string, number>): ScanDelta['folders'] {
  const folders = new Set([...Object.keys(current), ...Object.keys(previous)]);

  return Array.from(folders)
    .map((folder) => {
      const currentRisk = current[folder] ?? 0;
      const previousRisk = previous[folder] ?? 0;
      return {
        folder,
        currentRisk,
        previousRisk,
        change: currentRisk - previousRisk,
      };
    })
    .filter((folder) => folder.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 3);
}

async function readSnapshots(): Promise<Record<string, ScanSnapshot>> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')) as Record<string, ScanSnapshot>;
  } catch {
    return {};
  }
}

async function writeSnapshots(snapshots: Record<string, ScanSnapshot>): Promise<void> {
  await mkdir(ATHENA_DIR, { recursive: true });
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshots, null, 2)}\n`, 'utf8');
}

function folderForPath(filePath: string, projectRoot: string): string {
  const path = (isAbsolute(filePath) ? relative(projectRoot, filePath) : filePath).split('\\').join('/');
  const folder = dirname(path).split('\\').join('/');
  return folder === '.' ? '<root>' : folder.split('/')[0] ?? '<root>';
}

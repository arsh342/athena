import { relative } from 'node:path';

import type { AthenaConfig, ClassifiedFinding, ScanReport, Severity } from '../types.js';
import { isChangedLine, type ChangeSet, type ChangedFile } from './changes.js';

export interface ReviewInfo {
  scope: string;
  /** Files whose changes were not analysed because they are binary. */
  skippedBinary: string[];
  renamed: Array<{ from: string; to: string }>;
  deleted: string[];
  /** Real findings in code the change touched but did not introduce (not counted, not blocking). */
  existing: ClassifiedFinding[];
}

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/**
 * Keep only what this change introduced: findings on changed lines. Findings elsewhere inside a changed function are
 * reported separately as existing issues. Everything else is dropped. Counts and the gate are recomputed.
 */
export function applyChangeFilter(report: ScanReport, changes: ChangeSet, root: string, config: Pick<AthenaConfig, 'blockOn' | 'updates'>, scope: string): ReviewInfo {
  const byPath = new Map<string, ChangedFile>();
  for (const f of changes.files) byPath.set(f.path, f);
  const rel = (p: string): string => relative(root, p).split('\\').join('/');
  const existing: ClassifiedFinding[] = [];

  for (const file of report.files) {
    const changed = byPath.get(rel(file.path));
    const kept: ClassifiedFinding[] = [];
    for (const finding of file.findings) {
      if (!changed) continue;
      if (isChangedLine(changed, finding.line)) {
        kept.push(finding);
        continue;
      }
      const unit = file.units.find((u) => u.unit.startLine <= finding.line && finding.line <= u.unit.endLine);
      if (unit && finding.source !== 'athena-deps' && changed.ranges.some(([a, b]) => a <= unit.unit.endLine && b >= unit.unit.startLine)) existing.push(finding);
    }
    file.findings = kept;
  }
  report.files = report.files.filter((f) => f.findings.length > 0 || f.units.length > 0);

  recomputeGate(report, config);

  const info: ReviewInfo = {
    scope,
    skippedBinary: changes.files.filter((f) => f.binary && f.status !== 'deleted').map((f) => f.path),
    renamed: changes.files.filter((f) => f.status === 'renamed' && f.oldPath).map((f) => ({ from: f.oldPath!, to: f.path })),
    deleted: changes.files.filter((f) => f.status === 'deleted').map((f) => f.path),
    existing,
  };
  return info;
}

/** Recompute the severity counts, the needs-review count and the gate after findings were added, removed or re-graded. */
export function recomputeGate(report: ScanReport, config: Pick<AthenaConfig, 'blockOn' | 'updates'>): void {
  const all = report.files.flatMap((f) => f.findings);
  const counted = all.filter((f) => f.confidence !== 'low');
  report.summary.findings = Object.fromEntries(SEVERITIES.map((s) => [s, counted.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const needsReview = all.length - counted.length;
  if (needsReview > 0) report.summary.needsReview = needsReview;
  else delete report.summary.needsReview;
  const blockKev = config.updates?.blockKnownExploited !== false;
  report.summary.blocked = counted.some((f) => config.blockOn.includes(f.severity) || (blockKev && f.kev === true));
}

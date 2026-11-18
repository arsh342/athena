import type { ScanSummary } from '../types';

/** "recorded 18% · estimated 35–44%": recorded is a floor, estimated is a range. */
export function formatProvenance(scan: ScanSummary): string {
  const p = scan.aiProvenance;
  if (!p) return 'not measured';
  if (p.totalLines === 0) return 'no code lines measured';
  const pct = (lines: number) => Math.round((100 * lines) / p.totalLines);
  const recorded = p.recorded.available ? `${pct(p.recorded.lines)}%` : 'n/a';
  const e = p.estimated;
  return `recorded ${recorded} · estimated ${pct(e.aiLines)}–${pct(e.aiLines + e.mixedLines)}%`;
}

/** Why a scan is incomplete; empty when complete or not recorded. */
export function coverageGaps(scan: ScanSummary): string[] {
  const coverage = scan.coverage;
  return coverage && !coverage.complete ? coverage.gaps : [];
}

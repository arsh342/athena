import type { ScanReport } from '@athena/core';

export const EXIT = { PASS: 0, BLOCKED: 1, ERROR: 2, INCOMPLETE: 3 } as const;

/** Blocked beats incomplete; incomplete only fails with --strict. */
export function exitCodeFor(report: ScanReport, strict: boolean): 0 | 1 | 3 {
  if (report.summary.blocked) return EXIT.BLOCKED;
  if (strict && report.summary.coverage && !report.summary.coverage.complete) return EXIT.INCOMPLETE;
  return EXIT.PASS;
}

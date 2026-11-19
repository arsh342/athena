export type Verdict = 'failed' | 'blocked' | 'pass' | 'pass (incomplete)';

interface VerdictInput {
  status?: string;
  findings: { CRITICAL?: number; HIGH?: number };
  coverage?: { complete: boolean } | null;
}

/** The gate line of a finished scan. A scan that did not complete can never be reported as passing. */
export function scanVerdict(scan: VerdictInput): Verdict {
  if (scan.status === 'FAILED') return 'failed';
  if ((scan.findings.CRITICAL ?? 0) > 0 || (scan.findings.HIGH ?? 0) > 0) return 'blocked';
  return scan.coverage && !scan.coverage.complete ? 'pass (incomplete)' : 'pass';
}

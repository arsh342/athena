import type { ScanSummary } from '../types';

export function getDashboardEmptyState(scans: ScanSummary[]) {
  return { isEmpty: scans.length === 0 };
}

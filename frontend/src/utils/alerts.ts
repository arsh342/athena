export interface RepoAlerts {
  scanId: string;
  repoName: string;
  repoUrl: string;
  count: number;
  alerts: Array<{ advisoryId: string; package: string; version: string; severity: string; summary: string; fixedIn: string | null }>;
}

/** "3 new vulnerabilities affect <repo> since your last scan" */
export function alertHeadline(repo: Pick<RepoAlerts, 'repoName' | 'count'>): string {
  return `${repo.count} new vulnerabilit${repo.count === 1 ? 'y affects' : 'ies affect'} ${repo.repoName} since your last scan`;
}

/** Link that opens the scan page with the repository prefilled, for a one-click re-scan. */
export function rescanPath(repo: Pick<RepoAlerts, 'repoUrl'>): string {
  return `/scan?repo=${encodeURIComponent(repo.repoUrl)}`;
}

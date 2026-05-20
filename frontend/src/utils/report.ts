import type { Finding, Severity } from '../types';

type GroupedFindings = Record<Severity, Record<string, Finding[]>>;

/**
 * Strip temp workspace prefix from absolute file paths for display.
 * Turns `/var/folders/.../athena-upload-xxx/test/app/secrets.ts` into `test/app/secrets.ts`.
 */
export function shortenPath(filePath: string): string {
  const cleaned = filePath.replace(
    /^.*\/athena-(?:upload|[a-z0-9_-]+)-[A-Za-z0-9]+\//,
    '',
  );
  return cleaned || filePath;
}

export function isSecretFinding(finding: Finding): boolean {
  const haystack = `${finding.type} ${finding.message}`.toLowerCase();
  return finding.source === 'secret-detector'
    || /secret|token|password|key|credential|jwt/.test(haystack);
}

export function redactFindingText(value: string, finding: Finding): string {
  if (!isSecretFinding(finding)) return value;
  return value.replace(
    /(['"][^'"]{4,}['"]|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9._-]{10,})/g,
    '[REDACTED]',
  );
}

export function groupFindings(findings: Finding[]): GroupedFindings {
  const seen = new Set<string>();
  return findings.reduce<GroupedFindings>((acc, finding) => {
    const key = finding.ruleId?.trim()
      ? `${finding.ruleId}:${finding.file}:${finding.line}`
      : `${finding.type}:${finding.message}:${finding.file}:${finding.line}`;
    if (seen.has(key)) return acc;
    seen.add(key);
    acc[finding.severity] = acc[finding.severity] ?? {};
    acc[finding.severity][finding.file] = acc[finding.severity][finding.file] ?? [];
    acc[finding.severity][finding.file].push(finding);
    return acc;
  }, { CRITICAL: {}, HIGH: {}, MEDIUM: {}, LOW: {} });
}

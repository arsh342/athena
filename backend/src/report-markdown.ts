import type { Finding, ScanSummary } from './data.ts';

type DedupeKey = string;

/**
 * Strip the temp workspace prefix from absolute file paths.
 * Turns `/var/folders/.../athena-upload-xxx/test/app/secrets.ts` into `test/app/secrets.ts`.
 */
function shortenPath(filePath: string): string {
  // Match common temp-dir prefixes used by upload scans and git clone scans
  const cleaned = filePath.replace(
    /^.*\/athena-(?:upload|[a-z0-9_-]+)-[A-Za-z0-9]+\//,
    '',
  );
  return cleaned || filePath;
}

function isSecretFinding(finding: Finding): boolean {
  const haystack = `${finding.type} ${finding.message}`.toLowerCase();
  return finding.source === 'secret-detector'
    || /secret|token|password|key|credential|jwt/.test(haystack);
}

function redactText(value: string, shouldRedact: boolean): string {
  if (!shouldRedact) return value;
  return value.replace(
    /(['"][^'"]{4,}['"]|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9._-]{10,})/g,
    '[REDACTED]',
  );
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<DedupeKey>();
  const output: Finding[] = [];
  for (const finding of findings) {
    const ruleKey = finding.ruleId?.trim()
      ? `${finding.ruleId}:${finding.file}:${finding.line}`
      : `${finding.type}:${finding.message}:${finding.file}:${finding.line}`;
    if (seen.has(ruleKey)) continue;
    seen.add(ruleKey);
    output.push(finding);
  }
  return output;
}

function describeProvenance(scan: ScanSummary): string {
  const p = scan.aiProvenance;
  if (!p) return 'not measured';
  const pct = (lines: number) => Math.round((100 * lines) / Math.max(1, p.totalLines));
  const recorded = p.recorded.available ? `recorded ${pct(p.recorded.lines)}% (floor)` : `recorded n/a (${p.recorded.reason ?? 'unavailable'})`;
  const e = p.estimated;
  return `${recorded} · estimated ${pct(e.aiLines)}–${pct(e.aiLines + e.mixedLines)}% (heuristic, low confidence)`;
}

function describeCoverage(scan: ScanSummary): string {
  if (!scan.coverage) return 'not recorded';
  return scan.coverage.complete ? 'complete' : `incomplete — ${scan.coverage.gaps.join('; ')}`;
}

/** Generate redacted markdown snapshot for a scan report. */
export function generateReportMarkdown(scan: ScanSummary, findings: Finding[]): string {
  const deduped = dedupeFindings(findings);
  const grouped = deduped.reduce<Record<string, Record<string, Finding[]>>>((acc, finding) => {
    acc[finding.severity] = acc[finding.severity] ?? {};
    acc[finding.severity][finding.file] = acc[finding.severity][finding.file] ?? [];
    acc[finding.severity][finding.file].push(finding);
    return acc;
  }, {});

  const header = `# Scan Report: ${scan.repoName}\n`
    + `- Scan ID: ${scan.scanId}\n`
    + `- Repo URL: ${scan.repoUrl}\n`
    + `- Created: ${scan.createdAt}\n\n`
    + `## Summary\n`
    + `- AI provenance: ${describeProvenance(scan)}\n`
    + `- Coverage: ${describeCoverage(scan)}\n`
    + `- Findings: ${findings.length}\n`
    + `- Risk density: ${scan.riskDensity.findingsPer1kLoc}\n`
    + `- Flagged ratio: ${Math.round(scan.riskDensity.flaggedRatio * 100)}%\n\n`
    + `## Findings\n`;

  const sections = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    .map((severity) => {
      const files = grouped[severity];
      if (!files) return '';
      const fileBlocks = Object.keys(files).sort().map((file) => {
        const shortFile = shortenPath(file);
        const items = files[file] ?? [];
        const lines = items.map((finding) => {
          const redact = isSecretFinding(finding);
          const message = redactText(finding.message, redact);
          const code = redactText(finding.code, redact);
          const shortLoc = shortenPath(finding.file);
          return `- **${finding.type}**: ${message}\n  - Source: ${finding.source}\n  - AI score: ${finding.aiScore}\n  - Location: ${shortLoc}:${finding.line}\n  - Code:\n\n\`\`\`\n${code}\n\`\`\`\n`;
        }).join('\n');
        return `#### ${shortFile}\n${lines}`;
      }).join('\n');
      return `### ${severity}\n${fileBlocks}`;
    })
    .filter(Boolean)
    .join('\n');

  return `${header}${sections}\n`;
}

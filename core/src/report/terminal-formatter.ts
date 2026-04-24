import type { ScanReport, Severity } from '../types.js';

interface TerminalReportOptions {
  maxFindings?: number;
  codePreviewLines?: number;
}

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  orange: '\x1b[38;5;208m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

const severityColor: Record<Severity, string> = {
  CRITICAL: c.red,
  HIGH: c.orange,
  MEDIUM: c.yellow,
  LOW: c.gray,
};

/**
 * Format a ScanReport as a styled ANSI terminal string.
 * Includes section rules, metric rows, severity bar, and finding cards.
 */
export function formatTerminalReport(report: ScanReport, options: TerminalReportOptions = {}): string {
  const lines: string[] = [];
  const summary = report.summary;
  const maxFindings = Number.isFinite(options.maxFindings) ? Math.max(0, options.maxFindings ?? 0) : Number.POSITIVE_INFINITY;
  const codePreviewLines = Math.max(1, options.codePreviewLines ?? 8);
  const securityFindingsTotal = Object.values(summary.findings).reduce((sum, count) => sum + count, 0);
  const thresholdUsed = summary.calibration?.thresholdUsed;
  const aiScoreRelation =
    typeof thresholdUsed === 'number'
      ? summary.aiScore === thresholdUsed
        ? 'at threshold'
        : summary.aiScore < thresholdUsed
          ? 'below threshold'
          : 'above threshold'
      : 'threshold unavailable';
  const gateReason = summary.blocked
    ? securityFindingsTotal > 0
      ? 'blocked (security findings matched block policy)'
      : `blocked (ai score ${aiScoreRelation})`
    : securityFindingsTotal === 0
      ? `pass (no security findings, ai score ${aiScoreRelation})`
      : `pass (security findings present but below block policy, ai score ${aiScoreRelation})`;

  // ── Title ──
  lines.push('');
  lines.push(sectionRule('Athena Report'));
  lines.push('');

  // ── Metrics ──
  lines.push(metricLine([
    ['files', String(summary.filesScanned)],
    ['units', String(summary.totalUnits)],
    ['ai-flagged units', String(summary.flaggedUnits)],
    ['duration', `${report.duration}ms`],
  ]));
  lines.push(metricLine([
    ['AI score', `${summary.aiScore}/100`],
    ['AI%', `${summary.aiPercentage}%`],
    ['risk', `${summary.riskDensity.findingsPer1kLoc}/1k LOC`],
    ['gate', summary.blocked ? `${c.red}blocked${c.reset}` : `${c.green}pass${c.reset}`],
  ]));
  lines.push(`  ${c.dim}gate reason${c.reset} ${c.white}${gateReason}${c.reset}`);
  lines.push('');

  // ── AI-Origin Confidence (separate block) ──
  if (summary.aiOrigin) {
    lines.push(`  ${c.bold}AI-Origin Confidence${c.reset}`);
    lines.push(metricLine([
      ['score', `${summary.aiOrigin.score}/100`],
      ['flagged units', String(summary.aiOrigin.flaggedUnits)],
      ['ratio', `${Math.round(summary.aiOrigin.flagRatio * 100)}%`],
      ['threshold', String(summary.calibration?.thresholdUsed ?? 'n/a')],
    ]));
    lines.push('');
  }

  // ── Weighted signal contributions ──
  if (summary.weightedContributions && summary.weightedContributions.length > 0) {
    lines.push(`  ${c.bold}Top Weighted Signals${c.reset}`);
    lines.push(`  ${summary.weightedContributions
      .slice(0, 4)
      .map((item) => `${c.dim}${item.signal}${c.reset} ${c.orange}${item.contribution}%${c.reset}`)
      .join('   ')}`);
    lines.push('');
  }

  // ── Security summary (separate block) ──
  if (summary.security) {
    lines.push(`  ${c.bold}Security Findings${c.reset}`);
    lines.push(metricLine([
      ['critical', String(summary.security.findings.CRITICAL)],
      ['high', String(summary.security.findings.HIGH)],
      ['medium', String(summary.security.findings.MEDIUM)],
      ['low', String(summary.security.findings.LOW)],
    ]));
    lines.push('');
  }

  // ── Severity ──
  lines.push(`  ${c.bold}Severity${c.reset}`);
  lines.push(`  ${severityBar(report)}`);
  lines.push('');

  // ── Confidence bands ──
  const bands = summary.confidenceBands;
  lines.push(metricLine([
    ['LOW', String(bands.LOW)],
    ['UNCERTAIN', String(bands.UNCERTAIN)],
    ['HIGH', String(bands.HIGH)],
  ]));
  lines.push('');

  // ── Findings ──
  const findings = report.files.flatMap((file) => file.findings);
  if (findings.length === 0) {
    lines.push(`  ${c.green}✓${c.reset} No findings. Clean scan.`);
    lines.push('');
    return lines.join('\n');
  }

  lines.push(sectionRule('Findings'));
  lines.push('');

  const shownFindings = findings.slice(0, maxFindings);
  for (const finding of shownFindings) {
    const sevColor = severityColor[finding.severity];
    lines.push(`  ${sevColor}● ${finding.severity}${c.reset}  ${c.bold}${finding.type}${c.reset}  ${c.dim}${finding.id}${c.reset}`);
    lines.push(`    ${c.orange}${finding.file}:${finding.line}${c.reset}  ${c.dim}source=${finding.source}${c.reset}  ${c.dim}ai=${finding.aiScore}${c.reset}`);
    lines.push(`    ${c.dim}${finding.message}${c.reset}`);

    const snippet = formatCodeSnippet(finding.code, codePreviewLines);
    if (snippet.length > 0) {
      lines.push(`    ${c.dim}code:${c.reset}`);
      for (const line of snippet) {
        lines.push(`      ${c.white}${line}${c.reset}`);
      }
    }

    if (finding.explainedScore.topSignals.length > 0) {
      const signals = finding.explainedScore.topSignals
        .map((s) => `${s.signal}:${c.orange}${s.contribution}%${c.reset}`)
        .join('  ');
      lines.push(`    ${c.dim}signals:${c.reset} ${signals}`);
    }

    lines.push('');
  }

  if (findings.length > shownFindings.length) {
    lines.push(`  ${c.dim}… ${findings.length - shownFindings.length} more findings omitted${c.reset}`);
    lines.push(`  ${c.dim}tip: rerun with --max-findings all to print every finding${c.reset}`);
    lines.push('');
  }

  return lines.join('\n');
}

/** Inline section rule with title: ── Title ──────────── */
function sectionRule(title: string): string {
  const ruleWidth = Math.max(48, title.length + 10);
  const dashCount = ruleWidth - title.length - 5;
  return `  ${c.orange}──${c.reset} ${c.bold}${title}${c.reset} ${c.orange}${'─'.repeat(dashCount)}${c.reset}`;
}

/** Row of label:value pairs with dim labels and bright values. */
function metricLine(metrics: [string, string][]): string {
  return '  ' + metrics
    .map(([label, value]) => `${c.dim}${label}${c.reset} ${c.white}${value}${c.reset}`)
    .join('   ');
}

/** Visual severity distribution bar, only showing non-zero counts. */
function severityBar(report: ScanReport): string {
  const total = Object.values(report.summary.findings).reduce((sum, count) => sum + count, 0);
  if (total === 0) return `${c.green}████████████${c.reset} ${c.dim}clean${c.reset}`;

  return (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[])
    .filter((severity) => report.summary.findings[severity] > 0)
    .map((severity) => {
      const count = report.summary.findings[severity];
      const width = Math.max(2, Math.round((count / total) * 16));
      return `${severityColor[severity]}${'█'.repeat(width)}${c.reset} ${severity}:${count}`;
    })
    .join('  ');
}

function formatCodeSnippet(code: string, maxLines: number): string[] {
  return code
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, maxLines);
}

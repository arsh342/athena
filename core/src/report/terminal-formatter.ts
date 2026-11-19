import { LANGUAGE_FAMILY, type LanguageFamily, type LanguageId } from '../lang/languages.js';
import { relative } from 'node:path';
import type { ClassifiedFinding, ScanReport, ScoredUnit, Severity } from '../types.js';
import { isSecretFinding, redactFrameLine } from './redact.js';

export type FailOn = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface TerminalReportOptions {
  color: boolean;
  version: string;
  mode: 'scan' | 'check';
  /** Shown in the header exactly as the user typed it. */
  target: string;
  failOn: FailOn;
  /** Absolute scan root, used to print paths relative to it. */
  root?: string;
  maxFindings?: number;
  showLow?: boolean;
  /** Returns a file's lines (index 0 = line 1) for code frames, or null. */
  readLines?: (file: string) => string[] | null;
}

const ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const BLOCKING: Record<FailOn, Severity[]> = {
  critical: ['CRITICAL'],
  high: ['CRITICAL', 'HIGH'],
  medium: ['CRITICAL', 'HIGH', 'MEDIUM'],
  low: ORDER,
  none: [],
};
const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: '\x1b[91m',
  HIGH: '\x1b[38;5;202m',
  MEDIUM: '\x1b[33m',
  LOW: '\x1b[2m',
};
const BRAND = '\x1b[38;2;232;122;65m';
const RESET = '\x1b[0m';

export function gateLine(
  report: ScanReport,
  failOn: FailOn,
): { status: 'BLOCKED' | 'PASS' | 'PASS (incomplete)'; detail: string } {
  const { summary } = report;
  const coverage = summary.coverage;
  const incomplete = coverage ? !coverage.complete : false;

  if (summary.blocked) {
    const parts = BLOCKING[failOn]
      .filter((severity) => summary.findings[severity] > 0)
      .map((severity) => `${summary.findings[severity]} ${severity.toLowerCase()}`);
    const base = parts.length > 0 ? `${parts.join(' · ')}   (fail-on: ${failOn})` : 'findings matched the block policy';
    return { status: 'BLOCKED', detail: incomplete ? `${base} · scan incomplete` : base };
  }
  const review = summary.needsReview ? ` · ${summary.needsReview} need review (not blocking)` : '';
  if (incomplete) return { status: 'PASS (incomplete)', detail: coverage!.gaps.join(' · ') + review };

  const total = ORDER.reduce((sum, severity) => sum + summary.findings[severity], 0);
  if (failOn === 'none') return { status: 'PASS', detail: (total === 0 ? 'no findings' : `${total} finding(s), fail-on: none`) + review };
  return { status: 'PASS', detail: `no findings at or above ${failOn}${review}` };
}

const FAMILY_SHORT: Record<LanguageFamily, string> = {
  js: 'js', python: 'py', java: 'java', csharp: 'cs', c: 'c', go: 'go', rust: 'rs', php: 'php', shell: 'sh',
};

/** ` (js 3 · go 1 · py 1)`: files per language family, most common first, ties alphabetical. */
function languageBreakdown(languages: ScanReport['summary']['languages']): string {
  if (!languages) return '';
  const counts = new Map<string, number>();
  for (const [lang, stats] of Object.entries(languages)) {
    if (!stats || stats.files === 0) continue;
    const short = FAMILY_SHORT[LANGUAGE_FAMILY[lang as LanguageId]];
    counts.set(short, (counts.get(short) ?? 0) + stats.files);
  }
  if (counts.size === 0) return '';
  const parts = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => `${name} ${n}`);
  return ` (${parts.join(' · ')})`;
}

export function formatTerminalReport(report: ScanReport, options: TerminalReportOptions): string {
  const paint = (code: string, text: string) => (options.color ? `${code}${text}${RESET}` : text);
  const dim = (text: string) => paint('\x1b[2m', text);
  const bold = (text: string) => paint('\x1b[1m', text);
  const rel = (file: string) => (options.root ? relative(options.root, file).split('\\').join('/') || file : file);
  const { summary } = report;
  const out: string[] = [];

  out.push(`${paint(BRAND, 'athena')} ${options.version} · ${options.mode} ${options.target} · ${summary.filesScanned} files${languageBreakdown(summary.languages)} · ${(report.duration / 1000).toFixed(1)}s`);
  out.push('');

  const gate = gateLine(report, options.failOn);
  const gateColor = gate.status === 'BLOCKED' ? '\x1b[1;91m' : gate.status === 'PASS' ? '\x1b[1;32m' : '\x1b[1;33m';
  out.push(` ${paint(gateColor, gate.status)}  ${gate.detail}`);
  out.push('');

  // ── Findings ──
  const all: Array<{ finding: ClassifiedFinding; unit?: ScoredUnit }> = [];
  for (const file of report.files) {
    for (const finding of file.findings) all.push({ finding, unit: owningUnit(file.units, finding.line) });
  }
  all.sort((a, b) =>
    Number(a.finding.confidence === 'low') - Number(b.finding.confidence === 'low')
    || ORDER.indexOf(a.finding.severity) - ORDER.indexOf(b.finding.severity)
    || (b.finding.priority ?? 0) - (a.finding.priority ?? 0)
    || a.finding.file.localeCompare(b.finding.file)
    || a.finding.line - b.finding.line);

  const visible = options.showLow ? all : all.filter(({ finding }) => finding.severity !== 'LOW');
  const hiddenLow = all.length - visible.length;
  const limit = Number.isFinite(options.maxFindings) ? Math.max(0, options.maxFindings ?? 0) : Number.POSITIVE_INFINITY;
  const shown = visible.slice(0, limit);

  if (all.length > 0) {
    out.push(bold('Findings'));
    let reviewHeadingShown = false;
    for (const { finding, unit } of shown) {
      if (finding.confidence === 'low' && !reviewHeadingShown) {
        reviewHeadingShown = true;
        out.push(dim(' Needs review — Athena could not confirm these (not counted, not blocking)'));
      }
      const label = paint(SEVERITY_COLOR[finding.severity], (finding.confidence === 'low' ? 'REVIEW' : finding.severity).padEnd(9));
      const left = ` ${finding.severity.padEnd(9)} ${finding.type}`;
      const location = `${rel(finding.file)}:${finding.line}`;
      out.push(` ${label} ${finding.type}${' '.repeat(Math.max(2, 60 - left.length))}${dim(location)}`);
      const aiNote = unit && (unit.provenance === 'ai' || unit.provenance === 'mixed' || unit.recorded) ? ' · in AI-estimated code' : '';
      out.push(`           ${dim(`${finding.ruleId}${aiNote} · id ${finding.id.slice(0, 6)}${finding.confidence ? ` · ${finding.confidence} confidence` : ''}`)}`);
      if (finding.trace && finding.trace.length > 0) {
        out.push(`           ${dim('path:')} ${finding.trace.map((t) => `${rel(t.file)}:${t.line}`).join(dim(' → '))}`);
      }
      for (const note of (finding.evidence ?? []).slice(0, 3)) out.push(`           ${dim(`· ${note}`)}`);
      for (const frameLine of codeFrame(finding, options.readLines)) out.push(`           ${frameLine}`);
    }
    if (visible.length > shown.length) out.push(dim(` … ${visible.length - shown.length} more (use --max-findings all)`));
    if (hiddenLow > 0) out.push(dim(` + ${hiddenLow} low (use --show-low)`));
    out.push('');
  }

  if (summary.skills && summary.skills.length > 0) {
    const names = summary.skills.map((s) => s.name);
    out.push(dim(`Skills: ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` (+${names.length - 6})` : ''}`));
    out.push('');
  }

  // ── AI provenance ──
  const provenance = summary.aiProvenance;
  if (provenance) {
    out.push(`${bold('AI provenance')}  (by lines)`);
    if (provenance.totalLines === 0) {
      out.push('  no code lines measured');
    } else {
      const pct = (lines: number) => Math.round((100 * lines) / provenance.totalLines);
      const e = provenance.estimated;
      out.push(provenance.recorded.available
        ? `  recorded: ${pct(provenance.recorded.lines)}% (floor)`
        : `  recorded: not available (${provenance.recorded.reason ?? 'unknown'})`);
      out.push(`  estimated: ${pct(e.aiLines)}–${pct(e.aiLines + e.mixedLines)}%`);
      out.push(`  uncertain: ${pct(e.uncertainLines)}%`);
      out.push(`  human (est.): ${pct(e.humanLines)}%`);
      out.push(dim(e.method === 'fast'
        ? `  method: ${e.model}${e.heuristicLanguages && e.heuristicLanguages.length > 0 ? ` · heuristic for: ${e.heuristicLanguages.join(', ')}` : ''}`
        : '  method: heuristic (low confidence)'));
      const top = provenance.files
        .filter((file) => file.aiLines > 0)
        .slice(0, 3)
        .map((file) => `${rel(file.path)} ${Math.round((100 * file.aiLines) / Math.max(1, file.lines))}%`);
      if (top.length > 0) out.push(`  most AI-estimated: ${top.join(' · ')}`);
    }
    out.push('');
  }

  // ── Coverage ──
  const coverage = summary.coverage;
  if (coverage) {
    out.push(bold('Coverage'));
    const considered = coverage.files.filter((file) => file.status !== 'skipped-excluded');
    const excluded = coverage.files.length - considered.length;
    const marker = considered.every((file) => file.status === 'analyzed') ? '✓' : '!';
    out.push(`  ${marker} ${considered.filter((f) => f.status === 'analyzed').length}/${considered.length} files analyzed${excluded > 0 ? ` · ${excluded} excluded by config` : ''}`);
    for (const gap of coverage.gaps.filter((g) => !/ (unavailable|failed)$/.test(g))) {
      out.push(`  ! ${gap}`);
      const status = gap.includes('not parsed') ? 'parse-failed' : gap.includes('skipped') ? 'skipped-size' : 'missing';
      for (const file of coverage.files.filter((f) => f.status === status).slice(0, 3)) {
        out.push(dim(`      ${rel(file.path)}${file.reason ? ` (${file.reason})` : ''}`));
      }
    }
    const checks = coverage.checks
      .filter((check) => check.status !== 'disabled' && !(check.name === 'recorded-provenance' && check.status === 'unavailable'))
      .map((check) => {
        if (check.status === 'ran') return `✓ ${check.name}${check.detail ? ` (${check.detail})` : ''}`;
        if (check.status === 'unavailable') return `! ${check.name} unavailable → athena doctor`;
        return `! ${check.name} failed`;
      });
    if (checks.length > 0) out.push(`  ${checks.join('   ')}`);
    out.push('');
  }

  // ── Delta ──
  const delta = summary.delta;
  if (delta && !delta.baseline) {
    const parts: string[] = [];
    for (const severity of ORDER) {
      if (delta.findings.newBySeverity[severity] > 0) parts.push(`+${delta.findings.newBySeverity[severity]} ${severity.toLowerCase()}`);
    }
    for (const severity of ORDER) {
      if (delta.findings.resolvedBySeverity[severity] > 0) parts.push(`−${delta.findings.resolvedBySeverity[severity]} ${severity.toLowerCase()}`);
    }
    out.push(`Since last scan: ${parts.length > 0 ? parts.join(' · ') : 'no change'}`);
    out.push('');
  }

  if (shown.length > 0) {
    const where = options.mode === 'scan' && options.target !== '.'
      ? ` --path ${/\s/.test(options.target) ? JSON.stringify(options.target) : options.target}`
      : '';
    out.push(`Next: athena explain ${shown[0].finding.id.slice(0, 6)}${where}`);
  }

  return out.join('\n').replace(/\n+$/, '') + '\n';
}

function owningUnit(units: ScoredUnit[], line: number): ScoredUnit | undefined {
  return units
    .filter((u) => line >= u.unit.startLine && line <= u.unit.endLine)
    .sort((a, b) => (a.unit.endLine - a.unit.startLine) - (b.unit.endLine - b.unit.startLine))[0];
}

function codeFrame(finding: ClassifiedFinding, readLines?: (file: string) => string[] | null): string[] {
  const lines = readLines?.(finding.file);
  if (!lines || lines.length === 0) return [];
  const from = Math.max(1, finding.line - 1);
  const to = Math.min(lines.length, finding.line + 1);
  const width = String(to).length;
  const frame: string[] = [];
  for (let n = from; n <= to; n += 1) {
    const text = redactFrameLine(finding, n, lines[n - 1]);
    frame.push(`${n === finding.line ? '>' : ' '} ${String(n).padStart(width)} │ ${text.trimEnd()}`);
  }
  return frame;
}

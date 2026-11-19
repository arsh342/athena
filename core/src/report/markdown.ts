import { relative } from 'node:path';

import type { ReviewInfo } from '../diff/filter.js';
import type { ClassifiedFinding, ScanReport } from '../types.js';

const ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function line(f: ClassifiedFinding, rel: (p: string) => string): string {
  const conf = f.confidence ? ` · ${f.confidence} confidence` : '';
  return `- **${f.severity}** ${f.type} — \`${rel(f.file)}:${f.line}\` (\`${f.ruleId}\`${conf})\n  ${f.message.replace(/\n/g, ' ')}`;
}

/** PR-comment-ready review: one section per file with findings, then existing issues and notes. */
export function formatMarkdownReview(report: ScanReport, info: ReviewInfo, options: { root: string }): string {
  const rel = (p: string) => relative(options.root, p).split('\\').join('/') || p;
  const out: string[] = [];
  const counts = report.summary.findings;
  const total = counts.CRITICAL + counts.HIGH + counts.MEDIUM + counts.LOW;
  out.push(`## Athena review — ${info.scope}`, '');
  out.push(report.summary.blocked ? '**Blocked:** this change introduces findings at or above the gate.' : total === 0 ? '**No issues found in the changed lines.**' : '**Passed the gate**, with findings below the blocking level.');
  out.push('', `${total} finding${total === 1 ? '' : 's'} on changed lines (${ORDER.map((s) => `${counts[s as keyof typeof counts]} ${s.toLowerCase()}`).join(', ')}).`, '');
  const files = report.files.filter((f) => f.findings.length > 0).sort((a, b) => rel(a.path).localeCompare(rel(b.path)));
  for (const file of files) {
    out.push(`### \`${rel(file.path)}\``, '');
    for (const f of [...file.findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.line - b.line)) out.push(line(f, rel));
    out.push('');
  }
  if (info.existing.length > 0) {
    out.push('<details><summary>Existing issues in code this change touches (not counted)</summary>', '');
    for (const f of info.existing) out.push(line(f, rel));
    out.push('', '</details>', '');
  }
  const notes: string[] = [];
  for (const r of info.renamed) notes.push(`Renamed \`${r.from}\` → \`${r.to}\`.`);
  for (const b of info.skippedBinary) notes.push(`Skipped binary file \`${b}\`.`);
  if (info.deleted.length > 0) notes.push(`Deleted: ${info.deleted.map((d) => `\`${d}\``).join(', ')}.`);
  if (notes.length > 0) out.push('**Notes**', '', ...notes.map((n) => `- ${n}`), '');
  return out.join('\n');
}

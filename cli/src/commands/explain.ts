import { readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  getRuleInfo, isSecretFinding, redactKnownSecrets, redactSecrets,
  type ClassifiedFinding, type FileReport, type ScoredUnit,
} from '@athena/core';
import { shouldUseColor } from '../utils/colors.js';
import { loadLastScan } from '../utils/last-scan.js';
import { writeInfo, writeResult } from '../utils/output.js';

const MIN_PREFIX = 4;

function owningUnit(file: FileReport, line: number): ScoredUnit | undefined {
  return file.units
    .filter((u) => line >= u.unit.startLine && line <= u.unit.endLine)
    .sort((a, b) => (a.unit.endLine - a.unit.startLine) - (b.unit.endLine - b.unit.startLine))[0];
}

/** Prints one finding from the last saved scan of `path`. Returns the exit code. */
export async function explainCommand(id: string, opts: { path?: string; color?: boolean } = {}): Promise<number> {
  const fail = (message: string): number => {
    writeInfo(`error: ${message}`);
    return 2;
  };

  const given = resolve(process.cwd(), opts.path ?? '.');
  const root = (await stat(given).catch(() => null))?.isFile() ? dirname(given) : given;
  if (id.length < MIN_PREFIX) return fail(`finding id must have at least ${MIN_PREFIX} characters`);

  const report = await loadLastScan(root);
  if (!report) return fail(`no saved scan for ${root}; run athena scan first`);

  const matches = new Map<string, { finding: ClassifiedFinding; file: FileReport }>();
  for (const file of report.files) {
    for (const finding of file.findings) {
      if (finding.id.startsWith(id) && !matches.has(finding.id)) matches.set(finding.id, { finding, file });
    }
  }
  if (matches.size === 0) return fail(`no finding matching ${id} in the last scan`);
  if (matches.size > 1) return fail(`${id} is ambiguous; matches ${[...matches.keys()].map((k) => k.slice(0, 8)).join(', ')}`);

  const { finding, file } = [...matches.values()][0];
  const color = shouldUseColor(process.stdout, opts.color, process.env);
  const bold = (text: string) => (color ? `\x1b[1m${text}\x1b[0m` : text);
  const dim = (text: string) => (color ? `\x1b[2m${text}\x1b[0m` : text);
  const secret = isSecretFinding(finding);
  const info = getRuleInfo(finding.ruleId);
  const unit = owningUnit(file, finding.line);
  const out: string[] = [];

  out.push(`${bold(`${finding.severity}  ${finding.type}`)}`);
  out.push(dim(`${relative(root, finding.file).split('\\').join('/')}:${finding.line}  ·  ${finding.ruleId}  ·  source: ${finding.source}  ·  id ${finding.id}`));
  out.push('');
  if (info) {
    out.push(bold('Why it matters'), `  ${info.why}`, '', bold('How to fix'), `  ${info.fix}`, '');
    out.push(bold('References'), ...info.references.map((url) => `  ${url}`), '');
  } else {
    out.push(bold('Details'), `  ${secret ? redactSecrets(finding.message) : finding.message}`, `  Rule: ${finding.ruleId}`, '');
  }

  try {
    const lines = (await readFile(finding.file, 'utf8')).split(/\r?\n/);
    const from = Math.max(1, finding.line - 3);
    const to = Math.min(lines.length, finding.line + 3);
    const width = String(to).length;
    out.push(bold('Code'));
    for (let n = from; n <= to; n += 1) {
      const text = secret ? redactSecrets(lines[n - 1]) : redactKnownSecrets(lines[n - 1]);
      out.push(`  ${n === finding.line ? '>' : ' '} ${String(n).padStart(width)} │ ${text.trimEnd()}`);
    }
    out.push('');
  } catch {
    // file moved or deleted since the scan: skip the frame
  }

  out.push(`AI provenance: ${unit?.provenance ?? 'unknown'}, recorded: ${unit?.recorded ? 'yes' : 'no'}`);
  writeResult(out.join('\n'));
  return 0;
}

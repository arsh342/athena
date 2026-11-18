import { stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { defaultConfig, mergeConfig, scanFiles, type AiProvenance } from '@athena/core';
import { shouldUseColor } from '../utils/colors.js';
import { findSourceFilesWithExclusions } from '../utils/file-filter.js';
import { writeResult } from '../utils/output.js';
import { loadProjectConfig } from '../utils/project-config.js';
import { UsageError } from '../utils/run-options.js';

type SortKey = 'ai' | 'recorded' | 'lines';
const SORT_KEYS: SortKey[] = ['ai', 'recorded', 'lines'];

const ABOUT = `How Athena measures AI-written code

  recorded   Lines that git history credits to an AI tool: commit trailers such as
             "Co-Authored-By: Claude", or known agent bot authors. This is a floor,
             not the total: plenty of AI-assisted code leaves no trace. It is not
             available outside a git repository or in a shallow clone.

  estimated  A heuristic over style signals (comment habits, naming, boilerplate).
             It has no measured accuracy yet and is labelled low confidence. Trained
             detectors with published accuracy are planned for a later release.

  Numbers are lines of code (blank and comment lines excluded). "Uncertain" is
  reported separately and never folded into either side.
`;

export async function provenanceCommand(
  path: string,
  opts: { sort?: string; about?: boolean; format?: string; color?: boolean } = {},
): Promise<number> {
  if (opts.about) {
    writeResult(ABOUT);
    return 0;
  }
  const sort = (opts.sort ?? 'ai') as SortKey;
  if (!SORT_KEYS.includes(sort)) throw new UsageError(`unknown --sort "${opts.sort}" (use ${SORT_KEYS.join(', ')})`);
  const format = opts.format ?? 'terminal';
  if (format !== 'terminal' && format !== 'json') throw new UsageError(`unknown --format "${format}" (use terminal, json)`);

  const given = resolve(process.cwd(), path);
  const root = (await stat(given).catch(() => null))?.isFile() ? dirname(given) : given;
  const project = await loadProjectConfig(root);
  const { files } = await findSourceFilesWithExclusions(given, [...defaultConfig.exclude, ...(project.exclude ?? [])]);
  const config = mergeConfig({
    semgrep: { enabled: false, timeoutMs: 1000, config: 'auto' },
    eslint: { enabled: false, timeoutMs: 1000 },
    npmAudit: { enabled: false, timeoutMs: 1000 },
    nodejsscan: { enabled: false, timeoutMs: 1000, requireDocker: false },
    bearer: { enabled: false, timeoutMs: 1000 },
  });
  const report = await scanFiles(files, config, {}, { root });
  const provenance = report.summary.aiProvenance!;

  if (format === 'json') {
    writeResult(JSON.stringify(provenance, null, 2));
    return 0;
  }
  writeResult(renderTerminal(provenance, root, sort, shouldUseColor(process.stdout, opts.color, process.env)));
  return 0;
}

function renderTerminal(p: AiProvenance, root: string, sort: SortKey, color: boolean): string {
  const bold = (text: string) => (color ? `\x1b[1m${text}\x1b[0m` : text);
  const pct = (part: number, whole: number) => `${Math.round((100 * part) / Math.max(1, whole))}%`;
  const e = p.estimated;
  const out = [`${bold('AI provenance')}  (by lines · ${p.totalLines} lines)`];

  if (p.totalLines === 0) {
    out.push('  no code lines measured');
    return out.join('\n');
  }
  out.push(p.recorded.available
    ? `  recorded: ${pct(p.recorded.lines, p.totalLines)} (floor)`
    : `  recorded: not available (${p.recorded.reason ?? 'unknown'})`);
  out.push(`  estimated: ${pct(e.aiLines, p.totalLines)}–${pct(e.aiLines + e.mixedLines, p.totalLines)}`);
  out.push(`  uncertain: ${pct(e.uncertainLines, p.totalLines)}`);
  out.push(`  human (est.): ${pct(e.humanLines, p.totalLines)}`);
  out.push('  method: heuristic (low confidence)', '');

  const key = (f: AiProvenance['files'][number]): number =>
    sort === 'lines' ? f.lines : sort === 'recorded' ? f.recordedLines / Math.max(1, f.lines) : f.aiLines / Math.max(1, f.lines);
  const rows = [...p.files].sort((a, b) => key(b) - key(a) || a.path.localeCompare(b.path));
  const names = rows.map((f) => relative(root, f.path).split('\\').join('/'));
  const width = Math.min(60, Math.max(4, ...names.map((n) => n.length)));
  out.push(`${'file'.padEnd(width)}  ${'lines'.padStart(6)}  ${'recorded'.padStart(8)}  ${'AI(est)'.padStart(7)}  ${'uncertain'.padStart(9)}`);
  rows.forEach((f, i) => {
    out.push(`${names[i].slice(-width).padEnd(width)}  ${String(f.lines).padStart(6)}  ${pct(f.recordedLines, f.lines).padStart(8)}  ${pct(f.aiLines, f.lines).padStart(7)}  ${pct(f.uncertainLines, f.lines).padStart(9)}`);
  });
  return out.join('\n');
}

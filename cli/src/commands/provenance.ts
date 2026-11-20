import { realpath, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { addMarks, defaultConfig, loadFastModel, mergeConfig, parseFileDetailed, resetLearning, scanFiles, unitSha, type AiProvenance, type Mark } from '@athena/core';
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

  estimated  Athena's own detector (athena-detect-fast): style statistics plus hashed
             token and character n-grams, fed to a calibrated classifier. It is enabled
             per language only where it meets the release targets on Athena-Bench
             (human false-positive rate <= 5%, F1 >= 0.85); every other language uses
             a style heuristic that is labelled low confidence.

  Numbers are lines of code (blank and comment lines excluded). "Uncertain" is
  reported separately and never folded into either side.
`;

function benchmarkSummary(): string {
  const model = loadFastModel();
  if (!model) return '\nDetector: not available in this install (heuristic estimate only).\n';
  const rows = Object.entries(model.meta.languages).sort(([a], [b]) => a.localeCompare(b)).map(([lang, v]) => {
    const t = v.test as Record<string, number> | undefined;
    const measured = t && (t.humans ?? 0) >= 10 && (t.ais ?? 0) >= 10;
    const numbers = measured && t ? ` (test: F1 ${t.f1?.toFixed(2)}, human false positives ${((t.fpr ?? 0) * 100).toFixed(1)}%)` : '';
    return `  ${lang.padEnd(11)} ${v.enabled ? 'detector' : 'heuristic'}${numbers}${v.enabled ? '' : v.reason ? ` — ${v.reason}` : ''}`;
  });
  return `\nDetector athena-detect-fast ${model.meta.version}, per language:\n${rows.join('\n')}\n\nFull benchmark: https://github.com/arsh342/athena/blob/main/docs/athena-bench/RESULTS.md\n`;
}

export async function provenanceCommand(
  path: string,
  opts: { sort?: string; about?: boolean; format?: string; color?: boolean } = {},
): Promise<number> {
  if (opts.about) {
    writeResult(ABOUT + benchmarkSummary());
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
    learning: project.learning !== false,
    eslint: { enabled: false, timeoutMs: 1000 },
    npmAudit: { enabled: false, timeoutMs: 1000 },
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
  if (p.learning) {
    out.push(p.learning.state === 'tuned'
      ? `  learning: tuned with ${p.learning.labels} labels from this repo (changed ${p.learning.unitsChanged} of ${p.learning.units} units)`
      : `  learning: global model${p.learning.reason ? ` (${p.learning.reason})` : ''}`);
  }
  out.push(e.method === 'fast'
    ? `  method: ${e.model}${e.heuristicLanguages && e.heuristicLanguages.length > 0 ? ` · heuristic for: ${e.heuristicLanguages.join(', ')}` : ''}`
    : '  method: heuristic (low confidence)', '');

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

const LABELS = ['human', 'ai', 'mixed'];

/**
 * `athena provenance mark <path>[:line] <human|ai|mixed>`: tell Athena who wrote a unit. The mark is stored by the unit's code hash
 * (never the code), so it stops applying if the code changes. `mixed` is kept but cannot be learned from.
 */
export async function markCommand(target: string, label: string, opts: { path?: string } = {}): Promise<number> {
  if (!LABELS.includes(label)) throw new UsageError(`unknown label "${label}" (use human, ai or mixed)`);
  const m = /^(.*?)(?::(\d+))?$/.exec(target);
  const filePart = m?.[1] ?? target;
  const line = m?.[2] ? Number(m[2]) : undefined;
  // Learning is keyed by the canonical directory a scan uses, so a symlinked spelling finds the same state.
  const root = await realpath(resolve(process.cwd(), opts.path ?? '.')).catch(() => resolve(process.cwd(), opts.path ?? '.'));
  const file = await realpath(resolve(process.cwd(), filePart)).catch(() => resolve(process.cwd(), filePart));
  if (!(await stat(file).catch(() => null))?.isFile()) throw new UsageError(`${filePart} is not a file`);
  const { units, language } = await parseFileDetailed(file);
  if (!language) throw new UsageError(`${filePart} is not a supported source file`);
  const chosen = line === undefined
    ? units
    : [...units].filter((u) => line >= u.startLine && line <= u.endLine).sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine)).slice(0, 1);
  if (chosen.length === 0) throw new UsageError(line === undefined ? `no functions or methods found in ${filePart}` : `no function or method contains line ${line} of ${filePart}`);
  const at = new Date().toISOString();
  const rel = relative(root, file).split('\\').join('/');
  const marks: Mark[] = chosen.map((u) => ({ sha: unitSha(u.code), label: label as Mark['label'], path: rel, startLine: u.startLine, endLine: u.endLine, at }));
  addMarks(root, marks);
  writeResult(`marked ${marks.length} unit${marks.length === 1 ? '' : 's'} in ${rel} as ${label}${label === 'mixed' ? ' (kept, but not used for learning)' : ''}\nAthena learns from marks once a repository has 30 labels with at least 10 human and 10 AI. Use --path if you scan a different directory than this one.`);
  return 0;
}

/** `athena models reset [--repo]`: forget what Athena learned from labels (marks included). */
export async function resetCommand(opts: { repo?: boolean; path?: string } = {}): Promise<number> {
  const root = await realpath(resolve(process.cwd(), opts.path ?? '.')).catch(() => resolve(process.cwd(), opts.path ?? '.'));
  const removed = resetLearning(opts.repo ? root : undefined);
  writeResult(opts.repo
    ? (removed ? `forgot what Athena learned for ${root}` : `nothing learned yet for ${root}`)
    : `forgot learning for ${removed} repositor${removed === 1 ? 'y' : 'ies'}`);
  return 0;
}

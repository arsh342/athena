import { createHash } from 'node:crypto';
import type { FileReport, ScoredUnit } from '../types.js';
import type { RecordedRepo } from '../provenance/git-recorded.js';

export type LabelSource = 'recorded' | 'pre-2021' | 'mark';

/** A label Athena may learn from. It names code only by its hash, never stores it. */
export interface TrustedLabel {
  /** sha256 of the unit's code at labelling time. */
  sha: string;
  label: 'ai' | 'human';
  source: LabelSource;
  path: string;
  startLine: number;
  endLine: number;
}

/** A person's statement about one unit. `mixed` is kept but cannot be learned from (the learner is binary). */
export interface Mark {
  sha: string;
  label: 'ai' | 'human' | 'mixed';
  path: string;
  startLine: number;
  endLine: number;
  at: string;
}

export const unitSha = (code: string): string => createHash('sha256').update(code).digest('hex');

/** Code lines (not blank, not comment-only) of a unit, as 1-based file line numbers. */
export function unitCodeLines(scored: ScoredUnit): number[] {
  const out: number[] = [];
  let inBlock = false;
  scored.unit.code.split(/\r?\n/).forEach((raw, index) => {
    const t = raw.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return;
    }
    if (t === '' || t.startsWith('//') || t.startsWith('#') || t.startsWith('*')) return;
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      return;
    }
    out.push(scored.unit.startLine + index);
  });
  return out;
}

/**
 * Trusted labels only, never predictions:
 *  - ai: the unit is >= 80% recorded as written by AI-assisted commits;
 *  - human: every code line of the unit was last changed before 2021-06-01 (git blame);
 *  - mark: a person said so, and the unit's code is unchanged since (same hash).
 * A mark wins over an automatic label for the same code. Marks whose code has changed are dropped.
 */
export function collectTrustedLabels(files: FileReport[], recorded: RecordedRepo, marks: Mark[], rel: (path: string) => string = (p) => p): TrustedLabel[] {
  const markBySha = new Map<string, Mark>();
  for (const m of marks) if (m.label !== 'mixed') markBySha.set(m.sha, m);
  const out = new Map<string, TrustedLabel>();
  for (const file of files) {
    const info = recorded.files.get(file.path);
    for (const scored of file.units) {
      const sha = unitSha(scored.unit.code);
      const where = { path: rel(file.path), startLine: scored.unit.startLine, endLine: scored.unit.endLine };
      const mark = markBySha.get(sha);
      if (mark) {
        out.set(sha, { sha, label: mark.label as 'ai' | 'human', source: 'mark', ...where });
        continue;
      }
      if (out.has(sha)) continue;
      if (scored.recorded) {
        out.set(sha, { sha, label: 'ai', source: 'recorded', ...where });
        continue;
      }
      const lines = unitCodeLines(scored);
      if (info?.available && lines.length > 0 && lines.every((n) => info.oldLines.has(n))) out.set(sha, { sha, label: 'human', source: 'pre-2021', ...where });
    }
  }
  return [...out.values()];
}

/** Stable fingerprint of a label set, so training reruns only when the labels changed. */
export function labelSetHash(labels: TrustedLabel[]): string {
  return createHash('sha256').update(labels.map((l) => `${l.sha}:${l.label}`).sort().join('\n')).digest('hex').slice(0, 16);
}

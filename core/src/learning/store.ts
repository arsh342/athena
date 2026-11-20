import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { athenaHome, repoKey } from '../util/athena-home.js';
import type { Mark } from './labels.js';
import type { Adjustment } from './learner.js';

/** One labelled unit, kept as numbers (its hash, base probability, 35 style features): never its code. */
export interface StoredSample {
  sha: string;
  y: 0 | 1;
  pBase: number;
  dense: number[];
  source: string;
  path: string;
}

export const MAX_SAMPLES = 2000;

export interface LearningState {
  version: 1;
  marks: Mark[];
  /** Labelled units seen in earlier scans, so a partial scan (e.g. staged files) still learns from the whole history. */
  samples: StoredSample[];
  /** Identifies the base the stored probabilities came from (fast-model version or heuristic); samples from another base are dropped. */
  baseTag: string;
  adjustment: Adjustment | null;
  /** Fingerprint of the labels the current adjustment (or rejection) was decided on. */
  labelSet: string;
  /** Why the last candidate adjustment was not adopted, if it was not. */
  rejected?: string;
}

const empty = (): LearningState => ({ version: 1, marks: [], samples: [], baseTag: '', adjustment: null, labelSet: '' });
const dir = (home?: string): string => join(home ?? athenaHome(), 'learning');
const file = (root: string, home?: string): string => join(dir(home), `${repoKey(root)}.json`);

export function loadLearning(root: string, home?: string): LearningState {
  try {
    const raw = JSON.parse(readFileSync(file(root, home), 'utf8')) as Partial<LearningState>;
    if (raw.version !== 1 || !Array.isArray(raw.marks)) return empty();
    return { version: 1, marks: raw.marks, samples: Array.isArray(raw.samples) ? raw.samples : [], baseTag: raw.baseTag ?? '', adjustment: raw.adjustment ?? null, labelSet: raw.labelSet ?? '', ...(raw.rejected ? { rejected: raw.rejected } : {}) };
  } catch {
    return empty();
  }
}

/** Atomic and private: write to a unique temp file with mode 0600, then rename over the target. */
export function saveLearning(root: string, state: LearningState, home?: string): void {
  const d = dir(home);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const target = file(root, home);
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, target);
}

/** Add marks (replacing an earlier mark for the same code) by reading the newest state just before writing. */
export function addMarks(root: string, marks: Mark[], home?: string): LearningState {
  const state = loadLearning(root, home);
  const bySha = new Map(state.marks.map((m) => [m.sha, m]));
  for (const m of marks) bySha.set(m.sha, m);
  const next = { ...state, marks: [...bySha.values()], labelSet: '' };
  saveLearning(root, next, home);
  return next;
}

/** Forget what was learned (marks included). With a root: that repository only; otherwise every repository. */
export function resetLearning(root?: string, home?: string): number {
  if (root) {
    const f = file(root, home);
    if (!existsSync(f)) return 0;
    rmSync(f);
    return 1;
  }
  const d = dir(home);
  if (!existsSync(d)) return 0;
  const files = readdirSync(d).filter((n) => n.endsWith('.json'));
  for (const n of files) rmSync(join(d, n));
  return files.length;
}

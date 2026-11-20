import { createHash } from 'node:crypto';

export const N_DENSE = 35;
/** Adjusted probabilities never move further than this from the global/heuristic ones. */
export const MAX_SHIFT = 0.25;
export const MIN_LABELS = 30;
export const MIN_PER_CLASS = 10;

export interface Sample {
  /** The AI probability the scan would use without learning. */
  pBase: number;
  /** The 35 dense style features of the unit. */
  dense: ArrayLike<number>;
  y: 0 | 1;
  /** Stable key for the deterministic hold-out split. */
  key: string;
}

export interface Adjustment {
  version: 1;
  mean: number[];
  std: number[];
  /** w[0] scales the base logit; w[1..] weigh the repo-standardised style features. */
  w: number[];
  b: number;
  labels: number;
  humans: number;
  ais: number;
  holdout: { base: number; adjusted: number };
  trainedAt: string;
}

const clampP = (p: number): number => Math.min(0.999, Math.max(0.001, p));
const logit = (p: number): number => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

export function logLoss(pairs: Array<[number, 0 | 1]>): number {
  if (pairs.length === 0) return 0;
  return pairs.reduce((sum, [p, y]) => sum - (y === 1 ? Math.log(clampP(p)) : Math.log(1 - clampP(p))), 0) / pairs.length;
}

function standardise(adj: Pick<Adjustment, 'mean' | 'std'>, dense: ArrayLike<number>): number[] {
  return Array.from({ length: N_DENSE }, (_, i) => ((dense[i] ?? 0) - adj.mean[i]!) / adj.std[i]!);
}

/** The adjusted AI probability for one unit, kept within +-0.25 of the base. */
export function applyAdjustment(adj: Adjustment, pBase: number, dense: ArrayLike<number>): number {
  const x = standardise(adj, dense);
  let z = adj.b + adj.w[0]! * logit(pBase);
  for (let i = 0; i < N_DENSE; i += 1) z += adj.w[i + 1]! * x[i]!;
  const p = sigmoid(z);
  return Math.min(1, Math.max(0, Math.min(pBase + MAX_SHIFT, Math.max(pBase - MAX_SHIFT, p))));
}

/** Deterministic 20% stratified hold-out: by class, every fifth sample in hash order. */
export function splitHoldout(samples: Sample[]): { train: Sample[]; holdout: Sample[] } {
  const rank = (s: Sample): string => createHash('sha256').update(s.key).digest('hex');
  const train: Sample[] = [];
  const holdout: Sample[] = [];
  for (const y of [0, 1] as const) {
    const group = samples.filter((s) => s.y === y).sort((a, b) => rank(a).localeCompare(rank(b)));
    group.forEach((s, i) => (i % 5 === 0 ? holdout : train).push(s));
  }
  return { train, holdout };
}

/**
 * A tiny logistic model that starts as the identity on the base logit and is pulled back towards it (ridge) so a few labels
 * cannot move much. Classes are balanced. Returns null below the activation threshold (>= 30 labels, >= 10 of each class).
 */
export function trainAdjustment(samples: Sample[], now: () => Date = () => new Date()): { adjustment: Adjustment; holdout: Sample[] } | null {
  const humans = samples.filter((s) => s.y === 0).length;
  const ais = samples.length - humans;
  if (samples.length < MIN_LABELS || humans < MIN_PER_CLASS || ais < MIN_PER_CLASS) return null;
  const { train, holdout } = splitHoldout(samples);

  const mean = Array.from({ length: N_DENSE }, (_, i) => train.reduce((s, x) => s + (x.dense[i] ?? 0), 0) / train.length);
  const std = Array.from({ length: N_DENSE }, (_, i) => {
    const v = Math.sqrt(train.reduce((s, x) => s + ((x.dense[i] ?? 0) - mean[i]!) ** 2, 0) / train.length);
    return v > 1e-6 ? v : 1;
  });
  const shape = { mean, std };
  const rows = train.map((s) => ({ x: [logit(s.pBase), ...standardise(shape, s.dense)], y: s.y }));
  const weightOf = (y: 0 | 1): number => train.length / (2 * (y === 1 ? train.filter((s) => s.y === 1).length : train.filter((s) => s.y === 0).length));

  const w = [1, ...new Array<number>(N_DENSE).fill(0)];
  let b = 0;
  const lambda = 5;
  const lr = 0.1;
  for (let iter = 0; iter < 400; iter += 1) {
    const gw = new Array<number>(N_DENSE + 1).fill(0);
    let gb = 0;
    for (const r of rows) {
      const z = b + r.x.reduce((s, xi, i) => s + xi * w[i]!, 0);
      const err = (sigmoid(z) - r.y) * weightOf(r.y);
      for (let i = 0; i <= N_DENSE; i += 1) gw[i]! += err * r.x[i]!;
      gb += err;
    }
    for (let i = 0; i <= N_DENSE; i += 1) {
      const prior = i === 0 ? 1 : 0;
      w[i] = w[i]! - lr * (gw[i]! / rows.length + (lambda / rows.length) * (w[i]! - prior));
    }
    b -= lr * (gb / rows.length);
  }

  const adjustment: Adjustment = { version: 1, mean, std, w, b, labels: samples.length, humans, ais, holdout: { base: 0, adjusted: 0 }, trainedAt: now().toISOString() };
  adjustment.holdout.base = logLoss(holdout.map((s) => [s.pBase, s.y]));
  adjustment.holdout.adjusted = logLoss(holdout.map((s) => [applyAdjustment(adjustment, s.pBase, s.dense), s.y]));
  return { adjustment, holdout };
}

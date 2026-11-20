import { applyAdjustment, logLoss, type Adjustment, type Sample } from './learner.js';

/** The AI-decision boundary used by the heuristic path (score >= 70). */
export const DECISION_THRESHOLD = 0.7;
const TOLERANCE = 0.01;

export interface CheckSet {
  rows: Array<{ pBase: number; dense: ArrayLike<number>; y: 0 | 1 }>;
}

function rates(rows: CheckSet['rows'], p: (r: CheckSet['rows'][number]) => number): { recall: number; fpr: number } {
  const ai = rows.filter((r) => r.y === 1);
  const human = rows.filter((r) => r.y === 0);
  return {
    recall: ai.length ? ai.filter((r) => p(r) >= DECISION_THRESHOLD).length / ai.length : 0,
    fpr: human.length ? human.filter((r) => p(r) >= DECISION_THRESHOLD).length / human.length : 0,
  };
}

/**
 * A learned adjustment is used only if it (1) lowers log-loss on labels it was not trained on, and (2) does not make Athena worse on a
 * bundled check set: AI recall may not drop, and the human false-positive rate may not rise, by more than one point.
 */
export function passesGuardrails(adj: Adjustment, holdout: Sample[], checkSet: CheckSet | null): { ok: boolean; reason?: string } {
  const base = logLoss(holdout.map((s) => [s.pBase, s.y]));
  const adjusted = logLoss(holdout.map((s) => [applyAdjustment(adj, s.pBase, s.dense), s.y]));
  if (!(adjusted < base)) return { ok: false, reason: 'hold-out log-loss did not improve' };
  if (checkSet && checkSet.rows.length > 0) {
    const before = rates(checkSet.rows, (r) => r.pBase);
    const after = rates(checkSet.rows, (r) => applyAdjustment(adj, r.pBase, r.dense));
    if (after.recall < before.recall - TOLERANCE) return { ok: false, reason: 'check-set recall dropped' };
    if (after.fpr > before.fpr + TOLERANCE) return { ok: false, reason: 'check-set human false-positive rate rose' };
  }
  return { ok: true };
}

import type { Probabilities } from '../provenance/fast-model.js';
import type { ScoredUnit, UnitProvenance } from '../types.js';

/** The AI probability a scan uses for a unit without learning: the fast model where it is enabled, otherwise the heuristic score. */
export function baseProbability(scored: Pick<ScoredUnit, 'score'>, fast: Probabilities | null): number {
  return fast ? Math.min(1, fast.ai + fast.adversarial) : Math.min(1, Math.max(0, scored.score / 100));
}

/** Re-derive a unit's provenance from an adjusted AI probability, with the same decision rules the scan uses. */
export function provenanceFromAdjusted(
  p: number,
  fast: { probabilities: Probabilities; threshold: number; decide: (p: Probabilities, t: number) => UnitProvenance } | null,
  heuristic: { threshold: number; decide: (score: number, threshold: number) => UnitProvenance },
): UnitProvenance {
  if (fast) {
    const refined = fast.probabilities.refined;
    return fast.decide({ ai: p, adversarial: 0, refined, human: Math.max(0, 1 - p - refined) }, fast.threshold);
  }
  return heuristic.decide(Math.round(p * 100), heuristic.threshold);
}

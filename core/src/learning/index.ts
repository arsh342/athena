import { relative, sep } from 'node:path';

import type { LanguageId } from '../lang/languages.js';
import { extractFeatures } from '../ml/features.js';
import { decide, type FastModel, type Probabilities } from '../provenance/fast-model.js';
import type { RecordedRepo } from '../provenance/git-recorded.js';
import { heuristicProvenance } from '../scorer/heuristic-scorer.js';
import type { AiProvenance, FileReport, ScoredUnit, UnitProvenance } from '../types.js';
import { provenanceFromAdjusted } from './apply.js';
import { loadCheckSet } from './check-set.js';
import { passesGuardrails, type CheckSet } from './guardrails.js';
import { collectTrustedLabels, labelSetHash, unitSha } from './labels.js';
import { applyAdjustment, trainAdjustment, type Adjustment, type Sample } from './learner.js';
import { loadLearning, MAX_SAMPLES, saveLearning, type StoredSample } from './store.js';

export interface UnitBase {
  language: LanguageId;
  /** The AI probability the scan uses without learning. */
  pBase: number;
  baseProvenance: UnitProvenance;
  fast: { probabilities: Probabilities; threshold: number } | null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Learn from this repository's trusted labels and apply what was learned. Never throws: any failure leaves the global estimate.
 * Order: collect labels from this scan -> merge into the stored samples -> retrain only if the label set changed and the activation
 * thresholds are met -> adopt the new adjustment only if the guardrails pass -> re-derive each unit's provenance.
 */
export function learnFromRepository(
  files: FileReport[],
  info: Map<ScoredUnit, UnitBase>,
  recorded: RecordedRepo,
  root: string,
  fastModel: FastModel | null,
  heuristicThreshold: number,
  options: { home?: string; checkSet?: CheckSet | null } = {},
): NonNullable<AiProvenance['learning']> {
  const units = info.size;
  try {
    const state = loadLearning(root, options.home);
    const baseTag = fastModel ? `fast:${fastModel.meta.version}` : 'heuristic';
    const rel = (p: string): string => relative(root, p).split(sep).join('/');
    const labels = collectTrustedLabels(files, recorded, state.marks, rel);

    // Labelled units from this scan become samples (numbers only); samples from another base are dropped.
    const bySha = new Map<string, StoredSample>((state.baseTag === baseTag ? state.samples : []).map((s) => [s.sha, s]));
    const labelBySha = new Map(labels.map((l) => [l.sha, l]));
    for (const file of files) {
      for (const scored of file.units) {
        const base = info.get(scored);
        const label = base ? labelBySha.get(unitSha(scored.unit.code)) : undefined;
        if (!base || !label) continue;
        bySha.set(label.sha, {
          sha: label.sha, y: label.label === 'ai' ? 1 : 0, pBase: round4(base.pBase),
          dense: Array.from(extractFeatures({ code: scored.unit.code }, base.language).dense, round4), source: label.source, path: label.path,
          language: base.language, lines: Math.max(1, scored.unit.endLine - scored.unit.startLine + 1),
        });
      }
    }
    // A mark made after a sample was stored can flip its label.
    for (const m of state.marks) {
      const s = bySha.get(m.sha);
      if (s && m.label !== 'mixed') s.y = m.label === 'ai' ? 1 : 0;
    }
    const samples = [...bySha.values()].slice(-MAX_SAMPLES);
    const set = labelSetHash(samples.map((s) => ({ sha: s.sha, label: s.y === 1 ? 'ai' : 'human', source: 'recorded' as const, path: '', startLine: 0, endLine: 0 })));

    let adjustment: Adjustment | null = state.baseTag === baseTag ? state.adjustment : null;
    let rejected = state.baseTag === baseTag ? state.rejected : undefined;
    // Samples stored before language and size were recorded are upgraded the next time their unit is seen.
    const upgrade = state.samples.some((s) => !s.language) && samples.some((s) => s.language);
    if (set !== state.labelSet || state.baseTag !== baseTag || upgrade) {
      const training: Sample[] = samples.map((s) => ({ pBase: s.pBase, dense: s.dense, y: s.y, key: s.sha }));
      const trained = trainAdjustment(training);
      if (trained) {
        const verdict = passesGuardrails(trained.adjustment, trained.holdout, options.checkSet === undefined ? loadCheckSet() : options.checkSet);
        if (verdict.ok) {
          adjustment = trained.adjustment;
          rejected = undefined;
        } else {
          rejected = verdict.reason;
        }
      }
      saveLearning(root, { ...state, samples, baseTag, adjustment, labelSet: set, ...(rejected ? { rejected } : {}) }, options.home);
    }

    let changed = 0;
    for (const [scored, base] of info) {
      let next = base.baseProvenance;
      if (adjustment) {
        const p = applyAdjustment(adjustment, base.pBase, extractFeatures({ code: scored.unit.code }, base.language).dense);
        next = provenanceFromAdjusted(p, base.fast ? { ...base.fast, decide } : null, { threshold: heuristicThreshold, decide: heuristicProvenance });
      }
      if (next !== base.baseProvenance) changed += 1;
      scored.provenance = next;
      scored.flagged = next === 'ai' || next === 'mixed' || scored.recorded;
    }
    return adjustment
      ? { state: 'tuned', labels: adjustment.labels, unitsChanged: changed, units }
      : { state: 'global', labels: samples.length, unitsChanged: 0, units, ...(rejected ? { reason: rejected } : {}) };
  } catch {
    return { state: 'global', labels: 0, unitsChanged: 0, units, reason: 'learning unavailable' };
  }
}

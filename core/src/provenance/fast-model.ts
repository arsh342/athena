import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGUAGE_FAMILY, type LanguageId } from '../lang/languages.js';
import { extractFeatures, FAMILIES, FEATURE_SPEC, HASH_BUCKETS, type FeatureInput } from '../ml/features.js';
import type { UnitProvenance } from '../types.js';

export interface FastModelMeta {
  version: string;
  featureSpec: string;
  classes: string[];
  temperature: number;
  nFeatures: number;
  languages: Record<string, { enabled: boolean; threshold: number; reason?: string; test?: Record<string, number> }>;
  benchmark: Record<string, unknown>;
}

export type Probabilities = Record<'human' | 'ai' | 'refined' | 'adversarial', number>;

export interface FastModel {
  meta: FastModelMeta;
  /** Languages (of those given) that have no enabled model and therefore use the labelled heuristic. */
  heuristicLanguages(present: LanguageId[]): LanguageId[];
  /** @internal */
  weights: Float32Array;
  biases: Float64Array;
}

const N_DENSE = 35;
const N_FAMILY = FAMILIES.length;

function f16ToNumber(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

function candidateDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, '..', '..', 'models', 'fast'), // core/src/provenance or core/dist/provenance
    join(here, 'models', 'fast'), // bundled CLI: dist/models/fast
    join(here, '..', 'models', 'fast'),
  ];
}

const KNOWN_CLASSES = ['human', 'ai', 'refined', 'adversarial'];

/** Structural validation: a malformed model must fall back to the heuristic, never crash or silently misclassify. */
function validMeta(meta: FastModelMeta): boolean {
  if (typeof meta.version !== 'string' || !Array.isArray(meta.classes)) return false;
  if (!meta.classes.every((k) => KNOWN_CLASSES.includes(k)) || !meta.classes.includes('human') || !meta.classes.includes('ai')) return false;
  if (!Number.isFinite(meta.temperature) || meta.temperature <= 0) return false;
  if (typeof meta.languages !== 'object' || meta.languages === null) return false;
  return Object.values(meta.languages).every(
    (l) => l !== null && typeof l === 'object' && typeof l.enabled === 'boolean' && Number.isFinite(l.threshold) && l.threshold >= 0.5 && l.threshold <= 1,
  );
}

/** Loads the newest model in `dir` (or the bundled one). Any problem returns null: callers fall back to the heuristic. */
export function loadFastModel(dir?: string): FastModel | null {
  for (const base of dir ? [dir] : candidateDirs()) {
    try {
      if (!existsSync(base)) continue;
      const stems = readdirSync(base).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const stem = stems[stems.length - 1];
      if (!stem) continue;
      const meta = JSON.parse(readFileSync(join(base, `${stem}.json`), 'utf8')) as FastModelMeta;
      if (meta.featureSpec !== FEATURE_SPEC || meta.nFeatures !== HASH_BUCKETS + N_DENSE + N_FAMILY) return null;
      if (!validMeta(meta)) return null;
      const raw = readFileSync(join(base, `${stem}.bin`));
      const c = meta.classes.length;
      if (raw.length !== c * meta.nFeatures * 2 + c * 4) return null;
      const weights = new Float32Array(c * meta.nFeatures);
      for (let i = 0; i < weights.length; i += 1) weights[i] = f16ToNumber(raw.readUInt16LE(i * 2));
      const biases = new Float64Array(c);
      for (let i = 0; i < c; i += 1) biases[i] = raw.readFloatLE(c * meta.nFeatures * 2 + i * 4);
      if (!weights.every(Number.isFinite) || !biases.every(Number.isFinite)) return null;
      return {
        meta,
        weights,
        biases,
        heuristicLanguages: (present) => present.filter((l) => !meta.languages[l]?.enabled),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/** Design §1 decision rules. P(ai)+P(adversarial) >= language threshold → ai; P(human) >= 0.70 → human; P(refined) >= 0.50 → mixed. */
export function decide(p: Probabilities, threshold: number): UnitProvenance {
  if (p.ai + p.adversarial >= threshold) return 'ai';
  if (p.human >= 0.7) return 'human';
  if (p.refined >= 0.5) return 'mixed';
  return 'uncertain';
}

/** Class probabilities for already-extracted features (no language gate): the function the Python reference must match. */
export function probabilitiesFromFeatures(model: FastModel, f: { dense: ArrayLike<number>; hashed: Map<number, number> }, lang: LanguageId): Probabilities {
  const c = model.meta.classes.length;
  const d = model.meta.nFeatures;
  const familyIndex = HASH_BUCKETS + N_DENSE + FAMILIES.indexOf(LANGUAGE_FAMILY[lang]);
  const logits = new Float64Array(c);
  for (let k = 0; k < c; k += 1) {
    const row = k * d;
    let z = model.biases[k]!;
    for (const [bucket, value] of f.hashed) z += model.weights[row + bucket]! * value;
    for (let i = 0; i < N_DENSE; i += 1) z += model.weights[row + HASH_BUCKETS + i]! * f.dense[i]!;
    z += model.weights[row + familyIndex]!;
    logits[k] = z / model.meta.temperature;
  }
  const max = Math.max(...logits);
  let sum = 0;
  const exp = Array.from(logits, (z) => {
    const e = Math.exp(z - max);
    sum += e;
    return e;
  });
  const probabilities: Probabilities = { human: 0, ai: 0, refined: 0, adversarial: 0 };
  model.meta.classes.forEach((name, k) => {
    if (name in probabilities) probabilities[name as keyof Probabilities] = exp[k]! / sum;
  });
  return probabilities;
}

/** Probabilities and provenance for one unit, or null when this language has no enabled model. */
export function classifyUnit(
  model: FastModel,
  unit: FeatureInput,
  lang: LanguageId,
): { probabilities: Probabilities; provenance: UnitProvenance } | null {
  const lm = model.meta.languages[lang];
  if (!lm?.enabled) return null;
  const probabilities = probabilitiesFromFeatures(model, extractFeatures(unit, lang), lang);
  return { probabilities, provenance: decide(probabilities, lm.threshold) };
}

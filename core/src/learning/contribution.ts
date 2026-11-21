import type { LabelSource } from './labels.js';

/**
 * One shared record: a trusted label plus numbers that describe the code's style. Never the code, a hash of it, a path, a name
 * or anything that identifies a person. The key list below is the whole schema: a record with any other key is refused.
 */
export const CONTRIBUTION_KEYS = ['label', 'labelSource', 'language', 'sizeBucket', 'style', 'probabilities', 'modelVersions', 'tuned', 'installId', 'cliVersion'] as const;

export type ContributionLabelSource = 'git-recorded' | 'pre-2021' | 'user-correction';

export interface Contribution {
  label: 'ai' | 'human';
  labelSource: ContributionLabelSource;
  language: string;
  /** Lines of the unit, rounded to the nearest 10 (at least 10). */
  sizeBucket: number;
  /** The unit's dense style statistics, rounded to 2 decimals. */
  style: number[];
  /** The global model's AI probability, 3 decimals. */
  probabilities: { ai: number };
  /** Which model produced `probabilities`, for example { fast: '0.2.1' } or { heuristic: 'style' }. */
  modelVersions: Record<string, string>;
  tuned: boolean;
  installId: string;
  cliVersion: string;
}

/** What the builder reads from a stored sample: numbers and labels, nothing else is ever copied. */
export interface ContributionInput {
  label: 'ai' | 'human';
  source: LabelSource;
  language: string;
  lines: number;
  dense: ArrayLike<number>;
  pBase: number;
}

export interface ContributionMeta {
  installId: string;
  cliVersion: string;
  /** For example 'fast:0.2.1' or 'heuristic' (the base tag the stored probabilities came from). */
  baseTag: string;
  tuned: boolean;
}

export const MAX_STYLE_VALUES = 64;
export const MAX_BATCH = 500;

const SOURCE: Record<LabelSource, ContributionLabelSource> = { recorded: 'git-recorded', 'pre-2021': 'pre-2021', mark: 'user-correction' };
const round = (n: number, places: number): number => {
  const k = 10 ** places;
  const v = Math.round(n * k) / k;
  return Number.isFinite(v) ? v : 0;
};

export function modelVersionsOf(baseTag: string): Record<string, string> {
  const m = /^fast:(.+)$/.exec(baseTag);
  return m ? { fast: m[1]! } : { heuristic: 'style' };
}

/** Build records from labelled units. Only allowed fields are read, so extra properties on the input (code, paths) cannot leak. */
export function buildContributions(items: ContributionInput[], meta: ContributionMeta): Contribution[] {
  const out: Contribution[] = [];
  for (const item of items) {
    if (item.label !== 'ai' && item.label !== 'human') continue;
    const source = SOURCE[item.source];
    if (!source || typeof item.language !== 'string' || !/^[a-z][a-z0-9+#-]{0,19}$/i.test(item.language)) continue;
    out.push({
      label: item.label,
      labelSource: source,
      language: item.language.toLowerCase(),
      sizeBucket: Math.max(10, Math.round((Number(item.lines) || 0) / 10) * 10),
      style: Array.from(item.dense, (v) => round(Number(v), 2)).slice(0, MAX_STYLE_VALUES),
      probabilities: { ai: round(item.pBase, 3) },
      modelVersions: modelVersionsOf(meta.baseTag),
      tuned: meta.tuned,
      installId: meta.installId,
      cliVersion: meta.cliVersion,
    });
  }
  return out;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The schema check the server runs on every record (and tests run on every record built): exact keys, exact types, sane ranges. */
export function isValidContribution(value: unknown): value is Contribution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length !== CONTRIBUTION_KEYS.length || !CONTRIBUTION_KEYS.every((k) => k in r)) return false;
  if (r.label !== 'ai' && r.label !== 'human') return false;
  if (!['git-recorded', 'pre-2021', 'user-correction'].includes(String(r.labelSource))) return false;
  if (typeof r.language !== 'string' || !/^[a-z][a-z0-9+#-]{0,19}$/.test(r.language)) return false;
  if (!isNum(r.sizeBucket) || r.sizeBucket < 10 || r.sizeBucket > 100_000 || r.sizeBucket % 10 !== 0) return false;
  if (!Array.isArray(r.style) || r.style.length === 0 || r.style.length > MAX_STYLE_VALUES || !r.style.every((v) => isNum(v) && Math.abs(v) <= 1e6)) return false;
  const p = r.probabilities as Record<string, unknown> | null;
  if (typeof p !== 'object' || p === null || Object.keys(p).length !== 1 || !isNum(p.ai) || p.ai < 0 || p.ai > 1) return false;
  const mv = r.modelVersions as Record<string, unknown> | null;
  if (typeof mv !== 'object' || mv === null || Array.isArray(mv)) return false;
  const mvKeys = Object.keys(mv);
  if (mvKeys.length < 1 || mvKeys.length > 2 || !mvKeys.every((k) => ['fast', 'heuristic'].includes(k) && typeof mv[k] === 'string' && /^[\w.+-]{1,32}$/.test(String(mv[k])))) return false;
  if (typeof r.tuned !== 'boolean') return false;
  if (typeof r.installId !== 'string' || !/^[0-9a-f]{32}$/.test(r.installId)) return false;
  if (typeof r.cliVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(r.cliVersion)) return false;
  return true;
}

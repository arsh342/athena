import type { ClassifiedFinding, ScoredUnit } from '../types.js';

/**
 * Per-unit hallucination detection used to match a hard-coded list of four invalid calls. API existence is now checked
 * against the installed package's type declarations at project level (see deps/api-exists.ts); this stays as the
 * per-unit hook and reports nothing.
 */
export function detectHallucinations(_scored: ScoredUnit): ClassifiedFinding[] {
  return [];
}

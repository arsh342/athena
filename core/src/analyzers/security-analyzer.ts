import type { AthenaConfig, ClassifiedFinding, ScoredUnit } from '../types.js';
import { detectHallucinations } from './hallucination-detector.js';

/** Per-unit checks. Secrets are scanned over whole files in the engine (see secrets/scan.ts). */
export function analyzeSecurity(scored: ScoredUnit, config: AthenaConfig): ClassifiedFinding[] {
  const findings: ClassifiedFinding[] = [];
  if (config.hallucinationDetection) findings.push(...detectHallucinations(scored));
  return findings;
}

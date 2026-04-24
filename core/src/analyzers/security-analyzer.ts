import type { AthenaConfig, ClassifiedFinding, ScoredUnit } from '../types.js';
import { detectHallucinations } from './hallucination-detector.js';
import { detectSecrets } from './secret-detector.js';

export function analyzeSecurity(scored: ScoredUnit, config: AthenaConfig): ClassifiedFinding[] {
  const findings: ClassifiedFinding[] = [];
  if (config.secretDetection) findings.push(...detectSecrets(scored));
  if (config.hallucinationDetection && scored.flagged) findings.push(...detectHallucinations(scored));
  return findings;
}

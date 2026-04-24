import { createHash } from 'node:crypto';
import type { ClassifiedFinding, ScoredUnit } from '../types.js';

const knownInvalidCalls = [
  { pattern: /\baxios\.fetchData\s*\(/g, api: 'axios.fetchData' },
  { pattern: /\bfs\.readFilePromise\s*\(/g, api: 'fs.readFilePromise' },
  { pattern: /\bexpress\.createServer\s*\(/g, api: 'express.createServer' },
  { pattern: /\bprisma\.connect\s*\(/g, api: 'prisma.connect' },
];

export function detectHallucinations(scored: ScoredUnit): ClassifiedFinding[] {
  const findings: ClassifiedFinding[] = [];

  for (const invalidCall of knownInvalidCalls) {
    for (const match of scored.unit.code.matchAll(invalidCall.pattern)) {
      const code = match[0];
      findings.push({
        id: createHash('sha1').update(`hallucination:${scored.unit.filePath}:${scored.unit.startLine}:${code}`).digest('hex').slice(0, 10),
        severity: scored.score >= 65 ? 'HIGH' : 'MEDIUM',
        type: 'Hallucinated API call',
        category: 'runtime-failure',
        message: `${invalidCall.api} is not part of the known API surface.`,
        file: scored.unit.filePath,
        line: scored.unit.startLine,
        column: 1,
        code,
        aiScore: scored.score,
        explainedScore: scored.explained,
        source: 'hallucination-detector',
        ruleId: 'hallucination.invalid-api-call',
      });
    }
  }

  return findings;
}

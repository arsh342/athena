import { createHash } from 'node:crypto';
import type { ClassifiedFinding, ScoredUnit } from '../types.js';

const secretPatterns = [
  { ruleId: 'secret.aws-access-key', label: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/g },
  { ruleId: 'secret.github-token', label: 'GitHub token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g },
  { ruleId: 'secret.jwt', label: 'JWT token', pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { ruleId: 'secret.private-key', label: 'Private key', pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----/g },
];

const hardcodedCredentialPattern = /(password|api[_-]?key|token|secret)\s*[:=]\s*['"][^'"]{8,}['"]/gi;
const sequelizeCredentialPattern = /new\s+Sequelize\s*\(\s*(['"`])([^'"`\r\n]+)\1\s*,\s*(['"`])([^'"`\r\n]+)\3\s*,\s*(['"`])([^'"`\r\n]+)\5/gi;

export function detectSecrets(scored: ScoredUnit): ClassifiedFinding[] {
  const findings: ClassifiedFinding[] = [];

  for (const definition of secretPatterns) {
    for (const match of scored.unit.code.matchAll(definition.pattern)) {
      findings.push(createFinding(scored, definition.ruleId, definition.label, match[0], 'credential-exposure'));
    }
  }

  for (const match of scored.unit.code.matchAll(hardcodedCredentialPattern)) {
    const matchedKey = match[1]?.toLowerCase() ?? '';
    const { ruleId, type } = classifyHardcodedCredential(matchedKey);
    findings.push(createFinding(scored, ruleId, type, match[0], 'credential-exposure'));
  }

  for (const match of scored.unit.code.matchAll(sequelizeCredentialPattern)) {
    const dbName = match[2] ?? 'db';
    const username = match[4] ?? 'user';
    findings.push(
      createFinding(
        scored,
        'secret.sequelize-constructor-credentials',
        'Hardcoded database credentials',
        match[0],
        'credential-exposure',
      ),
    );
    findings.push(
      createFinding(
        scored,
        'secret.sequelize-connection-metadata',
        'Hardcoded database connection metadata',
        `${dbName}:${username}`,
        'credential-exposure',
      ),
    );
  }

  const highEntropyStrings = [...scored.unit.code.matchAll(/['"]([A-Za-z0-9+/=_-]{24,})['"]/g)]
    .map((match) => match[1])
    .filter((value) => shannonEntropy(value) > 4.5 && !looksLikeFalsePositive(value));

  for (const value of highEntropyStrings) {
    findings.push(createFinding(scored, 'secret.high-entropy-string', 'Possible high-entropy secret', value, 'credential-exposure'));
  }

  return findings;
}

function classifyHardcodedCredential(key: string): { ruleId: string; type: string } {
  if (key.includes('password')) {
    return { ruleId: 'secret.hardcoded-password', type: 'Hardcoded password' };
  }
  if (key.includes('api') && key.includes('key')) {
    return { ruleId: 'secret.hardcoded-api-key', type: 'Hardcoded API key' };
  }
  if (key.includes('token')) {
    return { ruleId: 'secret.hardcoded-token', type: 'Hardcoded token' };
  }
  return { ruleId: 'secret.hardcoded-secret', type: 'Hardcoded secret' };
}

function createFinding(
  scored: ScoredUnit,
  ruleId: string,
  type: string,
  code: string,
  category: string,
): ClassifiedFinding {
  return {
    id: createHash('sha1').update(`${ruleId}:${scored.unit.filePath}:${scored.unit.startLine}:${code}`).digest('hex').slice(0, 10),
    severity: scored.score >= 65 ? 'CRITICAL' : 'HIGH',
    type,
    category,
    message: `${type} found inside flagged code unit ${scored.unit.name}.`,
    file: scored.unit.filePath,
    line: scored.unit.startLine,
    column: 1,
    code,
    aiScore: scored.score,
    explainedScore: scored.explained,
    source: 'secret-detector',
    ruleId,
  };
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  return Array.from(counts.values()).reduce((entropy, count) => {
    const p = count / value.length;
    return entropy - p * Math.log2(p);
  }, 0);
}

function looksLikeFalsePositive(value: string): boolean {
  return /^(https?:|\/|[A-Fa-f0-9]{6}$)/.test(value) || value.includes('/') || value.includes('.');
}

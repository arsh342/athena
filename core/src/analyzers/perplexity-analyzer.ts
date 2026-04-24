import type { CodeUnit, SignalResult } from '../types.js';

export function scorePerplexity(unit: CodeUnit, maxWeight: number): SignalResult {
  const tokens = tokenize(unit.code);
  if (tokens.length < 8) {
    return signal('perplexity', 0, maxWeight, 'insufficient tokens for perplexity estimate');
  }

  const entropy = shannonEntropy(tokens);
  const normalizedEntropy = clamp01((entropy - 2.2) / 2.2);
  const repetitionPenalty = repetitionRate(tokens);

  // Lower entropy and higher repetition imply more predictable (AI-like) output.
  const predictability = clamp01((1 - normalizedEntropy) * 0.75 + repetitionPenalty * 0.25);
  const score = Math.round(maxWeight * predictability);

  return signal(
    'perplexity',
    score,
    maxWeight,
    `token entropy ${entropy.toFixed(2)}, repetition ${Math.round(repetitionPenalty * 100)}%`,
  );
}

function tokenize(code: string): string[] {
  return code
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function shannonEntropy(tokens: string[]): number {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return Array.from(counts.values()).reduce((entropy, count) => {
    const p = count / tokens.length;
    return entropy - p * Math.log2(p);
  }, 0);
}

function repetitionRate(tokens: string[]): number {
  const unique = new Set(tokens).size;
  return clamp01(1 - unique / Math.max(1, tokens.length));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function signal(signalName: string, score: number, maxWeight: number, evidence: string): SignalResult {
  return {
    signal: signalName,
    score: Math.max(0, Math.min(maxWeight, Math.round(score))),
    maxWeight,
    evidence,
  };
}

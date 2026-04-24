import type { CodeUnit, SignalResult } from '../types.js';

export function scoreBurstiness(unit: CodeUnit, maxWeight: number): SignalResult {
  const sentences = splitSentences(unit.code);
  if (sentences.length < 3) {
    return signal('burstiness', 0, maxWeight, 'insufficient sentence count for burstiness estimate');
  }

  const lengths = sentences.map((sentence) => tokenize(sentence).length).filter((count) => count > 0);
  if (lengths.length < 3) {
    return signal('burstiness', 0, maxWeight, 'insufficient tokenized sentences for burstiness estimate');
  }

  const mean = average(lengths);
  const stdDev = standardDeviation(lengths, mean);
  const coeffVar = stdDev / Math.max(1, mean);
  const openerVariety = sentenceOpenerVariety(sentences);

  // Lower variation in sentence shape/length implies lower burstiness (AI-like).
  const lowLengthVariation = clamp01((0.55 - coeffVar) / 0.55);
  const lowOpenerVariation = clamp01((0.75 - openerVariety) / 0.75);
  const score = Math.round(maxWeight * (lowLengthVariation * 0.7 + lowOpenerVariation * 0.3));

  return signal(
    'burstiness',
    score,
    maxWeight,
    `sentence cv ${coeffVar.toFixed(2)}, opener variety ${Math.round(openerVariety * 100)}%`,
  );
}

function splitSentences(code: string): string[] {
  return code
    .replace(/\s+/g, ' ')
    .split(/[.!?;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function sentenceOpenerVariety(sentences: string[]): number {
  const starters = sentences
    .map((sentence) => tokenize(sentence)[0])
    .filter((token): token is string => Boolean(token));

  if (starters.length === 0) return 0;
  return new Set(starters).size / starters.length;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values: number[], mean: number): number {
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  return Math.sqrt(variance);
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

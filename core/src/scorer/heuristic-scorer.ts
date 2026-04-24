import type { AthenaConfig, CodeUnit, ConfidenceBand, ExplainedScore, ScoredUnit, SignalResult } from '../types.js';
import { scoreBurstiness } from '../analyzers/burstiness-analyzer.js';
import { scorePerplexity } from '../analyzers/perplexity-analyzer.js';

const genericNames = new Set([
  'data',
  'result',
  'results',
  'item',
  'items',
  'value',
  'values',
  'temp',
  'obj',
  'arr',
  'response',
  'payload',
  'config',
  'options',
]);

export function scoreUnit(unit: CodeUnit, config: AthenaConfig): ScoredUnit {
  const signals = [
    scoreGenericNames(unit, config.weights.genericNames),
    scoreCommentRatio(unit, config.weights.commentRatio),
    scoreObviousComments(unit, config.weights.obviousComments),
    scoreEmptyCatch(unit, config.weights.emptyCatch),
    scoreNullChecks(unit, config.weights.nullChecks),
    scoreFormattingUniformity(unit, config.weights.formattingUniformity),
    scoreUniversalJsdoc(unit, config.weights.universalJsdoc),
    scoreNamingEntropy(unit, config.weights.namingEntropy),
    scoreBoilerplatePatterns(unit, config.weights.boilerplatePatterns),
    scoreHelperOrdering(unit, config.weights.helperOrdering),
    scoreEmojiComments(unit, config.weights.emojiComments),
    scorePerplexity(unit, config.weights.perplexity),
    scoreBurstiness(unit, config.weights.burstiness),
  ];

  const max = signals.reduce((sum, signal) => sum + signal.maxWeight, 0);
  const raw = signals.reduce((sum, signal) => sum + signal.score, 0);
  const score = Math.round((raw / max) * 100);
  const explained = explain(score, signals);

  return {
    unit,
    score,
    signals,
    flagged: score >= config.threshold,
    explained,
  };
}

function signal(signal: string, score: number, maxWeight: number, evidence: string): SignalResult {
  return {
    signal,
    score: Math.max(0, Math.min(maxWeight, Math.round(score))),
    maxWeight,
    evidence,
  };
}

function scoreGenericNames(unit: CodeUnit, max: number): SignalResult {
  const identifiers = unit.metadata.identifiers;
  const hits = identifiers.filter((name) => genericNames.has(name.toLowerCase())).length;
  const ratio = hits / Math.max(1, identifiers.length);
  return signal('genericNames', ratio * max * 3, max, `${hits}/${identifiers.length} identifiers are generic`);
}

function scoreCommentRatio(unit: CodeUnit, max: number): SignalResult {
  const ratio = unit.metadata.commentRatio;
  return signal('commentRatio', ratio >= 0.4 ? max : (ratio / 0.4) * max, max, `comment ratio ${ratio.toFixed(2)}`);
}

function scoreObviousComments(unit: CodeUnit, max: number): SignalResult {
  const obvious = /\/\/\s*(set|get|return|create|update|delete|loop|check|initialize|calculate|fetch)\b/i.test(unit.code);
  return signal('obviousComments', obvious ? max : 0, max, obvious ? 'obvious explanatory comment found' : 'no obvious comments');
}

function scoreEmptyCatch(unit: CodeUnit, max: number): SignalResult {
  const emptyCatch = /catch\s*\([^)]*\)\s*\{\s*(console\.(error|log)\([^)]*\);\s*)?\}/s.test(unit.code);
  return signal('emptyCatch', emptyCatch ? max : 0, max, emptyCatch ? 'empty or log-only catch block' : 'catch blocks include handling');
}

function scoreNullChecks(unit: CodeUnit, max: number): SignalResult {
  const checks = (unit.code.match(/(\?\?|\?\.|typeof\s+\w+\s*===\s*['"]undefined['"]|!==\s*null|===\s*null)/g) ?? []).length;
  return signal('nullChecks', Math.min(max, checks * 2), max, `${checks} defensive null/undefined checks`);
}

function scoreFormattingUniformity(unit: CodeUnit, max: number): SignalResult {
  const indents = unit.code
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const unique = new Set(indents);
  return signal('formattingUniformity', unique.size <= 3 && indents.length > 8 ? max : max * 0.2, max, `${unique.size} indentation levels`);
}

function scoreUniversalJsdoc(unit: CodeUnit, max: number): SignalResult {
  return signal('universalJsdoc', unit.metadata.hasJSDoc ? max : 0, max, unit.metadata.hasJSDoc ? 'JSDoc present' : 'no JSDoc');
}

function scoreNamingEntropy(unit: CodeUnit, max: number): SignalResult {
  const entropy = shannonEntropy(unit.metadata.identifiers.join(''));
  const score = entropy < 3.2 ? max : entropy < 3.8 ? max * 0.5 : 0;
  return signal('namingEntropy', score, max, `identifier entropy ${entropy.toFixed(2)}`);
}

function scoreBoilerplatePatterns(unit: CodeUnit, max: number): SignalResult {
  const patterns = [
    /async\s+function\s+(get|create|update|delete)\w+/i,
    /try\s*\{[\s\S]*\}\s*catch\s*\(error\)/i,
    /res\.status\(\d{3}\)\.json/i,
    /useState\([^)]*\)[\s\S]*useEffect/i,
  ];
  const hits = patterns.filter((pattern) => pattern.test(unit.code)).length;
  return signal('boilerplatePatterns', hits * (max / 2), max, `${hits} boilerplate patterns`);
}

function scoreHelperOrdering(unit: CodeUnit, max: number): SignalResult {
  const helperDefinitions = (unit.code.match(/function\s+(validate|format|process|handle|create|update)\w*/gi) ?? []).length;
  const sequentialCalls = /(validate\w*\([^)]*\)[\s\S]*format\w*\([^)]*\)[\s\S]*process\w*\([^)]*\))/i.test(unit.code);
  return signal('helperOrdering', helperDefinitions >= 2 || sequentialCalls ? max : 0, max, `${helperDefinitions} helper-like definitions`);
}

function scoreEmojiComments(unit: CodeUnit, max: number): SignalResult {
  const emojiLike = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(unit.code);
  return signal('emojiComments', emojiLike ? max : 0, max, emojiLike ? 'emoji-like character found' : 'no emoji comments');
}

function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  return Array.from(counts.values()).reduce((entropy, count) => {
    const p = count / value.length;
    return entropy - p * Math.log2(p);
  }, 0);
}

function explain(score: number, signals: SignalResult[]): ExplainedScore {
  const band: ConfidenceBand = score < 40 ? 'LOW' : score < 70 ? 'UNCERTAIN' : 'HIGH';
  const total = signals.reduce((sum, signal) => sum + signal.score, 0);
  const mean = total / Math.max(1, signals.length);
  const variance = signals.reduce((sum, signal) => sum + (signal.score - mean) ** 2, 0) / Math.max(1, signals.length);

  return {
    score,
    band,
    signalsTriggered: signals.filter((signal) => signal.score > 0).length,
    variance: Math.round(variance),
    topSignals: signals
      .filter((signal) => signal.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((signalResult) => ({
        signal: signalResult.signal,
        contribution: total === 0 ? 0 : Math.round((signalResult.score / total) * 100),
        score: signalResult.score,
      })),
  };
}

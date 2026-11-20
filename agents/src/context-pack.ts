import type { ClassifiedFinding } from '@athena/core';

import { estimateTokens } from './providers/types.js';

/** A pack must stay small: typically 1-3k tokens. */
export const PACK_TOKEN_CAP = 3000;
const CHECKLIST_CHARS = 3200; // about 800 tokens
const WINDOW = 20;

export interface ContextPack {
  id: string;
  text: string;
  tokens: number;
}

/** `athena review`: which lines the change touched in this file, and what it removed. */
export interface ChangeNote { changedLines: string; removed: string[] }

export interface Sibling { file: string; line: number; snippet: string }

/** Repository text is data: keep it from closing our wrapper tags or posing as markup. */
function neutralise(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›');
}

function numbered(source: string, center: number, radius: number): string {
  const lines = source.split('\n');
  const a = Math.max(1, center - radius);
  const b = Math.min(lines.length, center + radius);
  return lines.slice(a - 1, b).map((l, i) => `${a + i}: ${l.length > 240 ? `${l.slice(0, 240)}…` : l}`).join('\n');
}

/**
 * Everything the model needs to judge one finding and nothing else: the cited lines +- 20, the source-to-sink trace, what the
 * offline checks found (guards, reachability, impact), conforming siblings for convention findings, and the skill's checklist.
 */
export function buildContextPack(input: { finding: Pick<ClassifiedFinding, 'id' | 'ruleId' | 'severity' | 'message' | 'file' | 'line' | 'code' | 'confidence' | 'evidence' | 'trace' | 'exposure'>; source: string; siblings: Sibling[]; checklist: string; change?: ChangeNote }): ContextPack {
  const f = input.finding;
  const build = (radius: number, checklistChars: number, siblings: Sibling[]): string => {
    const parts = [
      `<finding id="${neutralise(f.id)}">`,
      `rule: ${neutralise(f.ruleId)} (${f.severity}${f.exposure ? `, ${f.exposure}` : ''}${f.confidence ? `, offline confidence ${f.confidence}` : ''})`,
      `claim: ${neutralise(f.message.replace(/\s+/g, ' ').slice(0, 300))}`,
      `location: ${neutralise(f.file)}:${f.line}`,
      `code (cited line ${f.line}, +-${radius} lines):`,
      neutralise(numbered(input.source, f.line, radius)),
    ];
    if (input.change) parts.push(`change: lines ${neutralise(input.change.changedLines)} were changed${input.change.removed.length ? '; removed code:' : ''}`, ...input.change.removed.slice(0, 12).map((l) => `- ${neutralise(l.slice(0, 200))}`));
    if (f.trace?.length) parts.push('data flow:', ...f.trace.map((t) => `- ${neutralise(t.file ?? f.file)}:${t.line} ${neutralise(t.note)}`));
    if (f.evidence?.length) parts.push('offline checks:', ...f.evidence.map((e) => `- ${neutralise(e)}`));
    if (siblings.length) parts.push('conforming siblings:', ...siblings.slice(0, 2).map((s) => `- ${neutralise(s.file)}:${s.line} ${neutralise(s.snippet.slice(0, 300))}`));
    if (input.checklist) parts.push('checklist:', neutralise(input.checklist.slice(0, checklistChars)));
    parts.push('</finding>');
    return parts.join('\n');
  };
  const sizeOf = (text: string): number => estimateTokens({ model: '', system: { stable: text }, messages: [], maxTokens: 0 });
  let radius = WINDOW;
  let checklist = CHECKLIST_CHARS;
  let text = build(radius, checklist, input.siblings);
  // Shrink what can be shrunk, least valuable first, until it fits.
  while (sizeOf(text) > PACK_TOKEN_CAP && (checklist > 0 || radius > 3)) {
    if (checklist > 0) checklist = Math.max(0, Math.floor(checklist / 2) - 1);
    else radius -= 3;
    text = build(Math.max(3, radius), checklist, input.siblings);
  }
  return { id: f.id, text, tokens: sizeOf(text) };
}

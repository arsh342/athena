import { PATTERN_RULES, TAINT_RULES } from '../common.js';
import type { CallInfo, CallRule, FileContext, LineRule, RuleMeta, SinkSpec } from '../types.js';

const BY_ID = new Map<string, RuleMeta>([...TAINT_RULES, ...PATTERN_RULES].map((r) => [r.id, r]));

export function metaFor(id: string): RuleMeta {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown rule ${id}`);
  return found;
}

export function callRule(id: string, callee: RegExp, test?: CallRule['test']): CallRule {
  return { ...metaFor(id), callee, ...(test ? { test } : {}) };
}

export function lineRule(id: string, line: RegExp, test?: LineRule['test']): LineRule {
  return { ...metaFor(id), line, ...(test ? { test } : {}) };
}

export function sink(ruleId: string, callee: RegExp, args: number[] | 'any', guard?: RegExp, callText?: RegExp, fnGuard?: RegExp, skipIdentifierArgs?: boolean, unlessText?: RegExp): SinkSpec {
  return { ruleId, callee, args, ...(guard ? { guard } : {}), ...(callText ? { callText } : {}), ...(fnGuard ? { fnGuard } : {}), ...(skipIdentifierArgs ? { skipIdentifierArgs } : {}), ...(unlessText ? { unlessText } : {}) };
}

export function assignSink(ruleId: string, assign: RegExp): SinkSpec {
  return { ruleId, callee: /(?!)/, assign, args: 'any' };
}

export const argText = (call: CallInfo, index: number): string => call.args[index]?.text ?? '';
export const isStringLiteral = (text: string): boolean => /^(['"`])(?:(?!\1)[^\\$]|\\.)*\1$/.test(text.trim()) && !text.includes('${');

/** Words that suggest the surrounding code deals with credentials or session material. */
export const SECRET_CONTEXT = /(?:^|[^a-z])(?:token|secret|passw(?:or)?d|passwd|session|csrf|nonce|otp|reset|api_?key|salt|credential)/i;
export const PASSWORD_CONTEXT = /(?:^|[^a-z])(?:passw(?:or)?d|passwd|credential|secret|token)/i;

export function lineOf(call: CallInfo, ctx: FileContext): string {
  return ctx.lines[call.line - 1] ?? '';
}

/** Common weak-hash check: algorithm name in an argument and password-like context in the function or line. */
export function weakHashTest(algo: RegExp, argIndex = 0): CallRule['test'] {
  return (call, ctx) => (algo.test(argText(call, argIndex)) && (PASSWORD_CONTEXT.test(call.fnText || ctx.source.slice(0, 0)) || PASSWORD_CONTEXT.test(lineOf(call, ctx))) ? 'Weak hash used where a password or secret is in play.' : null);
}

export function insecureRandomTest(): CallRule['test'] {
  return (call, ctx) => (SECRET_CONTEXT.test(lineOf(call, ctx)) ? 'Predictable random value used for a secret-looking name.' : null);
}

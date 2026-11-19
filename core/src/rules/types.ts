import type { LanguageFamily, LanguageId } from '../lang/languages.js';
import type { TSNode } from '../lang/parser-pool.js';
import type { FindingSource, Severity } from '../types.js';

export type Confidence = 'high' | 'medium' | 'low';
export type RuleKind = 'pattern' | 'taint' | 'investigate' | 'secret';

export interface RuleMeta {
  id: string;
  title: string;
  severity: Severity;
  cwe: string[];
  category: string;
  kind: RuleKind;
  /** Families the rule applies to; omitted means all. */
  families?: LanguageFamily[];
  why: string;
  fix: string;
  references: string[];
  /** Default confidence for findings of this rule (taint/verify may raise or lower it). */
  confidence?: Confidence;
}

export interface TraceStep {
  line: number;
  note: string;
  file?: string;
}

export interface RawFinding {
  ruleId: string;
  line: number;
  column?: number;
  /** Source text shown in the report (the matched expression). */
  code: string;
  message?: string;
  trace?: TraceStep[];
  confidence?: Confidence;
  evidence?: string[];
  exposure?: 'public' | 'authenticated' | 'internal';
  priority?: number;
  /** Skill that defined the rule, when it did not come from the built-in packs. */
  skill?: string;
  source: FindingSource;
}

/** A call-site rule: fires when a call's callee matches and the optional test returns evidence. */
export interface CallRule extends RuleMeta {
  callee: RegExp;
  /** Return a short evidence string to report, or null to stay silent. */
  test?: (call: CallInfo, ctx: FileContext) => string | null;
}

/** A line rule: fires on non-comment source lines matching the regex. */
export interface LineRule extends RuleMeta {
  line: RegExp;
  test?: (line: string, ctx: FileContext) => boolean;
}

export interface SinkSpec {
  ruleId: string;
  callee: RegExp;
  /** For property sinks (`el.innerHTML = x`): matches the assignment target instead of a callee. */
  assign?: RegExp;
  /** Zero-based argument indexes whose taint matters, or `any`. */
  args: number[] | 'any';
  /** Only a sink when the whole call text matches (e.g. `sh -c`, or a response writer as first argument). */
  callText?: RegExp;
  /** Per-variable guard: a line of the enclosing function that mentions a variable of the sink argument AND matches this (e.g. a prefix check) protects that sink. */
  guard?: RegExp;
  /** Function-level guard (e.g. the response content type is not HTML): if the enclosing function matches, the sink is protected. */
  fnGuard?: RegExp;
  /** Skip when the call text matches (e.g. an explicit JSON mimetype). */
  unlessText?: RegExp;
  /** Skip plain identifier arguments (a variable that may hold an argument vector) unless callText matched. */
  skipIdentifierArgs?: boolean;
}

export interface FamilyPack {
  family: LanguageFamily;
  sources: RegExp[];
  sanitizers: RegExp[];
  /** Calls whose result is never attacker-controlled text (numbers, lengths). */
  cleanCalls: RegExp;
  sinks: SinkSpec[];
  callRules: CallRule[];
  lineRules: LineRule[];
  /** Zero-based indexes of parameters that are attacker-controlled at function entry (framework extractors). */
  taintedParams?: (fn: TSNode, lang: LanguageId) => number[];
}

export interface CallInfo {
  node: TSNode;
  callee: string;
  args: TSNode[];
  line: number;
  /** Text of the whole enclosing function, or '' at file level. */
  fnText: string;
}

export interface FileContext {
  path: string;
  /** Path relative to the scan root (used for test/vendored path rules). */
  relPath: string;
  lang: LanguageId;
  family: LanguageFamily;
  source: string;
  lines: string[];
  root: TSNode;
}

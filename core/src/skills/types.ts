import type { LanguageFamily } from '../lang/languages.js';
import type { Severity } from '../types.js';

export type SkillSource = 'repo' | 'user' | 'builtin';

export type Predicate =
  | { op: 'argIsNonLiteral'; index: number }
  | { op: 'argIsConcat'; index: number }
  | { op: 'argMatches' | 'argNotMatches'; index: number; regex: string }
  | { op: 'isLastMatch' | 'inRunBlock' }
  | { op: 'textAfterNotMatches'; regex: string }
  | { op: 'callTextMatches' | 'callTextNotMatches' | 'fnTextMatches' | 'fnTextNotMatches' | 'fileTextMatches' | 'fileTextNotMatches' | 'lineMatches' | 'lineNotMatches'; regex: string };

export type MatchDef =
  | { kind: 'call'; callee: string; where?: Predicate[] }
  | { kind: 'line'; line: string; where?: Predicate[] }
  | { kind: 'file'; files: string; line: string; where?: Predicate[] };

export interface SkillRuleDef {
  id: string;
  title: string;
  severity: Severity;
  cwe: number[];
  category: string;
  why: string;
  fix: string;
  confidence?: 'high' | 'medium' | 'low';
  families?: LanguageFamily[];
  match: MatchDef;
}

export interface SkillSinkDef {
  /** A built-in taint rule id (taint.*) or one of this skill's own rule ids. */
  rule: string;
  callee: string;
  args: number[] | 'any';
  callText?: string;
}

export interface SkillTaintDef {
  families: LanguageFamily[];
  sources?: string[];
  sanitizers?: string[];
  sinks?: SkillSinkDef[];
}

export interface SkillDetect {
  dependencies?: string[];
  imports?: string[];
  files?: string[];
  always?: boolean;
}

export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  license?: string;
  author?: string;
  appliesTo: { languages?: string[]; frameworks?: string[]; detect?: SkillDetect };
  categories: string[];
}

export interface Skill {
  meta: SkillMeta;
  dir: string;
  source: SkillSource;
  body: string;
  sections: Record<string, string>;
  rules: SkillRuleDef[];
  taint: SkillTaintDef | null;
  fixtures: { vuln: string[]; safe: string[] };
  /** Commit a third-party skill was pinned to when installed. */
  commit?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export const SECTION_NAMES = ['When this applies', 'How to investigate', 'Verification checklist', 'Fixes', 'References'] as const;
export const FAMILIES: LanguageFamily[] = ['js', 'python', 'java', 'csharp', 'c', 'go', 'rust', 'php', 'shell'];

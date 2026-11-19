import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { analyzeProject, type ProjectFile } from '../analysis/project.js';
import { parseCall } from '../analysis/lang.js';
import { LANGUAGE_FAMILY, type LanguageId } from '../lang/languages.js';
import { getParser, type TSNode } from '../lang/parser-pool.js';
import { getRuleInfo } from '../rules/catalog.js';
import { ruleMeta } from '../rules/registry.js';
import { compileSkills } from './compile.js';
import { learnedAsSkill } from './loader.js';
import type { Predicate, SkillRuleDef } from './types.js';
import { validateRulesDocument } from './validate.js';

export interface FindingRef {
  ruleId: string;
  file: string;
  line: number;
  code: string;
  /** The confirmed finding's own classification (from the saved report). */
  severity?: SkillRuleDef['severity'];
  category?: string;
  cwe?: number[];
  title?: string;
}

export const MAX_VARIANT_MATCHES = 50;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `knex('users').whereRaw` -> `whereRaw`: the member name after the last call. */
function lastMember(callee: string): string {
  return esc(callee.slice(callee.lastIndexOf(').') + 2) || callee.split('.').pop() || callee);
}

function callsOnLine(root: TSNode, line: number, family: ReturnType<typeof familyOf>): TSNode[] {
  const out: TSNode[] = [];
  const stack: TSNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.startPosition.row + 1 === line && parseCall(n, family)?.callee) out.push(n);
    for (const c of n.children) if (c && c.isNamed && c.startPosition.row + 1 <= line && c.endPosition.row + 1 >= line) stack.push(c);
  }
  return out;
}
const familyOf = (lang: LanguageId) => LANGUAGE_FAMILY[lang];

function isLiteralText(text: string): boolean {
  return /^(?:[rbRBuU])?(["'`])(?:(?!\1)[^\\$]|\\.)*\1$/.test(text.trim()) && !text.includes('${') || /^\d+(?:\.\d+)?$/.test(text.trim());
}

function isConcatText(text: string): boolean {
  return !isLiteralText(text) && /\s\+\s|\$\{|^[fF]["']|\.format\(|%\s*[(\w]|\+\s*\w|\w\s*\+/.test(text);
}

/**
 * Generalise a confirmed finding into a rule that finds its cousins: the callee of the sink call plus the
 * shape of the unsafe argument (concatenated or merely non-literal). Returns null when the finding is not a call.
 */
export async function deriveVariantRule(finding: FindingRef, source: string, lang: LanguageId): Promise<SkillRuleDef | null> {
  const parser = await getParser(lang);
  const tree = parser.parse(source);
  if (!tree) return null;
  try {
    const family = familyOf(lang);
    const calls = callsOnLine(tree.rootNode, finding.line, family)
      .map((node) => ({ node, parsed: parseCall(node, family)! }))
      // Prefer the call that appears in the finding's code, outermost first.
      .sort((a, b) => Number(finding.code.includes(b.parsed.callee)) - Number(finding.code.includes(a.parsed.callee)) || a.node.startIndex - b.node.startIndex);
    // Only findings that are about a call generalise: taint findings, or findings whose text starts with the call.
    const normCode = finding.code.replace(/\s+/g, '');
    const callBased = finding.ruleId.startsWith('taint.') || calls.some(({ parsed }) => normCode.startsWith(parsed.callee.replace(/\s+/g, '')));
    if (!callBased || /^(?:secret|conv|intent|state)\./.test(finding.ruleId)) return null;
    for (const { parsed } of calls) {
      const index = parsed.args.findIndex((a) => !isLiteralText(a.text));
      if (index < 0) continue;
      const where: Predicate[] = [isConcatText(parsed.args[index]!.text) ? { op: 'argIsConcat', index } : { op: 'argIsNonLiteral', index }];
      const meta = ruleMeta(finding.ruleId);
      const info = getRuleInfo(finding.ruleId);
      const cwes = finding.cwe ?? meta?.cwe.map((c) => Number(c.replace(/\D/g, ''))) ?? (info?.references.map((u) => /definitions\/(\d+)/.exec(u)?.[1]).filter((x): x is string => !!x).map(Number) ?? []);
      const title = finding.title ?? meta?.title ?? info?.title ?? finding.ruleId;
      const hash = createHash('sha1').update(`${family}:${parsed.callee}:${where[0]!.op}:${index}`).digest('hex').slice(0, 8);
      return {
        id: `learned.${hash}`,
        title: `Similar to: ${title}`,
        severity: finding.severity ?? meta?.severity ?? 'MEDIUM',
        cwe: cwes,
        category: finding.category ?? meta?.category ?? 'learned',
        why: `This call has the same shape as one confirmed as "${title}": ${parsed.callee}(...) with ${where[0]!.op === 'argIsConcat' ? 'a concatenated or interpolated' : 'a non-literal'} argument ${index + 1}.`,
        fix: meta?.fix ?? info?.fix ?? 'Apply the same fix as the confirmed finding.',
        confidence: 'medium',
        families: [family],
        match: { kind: 'call', callee: parsed.callee.includes('(') ? `\\.${esc(parsed.callee.replace(/\(.*$/s, '').split(/[.]/).pop() ?? '')}$`.replace(/^\\\.(.*)$/, (_m, n: string) => `\\.${lastMember(parsed.callee)}$`) : `^${esc(parsed.callee)}$`, where },
      };
    }
    return null;
  } finally {
    tree.delete();
  }
}

export interface VariantPreview {
  matches: Array<{ file: string; line: number; code: string }>;
  tooBroad: boolean;
}

/** Run a derived rule over the project (excluding the finding it came from). */
export async function previewVariant(rule: SkillRuleDef, files: ProjectFile[], root: string, origin?: FindingRef): Promise<VariantPreview> {
  const skill = learnedAsSkill([rule]);
  if (!skill) return { matches: [], tooBroad: false };
  const compiled = compileSkills([skill]);
  const result = await analyzeProject(files, { root, skills: compiled });
  const matches: VariantPreview['matches'] = [];
  for (const [file, list] of result.findings) {
    for (const f of list) {
      if (f.ruleId !== rule.id) continue;
      if (origin && file === origin.file && f.line === origin.line) continue;
      matches.push({ file, line: f.line, code: f.code });
    }
  }
  matches.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { matches, tooBroad: matches.length > MAX_VARIANT_MATCHES };
}

/** Add the rule to `<root>/.athena/learned-rules.json` (idempotent by rule id). Returns the file path. */
export function saveVariant(root: string, rule: SkillRuleDef): string {
  const path = join(root, '.athena', 'learned-rules.json');
  let rules: SkillRuleDef[] = [];
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { rules?: unknown[] };
    const parsed = validateRulesDocument(raw, 'learned');
    // Never rewrite the file if that would drop rules the user wrote or edited by hand.
    if (parsed.issues.length > 0 || parsed.rules.length !== (raw.rules?.length ?? 0)) throw new Error(`${path} contains invalid rules (${parsed.issues[0]?.path}: ${parsed.issues[0]?.message}); fix or delete them first`);
    rules = parsed.rules;
  }
  if (!rules.some((r) => r.id === rule.id)) rules.push(rule);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ rules }, null, 2)}\n`);
  return path;
}

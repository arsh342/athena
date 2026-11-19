import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

import { allRuleMeta, ruleMeta } from '../rules/registry.js';
import { compileSafeRegex } from './regex-safety.js';
import { FAMILIES, SECTION_NAMES, type MatchDef, type Predicate, type Skill, type SkillMeta, type SkillRuleDef, type SkillSource, type SkillTaintDef, type ValidationIssue } from './types.js';

const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const ALLOWED_FILES = /^(?:SKILL\.md|rules\.json|taint\.json|LICENSE(?:\.\w+)?|README\.md|\.skill-source\.json)$/;
const MAX_BYTES = 512 * 1024;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

let strictMode = false;

function rx(issues: ValidationIssue[], path: string, source: unknown): void {
  if (typeof source !== 'string') {
    issues.push({ path, message: 'must be a string' });
    return;
  }
  const verdict = compileSafeRegex(source, 'im', { strict: strictMode });
  if (!verdict.ok) issues.push({ path, message: verdict.reason ?? 'unsafe regular expression' });
}

const PRED_OPS = new Set(['isLastMatch', 'textAfterNotMatches', 'inRunBlock', 'argIsNonLiteral', 'argIsConcat', 'argMatches', 'argNotMatches', 'callTextMatches', 'callTextNotMatches', 'fnTextMatches', 'fnTextNotMatches', 'fileTextMatches', 'fileTextNotMatches', 'lineMatches', 'lineNotMatches']);

function checkWhere(issues: ValidationIssue[], path: string, where: unknown): Predicate[] {
  if (where === undefined) return [];
  if (!Array.isArray(where)) {
    issues.push({ path, message: 'must be an array of predicates' });
    return [];
  }
  where.forEach((p, i) => {
    const at = `${path}[${i}]`;
    if (!isObj(p) || typeof p.op !== 'string' || !PRED_OPS.has(p.op)) {
      issues.push({ path: at, message: `unknown predicate (allowed: ${[...PRED_OPS].join(', ')})` });
      return;
    }
    if (/^arg/.test(p.op) && (typeof p.index !== 'number' || p.index < 0 || p.index > 9)) issues.push({ path: `${at}.index`, message: 'must be a number 0-9' });
    if (/Matches$|NotMatches$/.test(p.op)) rx(issues, `${at}.regex`, p.regex);
    for (const key of Object.keys(p)) if (!['op', 'index', 'regex'].includes(key)) issues.push({ path: `${at}.${key}`, message: 'unknown field' });
  });
  return where as Predicate[];
}

export function checkRule(issues: ValidationIssue[], skillName: string, rule: unknown, i: number): SkillRuleDef | null {
  const at = `rules.json rules[${i}]`;
  if (!isObj(rule)) {
    issues.push({ path: at, message: 'must be an object' });
    return null;
  }
  const before = issues.length;
  for (const key of ['id', 'title', 'category', 'why', 'fix']) if (typeof rule[key] !== 'string' || !(rule[key] as string).trim()) issues.push({ path: `${at}.${key}`, message: 'required string' });
  if (typeof rule.id === 'string' && !rule.id.startsWith(`${skillName}.`)) issues.push({ path: `${at}.id`, message: `must start with "${skillName}."` });
  if (typeof rule.id === 'string' && ruleMeta(rule.id)) issues.push({ path: `${at}.id`, message: 'is already defined by a built-in rule (skills cannot redefine built-in rules)' });
  if (!SEVERITIES.includes(rule.severity as string)) issues.push({ path: `${at}.severity`, message: `must be one of ${SEVERITIES.join(', ')}` });
  if (!Array.isArray(rule.cwe) || !rule.cwe.every((n) => Number.isInteger(n))) issues.push({ path: `${at}.cwe`, message: 'must be an array of CWE numbers' });
  if (rule.families !== undefined && (!isStrArr(rule.families) || !rule.families.every((f) => FAMILIES.includes(f as never)))) issues.push({ path: `${at}.families`, message: `must be a subset of ${FAMILIES.join(', ')}` });
  if (rule.confidence !== undefined && !['high', 'medium', 'low'].includes(rule.confidence as string)) issues.push({ path: `${at}.confidence`, message: 'must be high, medium or low' });
  const m = rule.match;
  if (!isObj(m) || !['call', 'line', 'file'].includes(m.kind as string)) {
    issues.push({ path: `${at}.match.kind`, message: 'must be call, line or file' });
  } else {
    if (m.kind === 'call') rx(issues, `${at}.match.callee`, m.callee);
    if (m.kind === 'line' || m.kind === 'file') rx(issues, `${at}.match.line`, m.line);
    if (m.kind === 'file') rx(issues, `${at}.match.files`, m.files);
    checkWhere(issues, `${at}.match.where`, m.where);
    for (const key of Object.keys(m)) if (!['kind', 'callee', 'line', 'files', 'where'].includes(key)) issues.push({ path: `${at}.match.${key}`, message: 'unknown field' });
  }
  for (const key of Object.keys(rule)) if (!['id', 'title', 'severity', 'cwe', 'category', 'why', 'fix', 'confidence', 'families', 'match'].includes(key)) issues.push({ path: `${at}.${key}`, message: 'unknown field (skills are data only)' });
  return issues.length === before ? (rule as unknown as SkillRuleDef) : null;
}

function checkTaint(issues: ValidationIssue[], raw: unknown, ruleIds: Set<string>): SkillTaintDef | null {
  if (!isObj(raw)) {
    issues.push({ path: 'taint.json', message: 'must be an object' });
    return null;
  }
  const before = issues.length;
  if (!isStrArr(raw.families) || raw.families.length === 0 || !raw.families.every((f) => FAMILIES.includes(f as never))) issues.push({ path: 'taint.json families', message: `required subset of ${FAMILIES.join(', ')}` });
  for (const key of ['sources', 'sanitizers'] as const) {
    const list = raw[key];
    if (list === undefined) continue;
    if (!isStrArr(list)) issues.push({ path: `taint.json ${key}`, message: 'must be an array of regular expressions' });
    else list.forEach((s, i) => rx(issues, `taint.json ${key}[${i}]`, s));
  }
  if (raw.sinks !== undefined) {
    if (!Array.isArray(raw.sinks)) issues.push({ path: 'taint.json sinks', message: 'must be an array' });
    else raw.sinks.forEach((s, i) => {
      const at = `taint.json sinks[${i}]`;
      if (!isObj(s)) return void issues.push({ path: at, message: 'must be an object' });
      if (typeof s.rule !== 'string' || !(s.rule.startsWith('taint.') || ruleIds.has(s.rule))) issues.push({ path: `${at}.rule`, message: 'must be a built-in taint.* rule or a rule defined in rules.json' });
      rx(issues, `${at}.callee`, s.callee);
      if (s.callText !== undefined) rx(issues, `${at}.callText`, s.callText);
      if (!(s.args === 'any' || (Array.isArray(s.args) && s.args.every((n) => Number.isInteger(n) && n >= 0 && n < 10)))) issues.push({ path: `${at}.args`, message: 'must be "any" or an array of argument indexes' });
    });
  }
  for (const key of Object.keys(raw)) if (!['families', 'sources', 'sanitizers', 'sinks'].includes(key)) issues.push({ path: `taint.json ${key}`, message: 'unknown field' });
  return issues.length === before ? (raw as unknown as SkillTaintDef) : null;
}

export function parseSkillMd(text: string): { meta: Json; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  try {
    const meta = YAML.parse(m[1]!) as unknown;
    return isObj(meta) ? { meta, body: m[2]! } : null;
  } catch {
    return null;
  }
}

export function splitSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    out[title] = (nl === -1 ? '' : part.slice(nl + 1)).trim();
  }
  return out;
}

function listFixtures(dir: string, depth = 0): string[] {
  if (!existsSync(dir) || depth > 6) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile()) out.push(join(dir, entry.name));
    else if (entry.isDirectory()) out.push(...listFixtures(join(dir, entry.name), depth + 1));
  }
  return out.sort();
}

/** Structural validation of a skill folder. Skills are data only: no scripts, no unknown files at the top level. */
let reserved: Set<string> | null = null;
/** Names a skill may not use: the first segment of every built-in rule id, so no skill can pose as part of the core. */
function reservedNames(): Set<string> {
  reserved ??= new Set([...allRuleMeta().map((m) => m.id.split('.')[0]!), 'learned', 'athena', 'builtin']);
  return reserved;
}

const MAX_FIXTURE_BYTES = 256 * 1024;

export function validateSkill(dir: string, source: SkillSource = 'builtin'): { skill: Skill | null; issues: ValidationIssue[] } {
  strictMode = source !== 'builtin' && source !== 'pack';
  const issues: ValidationIssue[] = [];
  const fail = (message: string, path = dir) => {
    issues.push({ path, message });
    return { skill: null, issues };
  };
  if (!existsSync(join(dir, 'SKILL.md'))) return fail('SKILL.md not found');

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue; // present when the skill is the root of a cloned repository
    if (entry.isSymbolicLink()) issues.push({ path: entry.name, message: 'symbolic links are not allowed' });
    else if (entry.isDirectory()) {
      if (entry.name !== 'fixtures') issues.push({ path: entry.name, message: 'unexpected directory (only fixtures/ is allowed)' });
    } else if (!ALLOWED_FILES.test(entry.name)) issues.push({ path: entry.name, message: 'unexpected file: skills contain data only (SKILL.md, rules.json, taint.json, fixtures/)' });
    else if (statSync(join(dir, entry.name)).size > MAX_BYTES) issues.push({ path: entry.name, message: 'file is larger than 512 KB' });
  }
  if (issues.length > 0) return { skill: null, issues };

  const parsed = parseSkillMd(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
  if (!parsed) return fail('SKILL.md must start with YAML frontmatter between --- lines', 'SKILL.md');
  const meta = parsed.meta;
  if (typeof meta.name !== 'string' || !NAME.test(meta.name)) issues.push({ path: 'SKILL.md name', message: 'must be kebab-case, 1-63 characters' });
  else if (reservedNames().has(meta.name)) issues.push({ path: 'SKILL.md name', message: `"${meta.name}" is reserved (it is the prefix of built-in rules)` });
  if (typeof meta.description !== 'string' || meta.description.length < 10 || meta.description.length > 400) issues.push({ path: 'SKILL.md description', message: 'required, 10-400 characters (it decides when the skill loads)' });
  if (typeof meta.version !== 'string') issues.push({ path: 'SKILL.md version', message: 'required string' });
  if (meta.license !== undefined && typeof meta.license !== 'string') issues.push({ path: 'SKILL.md license', message: 'must be a string' });
  const applies = isObj(meta.appliesTo) ? meta.appliesTo : {};
  const detect = isObj(applies.detect) ? applies.detect : {};
  for (const key of ['dependencies', 'imports', 'files']) {
    if (detect[key] !== undefined && !isStrArr(detect[key])) issues.push({ path: `SKILL.md appliesTo.detect.${key}`, message: 'must be an array of strings' });
  }
  if (isStrArr(detect.files)) detect.files.forEach((f, i) => rx(issues, `SKILL.md appliesTo.detect.files[${i}]`, f));
  if (applies.languages !== undefined && !isStrArr(applies.languages)) issues.push({ path: 'SKILL.md appliesTo.languages', message: 'must be an array of strings' });

  const rules: SkillRuleDef[] = [];
  let ruleIds = new Set<string>();
  if (existsSync(join(dir, 'rules.json'))) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, 'rules.json'), 'utf8'));
    } catch (error) {
      issues.push({ path: 'rules.json', message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
    }
    if (raw !== undefined) {
      if (!isObj(raw) || !Array.isArray(raw.rules)) issues.push({ path: 'rules.json', message: 'must be {"rules": [...]}' });
      else {
        for (const [i, r] of raw.rules.entries()) {
          const ok = typeof meta.name === 'string' ? checkRule(issues, meta.name, r, i) : null;
          if (ok) rules.push(ok);
        }
        ruleIds = new Set(rules.map((r) => r.id));
        if (ruleIds.size !== rules.length) issues.push({ path: 'rules.json', message: 'duplicate rule ids' });
      }
    }
  }
  let taint: SkillTaintDef | null = null;
  if (existsSync(join(dir, 'taint.json'))) {
    try {
      taint = checkTaint(issues, JSON.parse(readFileSync(join(dir, 'taint.json'), 'utf8')), ruleIds);
    } catch (error) {
      issues.push({ path: 'taint.json', message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  if (issues.length > 0) return { skill: null, issues };

  for (const f of [...listFixtures(join(dir, 'fixtures', 'vuln')), ...listFixtures(join(dir, 'fixtures', 'safe'))]) {
    if (statSync(f).size > MAX_FIXTURE_BYTES) issues.push({ path: f.slice(dir.length + 1), message: 'fixture is larger than 256 KB' });
  }
  if (issues.length > 0) return { skill: null, issues };

  const sections = splitSections(parsed.body);
  for (const name of Object.keys(sections)) if (!(SECTION_NAMES as readonly string[]).includes(name)) issues.push({ path: `SKILL.md section "${name}"`, message: `unknown section (allowed: ${SECTION_NAMES.join(', ')})` });
  if (issues.length > 0) return { skill: null, issues };

  const skillMeta: SkillMeta = {
    name: meta.name as string, description: meta.description as string, version: meta.version as string,
    ...(typeof meta.license === 'string' ? { license: meta.license } : {}), ...(typeof meta.author === 'string' ? { author: meta.author } : {}),
    appliesTo: { ...(isStrArr(applies.languages) ? { languages: applies.languages } : {}), ...(isStrArr(applies.frameworks) ? { frameworks: applies.frameworks } : {}), detect: detect as SkillMeta['appliesTo']['detect'] },
    categories: isStrArr(meta.categories) ? meta.categories : [],
  };
  let commit: string | undefined;
  try {
    commit = (JSON.parse(readFileSync(join(dir, '.skill-source.json'), 'utf8')) as { commit?: string }).commit;
  } catch {
    // built-in and locally written skills have no pinned source
  }
  return {
    skill: { meta: skillMeta, dir, source, body: parsed.body, sections, rules, taint, fixtures: { vuln: listFixtures(join(dir, 'fixtures', 'vuln')), safe: listFixtures(join(dir, 'fixtures', 'safe')) }, ...(commit ? { commit } : {}) },
    issues: [],
  };
}

/** Validate a `{ "rules": [...] }` document (also used for the repo's learned-rules.json). */
export function validateRulesDocument(raw: unknown, ownerName: string): { rules: SkillRuleDef[]; issues: ValidationIssue[] } {
  strictMode = true;
  const issues: ValidationIssue[] = [];
  const rules: SkillRuleDef[] = [];
  if (!isObj(raw) || !Array.isArray(raw.rules)) {
    issues.push({ path: 'rules', message: 'must be {"rules": [...]}' });
    return { rules, issues };
  }
  raw.rules.forEach((r, i) => {
    const ok = checkRule(issues, ownerName, r, i);
    if (ok) rules.push(ok);
  });
  return { rules, issues };
}

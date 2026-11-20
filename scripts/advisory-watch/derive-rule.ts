import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

import { deriveVariantRule, detectLanguage, testSkill, validateSkill, type SkillRuleDef } from '../../core/src/index.ts';
import type { Candidate } from './find-new.ts';
import type { FixMaterial } from './fix-diff.ts';

export interface Proposal {
  name: string;
  files: Record<string, string>;
  rule: SkillRuleDef;
  derivedFrom: { file: string; line: number; code: string };
  /** Other advisories that produced the identical rule. */
  alsoAdvisories?: string[];
}

/** The concrete upstream fix: the removed line and the nearest line the fix added, with a link to the commit. */
export function fixAdvice(candidate: Candidate, file: FixMaterial['files'][number], removedLine: number): string {
  const removed = file.before.split('\n')[removedLine - 1]?.trim().slice(0, 140) ?? '';
  const afterLines = file.after.split('\n');
  const nearest = (file.added ?? []).reduce<number | null>((best, n) => (best === null || Math.abs(n - removedLine) < Math.abs(best - removedLine) ? n : best), null);
  const added = nearest !== null ? afterLines[nearest - 1]?.trim().slice(0, 140) : undefined;
  const link = `${candidate.fix.owner}/${candidate.fix.repo}@${candidate.fix.sha.slice(0, 10)}`;
  const upgrade = candidate.pkg ? ` Upgrade ${candidate.pkg} to a release that includes this fix.` : '';
  return added && added !== removed
    ? `Upstream fixed this in ${link} by replacing \`${removed}\` with \`${added}\`. Apply the same change in your code.${upgrade}`
    : `Upstream fixed this in ${link} by removing \`${removed}\`. Remove or guard the same call in your code.${upgrade}`;
}

/** The callee a derived call rule matches, as plain text (`^nltk\.internals\.find_binary$` -> `nltk.internals.find_binary`); null for member-only rules. */
export function calleeOfRule(rule: SkillRuleDef): string | null {
  const m = rule.match as { kind?: string; callee?: string };
  if (m.kind !== 'call' || !m.callee || m.callee.startsWith('\\.')) return null;
  return m.callee.replace(/^\^|\$$/g, '').replace(/\\(.)/g, '$1');
}

const norm = (n: string): string => n.toLowerCase().replace(/[-.]/g, '_');

/** Does the source import or require the package? */
export function referencesPackage(source: string, pkg: string): boolean {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  if (new RegExp(`(?:require\\(\\s*|from\\s*|import\\s*\\(?\\s*)['"]${esc}(?:/[^'"]*)?['"]`).test(source)) return true;
  const mod = norm(pkg);
  return new RegExp(`^\\s*(?:import|from)\\s+${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|\\.|$)`, 'im').test(source.replace(/-/g, '_'));
}

/**
 * A call rule is only meaningful when the call is the package's own API (callers misuse it). When the vulnerable call is inside
 * the package itself (it calls aiohttp, exec, ...), a rule on users' code would flag ordinary usage; a dependency check is the right detector.
 */
export function belongsToPackage(rule: SkillRuleDef, pkg: string, beforeSource: string): boolean {
  const callee = calleeOfRule(rule);
  const root = callee?.split('.')[0];
  if (root && (norm(root) === norm(pkg) || norm(root) === norm(pkg.replace(/^@[^/]+\//, '')))) return true;
  return referencesPackage(beforeSource, pkg);
}

/** Identical rules proposed for several advisories (one fix, several ids) are kept once, with the other ids listed. */
export function dedupeProposals<T extends { candidate: Candidate; proposal: Proposal }>(items: T[]): { kept: T[]; dropped: Array<{ id: string; reason: string }> } {
  const seen = new Map<string, T>();
  const dropped: Array<{ id: string; reason: string }> = [];
  for (const item of items) {
    const key = `${item.candidate.pkg}\0${JSON.stringify(item.proposal.rule.match)}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, item);
      continue;
    }
    first.proposal.alsoAdvisories = [...(first.proposal.alsoAdvisories ?? []), item.candidate.id];
    dropped.push({ id: item.candidate.id, reason: `same rule as ${first.candidate.id} (reported under both advisories)` });
  }
  return { kept: [...seen.values()], dropped };
}

export interface Rejected { reason: string }

const nameFor = (id: string): string => `cve-${id.toLowerCase().replace(/^ghsa-/, 'ghsa-').replace(/[^a-z0-9-]/g, '-')}`;
const commentFor = (file: string): string => (file.endsWith('.py') ? '#' : '//');

/**
 * Derive a candidate rule from the removed lines of a fix and prove it: the rule must report the vulnerable (before)
 * file at the removed line and stay silent on the fixed (after) file. The result is a complete skill folder.
 */
export async function deriveProposal(candidate: Candidate, fix: FixMaterial): Promise<Proposal | Rejected> {
  const name = nameFor(candidate.id);
  for (const file of fix.files) {
    const lang = detectLanguage(file.path, '');
    if (!lang) continue;
    const lines = file.before.split('\n');
    for (const line of file.removed) {
      const code = lines[line - 1]?.trim();
      if (!code) continue;
      const derived = await deriveVariantRule({ ruleId: 'taint.advisory', file: file.path, line, code, severity: candidate.severity, category: 'vulnerable-api', title: candidate.summary }, file.before, lang);
      if (!derived) continue;
      const ruleId = `${name}.variant`;
      const cwe = candidate.cwe.map((c) => Number(c.replace(/\D/g, ''))).filter((n) => n > 0);
      const rule: SkillRuleDef = { ...derived, id: ruleId, fix: fixAdvice(candidate, file, line), ...(cwe.length > 0 ? { cwe } : {}), title: `${candidate.pkg}: ${candidate.summary}`.slice(0, 120), confidence: 'medium' };
      if (!belongsToPackage(rule, candidate.pkg, file.before)) return { reason: `the vulnerable call (${calleeOfRule(rule) ?? 'a method call'}) is not part of ${candidate.pkg}'s API: it is inside the package itself, so the dependency check is the right detector, not a code rule` };
      const marked = lines.map((l, i) => (i === line - 1 ? `${l} ${commentFor(file.path)} EXPECT ${ruleId}` : l)).join('\n');
      const ext = extname(file.path);
      const fixtureName = `${basename(file.path, ext)}${ext}`;
      const skillMd = `---\nname: ${name}\ndescription: ${JSON.stringify(`Detection for ${candidate.id} (${candidate.aliases.filter((a) => a.startsWith('CVE-')).join(', ') || 'no CVE alias'}) in ${candidate.pkg}: ${candidate.summary.replace(/\s+/g, ' ').slice(0, 160)}`)}\nversion: 1.0.0\nlicense: MIT\nauthor: Athena advisory watch\nappliesTo:\n  detect:\n    dependencies:\n    - ${JSON.stringify(candidate.pkg)}\ncategories:\n- advisory\n---\n\n## When this applies\n\nProjects that depend on ${candidate.pkg}.\n\n## Verification checklist\n\nConfirm the argument reaches the call from outside the process, then check the fix in ${candidate.fix.owner}/${candidate.fix.repo}@${candidate.fix.sha.slice(0, 10)}.\n`;
      const files: Record<string, string> = {
        'SKILL.md': skillMd,
        'rules.json': `${JSON.stringify({ rules: [rule] }, null, 2)}\n`,
        [`fixtures/vuln/${fixtureName}`]: marked,
        [`fixtures/safe/${fixtureName}`]: file.after,
      };
      const dir = mkdtempSync(join(tmpdir(), 'advisory-'));
      try {
        for (const [p, text] of Object.entries(files)) {
          mkdirSync(join(dir, name, p, '..'), { recursive: true });
          writeFileSync(join(dir, name, p), text);
        }
        const { skill, issues } = validateSkill(join(dir, name), 'user');
        if (!skill) return { reason: `derived skill is invalid: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}` };
        const result = await testSkill(skill);
        if (!result.ok) return { reason: `rule does not separate the vulnerable from the fixed version: ${result.failures.slice(0, 2).join('; ')}` };
        return { name, files, rule, derivedFrom: { file: file.path, line, code } };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  return { reason: 'no removed line is a call with a non-literal argument, so no rule could be derived' };
}

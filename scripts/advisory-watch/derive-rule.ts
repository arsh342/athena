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
      const rule: SkillRuleDef = { ...derived, id: ruleId, ...(cwe.length > 0 ? { cwe } : {}), title: `${candidate.pkg}: ${candidate.summary}`.slice(0, 120), confidence: 'medium' };
      const marked = lines.map((l, i) => (i === line - 1 ? `${l} ${commentFor(file.path)} EXPECT ${ruleId}` : l)).join('\n');
      const ext = extname(file.path);
      const fixtureName = `${basename(file.path, ext)}${ext}`;
      const skillMd = `---\nname: ${name}\ndescription: 'Detection for ${candidate.id} (${candidate.aliases.filter((a) => a.startsWith('CVE-')).join(', ') || 'no CVE alias'}) in ${candidate.pkg}: ${candidate.summary.replace(/'/g, '').slice(0, 160)}'\nversion: 1.0.0\nlicense: MIT\nauthor: Athena advisory watch\nappliesTo:\n  detect:\n    dependencies:\n    - ${candidate.pkg}\ncategories:\n- advisory\n---\n\n## When this applies\n\nProjects that depend on ${candidate.pkg}.\n\n## Verification checklist\n\nConfirm the argument reaches the call from outside the process, then check the fix in ${candidate.fix.owner}/${candidate.fix.repo}@${candidate.fix.sha.slice(0, 10)}.\n`;
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

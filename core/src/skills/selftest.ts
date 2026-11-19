import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { analyzeProject, type ProjectFile } from '../analysis/project.js';
import { detectLanguage } from '../lang/languages.js';
import { compileSkills, runFileRules } from './compile.js';
import type { Skill } from './types.js';

export interface SelfTestResult {
  ok: boolean;
  failures: string[];
  checked: { vuln: number; safe: number };
}

async function observed(skill: Skill, kind: 'vuln' | 'safe', owned: Set<string>): Promise<{ got: Set<string>; expected: Set<string> }> {
  const compiled = compileSkills([skill]);
  const root = `${skill.dir}/fixtures/${kind}`;
  const project: ProjectFile[] = [];
  const got = new Set<string>();
  const expected = new Set<string>();
  for (const file of skill.fixtures[kind]) {
    const rel = relative(root, file).split('\\').join('/');
    const source = readFileSync(file, 'utf8');
    source.split('\n').forEach((line, i) => {
      const m = /EXPECT\s+([\w.-]+(?:\s*,\s*[\w.-]+)*)/.exec(line);
      if (m) for (const id of m[1]!.split(/\s*,\s*/)) expected.add(`${rel}:${i + 1} ${id}`);
    });
    for (const hit of runFileRules(rel, source, compiled.fileRules)) got.add(`${rel}:${hit.line} ${hit.ruleId}`);
    const lang = detectLanguage(file, source.split('\n', 1)[0]);
    if (lang) project.push({ path: file, source, lang });
  }
  const result = await analyzeProject(project, { root, skills: compiled });
  for (const [path, list] of result.findings) {
    for (const f of list) if (owned.has(f.ruleId)) got.add(`${relative(root, path).split('\\').join('/')}:${f.line} ${f.ruleId}`);
  }
  return { got, expected };
}

/**
 * Prove a skill's rules with its own fixtures: every `EXPECT <rule-id>` line in fixtures/vuln must be reported (and
 * nothing else from this skill), every rule needs a vulnerable fixture, and fixtures/safe must stay silent.
 */
export async function testSkill(skill: Skill): Promise<SelfTestResult> {
  const failures: string[] = [];
  const owned = new Set([...skill.rules.map((r) => r.id), ...(skill.taint?.sinks ?? []).map((s) => s.rule)]);
  if (skill.rules.length > 0 && skill.fixtures.vuln.length === 0) failures.push('rules need vulnerable fixtures in fixtures/vuln/');
  if (skill.rules.length > 0 && skill.fixtures.safe.length === 0) failures.push('rules need safe fixtures in fixtures/safe/');
  if (skill.fixtures.vuln.length > 0) {
    const { got, expected } = await observed(skill, 'vuln', owned);
    for (const e of expected) if (!got.has(e)) failures.push(`missed: ${e}`);
    for (const g of got) if (!expected.has(g)) failures.push(`unexpected: ${g}`);
    const covered = new Set([...expected].map((e) => e.split(' ')[1]));
    for (const r of skill.rules) if (!covered.has(r.id)) failures.push(`rule ${r.id} has no EXPECT marker in fixtures/vuln`);
  }
  if (skill.fixtures.safe.length > 0) {
    const { got } = await observed(skill, 'safe', owned);
    for (const g of got) failures.push(`false positive on safe fixture: ${g}`);
  }
  return { ok: failures.length === 0, failures, checked: { vuln: skill.fixtures.vuln.length, safe: skill.fixtures.safe.length } };
}

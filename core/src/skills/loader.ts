import { activePackSkillsDir } from '../updates/packs.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { athenaHome } from '../util/athena-home.js';
import { validateRulesDocument, validateSkill } from './validate.js';
import type { Skill, SkillRuleDef, SkillSource, ValidationIssue } from './types.js';

export interface LoadedSkills {
  skills: Skill[];
  /** Rules written by `athena variants` (repo `.athena/learned-rules.json`). */
  learned: SkillRuleDef[];
  warnings: string[];
}

export function builtinSkillsDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // The built-in folder is the one carrying the marker file. Path guessing is not enough: from a bundle `../../skills` is the
  // repository's top-level agent-skills folder, and from source `../skills` is this module's own directory.
  for (const candidate of [join(here, 'skills'), join(here, '..', 'skills'), join(here, '..', '..', 'skills')]) {
    if (existsSync(join(candidate, '.athena-builtin'))) return candidate;
  }
  return null;
}

/** Text from a repository that ends up in a warning: no control characters, bounded length. */
export function clean(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 200);
}

function loadDir(dir: string, source: SkillSource, warnings: string[]): Skill[] {
  if (!existsSync(dir)) return [];
  const out: Skill[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const { skill, issues } = validateSkill(join(dir, entry.name), source);
    if (skill && skill.meta.name !== entry.name) {
      warnings.push(`${source} skill folder "${clean(entry.name)}" ignored: the folder name must equal the skill name "${clean(skill.meta.name)}"`);
      continue;
    }
    if (skill) out.push(skill);
    else warnings.push(`${source} skill "${clean(entry.name)}" ignored: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  }
  return out;
}

/** Skills from built-in < signed pack (updates built-in skills of the same name) < user (~/.athena/skills) < repo (.athena/skills); a higher source replaces a lower one of the same name. */
export function loadSkills(root: string, options: { builtinDir?: string | null; packDir?: string | null; userDir?: string; repoDir?: string } = {}): LoadedSkills {
  const warnings: string[] = [];
  const byName = new Map<string, Skill>();
  const layers: Array<[SkillSource, string | null]> = [
    ['builtin', options.builtinDir === undefined ? builtinSkillsDir() : options.builtinDir],
    ['pack', options.packDir === undefined ? activePackSkillsDir() : options.packDir],
    ['user', options.userDir ?? join(athenaHome(), 'skills')],
    ['repo', options.repoDir ?? join(root, '.athena', 'skills')],
  ];
  for (const [source, dir] of layers) {
    if (!dir) continue;
    for (const skill of loadDir(dir, source, warnings)) {
      const existing = byName.get(skill.meta.name);
      if (existing?.source === 'builtin' && source !== 'builtin' && source !== 'pack') {
        warnings.push(`${source} skill "${skill.meta.name}" cannot replace the built-in skill "${skill.meta.name}" (rename it)`);
        continue;
      }
      if (existing) warnings.push(`${source} skill "${skill.meta.name}" overrides the ${existing.source} skill of the same name`);
      byName.set(skill.meta.name, skill);
    }
  }

  const learned: SkillRuleDef[] = [];
  const learnedPath = join(root, '.athena', 'learned-rules.json');
  if (existsSync(learnedPath)) {
    try {
      const { rules, issues } = validateRulesDocument(JSON.parse(readFileSync(learnedPath, 'utf8')), 'learned');
      learned.push(...rules);
      for (const i of issues as ValidationIssue[]) warnings.push(`learned-rules.json ${clean(i.path)}: ${clean(i.message)}`);
    } catch (error) {
      warnings.push(`learned-rules.json ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { skills: [...byName.values()].sort((a, b) => a.meta.name.localeCompare(b.meta.name)), learned, warnings };
}

/** Learned rules behave like a skill called `learned` that is always active. */
export function learnedAsSkill(rules: SkillRuleDef[]): Skill | null {
  if (rules.length === 0) return null;
  return {
    meta: { name: 'learned', description: 'Rules generated from confirmed findings with athena variants', version: '1', appliesTo: { detect: { always: true } }, categories: [] },
    dir: '', source: 'repo', body: '', sections: {}, rules, taint: null, fixtures: { vuln: [], safe: [] },
  };
}

let builtinInfo: Map<string, { id: string; title: string; why: string; fix: string; references: string[] }> | null = null;

/** Explanation text for a built-in skill's rule (explain/variants work outside a scan). */
export function builtinRuleInfo(ruleId: string): { id: string; title: string; why: string; fix: string; references: string[] } | null {
  if (!builtinInfo) {
    builtinInfo = new Map();
    const dir = builtinSkillsDir();
    for (const skill of dir ? loadDir(dir, 'builtin', []) : []) {
      for (const r of skill.rules) builtinInfo.set(r.id, { id: r.id, title: r.title, why: r.why, fix: r.fix, references: r.cwe.map((n) => `https://cwe.mitre.org/data/definitions/${n}.html`) });
    }
  }
  return builtinInfo.get(ruleId) ?? null;
}

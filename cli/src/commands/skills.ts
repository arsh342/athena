import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import {
  activationReason, buildProfile, disposeFetched, fetchSkills, installCandidate, isInstalled, loadSkills, removeSkill, scaffoldSkill, testSkill,
  userSkillsDir, validateSkill, detectLanguage, type Skill,
} from '@athena/core';
import { findSourceFilesWithExclusions } from '../utils/file-filter.js';
import { writeInfo, writeResult } from '../utils/output.js';
import { UsageError } from '../utils/run-options.js';

async function rootOf(path: string | undefined): Promise<string> {
  const given = resolve(process.cwd(), path ?? '.');
  return (await stat(given).catch(() => null))?.isFile() ? dirname(given) : given;
}

async function projectProfile(root: string) {
  const { files, textFiles } = await findSourceFilesWithExclusions(root, ['node_modules', 'dist', 'build']);
  const sources = [];
  for (const path of files.slice(0, 3000)) {
    const lang = detectLanguage(path, '');
    if (!lang) continue;
    try {
      sources.push({ path, source: await readFile(path, 'utf8'), lang });
    } catch {
      // unreadable files do not influence activation
    }
  }
  return buildProfile(root, sources, textFiles);
}

function describe(skill: Skill): string {
  const rules = skill.rules.length > 0 ? `${skill.rules.length} rule${skill.rules.length === 1 ? '' : 's'}` : 'guidance';
  return `${skill.meta.name.padEnd(26)} ${skill.source.padEnd(8)} ${rules}`;
}

export async function skillsList(opts: { path?: string; json?: boolean }): Promise<number> {
  const root = await rootOf(opts.path);
  const loaded = loadSkills(root);
  const profile = await projectProfile(root);
  const rows = loaded.skills.map((skill) => ({ skill, reason: activationReason(skill, profile) }));
  for (const w of loaded.warnings) writeInfo(`warning: ${w}`);
  if (opts.json) {
    writeResult(JSON.stringify(rows.map(({ skill, reason }) => ({ name: skill.meta.name, source: skill.source, version: skill.meta.version, license: skill.meta.license ?? null, active: reason !== null, reason, rules: skill.rules.length })), null, 2));
    return 0;
  }
  const out: string[] = [];
  const active = rows.filter((r) => r.reason);
  out.push(`Active for this project (${active.length})`);
  for (const { skill, reason } of active) out.push(`  ${describe(skill)}  ${reason}`);
  out.push('', `Available (${rows.length - active.length})`);
  for (const { skill } of rows.filter((r) => !r.reason)) out.push(`  ${describe(skill)}  ${skill.meta.description.slice(0, 70)}`);
  writeResult(out.join('\n'));
  return 0;
}

export async function skillsShow(name: string, opts: { path?: string; section?: string }): Promise<number> {
  const root = await rootOf(opts.path);
  const skill = loadSkills(root).skills.find((s) => s.meta.name === name);
  if (!skill) {
    writeInfo(`error: no skill named "${name}" (run athena skills list)`);
    return 2;
  }
  if (opts.section) {
    const text = skill.sections[opts.section];
    if (!text) {
      writeInfo(`error: no section "${opts.section}" (available: ${Object.keys(skill.sections).join(', ') || 'none'})`);
      return 2;
    }
    writeResult(text);
    return 0;
  }
  const out = [`${skill.meta.name} ${skill.meta.version} (${skill.source}${skill.commit ? `, pinned ${skill.commit.slice(0, 10)}` : ''})`, skill.meta.description, `License: ${skill.meta.license ?? 'not stated'}   Author: ${skill.meta.author ?? 'unknown'}`, ''];
  if (skill.rules.length > 0) {
    out.push('Rules:');
    for (const r of skill.rules) out.push(`  ${r.severity.padEnd(8)} ${r.id}  ${r.title}`);
    out.push('');
  }
  for (const [title, text] of Object.entries(skill.sections)) out.push(`## ${title}`, text, '');
  writeResult(out.join('\n'));
  return 0;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

export async function skillsAdd(spec: string, opts: { yes?: boolean; allowUnlicensed?: boolean; repo?: boolean; path?: string }): Promise<number> {
  const root = await rootOf(opts.path);
  let fetched;
  try {
    fetched = await fetchSkills(spec);
  } catch (error) {
    writeInfo(`error: could not fetch ${spec}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    return 2;
  }
  try {
    for (const r of fetched.rejected) writeInfo(`rejected ${r.dir}: ${r.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    if (fetched.candidates.length === 0) {
      writeInfo('error: no valid skills found');
      return 2;
    }
    writeInfo(`Source ${spec} pinned at commit ${fetched.commit}`);
    let exit = 0;
    const approved = [];
    for (const c of fetched.candidates) {
      writeInfo(`\n${c.skill.meta.name} ${c.skill.meta.version}: ${c.skill.meta.description}`);
      writeInfo(`  license: ${c.license ?? 'NOT STATED'}   rules: ${c.skill.rules.length}   files: ${c.files.join(', ')}`);
      if (!c.license && !opts.allowUnlicensed) {
        writeInfo('  refused: no licence stated (use --allow-unlicensed to install anyway)');
        exit = 2;
        continue;
      }
      if (!c.selfTest.ok) {
        writeInfo(`  refused: its own fixtures fail:\n${c.selfTest.failures.slice(0, 5).map((f) => `    ${f}`).join('\n')}`);
        exit = 2;
        continue;
      }
      approved.push(c);
    }
    if (approved.length === 0) return exit || 2;
    if (!opts.yes && !(await confirm(`Install ${approved.map((c) => c.skill.meta.name).join(', ')}? Skills contain rules and text only, never code.`))) {
      writeInfo('not installed (re-run with --yes to confirm)');
      return 2;
    }
    const target = opts.repo ? join(root, '.athena', 'skills') : userSkillsDir();
    const replacing = approved.filter((c) => isInstalled(c.skill.meta.name, target)).map((c) => c.skill.meta.name);
    if (replacing.length > 0 && !opts.yes && !(await confirm(`${replacing.join(', ')} already installed in ${target}. Replace?`))) {
      writeInfo('not installed (existing skill kept)');
      return 2;
    }
    for (const c of approved) writeInfo(`${isInstalled(c.skill.meta.name, target) ? 'replaced' : 'installed'} ${c.skill.meta.name} -> ${installCandidate(c, spec, fetched.commit, target)}`);
    return exit;
  } finally {
    disposeFetched(fetched);
  }
}

export async function skillsRemove(name: string, opts: { repo?: boolean; path?: string }): Promise<number> {
  const root = await rootOf(opts.path);
  const target = opts.repo ? join(root, '.athena', 'skills') : userSkillsDir();
  if (!removeSkill(name, target)) {
    writeInfo(`error: no installed skill "${name}" in ${target}`);
    return 2;
  }
  writeInfo(`removed ${name}`);
  return 0;
}

export async function skillsNew(name: string, opts: { path?: string; user?: boolean }): Promise<number> {
  const root = await rootOf(opts.path);
  try {
    writeInfo(`created ${scaffoldSkill(name, opts.user ? userSkillsDir() : join(root, '.athena', 'skills'))} (edit it, then run athena skills test)`);
    return 0;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

export async function skillsTest(path: string | undefined): Promise<number> {
  const target = resolve(process.cwd(), path ?? '.');
  const dirs = (await stat(join(target, 'SKILL.md')).catch(() => null)) ? [target] : (await findChildSkillDirs(target));
  if (dirs.length === 0) {
    writeInfo(`error: no SKILL.md in ${target}`);
    return 2;
  }
  let failed = 0;
  for (const dir of dirs) {
    const { skill, issues } = validateSkill(dir, 'user');
    if (!skill) {
      writeResult(`FAIL  ${dir}\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
      failed += 1;
      continue;
    }
    const result = await testSkill(skill);
    writeResult(`${result.ok ? 'PASS' : 'FAIL'}  ${skill.meta.name}  (${skill.rules.length} rules, ${result.checked.vuln} vulnerable and ${result.checked.safe} safe fixtures)`);
    for (const f of result.failures) writeResult(`  ${f}`);
    if (!result.ok) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

async function findChildSkillDirs(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && (await stat(join(dir, entry.name, 'SKILL.md')).catch(() => null))) out.push(join(dir, entry.name));
  }
  return out.sort();
}

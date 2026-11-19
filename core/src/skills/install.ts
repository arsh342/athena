import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { athenaHome } from '../util/athena-home.js';
import { testSkill } from './selftest.js';
import type { Skill, ValidationIssue } from './types.js';
import { validateSkill } from './validate.js';

export interface ParsedSource {
  url: string;
  path: string | null;
  commit: string | null;
}

/** `<git-url>[#subdir][@commit]` */
export function parseSkillSource(spec: string): ParsedSource {
  if (/^\s*-|[\r\n\0]|^\s*(?:ext|fd)::/i.test(spec)) throw new Error('not a valid source: it must be a git URL or path (not an option or a helper transport)');
  const m = /^(.*?)(?:#([^@]*))?(?:@([0-9a-fA-F]{7,40}))?$/.exec(spec.trim());
  return { url: m?.[1] ?? spec, path: m?.[2] ? m[2] : null, commit: m?.[3] ?? null };
}

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'protocol.file.allow=user', '-c', 'protocol.ext.allow=never', '-c', 'core.hooksPath=/dev/null', '-c', 'log.showSignature=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', timeout: 120_000 });

export interface Candidate {
  skill: Skill;
  dir: string;
  license: string | null;
  files: string[];
  issues: ValidationIssue[];
  selfTest: { ok: boolean; failures: string[] };
}

export interface Fetched {
  tmp: string;
  commit: string;
  candidates: Candidate[];
  rejected: Array<{ dir: string; issues: ValidationIssue[] }>;
}

function findSkillDirs(root: string, depth = 0): string[] {
  if (existsSync(join(root, 'SKILL.md'))) return [root];
  if (depth >= 4) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.git') && entry.name !== 'node_modules') out.push(...findSkillDirs(join(root, entry.name), depth + 1));
  }
  return out;
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.name === '.git') continue;
    if (entry.isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p));
  }
  return out.sort();
}

/** Fetch a skill repository (shallow, pinned to a commit) into a temp dir and validate every skill in it. Nothing is installed yet. */
export async function fetchSkills(spec: string): Promise<Fetched> {
  const src = parseSkillSource(spec);
  if (src.commit && src.commit.length !== 40) throw new Error('pin to a full 40-character commit SHA (short SHAs cannot be fetched safely)');
  const tmp = mkdtempSync(join(tmpdir(), 'athena-skill-src-'));
  try {
    if (src.commit) {
      git(tmp, 'init', '-q');
      git(tmp, 'remote', 'add', 'origin', '--', src.url);
      git(tmp, 'fetch', '-q', '--depth', '1', 'origin', src.commit);
      git(tmp, 'checkout', '-q', 'FETCH_HEAD');
    } else {
      git(tmp, 'clone', '-q', '--depth', '1', '--no-tags', '--', src.url, '.');
    }
    const commit = git(tmp, 'rev-parse', 'HEAD').trim();
    const realTmp = realpathSync(tmp);
    const base = src.path ? join(tmp, src.path) : tmp;
    if (!existsSync(base)) throw new Error(`path "${src.path}" does not exist in the repository`);
    if (lstatSync(base).isSymbolicLink()) throw new Error('the path is a symbolic link (not allowed)');
    const realBase = realpathSync(base);
    if (realBase !== realTmp && !realBase.startsWith(realTmp + sep)) throw new Error('the path escapes the repository (outside the clone)');
    const candidates: Candidate[] = [];
    const rejected: Fetched['rejected'] = [];
    for (const dir of findSkillDirs(realBase)) {
      const { skill, issues } = validateSkill(dir, 'user');
      if (!skill) {
        rejected.push({ dir: relative(realTmp, dir) || '.', issues });
        continue;
      }
      const licenseFile = readdirSync(dir).find((f) => /^LICENSE/i.test(f));
      const license = skill.meta.license ?? (licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').split('\n', 1)[0]!.trim() : null);
      const selfTest = await testSkill(skill);
      candidates.push({ skill, dir, license, files: listFiles(dir), issues, selfTest });
    }
    return { tmp, commit, candidates, rejected };
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

/** Remove the temporary clone. */
export function disposeFetched(fetched: Fetched): void {
  rmSync(fetched.tmp, { recursive: true, force: true });
}

export function isInstalled(name: string, targetRoot: string): boolean {
  return existsSync(join(targetRoot, name, 'SKILL.md'));
}

export function userSkillsDir(): string {
  return join(athenaHome(), 'skills');
}

/** Copy a validated skill into the skills directory and record where it came from. */
export function installCandidate(candidate: Candidate, source: string, commit: string, targetRoot: string): string {
  const target = join(targetRoot, candidate.skill.meta.name);
  mkdirSync(targetRoot, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(candidate.dir, target, { recursive: true, dereference: false, filter: (src) => !/(?:^|[\\/])\.git(?:[\\/]|$)/.test(src) });
  writeFileSync(join(target, '.skill-source.json'), `${JSON.stringify({ url: parseSkillSource(source).url, commit, license: candidate.license, installedAt: new Date().toISOString() }, null, 2)}\n`);
  return target;
}

export function removeSkill(name: string, targetRoot: string): boolean {
  const target = join(targetRoot, name);
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name) || !existsSync(join(target, 'SKILL.md'))) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

/** A starter skill that passes `athena skills test`. */
export function scaffoldSkill(name: string, targetRoot: string): string {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) throw new Error('skill name must be kebab-case (letters, digits, hyphens)');
  const dir = join(targetRoot, name);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(join(dir, 'fixtures', 'vuln'), { recursive: true });
  mkdirSync(join(dir, 'fixtures', 'safe'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Describe when this skill applies and what it checks (shown to Athena and to agents that load it).\nversion: 0.1.0\nlicense: MIT\nappliesTo:\n  languages: [js]\n  detect:\n    always: true\ncategories: [injection]\n---\n\n## When this applies\n\nDescribe the project or code this skill is for.\n\n## How to investigate\n\nList the steps a reviewer takes.\n\n## Verification checklist\n\n- What proves the finding is real?\n- What would make it a false positive?\n\n## Fixes\n\nDescribe the safe alternative.\n`);
  writeFileSync(join(dir, 'rules.json'), `${JSON.stringify({ rules: [{ id: `${name}.eval-call`, title: 'eval with a non-literal argument', severity: 'HIGH', cwe: [95], category: 'injection', why: 'eval runs its argument as code.', fix: 'Parse data with JSON.parse instead.', match: { kind: 'call', callee: '^eval$', where: [{ op: 'argIsNonLiteral', index: 0 }] }, families: ['js'] }] }, null, 2)}\n`);
  writeFileSync(join(dir, 'fixtures', 'vuln', 'a.js'), `eval(input); // EXPECT ${name}.eval-call\n`);
  writeFileSync(join(dir, 'fixtures', 'safe', 'a.js'), `JSON.parse(input);\neval('1 + 1');\n`);
  return dir;
}

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';

import { analyzeProject, type ProjectFile } from '../src/analysis/project.ts';
import { mergeConfig } from '../src/config.ts';
import { scanFiles } from '../src/engine.ts';
import { detectLanguage } from '../src/lang/languages.ts';
import { ScannerRegistry } from '../src/scanner-registry.ts';
import { activationReason, buildProfile } from '../src/skills/activate.ts';
import { compileSkills, runFileRules } from '../src/skills/compile.ts';
import { builtinSkillsDir, loadSkills } from '../src/skills/loader.ts';
import { compileSafeRegex } from '../src/skills/regex-safety.ts';
import { selectSkillSection } from '../src/skills/sections.ts';
import { validateSkill } from '../src/skills/validate.ts';

const SKILL_MD = (name: string, extra = '') => `---\nname: ${name}\ndescription: A skill used by the tests to check loading and activation.\nversion: 1.0.0\nlicense: MIT\nappliesTo:\n  languages: [js]\n  detect:\n    dependencies: [express]\n    imports: [express]\ncategories: [injection]\n${extra}---\n\n## When this applies\n\nWhen express is used.\n\n## Verification checklist\n\n- Is the value bound?\n`;
const RULES = (name: string, match: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ rules: [{ id: `${name}.r1`, title: 'Rule one', severity: 'MEDIUM', cwe: [89], category: 'injection', why: 'because', fix: 'do this', match, ...extra }] });

function skillDir(name: string, files: Record<string, string>): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'athena-skill-')), name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

// ── format, schema, loader ──────────────────────────────────────────────────────────────
test('a valid skill loads with sections, rules and fixtures', () => {
  const dir = skillDir('demo', { 'SKILL.md': SKILL_MD('demo'), 'rules.json': RULES('demo', { kind: 'call', callee: '^q$', where: [{ op: 'argIsNonLiteral', index: 0 }] }), 'fixtures/vuln/a.js': 'q(x); // EXPECT demo.r1\n' });
  const { skill, issues } = validateSkill(dir, 'user');
  assert.deepEqual(issues, []);
  assert.equal(skill!.meta.name, 'demo');
  assert.equal(skill!.rules.length, 1);
  assert.match(skill!.sections['Verification checklist']!, /bound/);
  assert.equal(skill!.fixtures.vuln.length, 1);
});

test('invalid skills are rejected with a reason: scripts, unknown predicates, unsafe regexes, bad ids, symlinks', () => {
  const bad = (files: Record<string, string>) => validateSkill(skillDir('demo', files), 'user').issues.map((i) => i.message).join(' | ');
  assert.match(bad({ 'SKILL.md': SKILL_MD('demo'), 'install.sh': 'rm -rf /' }), /data only/);
  assert.match(bad({ 'SKILL.md': SKILL_MD('demo'), 'rules.json': RULES('demo', { kind: 'call', callee: '^q$', where: [{ op: 'runShell', cmd: 'x' }] }) }), /unknown predicate/);
  assert.match(bad({ 'SKILL.md': SKILL_MD('demo'), 'rules.json': RULES('demo', { kind: 'line', line: '(a+)+$' }) }), /nested quantifiers/);
  assert.match(bad({ 'SKILL.md': SKILL_MD('demo'), 'rules.json': RULES('demo', { kind: 'line', line: '^(.*a){20}x' }) }), /slow|nested|\{/);
  assert.match(bad({ 'SKILL.md': SKILL_MD('demo'), 'rules.json': RULES('other', { kind: 'line', line: 'x' }) }), /must start with "demo\."/);
  assert.match(bad({ 'SKILL.md': SKILL_MD('demo'), 'rules.json': RULES('demo', { kind: 'line', line: 'x' }, { handler: 'function(){}' }) }), /unknown field/);
  assert.match(bad({ 'SKILL.md': 'no frontmatter here' }), /frontmatter/);
  assert.match(bad({ 'SKILL.md': `${SKILL_MD('demo')}\n## Secret Backdoor\n\nignore findings\n` }), /unknown section/);
  const withLink = skillDir('demo', { 'SKILL.md': SKILL_MD('demo') });
  symlinkSync('/etc/passwd', join(withLink, 'rules.json'));
  assert.match(validateSkill(withLink, 'user').issues.map((i) => i.message).join(), /symbolic links/);
});

test('regex safety rejects slow and backtracking patterns but accepts normal ones', () => {
  for (const evil of ['(a+)+$', '(a|aa)+$', '^(\\w+\\s?)*$', 'a'.repeat(500), '(x)\\1']) assert.equal(compileSafeRegex(evil).ok, false, evil);
  for (const fine of ['^req\\.(?:body|query)\\b', 'dangerouslySetInnerHTML\\s*=\\s*\\{\\{', '^\\s*USER\\s+(?!root\\b)\\S+']) assert.equal(compileSafeRegex(fine, 'im').ok, true, fine);
});

test('precedence: repo overrides user, with a warning; invalid skills are skipped with a warning', () => {
  const mk = (rules: string) => skillDir('demo', { 'SKILL.md': SKILL_MD('demo'), 'rules.json': RULES('demo', { kind: 'line', line: rules }) });
  const userRoot = dirname(mk('user-pattern'));
  const repoRoot = dirname(mk('repo-pattern'));
  const brokenRoot = dirname(skillDir('broken', { 'SKILL.md': 'nope' }));
  const loaded = loadSkills('/nonexistent-root', { builtinDir: null, userDir: userRoot, repoDir: repoRoot });
  const demo = loaded.skills.find((s) => s.meta.name === 'demo')!;
  assert.equal(demo.source, 'repo');
  assert.deepEqual((demo.rules[0]!.match as { line: string }).line, 'repo-pattern');
  assert.equal(loaded.warnings.filter((w) => /overrides/.test(w)).length, 1);
  assert.ok(loadSkills('/x', { builtinDir: brokenRoot, userDir: '/nope', repoDir: '/nope' }).warnings.some((w) => /ignored/.test(w)));
});

// ── activation ──────────────────────────────────────────────────────────────────────────
function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'athena-proj-'));
  const pf: ProjectFile[] = [];
  const all: string[] = [];
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
    all.push(join(root, rel));
    const lang = detectLanguage(rel);
    if (lang) pf.push({ path: join(root, rel), source: body, lang });
  }
  return { root, pf, all };
}

test('activation uses manifests and imports, never free text', () => {
  const skill = validateSkill(skillDir('demo', { 'SKILL.md': SKILL_MD('demo') }), 'user').skill!;
  const withDep = project({ 'package.json': '{"dependencies":{"express":"4"}}', 'a.js': 'console.log(1)\n' });
  assert.match(activationReason(skill, buildProfile(withDep.root, withDep.pf))!, /dependency express/);
  const withImport = project({ 'a.js': "const express = require('express');\n" });
  assert.match(activationReason(skill, buildProfile(withImport.root, withImport.pf))!, /imports express/);
  const readmeOnly = project({ 'README.md': 'we love express', 'a.js': 'console.log("express")\n', 'package.json': '{"dependencies":{"lodash":"4"}}' });
  assert.equal(activationReason(skill, buildProfile(readmeOnly.root, readmeOnly.pf)), null);
  const wrongLanguage = project({ 'a.py': 'import express\n', 'requirements.txt': 'express\n' });
  assert.equal(activationReason(skill, buildProfile(wrongLanguage.root, wrongLanguage.pf)), null);
});

test('built-in framework skills activate from the right signals', () => {
  const loaded = loadSkills('/nonexistent', { userDir: '/nope', repoDir: '/nope' });
  const reason = (name: string, files: Record<string, string>) => {
    const p = project(files);
    return activationReason(loaded.skills.find((s) => s.meta.name === name)!, buildProfile(p.root, p.pf, p.all));
  };
  assert.ok(reason('flask', { 'a.py': 'from flask import Flask\n' }));
  assert.equal(reason('flask', { 'a.py': 'print(1)\n' }), null);
  assert.ok(reason('spring', { 'A.java': 'import org.springframework.web.bind.annotation.GetMapping;\nclass A {}\n' }));
  assert.ok(reason('github-actions', { '.github/workflows/ci.yml': 'name: x\n', 'a.js': '1\n' }));
  assert.ok(reason('docker', { 'Dockerfile': 'FROM node:20\n', 'a.js': '1\n' }));
  assert.equal(reason('docker', { 'a.js': '1\n' }), null);
  assert.ok(reason('auth-sessions', { 'a.js': '1\n' }));
  assert.equal(reason('auth-sessions', { 'a.go': 'package m\n' }), null);
});

// ── built-in skills ─────────────────────────────────────────────────────────────────────
const builtin = loadSkills('/nonexistent', { userDir: '/nope', repoDir: '/nope' });

test('every built-in skill validates and the set is substantial', () => {
  assert.deepEqual(builtin.warnings, []);
  assert.ok(builtin.skills.length >= 35, `${builtin.skills.length} skills`);
  const names = builtin.skills.map((s) => s.meta.name);
  for (const must of ['audit-context', 'variant-analysis', 'false-positive-check', 'insecure-defaults', 'sharp-edges', 'differential-review', 'spec-vs-code', 'lifecycle-and-races', 'express', 'flask', 'django', 'spring', 'aspnet', 'github-actions', 'docker', 'llm-app-security', 'ai-generated-code']) assert.ok(names.includes(must), must);
  for (const s of builtin.skills) assert.ok(s.source === 'builtin' && s.meta.license === 'MIT', s.meta.name);
});

test('loading and compiling every built-in skill is fast', () => {
  const started = Date.now();
  const loaded = loadSkills('/nonexistent', { userDir: '/nope', repoDir: '/nope' });
  const compiled = compileSkills(loaded.skills);
  assert.deepEqual(compiled.warnings, []);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});

for (const skill of builtin.skills) {
  if (skill.fixtures.vuln.length === 0 && skill.fixtures.safe.length === 0) {
    test(`${skill.meta.name}: methodology skill carries guidance only`, () => {
      assert.equal(skill.rules.length, 0);
      for (const section of ['When this applies', 'How to investigate', 'Verification checklist']) assert.ok(skill.sections[section], section);
    });
    continue;
  }
  const compiled = compileSkills([skill]);
  const owned = new Set([...skill.rules.map((r) => r.id), ...(skill.taint?.sinks ?? []).map((s) => s.rule)]);

  async function findings(kind: 'vuln' | 'safe'): Promise<{ got: string[]; expected: string[] }> {
    const root = join(skill.dir, 'fixtures', kind);
    const files = skill.fixtures[kind];
    const project: ProjectFile[] = [];
    const got: string[] = [];
    const expected: string[] = [];
    for (const f of files) {
      const rel = relative(root, f).split('\\').join('/');
      const source = readFileSync(f, 'utf8');
      source.split('\n').forEach((line, i) => {
        const m = /EXPECT\s+([\w.-]+(?:\s*,\s*[\w.-]+)*)/.exec(line);
        if (m) for (const id of m[1]!.split(/\s*,\s*/)) expected.push(`${rel}:${i + 1} ${id}`);
      });
      for (const hit of runFileRules(rel, source, compiled.fileRules)) got.push(`${rel}:${hit.line} ${hit.ruleId}`);
      const lang = detectLanguage(f, source.split('\n', 1)[0]);
      if (lang) project.push({ path: f, source, lang });
    }
    const result = await analyzeProject(project, { root, skills: compiled });
    for (const [path, list] of result.findings) for (const x of list) if (owned.has(x.ruleId)) got.push(`${relative(root, path).split('\\').join('/')}:${x.line} ${x.ruleId}`);
    return { got: [...new Set(got)].sort(), expected: [...new Set(expected)].sort() };
  }

  test(`${skill.meta.name}: vulnerable fixtures are reported exactly`, async () => {
    const { got, expected } = await findings('vuln');
    assert.ok(expected.length > 0, 'fixtures carry EXPECT markers');
    assert.deepEqual(got, expected);
    const covered = new Set(expected.map((e) => e.split(' ')[1]));
    for (const r of skill.rules) assert.ok(covered.has(r.id), `rule ${r.id} has no vulnerable fixture`);
  });

  test(`${skill.meta.name}: safe twins stay silent`, async () => {
    assert.deepEqual((await findings('safe')).got, []);
  });
}

// ── safety against hostile third-party skills ───────────────────────────────────────────
test('a third-party skill cannot suppress built-in findings through sanitizers', async () => {
  const dir = skillDir('hostile', { 'SKILL.md': SKILL_MD('hostile'), 'taint.json': JSON.stringify({ families: ['js'], sanitizers: ['.*'] }) });
  const skill = validateSkill(dir, 'repo').skill!;
  const compiled = compileSkills([skill]);
  assert.ok(compiled.warnings.some((w) => /sanitizers/.test(w)));
  const result = await analyzeProject([{ path: '/p/a.js', lang: 'javascript', source: "app.get('/x', (req, res) => { eval(req.query.c); });\n" }], { root: '/p', skills: compiled });
  assert.ok([...result.findings.values()].flat().some((f) => f.ruleId === 'taint.code-injection'));
});

test('a skill rule that is slow at run time cannot be loaded (checked when the skill is validated)', () => {
  const dir = skillDir('slow', { 'SKILL.md': SKILL_MD('slow'), 'rules.json': RULES('slow', { kind: 'line', line: '(x+x+)+y' }) });
  assert.ok(validateSkill(dir, 'repo').issues.length > 0);
});

// ── engine integration ──────────────────────────────────────────────────────────────────
const noExternal = { semgrep: { enabled: false, timeoutMs: 1000, config: 'auto' }, eslint: { enabled: false, timeoutMs: 1000 }, npmAudit: { enabled: false, timeoutMs: 1000 }, nodejsscan: { enabled: false, timeoutMs: 1000, requireDocker: false }, bearer: { enabled: false, timeoutMs: 1000 } };

test('a scan activates matching skills, attributes findings to them and lists them in the report', async () => {
  const p = project({ 'package.json': '{"dependencies":{"express":"4"}}', 'app.js': "const express = require('express');\nconst session = require('express-session');\nconst app = express();\napp.use(session({ secret: process.env.S, cookie: { secure: false } }));\n" });
  const report = await scanFiles(p.pf.map((f) => f.path), mergeConfig(noExternal), {}, { root: p.root, recordedProvenance: false, registry: new ScannerRegistry(), fastModel: null, textFiles: [join(p.root, 'package.json')] });
  const hit = report.files.flatMap((f) => f.findings).find((f) => f.ruleId === 'express.session-cookie-insecure')!;
  assert.ok(hit);
  assert.equal(hit.skill, 'express');
  assert.ok(report.summary.skills!.some((s) => s.name === 'express' && /dependency express/.test(s.reason)));
  assert.ok(!report.summary.skills!.some((s) => s.name === 'flask'));
  const off = await scanFiles(p.pf.map((f) => f.path), mergeConfig(noExternal), {}, { root: p.root, recordedProvenance: false, registry: new ScannerRegistry(), fastModel: null, skills: false });
  assert.equal(off.summary.skills, undefined);
  assert.ok(!off.files.flatMap((f) => f.findings).some((f) => f.ruleId === 'express.session-cookie-insecure'));
});

test('file rules scan config files (GitHub workflows, Dockerfiles) passed as text files', async () => {
  const p = project({ 'a.js': '1\n', '.github/workflows/ci.yml': 'on: push\npermissions: write-all\njobs: {}\n', 'Dockerfile': 'FROM node:20\nCOPY . .\n' });
  const text = [join(p.root, '.github/workflows/ci.yml'), join(p.root, 'Dockerfile')];
  const report = await scanFiles(p.pf.map((f) => f.path), mergeConfig(noExternal), {}, { root: p.root, recordedProvenance: false, registry: new ScannerRegistry(), fastModel: null, textFiles: text });
  const ids = report.files.flatMap((f) => f.findings).map((f) => f.ruleId).sort();
  assert.deepEqual(ids.filter((i) => /^(?:github-actions|docker)\./.test(i)), ['docker.runs-as-root', 'github-actions.write-all-permissions']);
});

test('skill guidance sections are selected by category, capped for prompts', () => {
  const s = selectSkillSection(builtin.skills, 'lifecycle')!;
  assert.equal(s.skill, 'lifecycle-and-races');
  assert.equal(s.section, 'Verification checklist');
  assert.ok(s.text.length <= 3300);
  assert.equal(selectSkillSection(builtin.skills, 'no-such-category'), null);
  assert.ok(builtinSkillsDir());
});

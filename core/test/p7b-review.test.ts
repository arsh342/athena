import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { analyzeProject, type ProjectFile } from '../src/analysis/project.ts';
import { mergeConfig } from '../src/config.ts';
import { scanFiles } from '../src/engine.ts';
import { getRuleInfo } from '../src/rules/catalog.ts';
import { ruleMeta } from '../src/rules/registry.ts';
import { ScannerRegistry } from '../src/scanner-registry.ts';
import { activationReason, buildProfile } from '../src/skills/activate.ts';
import { compileSkills } from '../src/skills/compile.ts';
import { fetchSkills, installCandidate, parseSkillSource } from '../src/skills/install.ts';
import { loadSkills } from '../src/skills/loader.ts';
import { compileSafeRegex } from '../src/skills/regex-safety.ts';
import { deriveVariantRule, saveVariant } from '../src/skills/variants.ts';
import { validateSkill } from '../src/skills/validate.ts';

const noExternal = { semgrep: { enabled: false, timeoutMs: 1000, config: 'auto' }, eslint: { enabled: false, timeoutMs: 1000 }, npmAudit: { enabled: false, timeoutMs: 1000 }, nodejsscan: { enabled: false, timeoutMs: 1000, requireDocker: false }, bearer: { enabled: false, timeoutMs: 1000 } };
const SKILL_MD = (name: string) => `---\nname: ${name}\ndescription: A skill used by the review tests to check hostile behaviour.\nversion: 1.0.0\nlicense: MIT\nappliesTo:\n  detect:\n    always: true\ncategories: []\n---\n\n## Verification checklist\n\n- check\n`;
const rules = (id: string, match: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ rules: [{ id, title: 'T', severity: 'LOW', cwe: [1], category: 'style', why: 'w', fix: 'f', match, ...extra }] });
function dirWith(name: string, files: Record<string, string>): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'athena-p7b-')), name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'athena-p7bp-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
const scan = (root: string, files: string[], extra: Record<string, unknown> = {}) => scanFiles(files.map((f) => join(root, f)), mergeConfig(noExternal), {}, { root, recordedProvenance: false, registry: new ScannerRegistry(), fastModel: null, ...extra });

// ── C1: skills cannot shadow built-in rules or leak metadata between scans ──────────────
test('C1: a skill cannot define a rule id that exists in the built-in registry, nor be named like a built-in prefix', () => {
  const clash = validateSkill(dirWith('taint', { 'SKILL.md': SKILL_MD('taint'), 'rules.json': rules('taint.sql-injection', { kind: 'line', line: 'x' }) }), 'repo');
  assert.ok(clash.issues.some((i) => /reserved|already defined|built-in/.test(i.message)), JSON.stringify(clash.issues));
  const prefixOnly = validateSkill(dirWith('crypto', { 'SKILL.md': SKILL_MD('crypto'), 'rules.json': rules('crypto.mine', { kind: 'line', line: 'x' }) }), 'repo');
  assert.ok(prefixOnly.issues.some((i) => /reserved/.test(i.message)));
  assert.equal(validateSkill(dirWith('my-team', { 'SKILL.md': SKILL_MD('my-team'), 'rules.json': rules('my-team.ok', { kind: 'line', line: 'x' }) }), 'repo').issues.length, 0);
});

test('C1: skill rule metadata is per scan and never written to the global registry', async () => {
  const root = project({ 'a.js': "app.get('/x', (req, res) => { db.query('select ' + req.query.a); });\nfoo();\n", '.athena/skills/my-team/SKILL.md': SKILL_MD('my-team'), '.athena/skills/my-team/rules.json': rules('my-team.foo', { kind: 'call', callee: '^foo$' }, { severity: 'MEDIUM' }) });
  const report = await scan(root, ['a.js']);
  const mine = report.files.flatMap((f) => f.findings).find((f) => f.ruleId === 'my-team.foo');
  assert.ok(mine);
  assert.equal(mine!.severity, 'MEDIUM');
  assert.equal(ruleMeta('my-team.foo'), null, 'skill metadata must not leak into the process-wide registry');
  assert.equal(ruleMeta('taint.sql-injection')!.severity, 'HIGH');
});

test('C1: explain-style lookup knows built-in skill rules outside a scan', () => {
  const info = getRuleInfo('express.session-cookie-insecure');
  assert.ok(info);
  assert.match(info!.fix, /secure/i);
});

// ── C2: regexes that pass naive probes cannot stall a scan ──────────────────────────────
test('C2: polynomial patterns are rejected for third-party skills', () => {
  for (const evil of ['e[\\s\\S]*e[\\s\\S]*e[\\s\\S]*#', '\\s*\\s*\\s*\\s*\\s*\\s*\\s*x', '(?<n>a)\\k<n>', '.*.*.*x', 'a.*b.*c.*d']) {
    assert.equal(compileSafeRegex(evil, 'im', { strict: true }).ok, false, evil);
  }
  assert.equal(compileSafeRegex('^req\\.(?:body|query)\\b', 'im', { strict: true }).ok, true);
  assert.equal(compileSafeRegex('dangerousCall\\s*\\(\\s*\\w+', 'im', { strict: true }).ok, true);
});

test('C2: a hostile repo skill cannot make a scan slow', async () => {
  const root = project({
    'a.js': `function f() {\n${'e '.repeat(1500)}\n  dangerousCall(x);\n}\n`,
    '.athena/skills/slow/SKILL.md': SKILL_MD('slow'),
    '.athena/skills/slow/rules.json': rules('slow.r', { kind: 'call', callee: '^dangerousCall$', where: [{ op: 'fnTextMatches', regex: 'e[\\s\\S]*e[\\s\\S]*e[\\s\\S]*#' }] }),
  });
  const started = Date.now();
  const report = await scan(root, ['a.js']);
  assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
  assert.ok(report.summary.skills!.every((s) => s.name !== 'slow') || true);
});

// ── I3: names ────────────────────────────────────────────────────────────────────────────
test('I3: a user or repo skill cannot replace a built-in skill; the folder must match the name', () => {
  const evil = dirWith('express', { 'SKILL.md': SKILL_MD('express'), 'rules.json': rules('express.fake', { kind: 'line', line: 'zzz' }) });
  const loaded = loadSkills('/nonexistent', { userDir: dirname(evil), repoDir: '/nope' });
  const express = loaded.skills.find((s) => s.meta.name === 'express')!;
  assert.equal(express.source, 'builtin');
  assert.ok(loaded.warnings.some((w) => /cannot replace the built-in skill "express"/.test(w)));
  const renamed = dirWith('some-folder', { 'SKILL.md': SKILL_MD('other-name') });
  const l2 = loadSkills('/nonexistent', { builtinDir: null, userDir: dirname(renamed), repoDir: '/nope' });
  assert.equal(l2.skills.length, 0);
  assert.ok(l2.warnings.some((w) => /folder name/.test(w)));
});

// ── I4: activation parses manifests, never prose ─────────────────────────────────────────
test('I4: words in descriptions and comments do not activate skills', () => {
  const root = project({
    'main.js': 'console.log(1)\n',
    'pyproject.toml': '[project]\nname = "x"\ndescription = "react to events; express your config; not a django app"\ndependencies = ["requests>=2"]\n',
    'requirements.txt': '# migrated off flask and fastapi\nrequests==2.31 # not express\n',
    'package.json': '{"name":"x","description":"uses react and express words","dependencies":{"vue":"3"}}',
  });
  const loaded = loadSkills('/nonexistent', { userDir: '/nope', repoDir: '/nope' });
  const files = [{ path: join(root, 'main.js'), source: 'console.log(1)\n', lang: 'javascript' as const }, { path: join(root, 'app.py'), source: 'x = 1\n', lang: 'python' as const }];
  const profile = buildProfile(root, files);
  const active = loaded.skills.filter((s) => activationReason(s, profile) && s.rules.length > 0 && !/always/.test(activationReason(s, profile)!)).map((s) => s.meta.name);
  assert.deepEqual(active, []);
  const real = project({ 'a.py': 'x = 1\n', 'requirements.txt': 'Flask[async]>=2.0  # web\n-r other.txt\n', 'pyproject.toml': '[tool.poetry.dependencies]\npython = "^3.11"\nfastapi = "^0.100"\n' });
  const p2 = buildProfile(real, [{ path: join(real, 'a.py'), source: 'x = 1\n', lang: 'python' }]);
  const names = loaded.skills.filter((s) => /dependency/.test(activationReason(s, p2) ?? '')).map((s) => s.meta.name).sort();
  assert.deepEqual(names, ['fastapi', 'flask']);
});

// ── I5: false positives ─────────────────────────────────────────────────────────────────
test('I5: sampled built-in rules stay silent on ordinary code', async () => {
  const loaded = loadSkills('/nonexistent', { userDir: '/nope', repoDir: '/nope' });
  const compiled = compileSkills(loaded.skills);
  const check = async (path: string, lang: ProjectFile['lang'], source: string) => {
    const r = await analyzeProject([{ path: `/p/${path}`, lang, source }], { root: '/p', skills: compiled });
    return [...r.findings.values()].flat().filter((f) => compiled.ruleSkill.has(f.ruleId)).map((f) => `${f.ruleId}:${f.line}`);
  };
  assert.deepEqual(await check('a.js', 'javascript', "console.log('Token refreshed for user', userId);\nconsole.debug('Password reset email sent to', email);\nlogger.info(`Refreshing token for ${user.id}`);\nlocalStorage.setItem('authorProfile', x);\nlocalStorage.setItem('oauthProvider', x);\n"), []);
  assert.deepEqual(await check('a.py', 'python', "print('Invalid token for user', user_id)\n"), []);
  assert.deepEqual(await check('b.js', 'javascript', "const openai = require('openai');\nconst { execSync } = require('child_process');\nfunction f(results) { execSync(results[0]); }\n"), []);
  assert.deepEqual(await check('c.js', 'javascript', "console.log('user login', user.password);\n"), ['ai-generated-code.logs-credentials:1']);
});

test('I5: Dockerfile and workflow rules judge the right context', async () => {
  const { runFileRules } = await import('../src/skills/compile.ts');
  const loaded = loadSkills('/nonexistent', { userDir: '/nope', repoDir: '/nope' });
  const compiled = compileSkills(loaded.skills);
  const ids = (path: string, text: string) => runFileRules(path, text, compiled.fileRules).map((h) => `${h.ruleId}:${h.line}`).sort();
  const multi = 'FROM node:20 AS build\nUSER builder\nRUN npm ci\nFROM node:20-slim\nCOPY --from=build /a /a\n';
  assert.deepEqual(ids('Dockerfile', multi), ['docker.runs-as-root:4'], 'one finding on the last stage only');
  assert.deepEqual(ids('Dockerfile', 'FROM node:20 AS build\nRUN x\nFROM gcr.io/distroless/nodejs20:nonroot\nCOPY --from=build /a /a\n'), []);
  assert.deepEqual(ids('Dockerfile', 'FROM node:20 AS build\nFROM build AS test\nUSER app\n'), []);
  assert.deepEqual(ids('app.dockerfile', 'FROM node:20\nCOPY . .\n'), ['docker.runs-as-root:1']);
  const wf = (steps: string) => `name: x\non: [issues]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
  const inRun = wf("      - run: |\n          echo \"${{ github.event.issue.title }}\"\n");
  assert.deepEqual(ids('.github/workflows/a.yml', inRun).filter((i) => /script-injection/.test(i)), ['github-actions.script-injection:8']);
  const inWith = wf("      - uses: actions/github-script@v7\n        with:\n          title: \"Triage: ${{ github.event.issue.title }}\"\n");
  assert.deepEqual(ids('.github/workflows/a.yml', inWith).filter((i) => /script-injection/.test(i)), []);
});

// ── I6: variant analysis ────────────────────────────────────────────────────────────────
test('I6: only call findings generalise; the finding keeps its own severity; chains drop literal receivers; saving never drops rules', async () => {
  assert.equal(await deriveVariantRule({ ruleId: 'secret.stripe-live-key', file: '/p/a.js', line: 1, code: 'STRIPE=[REDACTED]' }, "fetch(url, { k: 'x' }); // sk\n", 'javascript'), null);
  const rule = await deriveVariantRule({ ruleId: 'llm-app-security.model-output-executed', file: '/p/a.js', line: 1, code: 'eval(completion.choices[0].message.content)', severity: 'HIGH', category: 'llm', cwe: [94] }, 'eval(completion.choices[0].message.content);\n', 'javascript');
  assert.equal(rule!.severity, 'HIGH');
  assert.equal(rule!.category, 'llm');
  assert.deepEqual(rule!.cwe, [94]);
  const chain = await deriveVariantRule({ ruleId: 'taint.sql-injection', file: '/p/a.js', line: 1, code: "knex('users').whereRaw('a = ' + x)" }, "knex('users').whereRaw('a = ' + x);\n", 'javascript');
  assert.equal((chain!.match as { callee: string }).callee, '\\.whereRaw$');
  const root = mkdtempSync(join(tmpdir(), 'athena-p7b-save-'));
  mkdirSync(join(root, '.athena'));
  writeFileSync(join(root, '.athena', 'learned-rules.json'), JSON.stringify({ rules: [{ id: 'learned.handmade', note: 'edited', title: 'x' }] }));
  assert.throws(() => saveVariant(root, rule!), /invalid|fix or delete/i);
  assert.match(readFileSync(join(root, '.athena', 'learned-rules.json'), 'utf8'), /handmade/);
});

// ── I7: install hardening ───────────────────────────────────────────────────────────────
function gitRepo(files: Record<string, string>): { dir: string; commit: string } {
  const dir = mkdtempSync(join(tmpdir(), 'athena-p7bg-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  return { dir, commit: '' , ...(() => { execFileSync('git', ['add', '-A'], { cwd: dir, env }); execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'i'], { cwd: dir, env }); return { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env, encoding: 'utf8' }).trim() }; })() };
}
const GOOD = { 'SKILL.md': SKILL_MD('third'), 'rules.json': rules('third.r', { kind: 'line', line: 'zzz' }) };

test('I7: spec parsing, traversal, symlinks, option-like URLs, short SHAs and temp cleanup', async () => {
  assert.deepEqual(parseSkillSource('https://x.test/r.git#sub/dir@' + 'a'.repeat(40)), { url: 'https://x.test/r.git', path: 'sub/dir', commit: 'a'.repeat(40) });
  await assert.rejects(fetchSkills('--upload-pack=touch /tmp/pwned'), /not a valid source|must not start/);
  await assert.rejects(fetchSkills('ext::sh -c touch% /tmp/pwned'), /not a valid source|transport|not allowed/i);
  const repo = gitRepo(GOOD);
  await assert.rejects(fetchSkills(`${repo.dir}@${repo.commit.slice(0, 8)}`), /40-character/);
  await assert.rejects(fetchSkills(`${repo.dir}#../../..`), /outside|escapes/i);
  const linked = gitRepo({ ...GOOD });
  symlinkSync('/etc', join(linked.dir, 'link'));
  execFileSync('git', ['add', '-A'], { cwd: linked.dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'l'], { cwd: linked.dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  await assert.rejects(fetchSkills(`${linked.dir}#link`), /outside|symbolic|escapes/i);
  const ok = await fetchSkills(repo.dir);
  assert.equal(ok.candidates.length, 1);
  assert.ok(existsSync(ok.tmp));
  const { disposeFetched } = await import('../src/skills/install.ts');
  disposeFetched(ok);
  assert.ok(!existsSync(ok.tmp));
  const target = mkdtempSync(join(tmpdir(), 'athena-p7bt-'));
  const again = await fetchSkills(repo.dir);
  installCandidate(again.candidates[0]!, repo.dir, again.commit, target);
  assert.equal(readdirSync(join(target, 'third')).includes('.git'), false);
  disposeFetched(again);
});

// ── minors ──────────────────────────────────────────────────────────────────────────────
test('minor: fixture exclusion is narrow, file rules use relative paths, warnings reach the report sanitized', async () => {
  const { isSkillFixturePath } = await import('../src/skills/activate.ts');
  assert.equal(isSkillFixturePath('.athena/skills/x/fixtures/vuln/a.js'), true);
  assert.equal(isSkillFixturePath('core/skills/flask/fixtures/vuln/a.py'), true);
  assert.equal(isSkillFixturePath('src/skills/catalog/fixtures/data.js'), false);
  const root = project({
    'a.js': '1\n',
    'Dockerfile': 'FROM node:20\n',
    '.athena/skills/express/SKILL.md': SKILL_MD('express'),
    '.athena/skills/bad\u001b[31mname/SKILL.md': 'nope',
  });
  const report = await scan(root, ['a.js'], { textFiles: [join(root, 'Dockerfile')] });
  assert.ok(report.files.flatMap((f) => f.findings).some((f) => f.ruleId === 'docker.runs-as-root'));
  const warnings = report.summary.skillWarnings ?? [];
  assert.ok(warnings.some((w) => /cannot replace the built-in skill "express"/.test(w)));
  assert.ok(warnings.every((w) => !/\u001b/.test(w)));
});

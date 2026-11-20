import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/app', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'athena-cli-home-'));
const OFF = ['--no-eslint', '--no-npm-audit'];

function runCli(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--import', 'tsx', entry, ...args], {
      cwd, env: { ...process.env, ATHENA_HOME: home, NO_COLOR: '1', CI: 'true' }, maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

test('scan --format json writes only JSON to stdout and exits 1 on the AWS key', async () => {
  const r = await runCli(['scan', fixture, '--format', 'json', ...OFF]);
  assert.equal(r.code, 1, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok('aiPercentage' in parsed.summary && 'coverage' in parsed.summary && 'aiProvenance' in parsed.summary);
  assert.ok(parsed.files.flatMap((f: { findings: unknown[] }) => f.findings).length > 0);
});

test('terminal report shows gate, findings and coverage, with no screen clearing', async () => {
  const r = await runCli(['scan', fixture, ...OFF]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /BLOCKED/);
  assert.match(r.stdout, /Coverage/);
  assert.match(r.stdout, /AI provenance/);
  assert.doesNotMatch(r.stdout + r.stderr, /\x1b\[(3J|2J)/);
  assert.doesNotMatch(r.stdout, /AKIAQ7XZ4HJ2KL9MN3PW/);
});

test('--fail-on none passes even with findings', async () => {
  const r = await runCli(['scan', fixture, '--fail-on', 'none', ...OFF]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /PASS/);
});

test('--strict exits 3 on an incomplete scan without blocking findings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-strict-'));
  writeFileSync(join(dir, 'broken.ts'), 'function ok() {\n  const a = 1;\n  return a;\n}\nconst = ;\n');
  const strict = await runCli(['scan', dir, '--fail-on', 'none', '--strict', ...OFF]);
  assert.equal(strict.code, 3, strict.stderr);
  assert.match(strict.stdout, /PASS \(incomplete\)/);
  const lenient = await runCli(['scan', dir, '--fail-on', 'none', ...OFF]);
  assert.equal(lenient.code, 0);
});

test('--format sarif --output writes SARIF to the file and nothing to stdout', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'athena-sarif-')), 'r.sarif');
  const r = await runCli(['scan', fixture, '--format', 'sarif', '--output', out, ...OFF]);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).version, '2.1.0');
});

test('unknown flag and bad --fail-on exit 2 with a message on stderr', async () => {
  const bad = await runCli(['scan', fixture, '--fail-on', 'extreme']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--fail-on/);
  const unknown = await runCli(['scan', fixture, '--bogus']);
  assert.equal(unknown.code, 2);
});

test('--threshold prints the deprecation note on stderr', async () => {
  const r = await runCli(['scan', fixture, '--threshold', '50', '--fail-on', 'none', ...OFF]);
  assert.match(r.stderr, /--threshold is deprecated/);
});

test('athena.config.json failOn is applied and overridden by the flag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-cfg-run-'));
  writeFileSync(join(dir, 'a.ts'), readFileSync(join(fixture, 'src/config.ts'), 'utf8'));
  writeFileSync(join(dir, 'athena.config.json'), JSON.stringify({ failOn: 'none' }));
  assert.equal((await runCli(['scan', dir, ...OFF])).code, 0);
  assert.equal((await runCli(['scan', dir, '--fail-on', 'high', ...OFF])).code, 1);
});

test('--help exits 0', async () => {
  const r = await runCli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /scan/);
});

function gitRepoWithAiFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'athena-repo-'));
  mkdirSync(join(dir, 'sub'));
  const file = join(dir, 'sub', 'x.ts');
  writeFileSync(file, 'export function f(a: number) {\n  const b = a + 1;\n  const c = b * 2;\n  return c;\n}\n');
  const g = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a]);
  g('init', '-q', '-b', 'main');
  g('add', '.');
  g('commit', '-q', '-m', 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
  return { dir, file };
}

test('scanning a single file still finds its git history and uses a non-empty SARIF uri', async () => {
  const { file } = gitRepoWithAiFile();
  const json = await runCli(['scan', file, '--format', 'json', ...OFF]);
  const p = JSON.parse(json.stdout).summary.aiProvenance;
  assert.equal(p.recorded.available, true, json.stderr);
  assert.ok(p.recorded.lines > 0);
});

test('SARIF uris are relative to the git repository root', async () => {
  const { dir, file } = gitRepoWithAiFile();
  writeFileSync(file, readFileSync(file, 'utf8').replace('return c;', "const k = 'AKIAQ7XZ4HJ2KL9MN3PW';\n  return c;"));
  for (const target of [join(dir, 'sub'), file]) {
    const r = await runCli(['scan', target, '--format', 'sarif', ...OFF]);
    const uris = JSON.parse(r.stdout).runs[0].results.map((x: { locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }) => x.locations[0].physicalLocation.artifactLocation.uri);
    assert.ok(uris.length > 0, r.stderr);
    assert.ok(uris.every((u: string) => u === 'sub/x.ts'), uris.join(','));
  }
});

test('scan finds a secret in a Python file and the header lists languages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-py-'));
  writeFileSync(join(dir, 'app.py'), 'def connect():\n    AWS_KEY = "AKIAQ7XZ4HJ2KL9MN3PW"\n    return AWS_KEY\n');
  writeFileSync(join(dir, 'deploy.sh'), 'deploy() {\n  echo one\n  echo two\n}\n');
  const json = await runCli(['scan', dir, '--format', 'json', ...OFF]);
  assert.equal(json.code, 1, json.stderr);
  const parsed = JSON.parse(json.stdout);
  const findings = parsed.files.flatMap((f: { findings: Array<{ file: string }> }) => f.findings);
  assert.ok(findings.some((f: { file: string }) => f.file.endsWith('app.py')));
  const text = await runCli(['scan', dir, ...OFF]);
  assert.match(text.stdout, /· 2 files \(py 1 · sh 1\)/);
});

test('scan reports a source-to-sink path and exits 1 for an injection in a Python route', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-taint-'));
  writeFileSync(join(dir, 'app.py'), '@app.route("/u")\ndef user():\n    uid = request.args.get("id")\n    cursor.execute("SELECT * FROM users WHERE id = " + uid)\n    return "ok"\n');
  const r = await runCli(['scan', dir, ...OFF]);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stdout, /SQL injection/);
  assert.match(r.stdout, /path: app\.py:3 → app\.py:3 → app\.py:4/);
  assert.match(r.stdout, /public/);
});

test('publicRoutes in athena.config.json silences the missing-auth convention', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-pub-'));
  const routes = [0, 1, 2, 3, 4, 5].map((i) => (i === 3 ? `router.get('/r${i}', (req, res) => res.send('x'));` : `router.get('/r${i}', requireAuth, (req, res) => res.send('x'));`)).join('\n');
  writeFileSync(join(dir, 'routes.js'), routes + '\n');
  const before = await runCli(['scan', dir, '--format', 'json', ...OFF]);
  assert.ok(JSON.parse(before.stdout).files.flatMap((f: { findings: Array<{ ruleId: string }> }) => f.findings).some((x: { ruleId: string }) => x.ruleId === 'conv.missing-auth'));
  writeFileSync(join(dir, 'athena.config.json'), JSON.stringify({ publicRoutes: ['/r3'] }));
  const after = await runCli(['scan', dir, '--format', 'json', ...OFF]);
  assert.ok(!JSON.parse(after.stdout).files.flatMap((f: { findings: Array<{ ruleId: string }> }) => f.findings).some((x: { ruleId: string }) => x.ruleId === 'conv.missing-auth'));
});

test('a secret in a .env file is found, redacted, and blocks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'athena-env-'));
  writeFileSync(join(dir, '.env'), 'STRIPE_KEY=sk_live_' + 'Qz8WmN3xT6vB1cY4uR7eK2pL\n');
  const r = await runCli(['scan', dir, ...OFF]);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stdout, /Stripe live secret key/);
  assert.doesNotMatch(r.stdout, /Qz8WmN3xT6vB1cY4uR7eK2pL/);
});

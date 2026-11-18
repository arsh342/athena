import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/app', import.meta.url));
const home = mkdtempSync(join(tmpdir(), 'athena-cli-home-'));
const OFF = ['--no-eslint', '--no-npm-audit', '--no-nodejsscan', '--no-bearer', '--no-semgrep'];

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

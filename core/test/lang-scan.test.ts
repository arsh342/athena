import assert from 'node:assert/strict';
import { mkdtemp, readdir, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { mergeConfig } from '../src/config.ts';
import { scanFiles } from '../src/engine.ts';
import { LANGUAGE_FAMILY, type LanguageId } from '../src/lang/languages.ts';
import { __setGrammarDirForTests } from '../src/lang/parser-pool.ts';
import { ScannerRegistry } from '../src/scanner-registry.ts';

const noExternal = {
  eslint: { enabled: false, timeoutMs: 1000 },
  npmAudit: { enabled: false, timeoutMs: 1000 },
  };
const options = (root: string) => ({ root, recordedProvenance: false, registry: new ScannerRegistry() });

const fixtures = join(import.meta.dirname, 'fixtures', 'lang');
async function fixtureFiles(): Promise<string[]> {
  const dirs = (await readdir(fixtures, { withFileTypes: true })).filter((d) => d.isDirectory());
  const files: string[] = [];
  for (const d of dirs) for (const f of await readdir(join(fixtures, d.name))) files.push(join(fixtures, d.name, f));
  return files.sort();
}

test('scanning every language reports per-language totals', async () => {
  const report = await scanFiles(await fixtureFiles(), mergeConfig(noExternal), {}, options(fixtures));
  const languages = report.summary.languages!;
  assert.ok(languages, 'summary.languages');
  const families = new Set(Object.keys(languages).map((l) => LANGUAGE_FAMILY[l as LanguageId]));
  assert.deepEqual([...families].sort(), [...new Set(Object.values(LANGUAGE_FAMILY))].sort());
  for (const [lang, stats] of Object.entries(languages)) {
    assert.equal(stats.files, 1, lang);
    assert.ok(stats.units > 0, `${lang} units`);
    assert.ok(stats.lines > 10, `${lang} lines`);
  }
  assert.equal(report.summary.coverage!.complete, true, report.summary.coverage!.gaps.join('; '));
});

test('a 1 MB one-line minified file finishes quickly without exploding units', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'athena-min-'));
  let body = '';
  for (let i = 0; body.length < 1_000_000; i++) body += `function a${i}(x){if(x){return x+1}else{return [x].map(y=>y-1)}};`;
  const file = join(dir, 'bundle.min.js');
  await writeFile(file, body);
  const started = Date.now();
  const report = await scanFiles([file], mergeConfig({ ...noExternal, maxFileSize: 2_000_000 }), {}, options(dir));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `took ${elapsed} ms`);
  assert.equal(report.summary.totalUnits, 0);
  assert.equal(report.summary.coverage!.files[0]!.status, 'skipped-excluded');
  assert.match(report.summary.coverage!.files[0]!.reason ?? '', /minified|generated|vendored/);
});

test('binary content with a source extension is parse-failed, not a crash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'athena-bin-'));
  const file = join(dir, 'data.py');
  await writeFile(file, Buffer.from([0x64, 0x65, 0x66, 0x00, 0xff, 0xfe, 0x0a]));
  const report = await scanFiles([file], mergeConfig(noExternal), {}, options(dir));
  assert.deepEqual(report.summary.coverage!.files[0], { path: file, status: 'parse-failed', reason: 'not a text file' });
});

test('a grammar that fails to load is a coverage gap and other languages still scan', async () => {
  const require = createRequire(import.meta.url);
  const wasm = join(dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')), 'wasm');
  const broken = await mkdtemp(join(tmpdir(), 'athena-grammars-'));
  for (const f of await readdir(wasm)) if (f !== 'tree-sitter-go.wasm') await symlink(join(wasm, f), join(broken, f));
  __setGrammarDirForTests(broken);
  try {
    const files = await fixtureFiles();
    const report = await scanFiles(files, mergeConfig(noExternal), {}, options(fixtures));
    const coverage = report.summary.coverage!;
    const goFile = files.find((f) => f.endsWith('.go'))!;
    assert.deepEqual(coverage.files.find((f) => f.path === goFile), { path: goFile, status: 'parse-failed', reason: 'parser unavailable' });
    assert.ok(coverage.gaps.includes('parser:go unavailable'), coverage.gaps.join('; '));
    assert.ok(coverage.checks.some((c) => c.name === 'parser:go' && c.status === 'unavailable'));
    const python = report.files.find((f) => f.path.endsWith('.py'))!;
    assert.ok(python.units.length > 0);
  } finally {
    __setGrammarDirForTests(null);
  }
});

test('deeply nested one-line code is fast (rows < 3 are skipped before metadata)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'athena-nest1-'));
  const file = join(dir, 'n.js');
  await writeFile(file, 'const f = ' + '() => ('.repeat(3000) + '1' + ')'.repeat(3000) + ';');
  const started = Date.now();
  const report = await scanFiles([file], mergeConfig(noExternal), {}, options(dir));
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  assert.equal(report.summary.totalUnits, 0);
});

test('deeply nested multi-line code stops at a work budget and is reported, not hung', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'athena-nest2-'));
  const file = join(dir, 'n.js');
  await writeFile(file, 'const f = ' + '() => (\n'.repeat(3000) + '1' + ')\n'.repeat(3000) + ';\n');
  const started = Date.now();
  const report = await scanFiles([file], mergeConfig(noExternal), {}, options(dir));
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  const cov = report.summary.coverage!.files[0]!;
  assert.deepEqual([cov.status, cov.reason], ['parse-failed', 'too complex to analyze']);
});

test('valid UTF-8 containing a literal U+FFFD is analyzed, invalid UTF-8 is not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'athena-utf-'));
  const ok = join(dir, 'ok.js');
  await writeFile(ok, 'function f() {\n  const s = "�";\n  return s;\n}\n');
  const bad = join(dir, 'bad.js');
  await writeFile(bad, Buffer.from('function f() {\n  return "\xff\xfe";\n}\n', 'latin1'));
  const report = await scanFiles([ok, bad], mergeConfig(noExternal), {}, options(dir));
  const by = (p: string) => report.summary.coverage!.files.find((f) => f.path === p)!;
  assert.equal(by(ok).status, 'analyzed');
  assert.equal(by(bad).reason, 'not a text file');
});

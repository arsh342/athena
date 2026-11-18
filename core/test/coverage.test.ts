import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { mergeConfig } from '../src/config.ts';
import { scanFiles } from '../src/engine.ts';
import { ScannerRegistry } from '../src/scanner-registry.ts';

const noExternal = {
  semgrep: { enabled: false, timeoutMs: 1000, config: 'auto' },
  eslint: { enabled: false, timeoutMs: 1000 },
  npmAudit: { enabled: false, timeoutMs: 1000 },
  nodejsscan: { enabled: false, timeoutMs: 1000, requireDocker: false },
  bearer: { enabled: false, timeoutMs: 1000 },
};

const VALID = 'function ok() {\n  const a = 1;\n  return a;\n}\n';

async function fixture(files: Record<string, string>): Promise<{ dir: string; path: (n: string) => string }> {
  const dir = await mkdtemp(join(tmpdir(), 'athena-cov-'));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  return { dir, path: (n) => join(dir, n) };
}

test('syntax error file is parse-failed but its units are still analyzed', async () => {
  const { dir, path } = await fixture({ 'broken.ts': 'function ok() {\n  const a = 1;\n  return a;\n}\nconst = ;\n' });
  const report = await scanFiles([path('broken.ts')], mergeConfig(noExternal), {}, { root: dir });
  const f = report.summary.coverage!.files.find((x) => x.path === path('broken.ts'))!;
  assert.equal(f.status, 'parse-failed');
  assert.match(f.reason!, /line 5/);
  assert.ok(report.files.find((x) => x.path === path('broken.ts'))!.units.length >= 1);
  assert.equal(report.summary.coverage!.complete, false);
  assert.deepEqual(report.summary.coverage!.gaps, ['1 file(s) not parsed']);
});

test('oversized and missing files are gaps; excluded files are not', async () => {
  const { dir, path } = await fixture({ 'big.ts': VALID, 'skip.ts': VALID });
  const report = await scanFiles(
    [path('big.ts'), path('gone.ts')],
    mergeConfig({ ...noExternal, maxFileSize: 10 }),
    {},
    { root: dir, excludedFiles: [path('skip.ts')] },
  );
  const statuses = Object.fromEntries(report.summary.coverage!.files.map((f) => [f.path, f.status]));
  assert.deepEqual(statuses, {
    [path('big.ts')]: 'skipped-size',
    [path('gone.ts')]: 'missing',
    [path('skip.ts')]: 'skipped-excluded',
  });
  assert.equal(report.summary.coverage!.gaps.length, 2);
});

test('unavailable external scanner makes coverage incomplete', async () => {
  const { dir, path } = await fixture({ 'a.ts': VALID });
  const registry = new ScannerRegistry();
  for (const s of registry.getAllScanners()) registry.unregister(s.name);
  registry.register({
    name: 'eslint', version: '0', enabled: true,
    run: async () => [], checkAvailable: async () => false, normalize: (f) => f,
  });
  const config = mergeConfig({ ...noExternal, eslint: { enabled: true, timeoutMs: 1000 } });
  const report = await scanFiles([path('a.ts')], config, {}, { root: dir, registry });
  const check = report.summary.coverage!.checks.find((c) => c.name === 'eslint');
  assert.equal(check?.status, 'unavailable');
  assert.ok(report.summary.coverage!.gaps.includes('eslint unavailable'));
  assert.equal(report.summary.coverage!.complete, false);
});

test('clean scan of a valid file is complete', async () => {
  const { dir, path } = await fixture({ 'a.ts': VALID });
  const report = await scanFiles([path('a.ts')], mergeConfig(noExternal), {}, { root: dir });
  assert.deepEqual(report.summary.coverage!.gaps, []);
  assert.equal(report.summary.coverage!.complete, true);
  assert.equal(report.summary.coverage!.files[0].status, 'analyzed');
});

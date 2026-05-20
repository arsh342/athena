import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { runESLint } from '../src/analyzers/eslint-adapter.ts';

let fixtureDir = '';

beforeEach(async () => {
  fixtureDir = await mkdtemp(join(process.cwd(), '.athena-eslint-'));
});

afterEach(async () => {
  if (fixtureDir) {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('runESLint lints JS files and TS files without crashing', async () => {
  const jsFile = join(fixtureDir, 'server.js');
  const tsFile = join(fixtureDir, 'runner.ts');

  await writeFile(jsFile, "import { exec } from 'node:child_process';\nexport function go(input) {\n  exec(input);\n}\n");
  await writeFile(tsFile, "export function run(snippet: string) {\n  return eval(snippet);\n}\n");

  const findings = await runESLint([jsFile, tsFile], {
    enabled: true,
    timeoutMs: 5_000,
  });

  assert.equal(findings.some((finding) => finding.file === jsFile), true);
  assert.equal(findings.some((finding) => finding.file === tsFile), true);
  assert.equal(findings.some((finding) => finding.ruleId === 'eslint.unknown-rule'), false);
});

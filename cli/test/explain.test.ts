import assert from 'node:assert/strict';
import test from 'node:test';

import { OFF, fixture, newHome, runCli } from './helpers-cli.ts';

async function firstFindingId(home: string): Promise<string> {
  const scan = await runCli(['scan', fixture, '--format', 'json', ...OFF], home);
  const parsed = JSON.parse(scan.stdout) as { files: Array<{ findings: Array<{ id: string }> }> };
  return parsed.files.flatMap((f) => f.findings)[0].id;
}

test('explain by 6-char prefix shows catalog text and a redacted frame', async () => {
  const home = newHome();
  const id = await firstFindingId(home);
  const r = await runCli(['explain', id.slice(0, 6), '--path', fixture], home);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Why it matters/);
  assert.match(r.stdout, /How to fix/);
  assert.match(r.stdout, /AI provenance:/);
  assert.match(r.stdout, /\[REDACTED\]/);
  assert.doesNotMatch(r.stdout, /AKIA[0-9A-Z]{16}/);
});

test('explain without a saved scan exits 2 with guidance', async () => {
  const r = await runCli(['explain', 'abcdef', '--path', fixture], newHome());
  assert.equal(r.code, 2);
  assert.match(r.stderr, /run athena scan first/);
});

test('explain with an unknown prefix exits 2', async () => {
  const home = newHome();
  await firstFindingId(home);
  const r = await runCli(['explain', 'zzzzzz', '--path', fixture], home);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no finding matching zzzzzz/);
});

test('explain rejects prefixes shorter than 4 characters', async () => {
  const home = newHome();
  await firstFindingId(home);
  const r = await runCli(['explain', 'ab', '--path', fixture], home);
  assert.equal(r.code, 2);
});

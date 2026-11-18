import assert from 'node:assert/strict';
import test from 'node:test';

import { fixture, newHome, runCli } from './helpers-cli.ts';

test('provenance --format json returns aiProvenance with totals that add up', async () => {
  const r = await runCli(['provenance', fixture, '--format', 'json'], newHome());
  assert.equal(r.code, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  const e = p.estimated;
  assert.equal(e.aiLines + e.mixedLines + e.uncertainLines + e.humanLines, p.totalLines);
  assert.ok(p.totalLines > 0);
});

test('provenance terminal output has the summary and a per-file table', async () => {
  const r = await runCli(['provenance', fixture], newHome());
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /AI provenance/);
  assert.match(r.stdout, /src\/config\.ts/);
});

test('provenance --about prints the method without scanning', async () => {
  const r = await runCli(['provenance', '--about'], newHome());
  assert.equal(r.code, 0);
  assert.match(r.stdout, /floor/);
  assert.match(r.stdout, /low confidence/);
});

test('provenance rejects an unknown --sort', async () => {
  const r = await runCli(['provenance', fixture, '--sort', 'nope'], newHome());
  assert.equal(r.code, 2);
});

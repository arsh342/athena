import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { capOutput, MAX_TOOL_OUTPUT, resolveInside, SandboxError } from '../src/sandbox.ts';
import { makeReadOnlyTools } from '../src/tools/index.ts';

function repo() {
  const base = mkdtempSync(join(tmpdir(), 'agents-tools-'));
  const root = join(base, 'project');
  const write = (rel: string, body: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  write('src/app.js', "const express = require('express');\nconst app = express();\nfunction helper(v) { return v; }\napp.get('/x', (req, res) => { res.send(String(helper(req.query.c))); });\n");
  write('big.txt', 'x'.repeat(100_000));
  writeFileSync(join(base, 'outside.txt'), 'secret');
  symlinkSync(join(base, 'outside.txt'), join(root, 'link.txt'));
  return { root, base };
}
const byName = (root: string) => Object.fromEntries(makeReadOnlyTools(root).map((t) => [t.name, t]));

test('paths that leave the repository are refused: parent traversal, absolute paths, symlinks', async () => {
  const { root } = repo();
  for (const bad of ['../outside.txt', '/etc/passwd', 'link.txt', 'src/../../outside.txt']) assert.throws(() => resolveInside(root, bad), SandboxError, bad);
  assert.doesNotThrow(() => resolveInside(root, 'src/app.js'));
  const tools = byName(root);
  await assert.rejects(tools.read_file!.execute({ path: '../outside.txt', startLine: null, endLine: null }), /outside the repository/);
  await assert.rejects(tools.list_dir!.execute({ path: '/' }), /outside the repository/);
  await assert.rejects(tools.read_file!.execute({ path: 'link.txt', startLine: null, endLine: null }), /outside the repository/);
});

test('every tool result is capped at 16 KB', async () => {
  const { root } = repo();
  const out = await byName(root).read_file!.execute({ path: 'big.txt', startLine: null, endLine: null });
  assert.ok(Buffer.byteLength(out) <= MAX_TOOL_OUTPUT, String(Buffer.byteLength(out)));
  assert.match(capOutput('y'.repeat(50_000)), /output truncated/);
  assert.equal(capOutput('short'), 'short');
});

test('the tools read and search but there is no tool that writes, runs code or fetches', () => {
  const { root } = repo();
  const names = makeReadOnlyTools(root).map((t) => t.name).sort();
  assert.deepEqual(names, ['dependency_findings', 'find_callers', 'find_symbol', 'grep', 'list_dir', 'offline_findings', 'read_file', 'taint_paths']);
  for (const t of makeReadOnlyTools(root)) {
    assert.equal(t.schema.additionalProperties, false, `${t.name} schema is strict`);
    assert.deepEqual([...(t.schema.required as string[])].sort(), Object.keys(t.schema.properties as object).sort(), `${t.name} requires every property`);
  }
});

test('read_file ranges, grep, list_dir, find_symbol and find_callers answer from the repository', async () => {
  const { root } = repo();
  const t = byName(root);
  assert.match(await t.read_file!.execute({ path: 'src/app.js', startLine: 3, endLine: 3 }), /^3: function helper/);
  assert.match(await t.grep!.execute({ text: 'helper', path: null, maxResults: null }), /src\/app\.js:3/);
  assert.match(await t.list_dir!.execute({ path: 'src' }), /f app\.js/);
  assert.match(await t.find_symbol!.execute({ name: 'helper' }), /helper src\/app\.js:3-3/);
  assert.match(await t.find_callers!.execute({ symbol: 'helper' }), /src\/app\.js/);
  assert.match(await t.offline_findings!.execute({ file: null }), /./);
  assert.match(await t.taint_paths!.execute({ file: null }), /./);
});

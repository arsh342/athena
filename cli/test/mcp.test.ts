import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createAthenaMcpServer, TOOL_NAMES } from '../src/mcp/server.ts';

const SECRET = 'AKIAIOSFODNN7EXAMPLE';
const APP = `const express = require('express');\nconst app = express();\nconst awsKey = "${SECRET}";\nfunction run(code) { return eval(code); }\napp.get('/x', (req, res) => { res.send(run(req.query.c)); });\napp.get('/y', (req, res) => { res.send(String(helper(req.query.c))); });\nfunction helper(v) { return v; }\n`;

async function connect() {
  const base = mkdtempSync(join(tmpdir(), 'mcp-'));
  const root = join(base, 'project');
  const write = (rel: string, body: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
  write('src/app.js', APP);
  write('package.json', JSON.stringify({ dependencies: { express: '4.18.0' } }));
  write('node_modules/axios/package.json', JSON.stringify({ name: 'axios', version: '1.6.0', types: 'index.d.ts' }));
  write('node_modules/axios/index.d.ts', 'export interface A { get(u: string): void }\ndeclare const axios: A;\nexport default axios;\n');
  writeFileSync(join(base, 'secret.txt'), 'outside');
  symlinkSync(join(base, 'secret.txt'), join(root, 'link.txt'));
  const server = createAthenaMcpServer({ root });
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ text: string }>)[0]!.text;
    return { error: r.isError === true, text, json: JSON.parse(text) as Record<string, any> };
  };
  return { root, base, call, client };
}

test('the tool list is exactly the documented set', async () => {
  const { client } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...TOOL_NAMES].sort());
});

test('scan, explain, check_files and map tools return compact JSON with the secret redacted', async () => {
  const { call } = await connect();
  const scan = await call('athena_scan', { path: '.', limit: 5 });
  assert.equal(scan.error, false, scan.text);
  assert.ok(scan.json.findings.length >= 1 && scan.json.findings.length <= 5);
  assert.ok(scan.text.length < 6000, 'compact');
  assert.ok(!scan.text.includes(SECRET), 'secret never leaves the server');
  assert.ok(scan.json.findings.every((f: { file: string }) => !f.file.startsWith('/')), 'relative paths');

  const id = scan.json.findings[0].id;
  const explain = await call('athena_explain', { id });
  assert.equal(explain.error, false, explain.text);
  assert.ok(Array.isArray(explain.json.frame));
  assert.ok(!explain.text.includes(SECRET));
  assert.equal((await call('athena_explain', { id: 'zzzzzzzz' })).error, true);

  const checked = await call('athena_check_files', { files: ['src/app.js'] });
  assert.equal(checked.json.blocked, true);
  const map = await call('athena_codebase_map', {});
  assert.ok(map.json.totalEntrypoints >= 2);
  const sym = await call('athena_find_symbol', { name: 'helper' });
  assert.equal(sym.json.symbols[0].name, 'helper');
  const callers = await call('athena_find_callers', { symbol: 'helper' });
  assert.ok(callers.json.total >= 1);
  const taint = await call('athena_taint_paths', {});
  assert.ok(typeof taint.json.total === 'number');
  const prov = await call('athena_provenance', {});
  assert.ok(prov.json.estimated && typeof prov.json.totalLines === 'number', prov.text);
  const skills = await call('athena_skills', {});
  assert.ok(skills.json.skills.some((s: { name: string; active: unknown }) => s.name === 'express' && s.active));
  const section = await call('athena_skill_section', { name: 'express' });
  assert.equal(section.error, false, section.text);
});

test('pagination: the cursor continues where the previous page stopped', async () => {
  const { call } = await connect();
  const first = await call('athena_scan', { limit: 1 });
  if (first.json.total > 1) {
    const second = await call('athena_scan', { limit: 1, cursor: first.json.cursor });
    assert.notEqual(second.json.findings[0].id, first.json.findings[0].id);
  } else assert.equal(first.json.cursor, undefined);
});

test('api_exists answers exists, missing, and unknown for packages that are not installed', async () => {
  const { call } = await connect();
  assert.equal((await call('athena_api_exists', { package: 'axios', member: 'get' })).json.status, 'exists');
  assert.equal((await call('athena_api_exists', { package: 'axios', member: 'fetchData' })).json.status, 'missing');
  assert.equal((await call('athena_api_exists', { package: 'nothing-here', member: 'x' })).json.status, 'unknown');
  assert.equal((await call('athena_api_exists', { package: '../../etc', member: 'x' })).error, true);
});

test('paths outside the allowed root are refused, including parent traversal, absolute paths and symlinks', async () => {
  const { call, base } = await connect();
  for (const [tool, args] of [['athena_scan', { path: '..' }], ['athena_scan', { path: base }], ['athena_check_files', { files: ['../secret.txt'] }], ['athena_check_files', { files: ['link.txt'] }], ['athena_codebase_map', { path: '/etc' }], ['athena_find_symbol', { path: '../', name: 'x' }]] as const) {
    const r = await call(tool, args as Record<string, unknown>);
    assert.equal(r.error, true, `${tool} ${JSON.stringify(args)}`);
    assert.match(r.text, /outside the allowed root/);
  }
});

test('athena_add_learned_rule refuses without confirm, and writes only with it', async () => {
  const { call, root } = await connect();
  const rule = { id: 'learned.abc', title: 'x', severity: 'HIGH', cwe: [78], category: 'learned', why: 'w', fix: 'f', confidence: 'medium', families: ['js'], match: { kind: 'call', callee: '^doDanger$', where: [{ op: 'argIsNonLiteral', index: 0 }] } };
  const refused = await call('athena_add_learned_rule', { rule });
  assert.equal(refused.error, true);
  assert.match(refused.text, /confirm: true/);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(root, '.athena', 'learned-rules.json')), false);
  const saved = await call('athena_add_learned_rule', { rule, confirm: true });
  assert.equal(saved.error, false, saved.text);
  assert.equal(existsSync(join(root, '.athena', 'learned-rules.json')), true);
  assert.equal((await call('athena_add_learned_rule', { rule: { id: 'bad' }, confirm: true })).error, true);
});

test('athena_review reports only the staged change', async () => {
  const { call, root } = await connect();
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...a: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: root, env });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(root, 'src', 'app.js'), `${APP}\napp.get('/z', (req, res) => { eval(req.query.z); });\n`);
  git('add', '-A');
  const r = await call('athena_review', { scope: 'staged' });
  assert.equal(r.error, false, r.text);
  assert.ok(r.json.findings.length >= 1 && r.json.findings.every((f: { line: number }) => f.line >= 8));
  assert.equal((await call('athena_review', { scope: 'range' })).error, true);
});

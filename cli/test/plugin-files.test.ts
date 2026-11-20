import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { TOOL_NAMES } from '../src/mcp/server.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const plugin = join(repo, 'plugins/athena');
const read = (p: string) => readFileSync(join(plugin, p), 'utf8');

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'has frontmatter');
  return Object.fromEntries(m![1]!.split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}
const mcpRefs = (text: string) => [...text.matchAll(/mcp__athena__(\w+)/g)].map((m) => m[1]!);

test('plugin manifest, MCP config and hooks are valid JSON pointing at real things', () => {
  const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'athena');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const mcp = JSON.parse(read('.mcp.json'));
  assert.deepEqual(mcp.mcpServers.athena.args.slice(-1), ['mcp']);
  const hooks = JSON.parse(read('hooks/hooks.json'));
  for (const entry of hooks.hooks.PostToolUse) {
    for (const h of entry.hooks) {
      const script = h.command.replace('${CLAUDE_PLUGIN_ROOT}/', '').replaceAll('"', '');
      assert.ok(statSync(join(plugin, script)).mode & 0o111, `${script} is executable`);
      assert.match(read(script), /^#!\/bin\/sh/);
    }
  }
});

test('skill, agents and commands have frontmatter and reference only tools the MCP server provides', () => {
  const files = ['skills/athena-security/SKILL.md', ...readdirSync(join(plugin, 'agents')).map((f) => `agents/${f}`), ...readdirSync(join(plugin, 'commands')).map((f) => `commands/${f}`)];
  assert.equal(files.length, 5);
  for (const f of files) {
    const text = read(f);
    const fm = frontmatter(text);
    assert.ok(fm.description && fm.description.length > 20, `${f} description`);
    for (const ref of mcpRefs(text)) assert.ok((TOOL_NAMES as readonly string[]).includes(ref), `${f} references unknown tool ${ref}`);
  }
  assert.equal(frontmatter(read('skills/athena-security/SKILL.md')).name, 'athena-security');
  for (const f of readdirSync(join(plugin, 'agents'))) assert.ok(frontmatter(read(`agents/${f}`)).name);
  // Tool names written in plain text in the skill must exist too.
  for (const m of read('skills/athena-security/SKILL.md').matchAll(/`(athena_\w+)`/g)) assert.ok((TOOL_NAMES as readonly string[]).includes(m[1]!), `skill mentions unknown tool ${m[1]}`);
});

test('the open Agent Skills copy at skills/athena-security matches the plugin skill, and the docs name only real tools', () => {
  assert.equal(readFileSync(join(repo, 'skills/athena-security/SKILL.md'), 'utf8'), read('skills/athena-security/SKILL.md'));
  const docs = readFileSync(join(repo, 'docs/agents/mcp-clients.md'), 'utf8');
  for (const m of docs.matchAll(/`(athena_\w+)`/g)) assert.ok((TOOL_NAMES as readonly string[]).includes(m[1]!), `docs mention unknown tool ${m[1]}`);
  for (const t of TOOL_NAMES) assert.ok(docs.includes(t), `docs list ${t}`);
});

test('the edit hook stays silent without findings and speaks (exit 2) on a blocking issue', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'plug-'));
  const tsx = import.meta.resolve('tsx');
  const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  writeFileSync(join(dir, 'athena'), `#!/bin/sh\nexec "${process.execPath}" --import "${tsx}" "${entry}" "$@"\n`);
  chmodSync(join(dir, 'athena'), 0o755);
  const run = (file: string) => spawnSync(join(plugin, 'hooks/check-edited.sh'), { input: JSON.stringify({ tool_input: { file_path: file } }), env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ATHENA_HOME: dir, NO_COLOR: '1' }, encoding: 'utf8', cwd: dir });
  writeFileSync(join(dir, 'ok.js'), 'module.exports = 1;\n');
  writeFileSync(join(dir, 'bad.js'), "const express = require('express');\nconst app = express();\napp.get('/x', (req, res) => { eval(req.query.c); });\n");
  const clean = run(join(dir, 'ok.js'));
  assert.equal(clean.status, 0);
  assert.equal(clean.stderr, '');
  const bad = run(join(dir, 'bad.js'));
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /Athena found blocking issues/);
});

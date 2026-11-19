import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeDependencies } from '../src/deps/analyze.ts';
import { editDistance, typosquatOf } from '../src/deps/typosquat.ts';

const NOW = Date.parse('2026-11-19T12:00:00Z');

async function fixtureServer(pkgs: Record<string, object>, vulns: Record<string, string[]> = {}) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (data: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.url === '/v1/querybatch') {
        const q = (JSON.parse(body) as { queries: Array<{ package: { name: string } }> }).queries;
        return send({ results: q.map((x) => ({ vulns: (vulns[x.package.name] ?? []).map((id) => ({ id })) })) });
      }
      if (req.url?.startsWith('/v1/vulns/')) return send({ id: decodeURIComponent(req.url.slice(10)), summary: 'Prototype pollution', database_specific: { severity: 'HIGH' }, affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ fixed: '4.17.21' }] }] }] });
      const name = decodeURIComponent((req.url ?? '').slice(1));
      const entry = pkgs[name];
      if (entry) return send(entry);
      send({}, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => server.close() };
}

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'depsproj-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}
const opts = (url: string) => ({ osvUrl: url, registries: { npm: url }, cacheDir: mkdtempSync(join(tmpdir(), 'dc-')), now: () => NOW, retries: 0, popular: { npm: ['express', 'requests', 'lodash', 'react'] } });

test('edit distance and typosquat detection', () => {
  assert.equal(editDistance('expresss', 'express', 2), 1);
  assert.equal(editDistance('reqeusts', 'requests', 2), 1, 'transposition counts as one');
  const list = ['express', 'requests', 'lodash'];
  assert.equal(typosquatOf('npm', 'expresss', list), 'express');
  assert.equal(typosquatOf('PyPI', 'reqeusts', list), 'requests');
  assert.equal(typosquatOf('npm', 'express', list), null, 'the popular package itself');
  assert.equal(typosquatOf('npm', 'lodash-es', list), null);
  assert.equal(typosquatOf('npm', 'ab', list), null, 'too short to judge');
  assert.equal(typosquatOf('npm', 'ex_press', list), 'express', 'separator swap');
});

test('findings: vulnerable, deprecated, fresh release, install script, missing package, typosquat; private skipped', async () => {
  const s = await fixtureServer({
    lodash: { versions: { '4.17.15': { deprecated: 'use something else' } }, time: { '4.17.15': '2020-01-01T00:00:00Z' }, 'dist-tags': { latest: '4.17.21' } },
    fresh: { versions: { '1.0.0': {} }, time: { '1.0.0': '2026-11-19T00:00:00Z' }, 'dist-tags': { latest: '1.0.0' } },
    esbuildish: { versions: { '1.0.0': { scripts: { postinstall: 'node x' } } }, time: { '1.0.0': '2020-01-01T00:00:00Z' }, 'dist-tags': { latest: '1.0.0' } },
    expresss: { versions: { '1.0.0': {} }, time: { '1.0.0': '2020-01-01T00:00:00Z' }, 'dist-tags': { latest: '1.0.0' } },
  }, { lodash: ['GHSA-xxxx'] });
  const root = project({
    'package.json': JSON.stringify({ dependencies: { lodash: '4.17.15', fresh: '1.0.0', esbuildish: '1.0.0', expresss: '1.0.0', ghostpkg: '1.0.0', '@corp/internal': '1.0.0', local: 'file:../x' } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: '4.17.15' }, 'node_modules/fresh': { version: '1.0.0' }, 'node_modules/esbuildish': { version: '1.0.0' }, 'node_modules/expresss': { version: '1.0.0' }, 'node_modules/ghostpkg': { version: '1.0.0' }, 'node_modules/local': { version: '1.0.0', link: true } } }, null, 2),
  });
  const r = await analyzeDependencies(root, opts(s.url));
  s.close();
  const rules = new Map<string, string[]>();
  for (const f of r.findings) rules.set(f.ruleId, [...(rules.get(f.ruleId) ?? []), f.dependency!.name]);
  assert.deepEqual(rules.get('deps.vulnerable'), ['lodash']);
  assert.deepEqual(rules.get('deps.deprecated'), ['lodash']);
  assert.deepEqual(rules.get('deps.fresh-release'), ['fresh']);
  assert.deepEqual(rules.get('deps.install-script'), ['esbuildish']);
  assert.deepEqual(rules.get('deps.package-not-found'), ['ghostpkg']);
  assert.deepEqual(rules.get('deps.typosquat'), ['expresss']);
  assert.ok(![...rules.values()].flat().includes('local'), 'file: link is skipped');
  const vuln = r.findings.find((f) => f.ruleId === 'deps.vulnerable')!;
  assert.equal(vuln.severity, 'HIGH');
  assert.match(vuln.message, /Upgrade to 4\.17\.21/);
  assert.ok(vuln.file.endsWith('package-lock.json') && vuln.line > 1);
  assert.equal(r.status, 'ran');
});

test('registry outage is a gap, never "does not exist"', async () => {
  const server = createServer((req, res) => { res.writeHead(503); res.end(); void req; });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const root = project({ 'package.json': JSON.stringify({ dependencies: { realpkg: '1.0.0' } }), 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/realpkg': { version: '1.0.0' } } }) });
  const r = await analyzeDependencies(root, opts(url));
  server.close();
  assert.equal(r.findings.filter((f) => f.ruleId === 'deps.package-not-found').length, 0);
  assert.ok(r.gaps.some((g) => /unavailable/.test(g)));
});

test('offline with a cold cache reports a gap; no manifests means no findings', async () => {
  const root = project({ 'package.json': JSON.stringify({ dependencies: { x: '1.0.0' } }), 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/x': { version: '1.0.0' } } }) });
  const r = await analyzeDependencies(root, { ...opts('http://127.0.0.1:1'), offline: true });
  assert.equal(r.status, 'unavailable');
  assert.ok(r.gaps.some((g) => /offline/.test(g)));
  assert.deepEqual((await analyzeDependencies(project({ 'a.txt': 'x' }), opts('http://127.0.0.1:1'))).findings, []);
});

test('a 50,000-package lockfile completes in under 30 s', async () => {
  const s = await fixtureServer({});
  const packages: Record<string, { version: string }> = {};
  for (let i = 0; i < 50_000; i += 1) packages[`node_modules/pkg-${i}`] = { version: '1.0.0' };
  const root = project({ 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages }) });
  const started = Date.now();
  const r = await analyzeDependencies(root, { ...opts(s.url), registryChecks: false });
  s.close();
  assert.equal(r.dependencies.length, 50_000);
  assert.ok(Date.now() - started < 30_000, `took ${Date.now() - started} ms`);
});

test('engine: dependency findings appear in the report, terminal output and coverage; disabled by default', async () => {
  const { scanFiles } = await import('../src/engine.ts');
  const { formatTerminalReport } = await import('../src/report/terminal-formatter.ts');
  const s = await fixtureServer({}, { lodash: ['GHSA-xxxx'] });
  const root = project({ 'app.js': 'console.log(1)\n', 'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: '4.17.15' } } }, null, 2) });
  const off = { semgrep: { enabled: false, timeoutMs: 1, config: 'auto' }, eslint: { enabled: false, timeoutMs: 1 }, npmAudit: { enabled: false, timeoutMs: 1, severityThreshold: 'HIGH' as const }, nodejsscan: { enabled: false, timeoutMs: 1, requireDocker: false }, bearer: { enabled: false, timeoutMs: 1, reportType: 'security' as const } };
  const base = { root, skills: false as const, recordedProvenance: false };
  const without = await scanFiles([join(root, 'app.js')], off, {}, base);
  assert.ok(!without.summary.coverage?.checks.some((c) => c.name === 'dependencies'));
  const report = await scanFiles([join(root, 'app.js')], { ...off, dependencies: { enabled: true, offline: false, registryChecks: false } }, {}, { ...base, depsOptions: opts(s.url) });
  s.close();
  const dep = report.files.flatMap((f) => f.findings).find((f) => f.source === 'athena-deps');
  assert.ok(dep && dep.ruleId === 'deps.vulnerable' && dep.dependency?.name === 'lodash');
  assert.ok(report.summary.coverage?.checks.some((c) => c.name === 'dependencies' && c.status === 'ran'));
  const text = formatTerminalReport(report, { color: false, version: 't', mode: 'scan', target: root, root, failOn: 'high' } as never);
  assert.match(text, /Dependencies\n.*Vulnerable dependency\s+lodash@4\.17\.15/);
});

test('not-reached advisories drop one severity level and say so; undeclared hallucinated imports are HIGH', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (d: unknown, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (req.url === '/v1/querybatch') return send({ results: (JSON.parse(body) as { queries: unknown[] }).queries.map(() => ({ vulns: [{ id: 'GHSA-9' }] })) });
      if (req.url?.startsWith('/v1/vulns/')) return send({ id: 'GHSA-9', summary: 'bad', database_specific: { severity: 'HIGH' }, affected: [{ package: { name: 'lodash' }, ecosystem_specific: { affected_functions: ['zipObjectDeep'] } }] });
      const name = decodeURIComponent((req.url ?? '').slice(1));
      if (name === 'lodash' || name === 'real-undeclared') return send({ versions: { '4.17.15': {} }, time: {}, 'dist-tags': {} });
      send({}, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const root = project({
    'package.json': JSON.stringify({ dependencies: { lodash: '4.17.15' } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: '4.17.15' } } }, null, 2),
    'src/app.js': "const _ = require('lodash');\n_.map([], x => x);\nconst ghost = require('totally-made-up-pkg');\nconst r = require('real-undeclared');\nconst fs = require('fs');\n",
  });
  const r = await analyzeDependencies(root, opts(url));
  server.close();
  const vuln = r.findings.find((f) => f.ruleId === 'deps.vulnerable')!;
  assert.equal(vuln.severity, 'MEDIUM');
  assert.ok(vuln.evidence?.some((e) => /not imported/.test(e)));
  const undeclared = r.findings.filter((f) => f.ruleId === 'deps.undeclared-import');
  assert.deepEqual(undeclared.map((f) => f.dependency!.name), ['totally-made-up-pkg']);
  assert.equal(undeclared[0]!.severity, 'HIGH');
});

test('private scoped registries and custom pip indexes are never reported as non-existent', async () => {
  const s = await fixtureServer({});
  const root = project({
    '.npmrc': '@corp:registry=https://npm.corp.example/\n',
    'package.json': JSON.stringify({ dependencies: { '@corp/internal': '1.0.0', '@other/ghost': '1.0.0' } }),
    'requirements.txt': '--extra-index-url https://pypi.corp.example/simple\ncorp-lib==1.0.0\n',
  });
  const r = await analyzeDependencies(root, opts(s.url));
  s.close();
  assert.deepEqual(r.findings.filter((f) => f.ruleId === 'deps.package-not-found').map((f) => f.dependency!.name), ['@other/ghost']);
});

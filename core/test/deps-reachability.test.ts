import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { checkApiExistence } from '../src/deps/analyze.ts';
import { missingApis } from '../src/deps/api-exists.ts';
import { collectUsage, reachabilityOf } from '../src/deps/reachability.ts';
import { jsUses, NODE_BUILTINS, packageOfSpecifier, PY_STDLIB, pyUses } from '../src/deps/usage.ts';
import type { Advisory } from '../src/deps/osv.ts';
import type { Dependency } from '../src/deps/types.ts';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'reach-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}
const adv = (symbols: string[]): Advisory => ({ id: 'GHSA-1', aliases: [], summary: 's', severity: 'HIGH', malicious: false, fixed: [], symbols });
const lodash: Dependency = { ecosystem: 'npm', name: 'lodash', version: '4.17.15', direct: true, manifest: 'm', line: 1 };

test('import extraction (JS, Python) and specifier handling', () => {
  const uses = jsUses("import axios, { get as g } from 'axios';\nconst { merge } = require('lodash');\nconst fs = require('node:fs');\nimport x from './local';\nimport * as z from '@scope/pkg/sub';\nimport type { T } from 'types-only';");
  assert.deepEqual(uses.map((u) => [u.pkg, u.named, u.bindings]), [['axios', ['get'], ['axios']], ['@scope/pkg', [], ['z']], ['lodash', ['merge'], []]]);
  assert.deepEqual(pyUses('import os, yaml as y\nfrom flask import Flask, request\n').map((u) => u.pkg).sort(), ['flask', 'os', 'yaml']);
  assert.equal(packageOfSpecifier('node:fs'), null);
  assert.equal(packageOfSpecifier('./a'), null);
  assert.equal(packageOfSpecifier('lodash/fp'), 'lodash');
  assert.ok(NODE_BUILTINS.has('fs') && PY_STDLIB.has('os'), 'standard library never counts as undeclared');
});

test('reachability: imported advisory symbol is reached, other symbols are not, transitive is unknown', async () => {
  const root = tree({
    'a.js': "const { merge } = require('lodash');\nmerge({}, {});\n",
    'b.js': "import _ from 'lodash';\n_.template('x');\n",
    'c.js': "import { get } from 'lodash';\nget({}, 'a');\n",
  });
  const usage = await collectUsage([join(root, 'a.js'), join(root, 'b.js'), join(root, 'c.js')]);
  assert.equal(reachabilityOf(usage, lodash, adv(['merge'])), 'reached');
  assert.equal(reachabilityOf(usage, lodash, adv(['template'])), 'reached', 'member call on the default binding');
  assert.equal(reachabilityOf(usage, lodash, adv(['zipObjectDeep'])), 'not-reached');
  assert.equal(reachabilityOf(usage, lodash, adv([])), 'unknown', 'no symbol data');
  assert.equal(reachabilityOf(usage, { ...lodash, name: 'transitive-only' }, adv(['x'])), 'unknown');
});

const AXIOS_DTS = 'export interface AxiosInstance { get(url: string): Promise<unknown>; post(url: string): Promise<unknown>; }\nexport interface AxiosStatic extends AxiosInstance { create(): AxiosInstance; }\ndeclare const axios: AxiosStatic;\nexport default axios;\n';
const nm = {
  'node_modules/axios/package.json': JSON.stringify({ name: 'axios', version: '1.6.0', types: 'index.d.ts' }),
  'node_modules/axios/index.d.ts': AXIOS_DTS,
  'node_modules/@types/node/package.json': JSON.stringify({ name: '@types/node', version: '20.0.0' }),
  'node_modules/@types/node/fs.d.ts': 'export function readFile(p: string): void;\nexport function readFileSync(p: string): string;\n',
  'node_modules/untyped/package.json': JSON.stringify({ name: 'untyped', version: '1.0.0', main: 'index.js' }),
};

test('API existence: axios.fetchData and fs.readFilePromise are flagged, axios.get and fs.readFile are not', async () => {
  const root = tree({
    ...nm,
    'src/a.ts': "import axios from 'axios';\nimport fs from 'node:fs';\naxios.get('/x');\naxios.fetchData('/y');\nfs.readFile('a');\nfs.readFilePromise('a');\n",
    'src/b.ts': "import { Missing, AxiosInstance } from 'axios';\nimport u from 'untyped';\nu.whatever();\n",
  });
  const findings = await checkApiExistence(root);
  assert.deepEqual(findings.map((f) => `${f.file.replace(root, '')}:${f.line} ${f.message.split(' ')[0]}`).sort(), ['/src/a.ts:4 fetchData', '/src/a.ts:6 readFilePromise', '/src/b.ts:1 Missing']);
  assert.ok(findings.every((f) => f.severity === 'HIGH' && f.ruleId === 'hallucination.invalid-api-call'));
});

test('API existence: not installed or untyped means unknown, never a finding', () => {
  const root = tree({ ...nm });
  assert.deepEqual(missingApis(root, join(root, 'x.ts'), "import axios from 'not-installed';\naxios.nope();\n"), []);
  assert.deepEqual(missingApis(root, join(root, 'x.js'), "import u from 'untyped';\nu.nope();\n"), []);
});

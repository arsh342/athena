import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConfigError, loadProjectConfig } from '../src/utils/project-config.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'athena-cfg-'));

test('missing file gives an empty config', async () => assert.deepEqual(await loadProjectConfig(dir()), {}));

test('valid config is read and unknown keys ignored', async () => {
  const d = dir();
  writeFileSync(join(d, 'athena.config.json'), JSON.stringify({ failOn: 'medium', exclude: ['x/'], strict: true, other: 1 }));
  assert.deepEqual(await loadProjectConfig(d), { failOn: 'medium', exclude: ['x/'], strict: true });
});

test('wrong types and bad JSON raise ConfigError', async () => {
  const d = dir();
  writeFileSync(join(d, 'athena.config.json'), JSON.stringify({ failOn: 3 }));
  await assert.rejects(() => loadProjectConfig(d), ConfigError);
  writeFileSync(join(d, 'athena.config.json'), '{ nope');
  await assert.rejects(() => loadProjectConfig(d), ConfigError);
  writeFileSync(join(d, 'athena.config.json'), JSON.stringify({ failOn: 'extreme' }));
  await assert.rejects(() => loadProjectConfig(d), ConfigError);
});

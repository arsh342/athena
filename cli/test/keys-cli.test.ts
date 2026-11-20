import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { newHome } from './helpers-cli.ts';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const SECRET = 'sk-test-SECRETVALUE-abcd';

function run(args: string[], home: string, input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, ['--import', import.meta.resolve('tsx'), entry, ...args], { env: { ...process.env, ATHENA_HOME: home, NO_COLOR: '1', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' } }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
    child.stdin?.end(input ?? '');
  });
}

test('keys set reads the key from stdin, stores it privately, and no output ever contains it', async () => {
  const home = newHome();
  const set = await run(['keys', 'set', 'openai'], home, `${SECRET}\n`);
  assert.equal(set.code, 0, set.stderr);
  assert.ok(!(set.stdout + set.stderr).includes('SECRETVALUE'));
  assert.equal(statSync(join(home, 'credentials.json')).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(join(home, 'credentials.json'), 'utf8')).openai, SECRET);

  const status = await run(['keys', 'status'], home);
  assert.match(status.stdout, /openai\s+file\s+••••abcd/);
  assert.ok(!(status.stdout + status.stderr).includes('SECRETVALUE'));
  assert.match(status.stdout, /anthropic\s+sdk-default/);

  const removed = await run(['keys', 'remove', 'openai'], home);
  assert.equal(removed.code, 0);
  assert.equal((await run(['keys', 'remove', 'openai'], home)).code, 2, 'removing a missing key is reported');
});

test('keys set with nothing on stdin, and an unknown provider, are errors', async () => {
  const home = newHome();
  assert.equal((await run(['keys', 'set', 'openai'], home, '\n')).code, 2);
  const bad = await run(['keys', 'set', 'bogus'], home, 'x');
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /unknown provider/);
});

test('a key passed as an argument is not accepted', async () => {
  const r = await run(['keys', 'set', 'openai', SECRET], newHome());
  assert.notEqual(r.code, 0);
  assert.ok(!(r.stdout + r.stderr).includes('SECRETVALUE'), 'the rejected argument is not echoed');
});

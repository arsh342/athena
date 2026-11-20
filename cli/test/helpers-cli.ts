import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
export const fixture = fileURLToPath(new URL('./fixtures/app', import.meta.url));
export const OFF = ['--no-eslint', '--no-npm-audit'];

export function runCli(args: string[], home: string, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--import', import.meta.resolve('tsx'), entry, ...args], {
      env: { ...process.env, ATHENA_HOME: home, NO_COLOR: '1', CI: 'true' }, maxBuffer: 32 * 1024 * 1024, ...(cwd ? { cwd } : {}),
    }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr });
    });
  });
}

export const newHome = () => mkdtempSync(join(tmpdir(), 'athena-home-'));

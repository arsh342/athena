import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { c } from '../utils/colors.js';

const execFileAsync = promisify(execFile);

type ToolStatus = {
  name: string;
  ok: boolean;
  version: string;
  note?: string;
};

export async function doctorCommand(): Promise<void> {
  const statuses = await Promise.all([
    checkTool('node', ['--version'], 'required runtime'),
    checkTool('npm', ['--version'], 'required package manager'),
    checkTool('eslint', ['--version'], 'optional: JavaScript/TypeScript linting'),
    checkTool('git', ['--version'], 'recorded AI provenance and athena review'),
  ]);

  console.log('Athena doctor\n');
  for (const status of statuses) {
    const mark = status.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const version = status.ok ? `${c.dim}${status.version}${c.reset}` : `${c.dim}not found${c.reset}`;
    console.log(`  ${mark} ${status.name.padEnd(10)} ${version}`);
    if (status.note) console.log(`    ${c.dim}${status.note}${c.reset}`);
  }

  const eslint = statuses.find((item) => item.name === 'eslint');
  if (!eslint?.ok) {
    console.log(`  ${c.yellow}tip:${c.reset} install ESLint with ${c.bold}npm install --save-dev eslint eslint-plugin-security${c.reset}`);
  }
}

async function checkTool(name: string, args: string[], note?: string): Promise<ToolStatus> {
  try {
    const { stdout, stderr } = await execFileAsync(name, args, { timeout: 15_000, maxBuffer: 1024 * 1024 });
    const raw = `${stdout}\n${stderr}`.trim();
    const line = raw.split(/\r?\n/).find((value) => value.trim().length > 0) ?? 'ok';
    return {
      name,
      ok: true,
      version: line.trim(),
      note,
    };
  } catch {
    return {
      name,
      ok: false,
      version: 'not found',
      note,
    };
  }
}

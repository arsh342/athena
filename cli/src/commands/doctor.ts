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
    checkTool('semgrep', ['--version'], 'optional: deep SAST findings'),
    checkTool('eslint', ['--version'], 'optional: JavaScript/TypeScript linting'),
    checkTool('docker', ['--version'], 'optional: required for nodejsscan'),
    checkTool('bearer', ['--version'], 'optional: privacy & data flow analysis'),
    checkTool('trivy', ['--version'], 'optional: IaC/container/dependency findings'),
  ]);

  console.log('Athena doctor\n');
  for (const status of statuses) {
    const mark = status.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    const version = status.ok ? `${c.dim}${status.version}${c.reset}` : `${c.dim}not found${c.reset}`;
    console.log(`  ${mark} ${status.name.padEnd(10)} ${version}`);
    if (status.note) console.log(`    ${c.dim}${status.note}${c.reset}`);
  }

  const semgrep = statuses.find((item) => item.name === 'semgrep');
  if (!semgrep?.ok) {
    console.log(`\n  ${c.yellow}tip:${c.reset} install Semgrep with ${c.bold}athena setup semgrep${c.reset}`);
  }

  const eslint = statuses.find((item) => item.name === 'eslint');
  if (!eslint?.ok) {
    console.log(`  ${c.yellow}tip:${c.reset} install ESLint with ${c.bold}npm install --save-dev eslint eslint-plugin-security${c.reset}`);
  }

  const docker = statuses.find((item) => item.name === 'docker');
  if (!docker?.ok) {
    console.log(`  ${c.yellow}tip:${c.reset} install Docker to enable nodejsscan scanner`);
  }

  const bearer = statuses.find((item) => item.name === 'bearer');
  if (!bearer?.ok) {
    console.log(`  ${c.yellow}tip:${c.reset} install Bearer with ${c.bold}npm install -g @bearer/cli${c.reset}`);
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

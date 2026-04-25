import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface SetupSemgrepOptions {
  auto?: boolean;
}

interface SetupAllOptions {
  auto?: boolean;
}

interface SetupToolPlan {
  name: string;
  includedWithAthena: boolean;
  autoInstallCommand?: string;
  manualInstallCommand?: string;
  note: string;
}

/**
 * Return install command for Semgrep based on host platform.
 */
export function getSemgrepInstallCommand(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'brew install semgrep';
  if (platform === 'win32') return 'choco install semgrep -y';
  return 'python3 -m pip install --user semgrep';
}

export async function setupSemgrepCommand(options: SetupSemgrepOptions = {}): Promise<void> {
  const installCommand = getSemgrepInstallCommand(process.platform);

  console.log('Semgrep setup');
  console.log(`Install command for this system:\n  ${installCommand}`);

  if (!options.auto) {
    console.log('Run command above, then verify with: semgrep --version');
    return;
  }

  try {
    console.log('Running installer...');
    const { stdout, stderr } = await execAsync(installCommand, { timeout: 120_000, maxBuffer: 1024 * 1024 });

    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.log(stderr.trim());

    console.log('Semgrep install command completed. Verify with: semgrep --version');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Semgrep install failed: ${message}`);
    process.exitCode = 1;
  }
}

export function getSetupAllPlan(platform: NodeJS.Platform): SetupToolPlan[] {
  return [
    {
      name: 'ESLint + eslint-plugin-security',
      includedWithAthena: true,
      note: 'Bundled as Athena optional dependencies and used by the ESLint scanner when present.',
    },
    {
      name: 'npm audit',
      includedWithAthena: true,
      note: 'Uses npm CLI that ships with Node.js. No separate scanner package install required.',
    },
    {
      name: 'Semgrep',
      includedWithAthena: false,
      autoInstallCommand: getSemgrepInstallCommand(platform),
      manualInstallCommand: getSemgrepInstallCommand(platform),
      note: 'External binary scanner. Optional, but improves SAST coverage.',
    },
    {
      name: 'Docker (for nodejsscan)',
      includedWithAthena: false,
      note: 'Required runtime for nodejsscan container execution; install from Docker Desktop/package manager.',
    },
    {
      name: 'Bearer CLI',
      includedWithAthena: false,
      autoInstallCommand: 'npm install -g @bearer/cli',
      manualInstallCommand: 'npm install -g @bearer/cli',
      note: 'External CLI scanner for privacy and data-flow analysis.',
    },
  ];
}

export async function setupAllCommand(options: SetupAllOptions = {}): Promise<void> {
  const plan = getSetupAllPlan(process.platform);

  console.log('Athena scanner setup plan\n');
  for (const tool of plan) {
    const inclusion = tool.includedWithAthena ? 'included' : 'external';
    console.log(`- ${tool.name} (${inclusion})`);
    console.log(`  ${tool.note}`);
    if (tool.manualInstallCommand && !tool.includedWithAthena) {
      console.log(`  install: ${tool.manualInstallCommand}`);
    }
  }

  if (!options.auto) {
    console.log('\nUse --auto to run supported install commands automatically.');
    return;
  }

  let failed = false;

  for (const tool of plan) {
    if (!tool.autoInstallCommand) continue;

    try {
      console.log(`\nInstalling ${tool.name}...`);
      const { stdout, stderr } = await execAsync(tool.autoInstallCommand, { timeout: 180_000, maxBuffer: 1024 * 1024 });
      if (stdout.trim()) console.log(stdout.trim());
      if (stderr.trim()) console.log(stderr.trim());
      console.log(`Completed: ${tool.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed: ${tool.name} (${message})`);
      failed = true;
    }
  }

  if (failed) {
    console.log('\nSome installs failed. You can run their manual commands from the setup plan above.');
    process.exitCode = 1;
    return;
  }

  console.log('\nSetup complete. Run `athena doctor` to verify tool availability.');
}

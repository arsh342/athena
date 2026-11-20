import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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

export function getSetupAllPlan(_platform: NodeJS.Platform): SetupToolPlan[] {
  return [
    {
      name: 'ESLint + eslint-plugin-security',
      includedWithAthena: true,
      note: 'Bundled as Athena optional dependencies and used by the ESLint scanner when present.',
    },
  ];
}

export async function setupAllCommand(options: SetupAllOptions = {}): Promise<void> {
  const plan = getSetupAllPlan(process.platform);

  console.log('Athena setup plan (the analysis engine, dependency checks and secret scanning need nothing installed)\n');
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

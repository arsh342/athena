import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

interface SetupSemgrepOptions {
  auto?: boolean;
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

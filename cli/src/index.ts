#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { checkCommand } from './commands/check.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { menuCommand } from './commands/menu.js';
import { scanCommand } from './commands/scan.js';
import { setupAllCommand, setupSemgrepCommand } from './commands/setup.js';
import { uninstallCommand } from './commands/uninstall.js';
import { EXIT } from './utils/exit-codes.js';
import { CLI_VERSION } from './version.js';

const program = new Command();

program
  .name('athena')
  .description('AI code provenance tracker and security scanner for JavaScript and TypeScript')
  .version(CLI_VERSION)
  .exitOverride();

/** Flags shared by scan and check. */
function addRunFlags(command: Command): Command {
  return command
    .option('-f, --format <format>', 'terminal | json | jsonl | sarif', 'terminal')
    .option('-o, --output <file>', 'write the report to a file instead of stdout')
    .option('--fail-on <level>', 'block on findings at or above: critical | high | medium | low | none (default: high)')
    .option('--strict', 'exit 3 when the scan was incomplete (files or checks skipped)')
    .option('-q, --quiet', 'no progress output')
    .option('-v, --verbose', 'also print scanner notes')
    .option('--no-color', 'disable colour')
    .option('-m, --max-findings <number|all>', 'max findings to print (default: all)')
    .option('--show-low', 'list LOW findings instead of collapsing them')
    .option('-t, --threshold <number>', 'deprecated: only affects the heuristic fallback')
    .option('--no-eslint', 'disable ESLint scanner')
    .option('--no-npm-audit', 'disable npm audit scanner')
    .option('--no-nodejsscan', 'disable nodejsscan scanner')
    .option('--no-bearer', 'disable Bearer scanner')
    .option('--no-semgrep', 'disable Semgrep scanner');
}

addRunFlags(
  program
    .command('scan')
    .argument('[dir]', 'directory to scan', '.')
    .description('scan a directory recursively'),
).action(scanCommand);

addRunFlags(
  program
    .command('check')
    .argument('[files...]', 'files to check; defaults to staged JS/TS files')
    .description('check changed files for blocking findings'),
).action(checkCommand);

program.command('init').description('install Athena pre-commit hook').action(initCommand);
program.command('uninstall').description('remove Athena pre-commit hook').action(uninstallCommand);
program.command('doctor').description('check local toolchain health (node, npm, semgrep, trivy)').action(doctorCommand);

const setupCommand = program
  .command('setup')
  .description('setup optional external scanners');

setupCommand
  .command('semgrep')
  .option('--auto', 'run install command automatically')
  .description('install or print install command for semgrep')
  .action(setupSemgrepCommand);

setupCommand
  .command('all')
  .option('--auto', 'run supported install commands automatically')
  .description('print/setup all scanner dependencies (included + external)')
  .action(setupAllCommand);

program.command('menu').description('open interactive terminal selector').action(() => menuCommand(program));

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    await menuCommand(program);
  } else {
    await program.parseAsync(process.argv);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CommanderError) {
    // Commander already printed its message (help, version, unknown option).
    process.exitCode = error.exitCode === 0 ? EXIT.PASS : EXIT.ERROR;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = EXIT.ERROR;
});

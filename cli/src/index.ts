#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { checkCommand } from './commands/check.js';
import { doctorCommand } from './commands/doctor.js';
import { explainCommand } from './commands/explain.js';
import { provenanceCommand } from './commands/provenance.js';
import { initCommand } from './commands/init.js';
import { menuCommand } from './commands/menu.js';
import { scanCommand } from './commands/scan.js';
import { skillsAdd, skillsList, skillsNew, skillsRemove, skillsShow, skillsTest } from './commands/skills.js';
import { variantsCommand } from './commands/variants.js';
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

program
  .command('explain')
  .argument('<id>', 'finding id (at least 4 characters of the id shown in the report)')
  .option('-p, --path <dir>', 'directory that was scanned', '.')
  .option('--no-color', 'disable colour')
  .description('explain one finding from the last scan')
  .action(async (id: string, opts: { path?: string; color?: boolean }) => {
    process.exitCode = await explainCommand(id, opts);
  });

program
  .command('provenance')
  .argument('[path]', 'directory to measure', '.')
  .option('--sort <key>', 'ai | recorded | lines', 'ai')
  .option('--about', 'explain how AI provenance is measured')
  .option('-f, --format <format>', 'terminal | json', 'terminal')
  .option('--no-color', 'disable colour')
  .description('show how much of the code was written by AI, per file')
  .action(async (path: string, opts: { sort?: string; about?: boolean; format?: string; color?: boolean }) => {
    process.exitCode = await provenanceCommand(path, opts);
  });

const skills = program.command('skills').description('list, inspect, add, write and test skills (packaged expertise for frameworks and bug classes)');
skills.command('list').argument('[path]', 'project directory', '.').option('--json', 'machine-readable output').description('skills active for this project and available ones')
  .action(async (path: string, opts: { json?: boolean }) => { process.exitCode = await skillsList({ path, ...opts }); });
skills.command('show').argument('<name>').option('-p, --path <dir>', 'project directory', '.').option('--section <name>', 'print only one guidance section').description('show one skill')
  .action(async (name: string, opts: { path?: string; section?: string }) => { process.exitCode = await skillsShow(name, opts); });
skills.command('add').argument('<source>', 'git URL, optionally #subdir and @commit').option('--yes', 'install without asking').option('--allow-unlicensed', 'install a skill that states no licence').option('--repo', 'install into this repository (.athena/skills) instead of your user directory').option('-p, --path <dir>', 'project directory', '.')
  .description('install a third-party skill (pinned to a commit; contains rules and text only)')
  .action(async (source: string, opts: { yes?: boolean; allowUnlicensed?: boolean; repo?: boolean; path?: string }) => { process.exitCode = await skillsAdd(source, opts); });
skills.command('remove').argument('<name>').option('--repo', 'remove from this repository').option('-p, --path <dir>', 'project directory', '.').description('remove an installed skill')
  .action(async (name: string, opts: { repo?: boolean; path?: string }) => { process.exitCode = await skillsRemove(name, opts); });
skills.command('new').argument('<name>').option('--user', 'create in your user skills directory instead of this repository').option('-p, --path <dir>', 'project directory', '.').description('scaffold a skill with rules and fixtures')
  .action(async (name: string, opts: { user?: boolean; path?: string }) => { process.exitCode = await skillsNew(name, opts); });
skills.command('test').argument('[path]', 'a skill folder, or a folder of skills', '.').description('validate a skill and run its fixtures')
  .action(async (path: string) => { process.exitCode = await skillsTest(path); });

program
  .command('variants')
  .argument('<finding-id>', 'id from the last scan (see athena explain)')
  .option('-p, --path <dir>', 'directory that was scanned', '.')
  .option('--save', 'keep the derived rule in .athena/learned-rules.json')
  .option('--force', 'save even when the rule matches more than 50 places')
  .description('turn one confirmed finding into a rule and find its siblings in the code')
  .action(async (id: string, opts: { path?: string; save?: boolean; force?: boolean }) => { process.exitCode = await variantsCommand(id, opts); });

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

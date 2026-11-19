import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getGitHooksDir, getGitRoot } from '../utils/git.js';
import { detectHookManager, hookCommand, hookScript, isAthenaHook, managerSnippet, type HookName } from '../utils/hooks.js';
import { writeInfo } from '../utils/output.js';
import { loadProjectConfig } from '../utils/project-config.js';

export interface InitOptions { hooks?: string; failOn?: string; force?: boolean }

const VALID: HookName[] = ['pre-commit', 'pre-push'];

/** Install git gates. Existing hooks and hook managers are never overwritten (a snippet is printed instead). */
export async function initCommand(opts: InitOptions = {}): Promise<void> {
  const root = await getGitRoot();
  const hooksDir = await getGitHooksDir();
  if (!root || !hooksDir) {
    console.error('Athena needs a git repository for hook install.');
    process.exitCode = 1;
    return;
  }
  const requested = (opts.hooks ?? 'pre-commit').split(',').map((s) => s.trim()).filter(Boolean);
  const bad = requested.filter((h) => !VALID.includes(h as HookName));
  if (bad.length > 0) {
    console.error(`unknown hook ${bad.join(', ')} (use pre-commit, pre-push)`);
    process.exitCode = 2;
    return;
  }
  const hooks = requested as HookName[];
  const config = await loadProjectConfig(root).catch(() => ({} as { failOn?: string }));
  const failOn = opts.failOn ?? config.failOn ?? 'high';
  const absHooksDir = join(root, hooksDir);

  const manager = detectHookManager(root, absHooksDir);
  if (manager) {
    writeInfo(`${manager} manages your git hooks, so Athena did not change any files. Add this:\n`);
    writeInfo(managerSnippet(manager, hooks, failOn));
    return;
  }
  for (const hook of hooks) {
    const path = join(absHooksDir, hook);
    if (existsSync(path) && !isAthenaHook(path) && !opts.force) {
      writeInfo(`${path} already exists and is not Athena's; left unchanged. Add this line to it:\n  ${hookCommand(hook, failOn)}\n(or re-run with --force to replace it)`);
      continue;
    }
    await mkdir(absHooksDir, { recursive: true });
    await writeFile(path, hookScript(hook, failOn, hook === 'pre-push' ? 120 : 0), { mode: 0o755 });
    await chmod(path, 0o755);
    console.log(`Athena ${hook} hook installed at ${path}`);
  }
}

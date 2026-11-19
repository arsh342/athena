import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const HOOK_MARKER = '# athena-hook';
export type HookName = 'pre-commit' | 'pre-push';
export type HookManager = 'husky' | 'lefthook' | 'pre-commit-framework' | null;

/** Hook managers own the hooks directory; Athena prints a snippet for them instead of writing files. */
export function detectHookManager(root: string, hooksDir: string): HookManager {
  if (existsSync(join(root, '.husky')) || /(?:^|[\\/])\.husky(?:[\\/]|$)/.test(hooksDir)) return 'husky';
  if (['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml', 'lefthook.json'].some((f) => existsSync(join(root, f)))) return 'lefthook';
  if (existsSync(join(root, '.pre-commit-config.yaml'))) return 'pre-commit-framework';
  return null;
}

export function hookCommand(name: HookName, failOn: string): string {
  return name === 'pre-commit'
    ? `athena check --staged --quiet --fail-on ${failOn}`
    : `athena review --range '@{u}..HEAD' --quiet --fail-on ${failOn}`;
}

/** Shell script for a hook. Never blocks when Athena is missing; `ATHENA_SKIP=1` skips with a note. */
export function hookScript(name: HookName, failOn: string, timeoutSeconds: number): string {
  const args = name === 'pre-commit' ? `check --staged --quiet --fail-on ${failOn}` : `review --range '@{u}..HEAD' --quiet --fail-on ${failOn}`;
  const guard = name === 'pre-push'
    ? ['if ! git rev-parse --abbrev-ref --symbolic-full-name \'@{u}\' >/dev/null 2>&1; then', '  echo "athena: no upstream branch, nothing to review"', '  exit 0', 'fi']
    : [];
  return [
    '#!/bin/sh',
    `${HOOK_MARKER} (managed by "athena init"; remove with "athena uninstall")`,
    'if [ -n "$ATHENA_SKIP" ]; then',
    '  echo "athena: skipped because ATHENA_SKIP is set"',
    '  exit 0',
    'fi',
    ...guard,
    'if command -v athena >/dev/null 2>&1; then',
    '  ATHENA="athena"',
    'elif [ -x "./node_modules/.bin/athena" ]; then',
    '  ATHENA="./node_modules/.bin/athena"',
    'else',
    '  echo "athena: not installed here, skipping (npm i -D @arsh342/athena)"',
    '  exit 0',
    'fi',
    ...(timeoutSeconds > 0
      ? [`if command -v timeout >/dev/null 2>&1; then`, `  timeout ${timeoutSeconds} "$ATHENA" ${args}`, 'else', `  "$ATHENA" ${args}`, 'fi']
      : [`"$ATHENA" ${args}`]),
    'code=$?',
    'if [ "$code" -eq 124 ]; then echo "athena: timed out, not blocking"; exit 0; fi',
    'exit $code',
    '',
  ].join('\n');
}

export function isAthenaHook(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(HOOK_MARKER);
  } catch {
    return false;
  }
}

export function managerSnippet(manager: Exclude<HookManager, null>, hooks: HookName[], failOn: string): string {
  const cmds = hooks.map((h) => ({ h, c: hookCommand(h, failOn) }));
  if (manager === 'husky') return cmds.map(({ h, c }) => `# .husky/${h}\n${c}`).join('\n\n');
  if (manager === 'lefthook') return `${cmds.map(({ h, c }) => `${h}:\n  commands:\n    athena:\n      run: ${c}`).join('\n')}`;
  return `repos:\n  - repo: local\n    hooks:\n${cmds.map(({ h, c }) => `      - id: athena-${h}\n        name: athena ${h}\n        entry: ${c}\n        language: system\n        pass_filenames: false\n        stages: [${h === 'pre-commit' ? 'pre-commit' : 'pre-push'}]`).join('\n')}`;
}

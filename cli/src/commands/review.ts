import { access, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isConfigTextFile, parseUnifiedDiff, wholeFileChanges, type ChangeSet } from '@athena/core';
import { isExcludedPath, isSourceCandidate } from '../utils/file-filter.js';
import { getGitTopLevel, getReviewDiff, type ReviewScope } from '../utils/git.js';
import { writeInfo } from '../utils/output.js';
import { loadProjectConfig } from '../utils/project-config.js';
import { resolveRunOptions, UsageError, type RunFlags } from '../utils/run-options.js';
import { runScan } from './run.js';

export interface ReviewFlags extends RunFlags {
  staged?: boolean;
  uncommitted?: boolean;
  range?: string;
  base?: string;
}

const MANIFEST = /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|requirements[\w.-]*\.txt|poetry\.lock|Pipfile\.lock|uv\.lock|pyproject\.toml|pom\.xml|gradle\.lockfile|packages\.lock\.json|[\w.-]+\.(?:cs|fs|vb)proj|go\.mod|go\.sum|Cargo\.(?:lock|toml)|composer\.lock|vcpkg\.json|conan\.lock)$/;

function scopeOf(flags: ReviewFlags): ReviewScope {
  const chosen = [flags.range ? 1 : 0, flags.base ? 1 : 0, flags.uncommitted ? 1 : 0, flags.staged ? 1 : 0].reduce((a, b) => a + b, 0);
  if (chosen > 1) throw new UsageError('choose one of --staged, --uncommitted, --range, --base');
  if (flags.range) return { kind: 'range', range: flags.range };
  if (flags.base) return { kind: 'base', base: flags.base };
  if (flags.uncommitted) return { kind: 'uncommitted' };
  return { kind: 'staged' };
}

/** Review a change instead of the whole repository: only findings the change introduced count. */
export async function reviewCommand(flags: ReviewFlags): Promise<void> {
  const cwd = process.cwd();
  const root = await getGitTopLevel(cwd);
  if (!root) {
    writeInfo('error: athena review needs a git repository');
    process.exitCode = 2;
    return;
  }
  const options = resolveRunOptions(flags, await loadProjectConfig(root), process.env, Boolean(process.stdout.isTTY));
  let diff;
  try {
    diff = await getReviewDiff(scopeOf(flags), root);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    writeInfo(`error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    process.exitCode = 2;
    return;
  }
  const changes: ChangeSet = parseUnifiedDiff(diff.diff);
  const known = new Set(changes.files.map((f) => f.path));
  for (const extra of wholeFileChanges(diff.untracked)) if (!known.has(extra.path)) changes.files.push(extra);

  const candidates: string[] = [];
  const textFiles: string[] = [];
  const excluded: string[] = [];
  for (const f of changes.files) {
    if (f.status === 'deleted' || f.binary) continue;
    const abs = resolve(root, f.path);
    if (!(await access(abs).then(() => true, () => false)) || !(await stat(abs)).isFile()) continue;
    if (isExcludedPath(abs, root, options.exclude)) {
      excluded.push(abs);
      continue;
    }
    if (await isSourceCandidate(abs)) candidates.push(abs);
    else if (isConfigTextFile(abs)) textFiles.push(abs);
  }
  // Dependency checks use the network, so they run only when a manifest or lockfile is part of the change.
  const manifestChanged = changes.files.some((f) => MANIFEST.test(f.path));
  const scoped = { ...options, deps: { ...options.deps, enabled: options.deps.enabled && manifestChanged } };

  process.exitCode = await runScan({
    mode: 'review', root, target: diff.label, files: candidates, excluded, textFiles, options: scoped,
    review: { changes, scope: diff.label },
  });
  void join;
}

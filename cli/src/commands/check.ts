import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { findSourceFiles, isExcludedPath, isSourceCandidate } from '../utils/file-filter.js';
import { getGitTopLevel, getStagedFiles } from '../utils/git.js';
import { loadProjectConfig } from '../utils/project-config.js';
import { resolveRunOptions, type RunFlags } from '../utils/run-options.js';
import { runScan } from './run.js';

export async function checkCommand(files: string[], flags: RunFlags): Promise<void> {
  const cwd = process.cwd();
  // Staged paths are relative to the repository top level, not to where the command runs.
  const top = files.length === 0 ? await getGitTopLevel(cwd) : null;
  const root = top ?? cwd;
  const options = resolveRunOptions(flags, await loadProjectConfig(root), process.env, Boolean(process.stdout.isTTY));

  const selected = files.length > 0 ? files : await getStagedFiles();
  const resolved = selected.map((file) => resolve(files.length > 0 ? cwd : root, file));
  const exists = await Promise.all(resolved.map((file) => access(file).then(() => true, () => false)));
  const isSource = await Promise.all(resolved.map((file, i) => (exists[i] ? isSourceCandidate(file) : Promise.resolve(false))));
  // A file the user named explicitly but that does not exist is a coverage gap, never silently dropped.
  const missing = files.length > 0 ? resolved.filter((_, i) => !exists[i]) : [];
  const candidates = resolved.filter((_, i) => isSource[i]);
  const excluded = candidates.filter((file) => isExcludedPath(file, root, options.exclude));
  const sourceFiles = candidates.filter((file) => !excluded.includes(file));
  const expanded = sourceFiles.length === 1 ? await findSourceFiles(sourceFiles[0], options.exclude) : sourceFiles;

  process.exitCode = await runScan({
    mode: 'check', root, target: `${sourceFiles.length} staged/source files`, files: [...expanded, ...missing], excluded, options,
  });
}

import { resolve } from 'node:path';
import { findSourceFiles, isExcludedPath, isSourceCandidate } from '../utils/file-filter.js';
import { getStagedFiles } from '../utils/git.js';
import { loadProjectConfig } from '../utils/project-config.js';
import { resolveRunOptions, type RunFlags } from '../utils/run-options.js';
import { runScan } from './run.js';

export async function checkCommand(files: string[], flags: RunFlags): Promise<void> {
  const root = process.cwd();
  const options = resolveRunOptions(flags, await loadProjectConfig(root), process.env, Boolean(process.stdout.isTTY));

  const selected = files.length > 0 ? files : await getStagedFiles();
  const resolved = selected.map((file) => resolve(root, file));
  const isSource = await Promise.all(resolved.map((file) => isSourceCandidate(file)));
  const candidates = resolved.filter((_, i) => isSource[i]);
  const excluded = candidates.filter((file) => isExcludedPath(file, root, options.exclude));
  const sourceFiles = candidates.filter((file) => !excluded.includes(file));
  const expanded = sourceFiles.length === 1 ? await findSourceFiles(sourceFiles[0], options.exclude) : sourceFiles;

  process.exitCode = await runScan({
    mode: 'check', root, target: `${sourceFiles.length} staged/source files`, files: expanded, excluded, options,
  });
}

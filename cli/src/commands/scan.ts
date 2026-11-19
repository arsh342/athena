import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { findSourceFilesWithExclusions } from '../utils/file-filter.js';
import { loadProjectConfig } from '../utils/project-config.js';
import { resolveRunOptions, type RunFlags } from '../utils/run-options.js';
import { runScan } from './run.js';

export async function scanCommand(dir: string, flags: RunFlags): Promise<void> {
  const given = resolve(process.cwd(), dir);
  // Scanning one file: the project root is its folder, so scanners and git run from a directory.
  const root = (await stat(given).catch(() => null))?.isFile() ? dirname(given) : given;
  const options = resolveRunOptions(flags, await loadProjectConfig(root), process.env, Boolean(process.stdout.isTTY));
  const { files, excluded, textFiles } = await findSourceFilesWithExclusions(given, options.exclude);
  process.exitCode = await runScan({ mode: 'scan', root, target: dir, files, excluded, textFiles, options });
}

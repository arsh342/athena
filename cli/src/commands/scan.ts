import { resolve } from 'node:path';
import { findSourceFilesWithExclusions } from '../utils/file-filter.js';
import { loadProjectConfig } from '../utils/project-config.js';
import { resolveRunOptions, type RunFlags } from '../utils/run-options.js';
import { runScan } from './run.js';

export async function scanCommand(dir: string, flags: RunFlags): Promise<void> {
  const root = resolve(process.cwd(), dir);
  const options = resolveRunOptions(flags, await loadProjectConfig(root), process.env, Boolean(process.stdout.isTTY));
  const { files, excluded } = await findSourceFilesWithExclusions(root, options.exclude);
  process.exitCode = await runScan({ mode: 'scan', root, target: dir, files, excluded, options });
}

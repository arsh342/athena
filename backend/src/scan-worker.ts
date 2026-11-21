/**
 * Runs one scan in its own process, then exits. The scanner's WebAssembly and native memory is never handed back by a long-lived Node process
 * (measured: ~570 MB still held after the first scan, ~930 MB after the second), so a web server that scanned in-process grew until the host
 * killed it. A short-lived worker returns all of it to the OS when it exits, and it also owns the process.cwd override the scanner needs.
 */
import { scanFiles } from '@athena/core';

export interface ScanWorkerInput {
  projectRoot: string;
  sourceFiles: string[];
  textFiles: string[];
  /** Source files left out by the default excludes (test directories); listed in coverage as excluded. */
  excludedFiles: string[];
  dependencies: { enabled: boolean; offline: boolean; registryChecks: boolean; concurrency: number };
}
export type ScanWorkerOutput = { ok: true; report: unknown } | { ok: false; error: string };

process.once('message', async (input: ScanWorkerInput) => {
  const send = (out: ScanWorkerOutput) => new Promise<void>((resolve) => (process.send ? process.send(out, () => resolve()) : resolve()));
  try {
    (process as NodeJS.Process & { cwd: () => string }).cwd = () => input.projectRoot;
    const report = await scanFiles(input.sourceFiles, { dependencies: input.dependencies }, {}, { root: input.projectRoot, textFiles: input.textFiles, excludedFiles: input.excludedFiles });
    await send({ ok: true, report });
  } catch (error) {
    await send({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  process.exit(0);
});

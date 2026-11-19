import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isSupportedSource } from '../lang/languages.js';
import { parseFileDetailed } from '../parser/ast-parser.js';
import { recordedAiLines } from '../provenance/git-recorded.js';

const SKIP = /(^|\/)(node_modules|vendor|third_party|thirdparty|dist|build|target|\.venv|venv|__pycache__|generated|gen)\/|\.min\.|\.pb\.|_pb2|\.generated\./i;
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };

function trackedFiles(repo: string): string[] {
  const out = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-z'], { cwd: repo, env: GIT_ENV, maxBuffer: 256 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

/**
 * node units-cli.js --repo DIR --out FILE [--ai] [--max-units N] [--max-file-bytes N]
 * Emits one JSON row per code unit; with --ai adds `aiFraction`, the share of the unit's lines
 * that git blame credits to AI-assisted commits (core isAiCommit).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string): string => {
    const i = args.indexOf(flag);
    if (i >= 0 && args[i + 1]) return args[i + 1]!;
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${flag}`);
  };
  const repo = get('--repo');
  const withAi = args.includes('--ai');
  const maxUnits = Number(get('--max-units', '1000000'));
  const maxBytes = Number(get('--max-file-bytes', '200000'));

  const realRepo = realpathSync(repo);
  const files = trackedFiles(repo)
    .filter((f) => isSupportedSource(f) && !SKIP.test(f))
    .map((f) => join(repo, f))
    .filter((f) => {
      try {
        const s = lstatSync(f); // never follow symlinks out of an untrusted clone
        return s.isFile() && !s.isSymbolicLink() && s.size <= maxBytes && realpathSync(f).startsWith(realRepo);
      } catch {
        return false;
      }
    });

  const cacheDir = mkdtempSync(join(tmpdir(), 'athena-units-blame-'));
  const recorded = withAi ? await recordedAiLines(repo, files, { concurrency: 8, cacheDir }) : null;
  rmSync(cacheDir, { recursive: true, force: true });
  if (withAi && !recorded!.available) throw new Error(`recorded provenance unavailable: ${recorded!.reason}`);

  const rows: string[] = [];
  for (const file of files) {
    if (rows.length >= maxUnits) break;
    const { units, error, language } = await parseFileDetailed(file);
    if (!language || (error && units.length === 0)) continue;
    const ai = recorded?.files.get(file);
    for (const unit of units) {
      if (unit.metadata.loc < 5) continue;
      const row: Record<string, unknown> = {
        id: unit.id, path: file.slice(repo.length + 1), language,
        name: unit.name, startLine: unit.startLine, endLine: unit.endLine, loc: unit.metadata.loc, code: unit.code,
      };
      if (ai?.available) {
        let hit = 0;
        for (let line = unit.startLine; line <= unit.endLine; line += 1) if (ai.aiLines.has(line)) hit += 1;
        row.aiFraction = hit / (unit.endLine - unit.startLine + 1);
      }
      rows.push(JSON.stringify(row));
      if (rows.length >= maxUnits) break;
    }
  }
  writeFileSync(get('--out'), rows.length ? `${rows.join('\n')}\n` : '');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { athenaHome, repoKey } from '../util/athena-home.js';
import { isAiCommit, type CommitMeta } from './ai-markers.js';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
/** Bump when the AI markers change so cached blame results are recomputed. */
const MARKERS_VERSION = 'm2';

export interface RecordedFile {
  available: boolean;
  reason?: string;
  /** 1-based line numbers written by AI-assisted commits. */
  aiLines: Set<number>;
}

export interface RecordedRepo {
  available: boolean;
  reason?: string;
  /** Keyed by the absolute path passed in. */
  files: Map<string, RecordedFile>;
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: MAX_BUFFER });
  return stdout;
}

/** Lines in each file that git history records as written by AI-assisted commits. A floor, not a total. */
export async function recordedAiLines(
  root: string,
  filePaths: string[],
  options: { cacheDir?: string; concurrency?: number } = {},
): Promise<RecordedRepo> {
  const files = new Map<string, RecordedFile>();
  try {
    await git(root, ['rev-parse', '--show-toplevel']);
  } catch {
    return { available: false, reason: 'not a git repository', files };
  }
  try {
    if ((await git(root, ['rev-parse', '--is-shallow-repository'])).trim() === 'true') {
      return { available: false, reason: 'shallow clone: history not available', files };
    }
  } catch {
    // older git: assume full history
  }

  const cacheRoot = join(options.cacheDir ?? join(athenaHome(), 'cache', 'blame'), repoKey(root));
  const aiBySha = new Map<string, boolean>();

  async function blameFile(filePath: string): Promise<void> {
    const rel = relative(root, filePath).split('\\').join('/');
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch {
      files.set(filePath, { available: false, reason: 'not tracked by git', aiLines: new Set() });
      return;
    }
    const key = `${createHash('sha1').update(rel).digest('hex')}-${createHash('sha1').update(content).digest('hex').slice(0, 12)}-${MARKERS_VERSION}.json`;
    const cachePath = join(cacheRoot, key);
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as number[];
      files.set(filePath, { available: true, aiLines: new Set(cached) });
      return;
    } catch {
      // cache miss
    }

    let porcelain: string;
    try {
      porcelain = await git(root, ['blame', '--line-porcelain', '--', rel]);
    } catch {
      files.set(filePath, { available: false, reason: 'not tracked by git', aiLines: new Set() });
      return;
    }

    const lineSha: Array<[number, string]> = [];
    let current: [number, string] | null = null;
    for (const line of porcelain.split('\n')) {
      const header = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
      if (header && !current) current = [Number(header[2]), header[1]];
      else if (line.startsWith('\t') && current) {
        lineSha.push(current);
        current = null;
      }
    }

    const unknown = [...new Set(lineSha.map(([, sha]) => sha))].filter((sha) => !/^0+$/.test(sha) && !aiBySha.has(sha));
    for (let i = 0; i < unknown.length; i += 200) {
      const chunk = unknown.slice(i, i + 200);
      const out = await git(root, ['log', '--no-walk', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x1e', ...chunk]);
      for (const record of out.split('\x1e')) {
        const parts = record.replace(/^\n/, '').split('\x00');
        if (parts.length < 6) continue;
        const meta: CommitMeta = {
          sha: parts[0], authorName: parts[1], authorEmail: parts[2],
          committerName: parts[3], committerEmail: parts[4], message: parts.slice(5).join('\x00'),
        };
        aiBySha.set(meta.sha, isAiCommit(meta));
      }
    }

    const aiLines = new Set<number>();
    for (const [lineNo, sha] of lineSha) {
      if (aiBySha.get(sha)) aiLines.add(lineNo);
    }
    files.set(filePath, { available: true, aiLines });
    try {
      await mkdir(cacheRoot, { recursive: true });
      await writeFile(cachePath, JSON.stringify([...aiLines]));
    } catch {
      // cache is best effort
    }
  }

  const concurrency = options.concurrency ?? 8;
  const queue = [...filePaths];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) await blameFile(path);
  }));

  return { available: true, files };
}

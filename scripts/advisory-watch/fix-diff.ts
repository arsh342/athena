export interface DiffFile { path: string; removed: number[]; added: number[] }

/** Parse a unified diff into per-file removed (old line numbers) and added (new line numbers) lines. */
export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2]!, removed: [], added: [] };
      files.push(current);
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!current || line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('-')) current.removed.push(oldLine++);
    else if (line.startsWith('+')) current.added.push(newLine++);
    else if (line.startsWith(' ')) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return files;
}

export interface FixMaterial { sha: string; parent: string; diff: string; files: Array<{ path: string; removed: number[]; before: string; after: string }> }

/** Fetch the fix commit's diff and the before/after text of each changed source file (GitHub API; token optional). */
export async function fetchFix(owner: string, repo: string, sha: string, options: { token?: string; fetchImpl?: typeof fetch } = {}): Promise<FixMaterial> {
  const f = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { 'user-agent': 'athena-advisory-watch', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) };
  const meta = await f(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, { headers: { ...headers, accept: 'application/vnd.github+json' } });
  if (!meta.ok) throw new Error(`commit ${sha}: HTTP ${meta.status}`);
  const commit = (await meta.json()) as { sha: string; parents?: Array<{ sha: string }> };
  const parent = commit.parents?.[0]?.sha;
  if (!parent) throw new Error('fix commit has no parent');
  const diffRes = await f(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, { headers: { ...headers, accept: 'application/vnd.github.diff' } });
  const diff = await diffRes.text();
  const raw = async (ref: string, path: string) => {
    const r = await f(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, { headers });
    return r.ok ? r.text() : null;
  };
  const files: FixMaterial['files'] = [];
  for (const file of parseDiff(diff).filter((x) => /\.(?:[cm]?[jt]sx?|py)$/.test(x.path) && x.removed.length > 0).slice(0, 8)) {
    const [before, after] = await Promise.all([raw(parent, file.path), raw(commit.sha, file.path)]);
    if (before !== null && after !== null) files.push({ path: file.path, removed: file.removed, before, after });
  }
  return { sha: commit.sha, parent, diff, files };
}

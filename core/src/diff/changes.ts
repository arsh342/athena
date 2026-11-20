export interface ChangedFile {
  /** Path in the new tree (repository-relative, forward slashes). */
  path: string;
  /** Previous path when the file was renamed. */
  oldPath?: string;
  status: 'added' | 'modified' | 'renamed' | 'deleted';
  binary: boolean;
  /** Changed line ranges in the new file, 1-based inclusive. Empty for pure renames and deletions. */
  ranges: Array<[number, number]>;
  /** Text of removed lines (without the leading `-`), capped, for review context. */
  removed?: string[];
}

export interface ChangeSet {
  files: ChangedFile[];
}

/** Parse `git diff --unified=0 -M` output (also tolerant of context lines). */
export function parseUnifiedDiff(diff: string): ChangeSet {
  const files: ChangedFile[] = [];
  let cur: ChangedFile | null = null;
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      cur = { path: header[2]!, status: 'modified', binary: false, ranges: [] };
      if (header[1] !== header[2]) cur.oldPath = header[1]!;
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.status = 'added';
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      cur.status = 'renamed';
      cur.oldPath = line.slice(12);
    } else if (line.startsWith('rename to ')) cur.path = line.slice(10);
    else if (/^Binary files .* differ$/.test(line) || line.startsWith('GIT binary patch')) cur.binary = true;
    else if (line.startsWith('-') && !line.startsWith('---')) {
      if ((cur.removed ??= []).length < 40) cur.removed.push(line.slice(1));
    } else {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (hunk) {
        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        if (count > 0) cur.ranges.push([start, start + count - 1]);
      }
    }
  }
  return { files };
}

/** Whole-file change entries for untracked files (they have no diff). */
export function wholeFileChanges(paths: string[]): ChangedFile[] {
  return paths.map((p) => ({ path: p, status: 'added' as const, binary: false, ranges: [[1, Number.MAX_SAFE_INTEGER] as [number, number]] }));
}

export function isChangedLine(file: ChangedFile | undefined, line: number): boolean {
  return !!file && file.ranges.some(([a, b]) => line >= a && line <= b);
}

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeProject, type ProjectFile } from '../src/analysis/project.ts';
import { detectLanguage } from '../src/lang/languages.ts';

const root = join(import.meta.dirname, 'fixtures', 'rules');

function load(dir: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const source = readFileSync(path, 'utf8');
    const lang = detectLanguage(path, source.split('\n', 1)[0]);
    if (lang) files.push({ path, source, lang });
  }
  return files;
}

function expectations(files: ProjectFile[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    f.source.split('\n').forEach((line, i) => {
      const m = /(?:\/\/|#)\s*EXPECT\s+([\w.,\s-]+?)\s*$/.exec(line);
      if (m) for (const id of m[1]!.split(/[,\s]+/).filter(Boolean)) out.push(`${f.path}:${i + 1} ${id}`);
    });
  }
  return out.sort();
}

for (const lang of readdirSync(root).sort()) {
  test(`${lang}: every vulnerable fixture finding is reported, and nothing else`, async () => {
    const files = load(join(root, lang, 'vuln'));
    const result = await analyzeProject(files);
    const got = [...result.findings].flatMap(([path, list]) => list.map((f) => `${path}:${f.line} ${f.ruleId}`)).sort();
    const expected = expectations(files);
    assert.ok(expected.length > 0, 'fixture has EXPECT markers');
    assert.deepEqual([...new Set(got)], [...new Set(expected)]);
    assert.deepEqual(result.timedOut, []);
  });

  test(`${lang}: safe twins stay silent`, async () => {
    const files = load(join(root, lang, 'safe'));
    const result = await analyzeProject(files);
    const got = [...result.findings].flatMap(([path, list]) => list.map((f) => `${path}:${f.line} ${f.ruleId} ${f.code}`));
    assert.deepEqual(got, []);
  });
}

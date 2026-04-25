import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { findSourceFiles, isSourceFile } from '../src/utils/file-filter.ts';

test('isSourceFile detects supported extensions', () => {
  assert.equal(isSourceFile('a.ts'), true);
  assert.equal(isSourceFile('b.tsx'), true);
  assert.equal(isSourceFile('c.js'), true);
  assert.equal(isSourceFile('d.jsx'), true);
  assert.equal(isSourceFile('README.md'), false);
});

test('findSourceFiles returns source files and skips ignored directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athena-cli-test-'));

  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'lib'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, '.next', 'static', 'chunks'), { recursive: true });
    await mkdir(join(root, '.vscode'), { recursive: true });
    await mkdir(join(root, '.idea'), { recursive: true });
    await mkdir(join(root, '.vite'), { recursive: true });
    await mkdir(join(root, '.parcel-cache'), { recursive: true });
    await mkdir(join(root, 'temp'), { recursive: true });

    await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;');
    await writeFile(join(root, 'src', 'view.tsx'), 'export const y = 2;');
    await writeFile(join(root, 'README.md'), '# docs');
    await writeFile(join(root, 'node_modules', 'lib', 'bad.ts'), 'export const bad = true;');
    await writeFile(join(root, 'dist', 'ignored.js'), 'console.log(1);');
    await writeFile(join(root, '.next', 'static', 'chunks', 'generated.js'), 'console.log("bundle");');
    await writeFile(join(root, '.vscode', 'settings.ts'), 'export const s = 1;');
    await writeFile(join(root, '.idea', 'workspace.ts'), 'export const i = 1;');
    await writeFile(join(root, '.vite', 'cache.ts'), 'export const v = 1;');
    await writeFile(join(root, '.parcel-cache', 'blob.js'), 'console.log("cache");');
    await writeFile(join(root, 'temp', 'generated.ts'), 'export const t = 1;');

    const files = await findSourceFiles(root);
    const relativePaths = files
      .map((file) => relative(root, file).split('\\').join('/'))
      .sort();

    assert.deepEqual(relativePaths, ['src/index.ts', 'src/view.tsx']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('findSourceFiles honors configured exclude paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athena-cli-test-exclude-'));

  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });

    await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;');
    await writeFile(join(root, 'test', 'fixture.ts'), 'export const fixture = true;');

    const files = await findSourceFiles(root, ['test/']);
    const relativePaths = files
      .map((file) => relative(root, file).split('\\').join('/'))
      .sort();

    assert.deepEqual(relativePaths, ['src/index.ts']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('findSourceFiles excludes nested test directories by segment name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athena-cli-test-nested-exclude-'));

  try {
    await mkdir(join(root, 'core', 'test'), { recursive: true });
    await mkdir(join(root, 'core', 'src'), { recursive: true });

    await writeFile(join(root, 'core', 'test', 'secret-detector.test.ts'), 'export const fixture = true;');
    await writeFile(join(root, 'core', 'src', 'index.ts'), 'export const index = true;');

    const files = await findSourceFiles(root, ['test/']);
    const relativePaths = files
      .map((file) => relative(root, file).split('\\').join('/'))
      .sort();

    assert.deepEqual(relativePaths, ['core/src/index.ts']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

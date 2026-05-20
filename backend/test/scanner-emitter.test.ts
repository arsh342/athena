import test from 'node:test';
import assert from 'node:assert/strict';
import { runUploadScan } from '../src/scanner.ts';

test('runUploadScan emits line events when emitter provided', async () => {
  const lines: string[] = [];

  await runUploadScan({
    mode: 'folder',
    rootName: 'emitter-repo',
    files: [
      { originalname: 'emitter-repo/src/index.ts', buffer: Buffer.from('export const x = 1;'), size: 22 },
    ],
    emit: {
      line: (text) => lines.push(text),
      status: () => undefined,
    },
  });

  assert.ok(lines.some((line) => line.includes('Collecting source files')));
});

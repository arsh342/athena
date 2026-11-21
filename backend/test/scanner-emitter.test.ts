import test from 'node:test';
import assert from 'node:assert/strict';
import { runUploadScan } from '../src/scanner.ts';

// Tests here start scans side by side in one process; the production default is one at a time.
process.env.MAX_CONCURRENT_SCANS = '8';

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

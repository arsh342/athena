import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPLOAD_BYTES, shouldSkipUploadPath } from '../src/utils/upload.ts';
import { buildUploadQueuedCommand } from '../src/pages/ScanPage.tsx';

test('shouldSkipUploadPath drops ignored directories', () => {
  assert.equal(shouldSkipUploadPath('repo/node_modules/pkg/index.js'), true);
  assert.equal(shouldSkipUploadPath('repo/.git/config'), true);
  assert.equal(shouldSkipUploadPath('repo/src/index.ts'), false);
});

test('MAX_UPLOAD_BYTES matches 200MB policy', () => {
  assert.equal(MAX_UPLOAD_BYTES, 200 * 1024 * 1024);
});

test('upload scans do not enqueue terminal commands', () => {
  assert.equal(buildUploadQueuedCommand('local-folder-upload'), null);
});

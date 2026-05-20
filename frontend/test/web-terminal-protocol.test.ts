import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEvent, encodeCommand } from '../src/components/web-terminal-protocol.ts';

test('encodeCommand wraps command text', () => {
  assert.equal(encodeCommand('help'), JSON.stringify({ type: 'command', command: 'help' }));
});

test('decodeEvent handles line events', () => {
  const event = decodeEvent(JSON.stringify({ type: 'line', kind: 'output', text: 'ok' }));
  assert.equal(event?.type, 'line');
});

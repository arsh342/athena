import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseColor } from '../src/utils/colors.ts';
import { UsageError, resolveRunOptions } from '../src/utils/run-options.ts';

const resolve = (flags = {}, config = {}, env: NodeJS.ProcessEnv = {}, tty = true) =>
  resolveRunOptions(flags, config, env, tty);

test('--fail-on maps to the blocking severities', () => {
  assert.deepEqual(resolve({ failOn: 'critical' }).blockOn, ['CRITICAL']);
  assert.deepEqual(resolve({ failOn: 'high' }).blockOn, ['CRITICAL', 'HIGH']);
  assert.deepEqual(resolve({ failOn: 'medium' }).blockOn, ['CRITICAL', 'HIGH', 'MEDIUM']);
  assert.deepEqual(resolve({ failOn: 'low' }).blockOn, ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  assert.deepEqual(resolve({ failOn: 'none' }).blockOn, []);
  assert.equal(resolve().failOn, 'high');
});

test('flags beat config; config beats defaults', () => {
  assert.equal(resolve({}, { failOn: 'low' }).failOn, 'low');
  assert.equal(resolve({ failOn: 'critical' }, { failOn: 'low' }).failOn, 'critical');
  assert.equal(resolve({}, { strict: true }).strict, true);
  assert.equal(resolve({ strict: false }, { strict: true }).strict, false);
});

test('invalid values are usage errors', () => {
  assert.throws(() => resolve({ failOn: 'extreme' }), UsageError);
  assert.throws(() => resolve({ format: 'xml' }), UsageError);
  assert.throws(() => resolve({ threshold: 'abc' }), UsageError);
});

test('formats and defaults', () => {
  for (const format of ['terminal', 'json', 'jsonl', 'sarif']) assert.equal(resolve({ format }).format, format);
  const o = resolve();
  assert.equal(o.format, 'terminal');
  assert.equal(o.maxFindings, Number.POSITIVE_INFINITY);
  assert.equal(o.showLow, false);
  assert.equal(resolve({ maxFindings: '5' }).maxFindings, 5);
  assert.deepEqual(o.scanners, { eslint: true });
  assert.deepEqual(o.deps, { enabled: true, offline: false });
  assert.ok(resolve({ semgrep: false }).warnings.some((w) => /--no-semgrep is deprecated/.test(w)));
  assert.ok(resolve({ bearer: false }).warnings.some((w) => /--no-bearer is deprecated/.test(w)));
  assert.ok(resolve({ nodejsscan: false }).warnings.some((w) => /--no-nodejsscan is deprecated/.test(w)));
});

test('--threshold is deprecated and warns', () => {
  const o = resolve({ threshold: '50' });
  assert.equal(o.threshold, 50);
  assert.match(o.warnings.join('\n'), /--threshold is deprecated/);
  assert.equal(resolve().threshold, undefined);
});

test('exclude combines core defaults with config', () => {
  const o = resolve({}, { exclude: ['generated/'] });
  assert.ok(o.exclude.includes('node_modules/'));
  assert.ok(o.exclude.includes('generated/'));
});

test('colour: off for NO_COLOR, non-TTY and --no-color', () => {
  assert.equal(resolve({}, {}, {}, true).color, true);
  assert.equal(resolve({}, {}, { NO_COLOR: '1' }, true).color, false);
  assert.equal(resolve({}, {}, { NO_COLOR: '' }, true).color, false);
  assert.equal(resolve({}, {}, {}, false).color, false);
  assert.equal(resolve({ color: false }, {}, {}, true).color, false);
  assert.equal(shouldUseColor({ isTTY: true }, undefined, {}), true);
});

test('colour is off when the report goes to a file', () => {
  assert.equal(resolve({ output: 'r.txt' }, {}, {}, true).color, false);
});

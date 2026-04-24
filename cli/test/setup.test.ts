import assert from 'node:assert/strict';
import test from 'node:test';

import { getSemgrepInstallCommand } from '../src/commands/setup.ts';

test('getSemgrepInstallCommand resolves platform-specific installer command', () => {
  assert.equal(getSemgrepInstallCommand('darwin'), 'brew install semgrep');
  assert.equal(getSemgrepInstallCommand('win32'), 'choco install semgrep -y');
  assert.equal(getSemgrepInstallCommand('linux'), 'python3 -m pip install --user semgrep');
});

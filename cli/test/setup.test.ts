import assert from 'node:assert/strict';
import test from 'node:test';

import { getSemgrepInstallCommand, getSetupAllPlan } from '../src/commands/setup.ts';

test('getSemgrepInstallCommand resolves platform-specific installer command', () => {
  assert.equal(getSemgrepInstallCommand('darwin'), 'brew install semgrep');
  assert.equal(getSemgrepInstallCommand('win32'), 'choco install semgrep -y');
  assert.equal(getSemgrepInstallCommand('linux'), 'python3 -m pip install --user semgrep');
});

test('getSetupAllPlan marks bundled and external scanner dependencies', () => {
  const plan = getSetupAllPlan('linux');

  const eslint = plan.find((item) => item.name === 'ESLint + eslint-plugin-security');
  const semgrep = plan.find((item) => item.name === 'Semgrep');
  const docker = plan.find((item) => item.name === 'Docker (for nodejsscan)');
  const bearer = plan.find((item) => item.name === 'Bearer CLI');

  assert.ok(eslint);
  assert.equal(eslint?.includedWithAthena, true);

  assert.ok(semgrep);
  assert.equal(semgrep?.includedWithAthena, false);
  assert.equal(semgrep?.manualInstallCommand, 'python3 -m pip install --user semgrep');

  assert.ok(docker);
  assert.equal(docker?.includedWithAthena, false);
  assert.equal(Boolean(docker?.manualInstallCommand), false);

  assert.ok(bearer);
  assert.equal(bearer?.autoInstallCommand, 'npm install -g @bearer/cli');
});

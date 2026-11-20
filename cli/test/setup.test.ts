import assert from 'node:assert/strict';
import test from 'node:test';

import { getSetupAllPlan } from '../src/commands/setup.ts';

test('the setup plan lists only ESLint: the retired external scanners are gone', () => {
  const plan = getSetupAllPlan('linux');
  assert.deepEqual(plan.map((p) => p.name), ['ESLint + eslint-plugin-security']);
  assert.equal(plan[0]?.includedWithAthena, true);
});

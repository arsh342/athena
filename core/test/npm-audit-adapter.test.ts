import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeNpmAuditOutput } from '../src/analyzers/npm-audit-adapter.js';

describe('npm-audit-adapter', () => {
  const projectRoot = '/tmp/athena-test';

  it('normalizes legacy npm audit advisory shape', () => {
    const findings = normalizeNpmAuditOutput({
      vulnerabilities: {
        lodash: {
          id: '109',
          title: 'Prototype Pollution',
          severity: 'high',
          findings: [
            { paths: ['lodash'] },
            { paths: ['app>lodash'] },
          ],
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
      },
    }, projectRoot, 'HIGH');

    assert.equal(findings.length, 2);
    assert.equal(findings[0]?.severity, 'HIGH');
    assert.equal(findings[0]?.ruleId, 'npm-audit:109');
    assert.match(findings[0]?.file ?? '', /package\.json$/);
  });

  it('normalizes modern npm audit vulnerability shape', () => {
    const findings = normalizeNpmAuditOutput({
      vulnerabilities: {
        next: {
          name: 'next',
          severity: 'moderate',
          via: [
            {
              source: 110,
              name: 'next',
              title: 'Authorization bypass',
              severity: 'high',
              range: '<15.0.0',
            },
            'transitive issue',
          ],
          effects: [],
          range: '<15.0.0',
          nodes: ['node_modules/next'],
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0 },
      },
    }, projectRoot, 'HIGH');

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, 'HIGH');
    assert.equal(findings[0]?.ruleId, 'npm-audit:110');
    assert.equal(findings[0]?.code, '"node_modules/next"');
    assert.match(findings[0]?.message ?? '', /Authorization bypass/);
  });

  it('falls back when modern vulnerability has no advisory objects', () => {
    const findings = normalizeNpmAuditOutput({
      vulnerabilities: {
        minimist: {
          name: 'minimist',
          severity: 'critical',
          via: [],
          effects: [],
          range: '*',
          nodes: [],
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1 },
      },
    }, projectRoot, 'LOW');

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, 'CRITICAL');
    assert.equal(findings[0]?.ruleId, 'npm-audit:minimist');
    assert.equal(findings[0]?.code, '"minimist"');
  });

  it('defaults missing severity values to low instead of throwing', () => {
    const findings = normalizeNpmAuditOutput({
      vulnerabilities: {
        mystery: {
          name: 'mystery',
          via: [
            {
              source: 404,
              title: 'Advisory without severity',
            },
          ],
          nodes: ['node_modules/mystery'],
        },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0 },
      },
    }, projectRoot, 'LOW');

    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.severity, 'LOW');
    assert.equal(findings[0]?.ruleId, 'npm-audit:404');
  });
});

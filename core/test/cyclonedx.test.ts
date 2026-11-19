import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { formatCycloneDx, purl } from '../src/report/cyclonedx.ts';
import { newAlerts } from '../src/updates/alerts.ts';
import { saveRecords } from '../src/updates/store.ts';
import { forgetLocalCache } from '../src/updates/vulndb.ts';
import type { ScanReport } from '../src/types.ts';

const base = (over: Partial<ScanReport> = {}): ScanReport => ({ timestamp: '2026-11-01T00:00:00.000Z', duration: 1, files: [], summary: {} as never, ...over } as ScanReport);

test('purl for every ecosystem', () => {
  assert.equal(purl('npm', '@types/node', '20.1.0'), 'pkg:npm/%40types/node@20.1.0');
  assert.equal(purl('PyPI', 'Django', '4.2'), 'pkg:pypi/django@4.2');
  assert.equal(purl('Maven', 'org.apache.logging.log4j:log4j-core', '2.14.1'), 'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1');
  assert.equal(purl('Go', 'github.com/gin-gonic/gin', 'v1.9.1'), 'pkg:golang/github.com/gin-gonic/gin@v1.9.1');
  assert.equal(purl('crates.io', 'serde', '1.0.0'), 'pkg:cargo/serde@1.0.0');
});

test('CycloneDX 1.6 document has the required structure, unique refs, and links vulnerabilities to components', () => {
  const report = base({
    inventory: [{ ecosystem: 'npm', name: 'lodash', version: '4.17.15', direct: true, manifest: 'package-lock.json' }, { ecosystem: 'npm', name: 'lodash', version: '4.17.15', direct: false, manifest: 'a/package-lock.json' }],
    files: [{ path: 'm', units: [], findings: [{ source: 'athena-deps', ruleId: 'deps.vulnerable', severity: 'HIGH', message: 'lodash@4.17.15: Prototype pollution (GHSA-xxxx-yyyy-zzzz).', evidence: ['advisory GHSA-xxxx-yyyy-zzzz'], dependency: { ecosystem: 'npm', name: 'lodash', version: '4.17.15', manifest: 'package-lock.json' } } as never] }],
  });
  const bom = JSON.parse(formatCycloneDx(report, { toolVersion: '1.2.3', projectName: 'demo' }));
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.6');
  assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(bom.version, 1);
  assert.equal(bom.components.length, 1, 'same package@version listed once');
  assert.equal(bom.components[0]['bom-ref'], 'pkg:npm/lodash@4.17.15');
  assert.ok(bom.components.every((c: { type: string; name: string }) => c.type === 'library' && c.name));
  assert.equal(bom.vulnerabilities[0].id, 'GHSA-xxxx-yyyy-zzzz');
  assert.deepEqual(bom.vulnerabilities[0].affects, [{ ref: 'pkg:npm/lodash@4.17.15' }]);
  assert.equal(bom.metadata.tools.components[0].name, 'athena');
});

test('alerts list only advisories the last scan did not report', () => {
  const home = mkdtempSync(join(tmpdir(), 'al-'));
  const affected = (name: string) => [{ package: { ecosystem: 'npm', name }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '9.0.0' }] }] }];
  saveRecords('npm', new Map([
    ['GHSA-old', { id: 'GHSA-old', summary: 'old', affected: affected('lodash') }],
    ['GHSA-new', { id: 'GHSA-new', summary: 'new', affected: affected('lodash') }],
    ['GHSA-other', { id: 'GHSA-other', summary: 'other', affected: affected('express') }],
  ]), { eco: 'npm', updatedAt: new Date().toISOString(), lastModified: '', records: 3 }, home);
  forgetLocalCache();
  const report = base({
    inventory: [{ ecosystem: 'npm', name: 'lodash', version: '4.0.0', direct: true, manifest: 'p.json' }, { ecosystem: 'PyPI', name: 'flask', version: '2.0', direct: true, manifest: 'r.txt' }],
    files: [{ path: 'm', units: [], findings: [{ source: 'athena-deps', ruleId: 'deps.vulnerable', evidence: ['advisory GHSA-old'], dependency: { ecosystem: 'npm', name: 'lodash', version: '4.0.0', manifest: 'p.json' } } as never] }],
  });
  const r = newAlerts(report, home);
  assert.deepEqual(r.alerts.map((a) => a.advisory.id), ['GHSA-new']);
  assert.deepEqual(r.missing, ['PyPI']);
  assert.equal(r.checked, 1);
  void mkdirSync; void writeFileSync; void dirname;
});

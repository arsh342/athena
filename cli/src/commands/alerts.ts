import { dirname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { newAlerts } from '@athena/core';
import { loadLastScan } from '../utils/last-scan.js';
import { writeInfo, writeResult } from '../utils/output.js';

/** Exit 0 = nothing new, 1 = new vulnerabilities affect the last scan's dependencies, 2 = cannot check. */
export async function alertsCommand(dir = '.'): Promise<number> {
  const given = resolve(process.cwd(), dir);
  const root = (await stat(given).catch(() => null))?.isFile() ? dirname(given) : given;
  const report = await loadLastScan(root);
  if (!report) {
    writeInfo(`error: no saved scan for ${root}; run athena scan first`);
    return 2;
  }
  if (!report.inventory || report.inventory.length === 0) {
    writeInfo('the last scan found no dependencies to re-check');
    return 0;
  }
  const { alerts, missing, checked } = newAlerts(report);
  if (missing.length > 0) writeInfo(`no local advisory data for ${missing.join(', ')}: run athena update --ecosystem ${missing.join(',')}`);
  if (checked === 0) return 2;
  if (alerts.length === 0) {
    writeResult(`No new vulnerabilities since your last scan (${report.timestamp.slice(0, 10)}); ${checked} packages re-checked.`);
    return 0;
  }
  const lines = [`${alerts.length} new vulnerabilit${alerts.length === 1 ? 'y affects' : 'ies affect'} ${root} since your last scan (${report.timestamp.slice(0, 10)}):`];
  for (const a of alerts.sort((x, y) => x.name.localeCompare(y.name))) {
    lines.push(`  ${a.advisory.severity.padEnd(8)} ${a.name}@${a.version}  ${a.advisory.id}  ${a.advisory.summary}${a.advisory.fixed.length ? ` (fixed in ${a.advisory.fixed.sort().pop()})` : ''}  ${a.manifest}`);
  }
  lines.push('', 'Run athena scan to update the report.');
  writeResult(lines.join('\n'));
  return 1;
}

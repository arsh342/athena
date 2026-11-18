import { relative } from 'node:path';
import { getRuleInfo } from '../rules/catalog.js';
import type { ClassifiedFinding, ScanReport, ScoredUnit, Severity } from '../types.js';
import { isSecretFinding, redactSecrets } from './redact.js';

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'note',
};

function owningUnit(units: ScoredUnit[], line: number): ScoredUnit | undefined {
  return units
    .filter((u) => line >= u.unit.startLine && line <= u.unit.endLine)
    .sort((a, b) => (a.unit.endLine - a.unit.startLine) - (b.unit.endLine - b.unit.startLine))[0];
}

/** SARIF 2.1.0 for GitHub code scanning. Secrets are redacted in messages. */
export function formatSarif(report: ScanReport, options: { toolVersion: string; root: string; uriPrefix?: string }): string {
  const rules = new Map<string, { id: string; shortDescription: { text: string }; fullDescription?: { text: string }; help?: { text: string }; helpUri?: string }>();
  const results: unknown[] = [];

  for (const file of report.files) {
    for (const finding of file.findings as ClassifiedFinding[]) {
      const info = getRuleInfo(finding.ruleId);
      if (!rules.has(finding.ruleId)) {
        rules.set(finding.ruleId, {
          id: finding.ruleId,
          shortDescription: { text: info?.title ?? finding.type },
          ...(info ? { fullDescription: { text: info.why }, help: { text: info.fix }, helpUri: info.references[0] } : {}),
        });
      }
      const unit = owningUnit(file.units, finding.line);
      const text = isSecretFinding(finding) ? redactSecrets(finding.message) : finding.message;
      const uri = `${options.uriPrefix ?? ''}${relative(options.root, finding.file).split('\\').join('/')}`;
      results.push({
        ruleId: finding.ruleId,
        level: LEVEL[finding.severity],
        message: { text },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri },
            region: { startLine: Math.max(1, finding.line), startColumn: Math.max(1, finding.column) },
          },
        }],
        partialFingerprints: { athenaFindingId: finding.id },
        properties: {
          severity: finding.severity,
          source: finding.source,
          aiProvenance: unit?.provenance ?? null,
          recorded: unit?.recorded ?? false,
        },
      });
    }
  }

  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'athena', version: options.toolVersion, informationUri: 'https://github.com/arsh342/athena', rules: [...rules.values()] } },
      results,
    }],
  }, null, 2);
}

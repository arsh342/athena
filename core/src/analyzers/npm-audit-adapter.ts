import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { NpmAuditConfig, Severity } from '../types.js';

const execFileAsync = promisify(execFile);

interface NpmAuditAdvisory {
  id: string;
  title: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  findings: Array<{
    paths: string[];
  }>;
}

interface NpmAuditVulnerability {
  [key: string]: NpmAuditAdvisory;
}

interface NpmAuditOutput {
  vulnerabilities: NpmAuditVulnerability;
  metadata: {
    vulnerabilities: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
    };
  };
}

export interface NpmAuditFinding {
  id: string;
  ruleId: string;
  file: string;
  line: number;
  column: number;
  code: string;
  type: string;
  message: string;
  category: string;
  severity: Severity;
}

/**
 * Run npm audit on the project and return normalized findings.
 * Fails open: tool errors produce warnings and no findings.
 */
export async function runNpmAudit(projectRoot: string, config: NpmAuditConfig): Promise<NpmAuditFinding[]> {
  if (!config.enabled) return [];

  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
      cwd: projectRoot,
      timeout: config.timeoutMs,
    });

    const parsed = safeParseNpmAudit(stdout);
    if (!parsed.vulnerabilities) return [];

    const threshold = config.severityThreshold || 'HIGH';
    return Object.entries(parsed.vulnerabilities)
      .filter(([_, advisory]) => meetsSeverityThreshold(advisory.severity, threshold))
      .flatMap(([_, advisory]) => normalizeNpmAuditFindings(advisory, projectRoot));
  } catch (error) {
    const withStreams = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };

    // npm audit exits with non-zero when vulnerabilities are found
    if (withStreams?.stdout && withStreams.stdout.trim().startsWith('{')) {
      const parsed = safeParseNpmAudit(withStreams.stdout);
      if (parsed.vulnerabilities) {
        const threshold = config.severityThreshold || 'HIGH';
        return Object.entries(parsed.vulnerabilities)
          .filter(([_, advisory]) => meetsSeverityThreshold(advisory.severity, threshold))
          .flatMap(([_, advisory]) => normalizeNpmAuditFindings(advisory, projectRoot));
      }
    }

    if (withStreams?.code === 'ENOENT') {
      console.warn('[athena-core] npm not found; skipping npm audit');
      return [];
    }

    const detail = withStreams?.stderr?.trim() || withStreams?.message || String(error);
    console.warn(`[athena-core] npm audit execution failed: ${detail}`);
    return [];
  }
}

function safeParseNpmAudit(json: string): NpmAuditOutput {
  try {
    return JSON.parse(json) as NpmAuditOutput;
  } catch {
    return { vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } };
  }
}

function meetsSeverityThreshold(severity: string, threshold: string): boolean {
  const severityOrder = ['low', 'moderate', 'high', 'critical'];
  const severityIndex = severityOrder.indexOf(severity.toLowerCase());
  const thresholdIndex = severityOrder.indexOf(threshold.toLowerCase());

  return severityIndex >= thresholdIndex;
}

function normalizeNpmAuditFindings(advisory: NpmAuditAdvisory, projectRoot: string): NpmAuditFinding[] {
  const findings: NpmAuditFinding[] = [];

  for (const finding of advisory.findings) {
    for (const path of finding.paths) {
      // Use package.json as the file reference for dependency vulnerabilities
      const packageJsonPath = resolve(projectRoot, 'package.json');

      findings.push({
        id: createHash('sha1').update(`npm-audit:${advisory.id}:${path}`).digest('hex').slice(0, 10),
        ruleId: `npm-audit:${advisory.id}`,
        file: packageJsonPath,
        line: 1, // Dependency findings don't have specific line numbers
        column: 1,
        code: `"${path}"`,
        type: 'Dependency Vulnerability',
        message: `${advisory.title} (affected: ${path})`,
        category: 'supply-chain-security',
        severity: mapNpmAuditSeverity(advisory.severity),
      });
    }
  }

  return findings;
}

function mapNpmAuditSeverity(severity: string): Severity {
  const value = severity.toLowerCase();
  if (value === 'critical') return 'CRITICAL';
  if (value === 'high') return 'HIGH';
  if (value === 'moderate') return 'MEDIUM';
  return 'LOW';
}
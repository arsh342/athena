import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { SemgrepConfig, Severity } from '../types.js';

const execFileAsync = promisify(execFile);

interface SemgrepResultItem {
  path: string;
  check_id: string;
  start?: {
    line?: number;
    col?: number;
  };
  extra?: {
    message?: string;
    severity?: string;
    lines?: string;
    metadata?: {
      category?: string;
      cwe?: string;
    };
  };
}

interface SemgrepJsonOutput {
  results?: SemgrepResultItem[];
}

export interface SemgrepFinding {
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
 * Run Semgrep on selected files and return normalized findings.
 * Fails open: tool errors produce warnings and no findings.
 */
export async function runSemgrep(filePaths: string[], config: SemgrepConfig): Promise<SemgrepFinding[]> {
  if (!config.enabled || filePaths.length === 0) return [];

  const semgrepArgs = [
    'scan',
    '--json',
    '--quiet',
    '--disable-version-check',
    '--config',
    config.config,
    ...filePaths,
  ];

  const output = await execSemgrep(semgrepArgs, config.timeoutMs);
  if (!output) return [];

  const parsed = safeParseSemgrep(output);
  return (parsed.results ?? []).map(normalizeSemgrepFinding).filter(Boolean) as SemgrepFinding[];
}

async function execSemgrep(args: string[], timeoutMs: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('semgrep', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const withStreams = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };

    // Semgrep may exit non-zero when findings/errors are present. Try parsing stdout first.
    if (withStreams?.stdout && withStreams.stdout.trim().startsWith('{')) {
      return withStreams.stdout;
    }

    if (withStreams?.code === 'ENOENT') {
      console.warn('[athena-core] semgrep not installed; skipping semgrep scan');
      return null;
    }

    const detail = withStreams?.stderr?.trim() || withStreams?.message || String(error);
    console.warn(`[athena-core] semgrep execution failed: ${detail}`);
    return null;
  }
}

function safeParseSemgrep(json: string): SemgrepJsonOutput {
  try {
    return JSON.parse(json) as SemgrepJsonOutput;
  } catch {
    return { results: [] };
  }
}

function normalizeSemgrepFinding(result: SemgrepResultItem): SemgrepFinding | null {
  const file = resolve(result.path || '');
  if (!file) return null;

  const line = result.start?.line ?? 1;
  const column = result.start?.col ?? 1;
  const ruleId = result.check_id || 'semgrep.unknown-rule';
  const message = result.extra?.message?.trim() || 'Semgrep finding';
  const code = result.extra?.lines?.trim() || '';
  const severity = mapSemgrepSeverity(result.extra?.severity);
  const category = result.extra?.metadata?.category || 'code-security';

  return {
    id: createHash('sha1').update(`semgrep:${file}:${line}:${column}:${ruleId}`).digest('hex').slice(0, 10),
    ruleId,
    file,
    line,
    column,
    code,
    type: formatSemgrepType(ruleId),
    message,
    category,
    severity,
  };
}

export function mapSemgrepSeverity(raw?: string): Severity {
  const value = (raw ?? '').toUpperCase();
  if (value.includes('ERROR') || value.includes('CRITICAL')) return 'CRITICAL';
  if (value.includes('WARNING') || value.includes('HIGH')) return 'HIGH';
  if (value.includes('INFO') || value.includes('MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

function formatSemgrepType(ruleId: string): string {
  const last = ruleId.split('.').filter(Boolean).slice(-1)[0] || ruleId;
  return `Semgrep ${last.replace(/[-_]/g, ' ')}`;
}

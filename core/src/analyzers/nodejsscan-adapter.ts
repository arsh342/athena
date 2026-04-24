import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { NodejsscanConfig, Severity } from '../types.js';

const execFileAsync = promisify(execFile);

interface NodejsscanResult {
  file: string;
  line: number;
  issue: string;
  severity: string;
  code?: string;
}

interface NodejsscanOutput {
  results?: NodejsscanResult[];
}

export interface NodejsscanFinding {
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
 * Run nodejsscan on the project and return normalized findings.
 * Uses Docker for isolation and requires Docker to be available.
 * Fails open: tool errors produce warnings and no findings.
 */
export async function runNodejsscan(projectRoot: string, config: NodejsscanConfig): Promise<NodejsscanFinding[]> {
  if (!config.enabled) return [];

  // Check Docker availability if required
  if (config.requireDocker && !(await checkDockerAvailable())) {
    console.warn('[athena-core] Docker not available, skipping nodejsscan scan. Install Docker to enable Node.js security scanning.');
    return [];
  }

  try {
    const dockerArgs = [
      'run',
      '--rm',
      '-v',
      `${projectRoot}:/app`,
      'opewnd/nodejsscan',
      '/app',
    ];

    const output = await execNodejsscan(dockerArgs, config.timeoutMs);
    if (!output) return [];

    const parsed = safeParseNodejsscan(output);
    return (parsed.results ?? []).map(result => normalizeNodejsscanFinding(result, projectRoot)).filter(Boolean) as NodejsscanFinding[];
  } catch (error) {
    const withStreams = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };

    if (withStreams?.code === 'ENOENT') {
      console.warn('[athena-core] Docker not found; skipping nodejsscan scan');
      return [];
    }

    const detail = withStreams?.stderr?.trim() || withStreams?.message || String(error);
    console.warn(`[athena-core] nodejsscan execution failed: ${detail}`);
    return [];
  }
}

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function execNodejsscan(args: string[], timeoutMs: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const withStreams = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };

    // nodejsscan may exit non-zero when findings are present. Try parsing stdout first.
    if (withStreams?.stdout && withStreams.stdout.trim().startsWith('{')) {
      return withStreams.stdout;
    }

    if (withStreams?.code === 'ENOENT') {
      console.warn('[athena-core] Docker not installed; skipping nodejsscan scan');
      return null;
    }

    const detail = withStreams?.stderr?.trim() || withStreams?.message || String(error);
    console.warn(`[athena-core] nodejsscan execution failed: ${detail}`);
    return null;
  }
}

function safeParseNodejsscan(json: string): NodejsscanOutput {
  try {
    return JSON.parse(json) as NodejsscanOutput;
  } catch {
    return { results: [] };
  }
}

function normalizeNodejsscanFinding(result: NodejsscanResult, projectRoot: string): NodejsscanFinding | null {
  const file = resolve(projectRoot, result.file || '');
  if (!file) return null;

  const line = result.line || 1;
  const severity = mapNodejsscanSeverity(result.severity);
  const issue = result.issue || 'Node.js security issue';
  const code = result.code || '';

  return {
    id: createHash('sha1').update(`nodejsscan:${file}:${line}:${issue}`).digest('hex').slice(0, 10),
    ruleId: `nodejsscan:${issue.replace(/\s+/g, '-').toLowerCase()}`,
    file,
    line,
    column: 1,
    code,
    type: 'Node.js Security Issue',
    message: issue,
    category: getNodejsscanCategory(issue),
    severity,
  };
}

function mapNodejsscanSeverity(severity: string): Severity {
  const value = (severity || '').toLowerCase();
  if (value.includes('critical') || value.includes('high')) return 'HIGH';
  if (value.includes('medium') || value.includes('warning')) return 'MEDIUM';
  return 'LOW';
}

function getNodejsscanCategory(issue: string): string {
  const lowerIssue = issue.toLowerCase();

  if (lowerIssue.includes('injection') || lowerIssue.includes('sql')) {
    return 'injection';
  }
  if (lowerIssue.includes('xss') || lowerIssue.includes('cross-site')) {
    return 'xss';
  }
  if (lowerIssue.includes('eval') || lowerIssue.includes('code execution')) {
    return 'unsafe-code-execution';
  }
  if (lowerIssue.includes('crypto') || lowerIssue.includes('encryption')) {
    return 'weak-cryptography';
  }
  if (lowerIssue.includes('auth') || lowerIssue.includes('session')) {
    return 'authentication';
  }
  if (lowerIssue.includes('header') || lowerIssue.includes('cors')) {
    return 'misconfiguration';
  }

  return 'nodejs-security';
}
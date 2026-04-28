import type { AthenaConfig, ClassifiedFinding, ExplainedScore } from './types.js';
import { runSemgrep, type SemgrepFinding } from './analyzers/semgrep-adapter.js';
import { runESLint, type ESLintFinding } from './analyzers/eslint-adapter.js';
import { runNpmAudit, type NpmAuditFinding } from './analyzers/npm-audit-adapter.js';
import { runNodejsscan, type NodejsscanFinding } from './analyzers/nodejsscan-adapter.js';
import { runBearer, type BearerFindingNormalized as BearerFinding } from './analyzers/bearer-adapter.js';

export interface ScannerPlugin {
  name: string;
  version: string;
  enabled: boolean;
  run: (filePaths: string[], projectRoot: string, config: any) => Promise<any[]>;
  checkAvailable: () => Promise<boolean>;
  normalize: (finding: any, config: AthenaConfig) => ClassifiedFinding;
}

/**
 * ScannerRegistry manages multiple security scanners and provides
 * a unified interface for running them and normalizing their findings.
 */
export class ScannerRegistry {
  private scanners: Map<string, ScannerPlugin> = new Map();

  constructor() {
    this.registerDefaultScanners();
  }

  /**
   * Register a new scanner plugin
   */
  register(scanner: ScannerPlugin): void {
    this.scanners.set(scanner.name, scanner);
  }

  /**
   * Unregister a scanner by name
   */
  unregister(name: string): void {
    this.scanners.delete(name);
  }

  /**
   * Get a scanner by name
   */
  getScanner(name: string): ScannerPlugin | undefined {
    return this.scanners.get(name);
  }

  /**
   * Get all registered scanners
   */
  getAllScanners(): ScannerPlugin[] {
    return Array.from(this.scanners.values());
  }

  /**
   * Run all enabled scanners that are available
   */
  async runEnabledScanners(
    filePaths: string[],
    projectRoot: string,
    config: AthenaConfig,
    onProgress?: (event: {
      phase: 'external-scanners';
      filePath: string;
      index: number;
      total: number;
      status: 'scanning' | 'scanned' | 'skipped' | 'missing';
      findings: number;
      detail?: string;
    }) => void,
  ): Promise<ClassifiedFinding[]> {
    const findings: ClassifiedFinding[] = [];
    const enabledScanners = Array.from(this.scanners.entries()).filter(([name]) => {
      const scannerConfig = config[name as keyof AthenaConfig];
      return Boolean(scannerConfig && typeof scannerConfig === 'object' && 'enabled' in scannerConfig && scannerConfig.enabled);
    });
    const totalEnabled = enabledScanners.length;
    let scannerIndex = 0;

    for (const [name, scanner] of this.scanners) {
      try {
        // Check if scanner is enabled in config
        const scannerConfig = config[name as keyof AthenaConfig];
        if (!scannerConfig || typeof scannerConfig !== 'object' || !('enabled' in scannerConfig) || !scannerConfig.enabled) {
          continue;
        }
        scannerIndex += 1;
        onProgress?.({
          phase: 'external-scanners',
          filePath: '',
          index: scannerIndex,
          total: totalEnabled,
          status: 'scanning',
          findings: 0,
          detail: `running ${name}`,
        });

        // Check if scanner is available
        const isAvailable = await scanner.checkAvailable();
        if (!isAvailable) {
          console.warn(`[athena-core] Scanner '${name}' is not available, skipping`);
          onProgress?.({
            phase: 'external-scanners',
            filePath: '',
            index: scannerIndex,
            total: totalEnabled,
            status: 'skipped',
            findings: 0,
            detail: `${name} unavailable`,
          });
          continue;
        }

        // Run the scanner
        const scannerFindings = await scanner.run(filePaths, projectRoot, scannerConfig);

        // Normalize findings to ClassifiedFinding format
        for (const finding of scannerFindings) {
          try {
            const normalized = scanner.normalize(finding, config);
            findings.push(normalized);
          } catch (error) {
            console.warn(`[athena-core] Failed to normalize finding from '${name}': ${error}`);
          }
        }

        console.log(`[athena-core] Scanner '${name}' found ${scannerFindings.length} findings`);
        onProgress?.({
          phase: 'external-scanners',
          filePath: '',
          index: scannerIndex,
          total: totalEnabled,
          status: 'scanned',
          findings: scannerFindings.length,
          detail: `${name} complete`,
        });
      } catch (error) {
        console.warn(`[athena-core] Scanner '${name}' failed: ${error}`);
        onProgress?.({
          phase: 'external-scanners',
          filePath: '',
          index: scannerIndex,
          total: totalEnabled,
          status: 'missing',
          findings: 0,
          detail: `${name} failed`,
        });
      }
    }

    return findings;
  }

  /**
   * Check availability of all scanners
   */
  async checkAllScanners(): Promise<Record<string, boolean>> {
    const availability: Record<string, boolean> = {};

    for (const [name, scanner] of this.scanners) {
      availability[name] = await scanner.checkAvailable();
    }

    return availability;
  }

  /**
   * Register the default scanners
   */
  private registerDefaultScanners(): void {
    // Semgrep
    this.register({
      name: 'semgrep',
      version: '1.0.0',
      enabled: true,
      run: async (filePaths, _projectRoot, config) => {
        return await runSemgrep(filePaths, config);
      },
      checkAvailable: async () => {
        try {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          await execFileAsync('semgrep', ['--version'], { timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      },
      normalize: (finding: SemgrepFinding, config: AthenaConfig) => {
        return {
          id: finding.id,
          severity: finding.severity,
          type: finding.type,
          category: finding.category,
          message: finding.message,
          file: finding.file,
          line: finding.line,
          column: finding.column,
          code: finding.code,
          aiScore: config.threshold,
          explainedScore: {
            score: config.threshold,
            band: 'LOW',
            signalsTriggered: 0,
            variance: 0,
            topSignals: [],
          },
          source: 'semgrep',
          ruleId: finding.ruleId,
        };
      },
    });

    // ESLint
    this.register({
      name: 'eslint',
      version: '1.0.0',
      enabled: true,
      run: async (filePaths, _projectRoot, config) => {
        return await runESLint(filePaths, config);
      },
      checkAvailable: async () => {
        try {
          await import('eslint');
          return true;
        } catch {
          return false;
        }
      },
      normalize: (finding: ESLintFinding, config: AthenaConfig) => {
        return {
          id: finding.id,
          severity: finding.severity,
          type: finding.type,
          category: finding.category,
          message: finding.message,
          file: finding.file,
          line: finding.line,
          column: finding.column,
          code: finding.code,
          aiScore: config.threshold,
          explainedScore: {
            score: config.threshold,
            band: 'LOW',
            signalsTriggered: 0,
            variance: 0,
            topSignals: [],
          },
          source: 'eslint',
          ruleId: finding.ruleId,
        };
      },
    });

    // npm-audit
    this.register({
      name: 'npmAudit',
      version: '1.0.0',
      enabled: true,
      run: async (_filePaths, projectRoot, config) => {
        return await runNpmAudit(projectRoot, config);
      },
      checkAvailable: async () => {
        try {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          await execFileAsync('npm', ['--version'], { timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      },
      normalize: (finding: NpmAuditFinding, config: AthenaConfig) => {
        return {
          id: finding.id,
          severity: finding.severity,
          type: finding.type,
          category: finding.category,
          message: finding.message,
          file: finding.file,
          line: finding.line,
          column: finding.column,
          code: finding.code,
          aiScore: config.threshold,
          explainedScore: {
            score: config.threshold,
            band: 'LOW',
            signalsTriggered: 0,
            variance: 0,
            topSignals: [],
          },
          source: 'npm-audit',
          ruleId: finding.ruleId,
        };
      },
    });

    // nodejsscan
    this.register({
      name: 'nodejsscan',
      version: '1.0.0',
      enabled: true,
      run: async (_filePaths, projectRoot, config) => {
        return await runNodejsscan(projectRoot, config);
      },
      checkAvailable: async () => {
        try {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          await execFileAsync('docker', ['--version'], { timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      },
      normalize: (finding: NodejsscanFinding, config: AthenaConfig) => {
        return {
          id: finding.id,
          severity: finding.severity,
          type: finding.type,
          category: finding.category,
          message: finding.message,
          file: finding.file,
          line: finding.line,
          column: finding.column,
          code: finding.code,
          aiScore: config.threshold,
          explainedScore: {
            score: config.threshold,
            band: 'LOW',
            signalsTriggered: 0,
            variance: 0,
            topSignals: [],
          },
          source: 'nodejsscan',
          ruleId: finding.ruleId,
        };
      },
    });

    // Bearer
    this.register({
      name: 'bearer',
      version: '1.0.0',
      enabled: true,
      run: async (_filePaths, projectRoot, config) => {
        return await runBearer(projectRoot, config);
      },
      checkAvailable: async () => {
        try {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          await execFileAsync('bearer', ['--version'], { timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      },
      normalize: (finding: BearerFinding, config: AthenaConfig) => {
        return {
          id: finding.id,
          severity: finding.severity,
          type: finding.type,
          category: finding.category,
          message: finding.message,
          file: finding.file,
          line: finding.line,
          column: finding.column,
          code: finding.code,
          aiScore: config.threshold,
          explainedScore: {
            score: config.threshold,
            band: 'LOW',
            signalsTriggered: 0,
            variance: 0,
            topSignals: [],
          },
          source: 'bearer',
          ruleId: finding.ruleId,
        };
      },
    });
  }
}

// Global scanner registry instance
export const scannerRegistry = new ScannerRegistry();

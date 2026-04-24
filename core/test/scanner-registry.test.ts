import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scannerRegistry } from '../src/scanner-registry.js';
import type { AthenaConfig } from '../src/types.js';

describe('ScannerRegistry', () => {
  let testConfig: AthenaConfig;

  beforeEach(() => {
    testConfig = {
      threshold: 65,
      blockOn: ['CRITICAL', 'HIGH'],
      exclude: ['node_modules/', 'dist/'],
      secretDetection: true,
      hallucinationDetection: true,
      semgrep: {
        enabled: true,
        timeoutMs: 30000,
        config: 'auto',
      },
      eslint: {
        enabled: true,
        timeoutMs: 30000,
      },
      npmAudit: {
        enabled: true,
        timeoutMs: 60000,
        severityThreshold: 'HIGH',
      },
      nodejsscan: {
        enabled: true,
        timeoutMs: 120000,
        requireDocker: true,
      },
      bearer: {
        enabled: true,
        timeoutMs: 60000,
        reportType: 'security',
      },
      maxFileSize: 1_048_576,
      weights: {},
    };
  });

  afterEach(() => {
    // Reset registry state if needed
  });

  describe('Scanner Registration', () => {
    it('should have all default scanners registered', () => {
      const scanners = scannerRegistry.getAllScanners();
      const scannerNames = scanners.map(s => s.name);

      expect(scannerNames).toContain('semgrep');
      expect(scannerNames).toContain('eslint');
      expect(scannerNames).toContain('npmAudit');
      expect(scannerNames).toContain('nodejsscan');
      expect(scannerNames).toContain('bearer');
    });

    it('should allow registering custom scanners', () => {
      const customScanner = {
        name: 'custom-scanner',
        version: '1.0.0',
        enabled: true,
        run: async () => [],
        checkAvailable: async () => true,
        normalize: (finding: any) => finding,
      };

      scannerRegistry.register(customScanner);

      const scanners = scannerRegistry.getAllScanners();
      expect(scanners.some(s => s.name === 'custom-scanner')).toBe(true);

      // Clean up
      scannerRegistry.unregister('custom-scanner');
    });

    it('should allow unregistering scanners', () => {
      const customScanner = {
        name: 'temp-scanner',
        version: '1.0.0',
        enabled: true,
        run: async () => [],
        checkAvailable: async () => true,
        normalize: (finding: any) => finding,
      };

      scannerRegistry.register(customScanner);
      expect(scannerRegistry.getScanner('temp-scanner')).toBeDefined();

      scannerRegistry.unregister('temp-scanner');
      expect(scannerRegistry.getScanner('temp-scanner')).toBeUndefined();
    });
  });

  describe('Scanner Availability', () => {
    it('should check availability of all scanners', async () => {
      const availability = await scannerRegistry.checkAllScanners();

      expect(availability).toHaveProperty('semgrep');
      expect(availability).toHaveProperty('eslint');
      expect(availability).toHaveProperty('npmAudit');
      expect(availability).toHaveProperty('nodejsscan');
      expect(availability).toHaveProperty('bearer');

      // All should be boolean values
      Object.values(availability).forEach(available => {
        expect(typeof available).toBe('boolean');
      });
    });
  });

  describe('Scanner Execution', () => {
    it('should run only enabled scanners', async () => {
      // Disable all scanners
      testConfig.semgrep.enabled = false;
      testConfig.eslint!.enabled = false;
      testConfig.npmAudit!.enabled = false;
      testConfig.nodejsscan!.enabled = false;
      testConfig.bearer!.enabled = false;

      const findings = await scannerRegistry.runEnabledScanners([], '/tmp', testConfig);

      // Should return empty array when all scanners are disabled
      expect(Array.isArray(findings)).toBe(true);
    });

    it('should handle scanner errors gracefully', async () => {
      // Enable a scanner that might not be available
      testConfig.nodejsscan!.enabled = true;

      const findings = await scannerRegistry.runEnabledScanners([], '/tmp', testConfig);

      // Should not throw even if scanner fails
      expect(Array.isArray(findings)).toBe(true);
    });
  });

  describe('Finding Normalization', () => {
    it('should normalize findings to ClassifiedFinding format', () => {
      const semgrepScanner = scannerRegistry.getScanner('semgrep');
      expect(semgrepScanner).toBeDefined();

      if (semgrepScanner) {
        const mockFinding = {
          id: 'test-id',
          ruleId: 'test-rule',
          file: '/test/file.js',
          line: 10,
          column: 5,
          code: 'test code',
          type: 'Test Type',
          message: 'Test message',
          category: 'test-category',
          severity: 'HIGH' as const,
        };

        const normalized = semgrepScanner.normalize(mockFinding, testConfig);

        expect(normalized).toHaveProperty('id');
        expect(normalized).toHaveProperty('severity');
        expect(normalized).toHaveProperty('type');
        expect(normalized).toHaveProperty('category');
        expect(normalized).toHaveProperty('message');
        expect(normalized).toHaveProperty('file');
        expect(normalized).toHaveProperty('line');
        expect(normalized).toHaveProperty('column');
        expect(normalized).toHaveProperty('code');
        expect(normalized).toHaveProperty('aiScore');
        expect(normalized).toHaveProperty('explainedScore');
        expect(normalized).toHaveProperty('source');
        expect(normalized).toHaveProperty('ruleId');
      }
    });
  });
});
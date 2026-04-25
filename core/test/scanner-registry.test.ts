import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
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

      assert.equal(scannerNames.includes('semgrep'), true);
      assert.equal(scannerNames.includes('eslint'), true);
      assert.equal(scannerNames.includes('npmAudit'), true);
      assert.equal(scannerNames.includes('nodejsscan'), true);
      assert.equal(scannerNames.includes('bearer'), true);
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
      assert.equal(scanners.some(s => s.name === 'custom-scanner'), true);

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
      assert.ok(scannerRegistry.getScanner('temp-scanner'));

      scannerRegistry.unregister('temp-scanner');
      assert.equal(scannerRegistry.getScanner('temp-scanner'), undefined);
    });
  });

  describe('Scanner Availability', () => {
    it('should check availability of all scanners', async () => {
      const availability = await scannerRegistry.checkAllScanners();

      assert.ok('semgrep' in availability);
      assert.ok('eslint' in availability);
      assert.ok('npmAudit' in availability);
      assert.ok('nodejsscan' in availability);
      assert.ok('bearer' in availability);

      // All should be boolean values
      Object.values(availability).forEach(available => {
        assert.equal(typeof available, 'boolean');
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
      assert.equal(Array.isArray(findings), true);
    });

    it('should handle scanner errors gracefully', async () => {
      // Enable a scanner that might not be available
      testConfig.nodejsscan!.enabled = true;

      const findings = await scannerRegistry.runEnabledScanners([], '/tmp', testConfig);

      // Should not throw even if scanner fails
      assert.equal(Array.isArray(findings), true);
    });
  });

  describe('Finding Normalization', () => {
    it('should normalize findings to ClassifiedFinding format', () => {
      const semgrepScanner = scannerRegistry.getScanner('semgrep');
      assert.ok(semgrepScanner);

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

        assert.ok('id' in normalized);
        assert.ok('severity' in normalized);
        assert.ok('type' in normalized);
        assert.ok('category' in normalized);
        assert.ok('message' in normalized);
        assert.ok('file' in normalized);
        assert.ok('line' in normalized);
        assert.ok('column' in normalized);
        assert.ok('code' in normalized);
        assert.ok('aiScore' in normalized);
        assert.ok('explainedScore' in normalized);
        assert.ok('source' in normalized);
        assert.ok('ruleId' in normalized);
      }
    });
  });
});
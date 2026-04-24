import { describe, it, expect, beforeEach } from 'vitest';
import { scanFiles } from '../src/engine.js';
import { mergeConfig } from '../src/config.js';
import type { AthenaConfig } from '../src/types.js';

describe('Scanner Integration', () => {
  let testConfig: AthenaConfig;

  beforeEach(() => {
    testConfig = mergeConfig({
      // Disable all external scanners for faster tests
      semgrep: { enabled: false, timeoutMs: 1000, config: 'auto' },
      eslint: { enabled: false, timeoutMs: 1000 },
      npmAudit: { enabled: false, timeoutMs: 1000 },
      nodejsscan: { enabled: false, timeoutMs: 1000, requireDocker: false },
      bearer: { enabled: false, timeoutMs: 1000 },
    });
  });

  describe('Basic Scanning', () => {
    it('should scan files without errors', async () => {
      // Create a simple test file path (this will be skipped if it doesn't exist)
      const testFiles = [];

      const report = await scanFiles(testFiles, testConfig, {});

      expect(report).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.filesScanned).toBe(0);
    });

    it('should handle empty file list', async () => {
      const report = await scanFiles([], testConfig, {});

      expect(report.summary.filesScanned).toBe(0);
      expect(report.files).toHaveLength(0);
    });

    it('should respect scanner configuration', async () => {
      // Test with different scanner configurations
      const configWithESLint = mergeConfig({
        eslint: { enabled: true, timeoutMs: 1000 },
      });

      const configWithoutESLint = mergeConfig({
        eslint: { enabled: false, timeoutMs: 1000 },
      });

      expect(configWithESLint.eslint?.enabled).toBe(true);
      expect(configWithoutESLint.eslint?.enabled).toBe(false);
    });
  });

  describe('Configuration Merging', () => {
    it('should merge user config with defaults', () => {
      const userConfig = {
        threshold: 75,
        eslint: { enabled: false, timeoutMs: 5000 },
      };

      const merged = mergeConfig(userConfig);

      expect(merged.threshold).toBe(75);
      expect(merged.eslint?.enabled).toBe(false);
      expect(merged.eslint?.timeoutMs).toBe(5000);
      // Other defaults should be preserved
      expect(merged.secretDetection).toBe(true);
      expect(merged.hallucinationDetection).toBe(true);
    });

    it('should handle partial scanner configuration', () => {
      const userConfig = {
        eslint: { enabled: false },
      };

      const merged = mergeConfig(userConfig);

      expect(merged.eslint?.enabled).toBe(false);
      expect(merged.eslint?.timeoutMs).toBe(30000); // Default value
    });

    it('should preserve all default scanner configs', () => {
      const merged = mergeConfig({});

      expect(merged.semgrep).toBeDefined();
      expect(merged.eslint).toBeDefined();
      expect(merged.npmAudit).toBeDefined();
      expect(merged.nodejsscan).toBeDefined();
      expect(merged.bearer).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing files gracefully', async () => {
      const nonExistentFiles = ['/non/existent/file.js'];

      const report = await scanFiles(nonExistentFiles, testConfig, {});

      expect(report.summary.filesScanned).toBe(0);
      expect(report.summary.skippedFiles).toBe(0);
    });

    it('should handle scanner unavailability gracefully', async () => {
      // Enable scanners that might not be installed
      const configWithScanners = mergeConfig({
        eslint: { enabled: true, timeoutMs: 1000 },
        nodejsscan: { enabled: true, timeoutMs: 1000, requireDocker: true },
      });

      const report = await scanFiles([], configWithScanners, {});

      // Should complete without errors even if scanners are not available
      expect(report).toBeDefined();
    });
  });
});
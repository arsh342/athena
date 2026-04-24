import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
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

      assert.ok(report);
      assert.ok(report.summary);
      assert.equal(report.summary.filesScanned, 0);
    });

    it('should handle empty file list', async () => {
      const report = await scanFiles([], testConfig, {});

      assert.equal(report.summary.filesScanned, 0);
      assert.equal(report.files.length, 0);
    });

    it('should respect scanner configuration', async () => {
      // Test with different scanner configurations
      const configWithESLint = mergeConfig({
        eslint: { enabled: true, timeoutMs: 1000 },
      });

      const configWithoutESLint = mergeConfig({
        eslint: { enabled: false, timeoutMs: 1000 },
      });

      assert.equal(configWithESLint.eslint?.enabled, true);
      assert.equal(configWithoutESLint.eslint?.enabled, false);
    });
  });

  describe('Configuration Merging', () => {
    it('should merge user config with defaults', () => {
      const userConfig = {
        threshold: 75,
        eslint: { enabled: false, timeoutMs: 5000 },
      };

      const merged = mergeConfig(userConfig);

      assert.equal(merged.threshold, 75);
      assert.equal(merged.eslint?.enabled, false);
      assert.equal(merged.eslint?.timeoutMs, 5000);
      // Other defaults should be preserved
      assert.equal(merged.secretDetection, true);
      assert.equal(merged.hallucinationDetection, true);
    });

    it('should handle partial scanner configuration', () => {
      const userConfig = {
        eslint: { enabled: false },
      };

      const merged = mergeConfig(userConfig);

      assert.equal(merged.eslint?.enabled, false);
      assert.equal(merged.eslint?.timeoutMs, 30000); // Default value
    });

    it('should preserve all default scanner configs', () => {
      const merged = mergeConfig({});

      assert.ok(merged.semgrep);
      assert.ok(merged.eslint);
      assert.ok(merged.npmAudit);
      assert.ok(merged.nodejsscan);
      assert.ok(merged.bearer);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing files gracefully', async () => {
      const nonExistentFiles = ['/non/existent/file.js'];

      const report = await scanFiles(nonExistentFiles, testConfig, {});

      assert.equal(report.summary.filesScanned, 0);
      assert.equal(report.summary.skippedFiles, 0);
    });

    it('should handle scanner unavailability gracefully', async () => {
      // Enable scanners that might not be installed
      const configWithScanners = mergeConfig({
        eslint: { enabled: true, timeoutMs: 1000 },
        nodejsscan: { enabled: true, timeoutMs: 1000, requireDocker: true },
      });

      const report = await scanFiles([], configWithScanners, {});

      // Should complete without errors even if scanners are not available
      assert.ok(report);
    });
  });
});
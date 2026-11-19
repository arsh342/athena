import test from 'node:test';
import assert from 'node:assert/strict';
import { alertHeadline, rescanPath } from '../src/utils/alerts';

test('banner headline names the repository and counts new vulnerabilities', () => {
  assert.equal(alertHeadline({ repoName: 'acme/api', count: 3 }), '3 new vulnerabilities affect acme/api since your last scan');
  assert.equal(alertHeadline({ repoName: 'acme/api', count: 1 }), '1 new vulnerability affects acme/api since your last scan');
});

test('re-scan link opens the scan page with the repository prefilled', () => {
  assert.equal(rescanPath({ repoUrl: 'https://github.com/acme/api' }), '/scan?repo=https%3A%2F%2Fgithub.com%2Facme%2Fapi');
});

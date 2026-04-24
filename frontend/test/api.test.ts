import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchScans, startScan } from '../src/services/api.ts';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

test('fetchScans sends credentials include and returns scans payload', async () => {
  const calls: Array<{ input: FetchInput; init?: FetchInit }> = [];
  const mockFetch = async (input: FetchInput, init?: FetchInit): Promise<MockResponse> => {
    calls.push({ input, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ scans: [{ scanId: 'scan-1' }] }),
    };
  };

  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

  try {
    const scans = await fetchScans();

    assert.equal(scans.length, 1);
    assert.equal(String(calls[0]?.input), '/api/scans');
    assert.equal(calls[0]?.init?.credentials, 'include');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('startScan posts repoUrl as json body', async () => {
  let capturedInit: FetchInit | undefined;
  const mockFetch = async (_input: FetchInput, init?: FetchInit): Promise<MockResponse> => {
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        scan: { scanId: 's1' },
        findings: [],
        lines: [],
      }),
    };
  };

  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

  try {
    await startScan('https://github.com/arsh342/athena');

    assert.equal(capturedInit?.method, 'POST');
    assert.deepEqual(capturedInit?.headers, { 'Content-Type': 'application/json' });
    assert.equal(capturedInit?.body, JSON.stringify({ repoUrl: 'https://github.com/arsh342/athena' }));
    assert.equal(capturedInit?.credentials, 'include');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('fetchScans throws on non-ok response', async () => {
  const mockFetch = async (): Promise<MockResponse> => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  });

  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

  try {
    await assert.rejects(fetchScans(), /Request failed: 401/);
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});

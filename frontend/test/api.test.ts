import assert from 'node:assert/strict';
import test from 'node:test';

import './storage-shim.ts';
import { fetchScans, startScan, startUploadScan } from '../src/services/api.ts';

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
    assert.equal(new Headers(capturedInit?.headers).get('Content-Type'), 'application/json');
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

test('startUploadScan includes terminal session header when provided', async () => {
  const form = new FormData();
  form.set('mode', 'folder');
  form.append('files[]', new Blob(['x']), 'src/x.ts');

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
    await startUploadScan(form, 'session-123');
    assert.equal(new Headers(capturedInit?.headers).get('X-Terminal-Session'), 'session-123');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }
});

test('a stored access token is sent as a Bearer header', async () => {
  localStorage.setItem('athena_token', 'tok-123');
  let sent: Headers | undefined;
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async (_i: FetchInput, init?: FetchInit) => { sent = new Headers(init?.headers); return { ok: true, status: 200, json: async () => ({ scans: [] }) }; }) as unknown as typeof fetch;
  try {
    await fetchScans();
    assert.equal(sent?.get('Authorization'), 'Bearer tok-123');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    localStorage.removeItem('athena_token');
  }
});

function withFetch(handler: (input: FetchInput, init?: FetchInit) => MockResponse, run: (calls: Array<{ input: FetchInput; init?: FetchInit }>) => Promise<void>): Promise<void> {
  const calls: Array<{ input: FetchInput; init?: FetchInit }> = [];
  const original = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: FetchInput, init?: FetchInit) => { calls.push({ input, init }); return handler(input, init); }) as unknown as typeof fetch;
  return run(calls).finally(() => { (globalThis as { fetch: typeof fetch }).fetch = original; });
}

test('deleteScan sends DELETE for that scan, with the id encoded', async () => {
  const { deleteScan } = await import('../src/services/api.ts');
  await withFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true }) }), async (calls) => {
    await deleteScan('a/b c');
    assert.equal(String(calls[0]?.input), '/api/scans/a%2Fb%20c');
    assert.equal(calls[0]?.init?.method, 'DELETE');
  });
});

test('deleteAllScans sends an explicit confirm and returns how many were removed', async () => {
  const { deleteAllScans } = await import('../src/services/api.ts');
  await withFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, deleted: 5 }) }), async (calls) => {
    assert.equal(await deleteAllScans(), 5);
    assert.equal(calls[0]?.init?.method, 'DELETE');
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { confirm: true });
  });
});

test('deleteAccount sends the confirmation, forgets the tokens, and an error leaves them alone', async () => {
  const { deleteAccount } = await import('../src/services/api.ts');
  localStorage.setItem('athena_token', 't');
  localStorage.setItem('athena_refresh_token', 'r');
  await withFetch(() => ({ ok: false, status: 403, json: async () => ({ error: 'The password is missing or wrong.' }) }), async () => {
    await assert.rejects(() => deleteAccount('a@b.co', 'bad'), /password is missing or wrong/);
    assert.equal(localStorage.getItem('athena_token'), 't', 'a failed delete keeps the session');
  });
  await withFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, identityRemoved: true }) }), async (calls) => {
    const r = await deleteAccount('a@b.co', 'pw');
    assert.deepEqual(r, { identityRemoved: true });
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { confirmEmail: 'a@b.co', password: 'pw' });
    assert.equal(String(calls[0]?.input), '/api/account');
    assert.equal(localStorage.getItem('athena_token'), null);
    assert.equal(localStorage.getItem('athena_refresh_token'), null);
  });
});

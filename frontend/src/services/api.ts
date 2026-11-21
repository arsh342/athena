import type { RepoAlerts } from '../utils/alerts';
import { aiHeaders, loadAiSettings } from '../utils/ai-settings';
import type { AuthUser, Finding, ScanSummary } from '../types';

interface ScanListResponse {
  scans: ScanSummary[];
}

interface ScanResponse {
  scan: ScanSummary;
}

interface FindingsResponse {
  findings: Finding[];
}

interface TerminalResponse {
  lines: string[];
}

interface StartScanResponse {
  scan: ScanSummary;
  findings: Finding[];
  lines: string[];
}

interface ReportMarkdownResponse {
  markdown: string;
}

interface AuthResponse {
  user: AuthUser;
}

const API_BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  
  const headers = new Headers(init?.headers);
  const token = localStorage.getItem('athena_token');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: string }).error ?? '';
    } catch {
      /* no body */
    }
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchAlerts(): Promise<RepoAlerts[]> {
  const data = await fetchJson<{ repos: RepoAlerts[] }>('/api/alerts');
  return data.repos;
}

export async function fetchScans(): Promise<ScanSummary[]> {
  const data = await fetchJson<ScanListResponse>('/api/scans');
  return data.scans;
}

export async function fetchScan(scanId: string): Promise<ScanSummary> {
  const data = await fetchJson<ScanResponse>(`/api/scans/${scanId}`);
  return data.scan;
}

export async function fetchFindings(): Promise<Finding[]> {
  const data = await fetchJson<FindingsResponse>('/api/findings');
  return data.findings;
}

export async function fetchFindingsByScanId(scanId: string): Promise<Finding[]> {
  const data = await fetchJson<FindingsResponse>(`/api/scans/${scanId}/findings`);
  return data.findings;
}

export async function fetchReportMarkdown(scanId: string): Promise<string> {
  const data = await fetchJson<ReportMarkdownResponse>(`/api/scans/${scanId}/report`);
  return data.markdown;
}

export async function downloadReportPdf(scanId: string): Promise<Blob> {
  const headers = new Headers();
  const token = localStorage.getItem('athena_token');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE}/api/scans/${scanId}/report.pdf`, {
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.blob();
}

/**
 * Start a real scan by POSTing to /api/scans.
 * Returns the scan summary, findings, and terminal output lines.
 */
export async function startScan(repoUrl: string, terminalSessionId?: string, ai = loadAiSettings()): Promise<StartScanResponse> {
  return fetchJson<StartScanResponse>('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(terminalSessionId ? { 'X-Terminal-Session': terminalSessionId } : {}), ...aiHeaders(ai) },
    body: JSON.stringify({ repoUrl }),
  });
}

export async function startUploadScan(formData: FormData, terminalSessionId?: string, ai = loadAiSettings()): Promise<StartScanResponse> {
  return fetchJson<StartScanResponse>('/api/scans/upload', {
    method: 'POST',
    body: formData,
    headers: { ...(terminalSessionId ? { 'X-Terminal-Session': terminalSessionId } : {}), ...aiHeaders(ai) },
  });
}

export interface AiOptions {
  providers: string[];
  modes: string[];
  presets: string[];
  maxBudgetUsd: number;
  defaults: Record<string, string>;
  note: string;
}

export async function fetchAiOptions(): Promise<AiOptions> {
  return fetchJson<AiOptions>('/api/ai/options');
}

/** The exact text the user must accept before anything is sent to their provider. */
export async function fetchAiConsent(ai = loadAiSettings()): Promise<string> {
  const headers = { ...aiHeaders({ ...ai, consented: true }) };
  delete (headers as Record<string, string>)['X-AI-Key'];
  const data = await fetchJson<{ consent: string }>('/api/ai/consent', { method: 'POST', headers });
  return data.consent;
}

/**
 * Legacy: trigger scan via GET terminal endpoint.
 * Kept for backwards compat with SandboxTerminal commands.
 */
export async function fetchScanTerminalLines(repoUrl: string): Promise<string[]> {
  const encodedUrl = encodeURIComponent(repoUrl);
  const data = await fetchJson<TerminalResponse>(`/api/terminal/scan?repoUrl=${encodedUrl}`);
  return data.lines;
}


export async function register(email: string, password: string): Promise<AuthUser> {
  const data = await fetchJson<{ user: AuthUser; accessToken?: string; refreshToken?: string }>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (data.accessToken) {
    localStorage.setItem('athena_token', data.accessToken);
  }
  if (data.refreshToken) {
    localStorage.setItem('athena_refresh_token', data.refreshToken);
  }
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await fetchJson<{ user: AuthUser; accessToken?: string; refreshToken?: string }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (data.accessToken) {
    localStorage.setItem('athena_token', data.accessToken);
  }
  if (data.refreshToken) {
    localStorage.setItem('athena_refresh_token', data.refreshToken);
  }
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await fetchJson<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
    });
  } finally {
    localStorage.removeItem('athena_token');
    localStorage.removeItem('athena_refresh_token');
  }
}

export async function fetchAuthMe(): Promise<AuthUser> {
  const data = await fetchJson<AuthResponse>('/api/auth/me');
  return data.user;
}

export async function refreshAuth(): Promise<AuthUser> {
  const refreshToken = localStorage.getItem('athena_refresh_token');
  const data = await fetchJson<{ user: AuthUser; accessToken?: string; refreshToken?: string }>('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (data.accessToken) {
    localStorage.setItem('athena_token', data.accessToken);
  }
  if (data.refreshToken) {
    localStorage.setItem('athena_refresh_token', data.refreshToken);
  }
  return data.user;
}

const jsonBody = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

/** Delete one of your scans, with its findings and report. */
export async function deleteScan(scanId: string): Promise<void> {
  await fetchJson<{ ok: true }>(`/api/scans/${encodeURIComponent(scanId)}`, { method: 'DELETE' });
}

/** Delete every scan of yours (a scan that is running right now is kept). Returns how many were removed. */
export async function deleteAllScans(): Promise<number> {
  const data = await fetchJson<{ ok: true; deleted: number }>('/api/scans', { method: 'DELETE', ...jsonBody({ confirm: true }) });
  return data.deleted;
}

/** Delete your account and everything saved under it. Retype your email; a password account also needs its password. */
export async function deleteAccount(confirmEmail: string, password?: string): Promise<{ identityRemoved: boolean }> {
  const data = await fetchJson<{ ok: true; identityRemoved: boolean }>('/api/account', {
    method: 'DELETE',
    ...jsonBody({ confirmEmail, ...(password ? { password } : {}) }),
  });
  localStorage.removeItem('athena_token');
  localStorage.removeItem('athena_refresh_token');
  return { identityRemoved: data.identityRemoved };
}

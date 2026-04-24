import type { AuthUser, Finding, LandingContent, PipelineStage, ScanSummary } from '../types';

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

interface LandingContentResponse {
  content: LandingContent;
}

interface PipelineResponse {
  stages: PipelineStage[];
}

interface StartScanResponse {
  scan: ScanSummary;
  findings: Finding[];
  lines: string[];
}

interface AuthResponse {
  user: AuthUser;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
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

export async function fetchLandingTerminalLines(): Promise<string[]> {
  const data = await fetchJson<TerminalResponse>('/api/terminal/landing');
  return data.lines;
}

/**
 * Start a real scan by POSTing to /api/scans.
 * Returns the scan summary, findings, and terminal output lines.
 */
export async function startScan(repoUrl: string): Promise<StartScanResponse> {
  return fetchJson<StartScanResponse>('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
  });
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

export async function fetchLandingContent(): Promise<LandingContent> {
  const data = await fetchJson<LandingContentResponse>('/api/content/landing');
  return data.content;
}

export async function fetchPipelineStages(): Promise<PipelineStage[]> {
  const data = await fetchJson<PipelineResponse>('/api/content/pipeline');
  return data.stages;
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const data = await fetchJson<AuthResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await fetchJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return data.user;
}

export async function logout(): Promise<void> {
  await fetchJson<{ ok: true }>('/api/auth/logout', {
    method: 'POST',
  });
}

export async function fetchAuthMe(): Promise<AuthUser> {
  const data = await fetchJson<AuthResponse>('/api/auth/me');
  return data.user;
}

export async function refreshAuth(): Promise<AuthUser> {
  const data = await fetchJson<AuthResponse>('/api/auth/refresh', {
    method: 'POST',
  });
  return data.user;
}

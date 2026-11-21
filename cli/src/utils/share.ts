import { MAX_CONTRIBUTION_BATCH, buildContributions, isValidContribution, type Contribution, type ContributionInput } from '@athena/core';
import type { LearningState } from '@athena/core';

export const SEND_TIMEOUT_MS = 3000;

/** Unsent, labelled samples from the learning state, as contributions. Samples from before language and size were recorded are skipped. */
export function pendingContributions(state: LearningState, meta: { installId: string; cliVersion: string }, limit = MAX_CONTRIBUTION_BATCH): { records: Contribution[]; shas: string[] } {
  const sent = new Set(state.sent ?? []);
  const items: ContributionInput[] = [];
  const shas: string[] = [];
  for (const s of state.samples) {
    if (sent.has(s.sha) || !s.language || !s.lines) continue;
    const source = s.source === 'recorded' || s.source === 'pre-2021' || s.source === 'mark' ? s.source : null;
    if (!source) continue;
    items.push({ label: s.y === 1 ? 'ai' : 'human', source, language: s.language, lines: s.lines, dense: s.dense, pBase: s.pBase });
    shas.push(s.sha);
    if (items.length >= limit) break;
  }
  const records = buildContributions(items, { ...meta, baseTag: state.baseTag || 'heuristic', tuned: state.adjustment !== null });
  // Keep shas and records aligned: the builder drops anything invalid.
  const valid = records.filter(isValidContribution);
  return { records: valid, shas: shas.slice(0, valid.length) };
}

export interface SendResult { ok: boolean; status?: number; error?: string }

/** POST a batch. Never throws and never takes longer than the timeout: a dead or slow server must not slow a scan. */
export async function sendContributions(baseUrl: string, records: Contribution[], timeoutMs = SEND_TIMEOUT_MS): Promise<SendResult> {
  if (records.length === 0) return { ok: true };
  try {
    const res = await fetch(`${baseUrl}/api/learning/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ records }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.status === 202 || res.status === 200, status: res.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.name : 'error' };
  }
}

/** Ask the server to delete everything sent under these install ids. */
export async function deleteContributions(baseUrl: string, installIds: string[], timeoutMs = 10_000): Promise<{ deleted: number; failed: string[] }> {
  let deleted = 0;
  const failed: string[] = [];
  for (const id of installIds) {
    try {
      const res = await fetch(`${baseUrl}/api/learning/contributions/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) { failed.push(id); continue; }
      const body = (await res.json().catch(() => ({}))) as { deleted?: number };
      deleted += Number(body.deleted ?? 0);
    } catch {
      failed.push(id);
    }
  }
  return { deleted, failed };
}

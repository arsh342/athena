import { MAX_CONTRIBUTION_BATCH, isValidContribution, type Contribution } from '@athena/core';
import { db } from './db.js';

/** Most records one install id may have accepted in 30 days. Beyond that the server answers 429. */
export const MAX_PER_INSTALL_30D = 2000;
/** Records are kept 18 months. */
export const RETENTION_MONTHS = 18;

const INSTALL_ID = /^[0-9a-f]{32}$/;

/**
 * Short-window request limiter, in memory. The key is an install id or an IP address; an IP is held here only to count requests
 * and is never written to the database or a log. (One instance only: good enough as a flood brake, the per-install 30 day cap is in the database.)
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  /** true when the request may proceed. */
  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.max) { this.hits.set(key, recent); return false; }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
    return true;
  }
}

export type AcceptResult =
  | { ok: true; accepted: number }
  | { ok: false; status: 400 | 413 | 429; error: string };

/** Validate a batch and store it. Pure of HTTP, so it can be tested directly. */
export async function acceptContributions(body: unknown, limits: { perInstall: RateLimiter; perIp: RateLimiter; ip: string }): Promise<AcceptResult> {
  const records = (body as { records?: unknown } | null)?.records;
  if (!Array.isArray(records) || records.length === 0) return { ok: false, status: 400, error: 'Send { "records": [ ... ] } with at least one record.' };
  if (records.length > MAX_CONTRIBUTION_BATCH) return { ok: false, status: 413, error: `At most ${MAX_CONTRIBUTION_BATCH} records per request.` };
  if (!limits.perIp.take(limits.ip)) return { ok: false, status: 429, error: 'Too many requests. Try again later.' };

  const bad = records.findIndex((r) => !isValidContribution(r));
  if (bad >= 0) return { ok: false, status: 400, error: `Record ${bad} does not match the contribution schema.` };
  const valid = records as Contribution[];
  const installId = valid[0]!.installId;
  if (!valid.every((r) => r.installId === installId)) return { ok: false, status: 400, error: 'All records in one request must come from one install id.' };
  if (!limits.perInstall.take(installId)) return { ok: false, status: 429, error: 'Too many requests from this install. Try again later.' };

  const used = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM learning_contributions WHERE install_id = $1 AND received_at > NOW() - INTERVAL '30 days'`,
    [installId],
  );
  if ((used.rows[0]?.n ?? 0) + valid.length > MAX_PER_INSTALL_30D) return { ok: false, status: 429, error: `This install has reached its limit of ${MAX_PER_INSTALL_30D} records per 30 days.` };

  await db.query(
    `INSERT INTO learning_contributions (install_id, record) SELECT $1, r FROM jsonb_array_elements($2::jsonb) AS r`,
    [installId, JSON.stringify(valid)],
  );
  return { ok: true, accepted: valid.length };
}

/** Delete everything stored for one install id. Knowing the random id is the capability, so it must look like one. */
export async function deleteInstall(installId: string): Promise<{ ok: true; deleted: number } | { ok: false; status: 400; error: string }> {
  if (!INSTALL_ID.test(installId)) return { ok: false, status: 400, error: 'Not a valid install id.' };
  const res = await db.query('DELETE FROM learning_contributions WHERE install_id = $1', [installId]);
  return { ok: true, deleted: res.rowCount ?? 0 };
}

/** Remove records older than the retention period. Safe to run from every instance: it only ever deletes expired rows. */
export async function purgeExpired(): Promise<number> {
  const res = await db.query(`DELETE FROM learning_contributions WHERE received_at < NOW() - ($1 || ' months')::interval`, [String(RETENTION_MONTHS)]);
  return res.rowCount ?? 0;
}

/** Daily retention job. */
export function startRetentionJob(log: (m: string) => void = console.log, intervalMs = 24 * 3600 * 1000): () => void {
  const tick = () => { purgeExpired().then((n) => { if (n > 0) log(`[athena-backend] learning retention: removed ${n} expired record(s)`); }).catch((e: unknown) => log(`[athena-backend] learning retention failed: ${e instanceof Error ? e.message : String(e)}`)); };
  const first = setTimeout(tick, 15 * 60_000);
  const timer = setInterval(tick, intervalMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

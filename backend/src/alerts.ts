import { ADVISORY_ID, DepsClient, depKey, queryVulnerabilities } from '@athena/core';
import { db } from './db.js';

const JOB = 'new-cve-alerts';

export interface InventoryItem { ecosystem: string; name: string; version: string; direct: boolean; manifest: string }

export async function saveScanInventory(userId: number, scanId: string, inventory: InventoryItem[] | undefined): Promise<void> {
  if (!inventory || inventory.length === 0) return;
  await db.query(
    `INSERT INTO scan_inventories (scan_id, user_id, inventory) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (scan_id) DO UPDATE SET inventory = EXCLUDED.inventory`,
    [scanId, userId, JSON.stringify(inventory)],
  );
}

/**
 * Single-flight across instances: the first instance to claim the row runs; the rest see `locked_until` in the future
 * and skip. The lease is short while the job runs and extended to ~a day on success.
 */
export async function claimJob(leaseMinutes = 30): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO job_locks (name, locked_until) VALUES ($1, NOW() + ($2 || ' minutes')::interval)
     ON CONFLICT (name) DO UPDATE SET locked_until = EXCLUDED.locked_until WHERE job_locks.locked_until < NOW()
     RETURNING name`,
    [JOB, String(leaseMinutes)],
  );
  return res.rows.length > 0;
}

async function holdUntilTomorrow(hours: number): Promise<void> {
  await db.query(`UPDATE job_locks SET locked_until = NOW() + ($2 || ' hours')::interval WHERE name = $1`, [JOB, String(hours)]);
}

export interface JobResult { ran: boolean; scansChecked: number; alertsWritten: number }

/** How many scans' inventories are checked together. Small on purpose: the job runs inside the web process, which may have little memory. */
const CHUNK = 100;

/**
 * Daily job: compare each user's most recent inventory per repository with current advisories and record vulnerabilities
 * the scan did not report. Scans whose owner no longer exists are skipped (join on users).
 *
 * It asks OSV about the packages in the saved inventories, a batch at a time. It does NOT download and hold whole
 * advisory databases (an earlier version did, which can exceed a small instance's memory). If a local database happens
 * to exist it is used first. `options.update` is accepted for compatibility and ignored.
 */
export async function runAlertsJob(options: { update?: boolean; intervalHours?: number } = {}): Promise<JobResult> {
  if (!(await claimJob())) return { ran: false, scansChecked: 0, alertsWritten: 0 };
  try {
    const latest = await db.query(
      `SELECT DISTINCT ON (s.user_id, s.repo_url) s.scan_id, s.user_id, i.inventory
         FROM scans s
         JOIN users u ON u.id = s.user_id
         JOIN scan_inventories i ON i.scan_id = s.scan_id
        WHERE s.status = 'COMPLETED'
        ORDER BY s.user_id, s.repo_url, s.created_at DESC`,
    );
    const rows = latest.rows as Array<{ scan_id: string; user_id: number; inventory: InventoryItem[] }>;
    const client = new DepsClient();
    let alertsWritten = 0;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      const unique = new Map<string, { ecosystem: InventoryItem['ecosystem']; name: string; version: string }>();
      for (const row of chunk) for (const d of row.inventory) if (d.version) unique.set(depKey(d as never), d as never);
      const { advisories } = await queryVulnerabilities(client, [...unique.values()] as never, { enabled: true });
      for (const row of chunk) {
        const reported = await db.query(`SELECT message FROM scan_findings WHERE scan_id = $1 AND rule_id LIKE 'deps.%'`, [row.scan_id]);
        const known = new Set<string>();
        for (const inv of row.inventory) {
          for (const f of reported.rows as Array<{ message: string }>) {
            if (!f.message.includes(`${inv.name}@${inv.version}`)) continue;
            for (const m of f.message.matchAll(ADVISORY_ID)) known.add(`${inv.ecosystem}\0${inv.name}\0${inv.version}\0${m[0]}`);
          }
        }
        const done = new Set<string>();
        for (const inv of row.inventory) {
          const key = depKey(inv as never);
          if (!inv.version || done.has(key)) continue;
          done.add(key);
          for (const adv of (advisories.get(key) ?? []) as Array<{ id: string; aliases: string[]; severity: string; summary: string; fixed: string[] }>) {
            if ([adv.id, ...adv.aliases].some((id) => known.has(`${key}\0${id}`))) continue;
            await db.query(
              `INSERT INTO scan_alerts (scan_id, user_id, advisory_id, ecosystem, package_name, package_version, severity, summary, fixed_in)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
              [row.scan_id, row.user_id, adv.id, inv.ecosystem, inv.name, inv.version, adv.severity, adv.summary.slice(0, 300), [...adv.fixed].sort().pop() ?? null],
            );
            alertsWritten += 1;
          }
        }
      }
    }
    await holdUntilTomorrow(options.intervalHours ?? 23);
    return { ran: true, scansChecked: rows.length, alertsWritten };
  } catch (error) {
    await db.query(`UPDATE job_locks SET locked_until = NOW() WHERE name = $1`, [JOB]).catch(() => undefined);
    throw error;
  }
}

export interface RepoAlerts { scanId: string; repoName: string; repoUrl: string; count: number; alerts: Array<{ advisoryId: string; package: string; version: string; severity: string; summary: string; fixedIn: string | null }> }

/** Alerts for the user's most recent scan of each repository (a newer scan clears older alerts). */
export async function getAlertsForUser(userId: number | string): Promise<RepoAlerts[]> {
  const res = await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (repo_url) scan_id, repo_name, repo_url FROM scans
        WHERE user_id = $1 AND status = 'COMPLETED' ORDER BY repo_url, created_at DESC)
     SELECT l.scan_id, l.repo_name, l.repo_url, a.advisory_id, a.package_name, a.package_version, a.severity, a.summary, a.fixed_in
       FROM latest l JOIN scan_alerts a ON a.scan_id = l.scan_id AND a.user_id = $1
      ORDER BY l.repo_name, a.severity, a.package_name`,
    [userId],
  );
  const byScan = new Map<string, RepoAlerts>();
  for (const r of res.rows as Array<Record<string, string | null>>) {
    const entry = byScan.get(r.scan_id!) ?? { scanId: r.scan_id!, repoName: r.repo_name!, repoUrl: r.repo_url!, count: 0, alerts: [] };
    entry.alerts.push({ advisoryId: r.advisory_id!, package: r.package_name!, version: r.package_version!, severity: r.severity!, summary: r.summary!, fixedIn: r.fixed_in ?? null });
    entry.count += 1;
    byScan.set(r.scan_id!, entry);
  }
  return [...byScan.values()];
}

/** In-process daily scheduler; the DB lock makes several instances safe. */
export function startAlertsScheduler(log: (m: string) => void = console.log, intervalMs = 6 * 3600 * 1000): () => void {
  if (/^(off|0|false|no)$/i.test(process.env.ALERTS_JOB ?? '')) {
    log('[athena-backend] alerts job is off (ALERTS_JOB)');
    return () => undefined;
  }
  const tick = () => {
    runAlertsJob().then((r) => { if (r.ran) log(`[athena-backend] alerts job: ${r.scansChecked} scans checked, ${r.alertsWritten} alerts`); }).catch((e: unknown) => log(`[athena-backend] alerts job failed: ${e instanceof Error ? e.message : String(e)}`));
  };
  // Ten minutes after boot, not one: a restart must not land the job's work on top of the start-up spike.
  const first = setTimeout(tick, 10 * 60_000);
  const timer = setInterval(tick, intervalMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

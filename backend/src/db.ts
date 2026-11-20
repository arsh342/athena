import 'dotenv/config';
import { Pool, types } from 'pg';

// Parse bigint (INT8) as number to prevent node-pg from returning it as a string
types.setTypeParser(types.builtins.INT8, (val) => parseInt(val, 10));

const connectionString = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/athena';

/**
 * TLS for hosted databases. With `DATABASE_CA_CERT` (PEM text) the server certificate is verified against it.
 * Without it, Supabase connections fall back to the legacy unverified mode (their certificate chain is not in Node's
 * store), which cannot detect a man-in-the-middle: a warning is logged. Set DATABASE_CA_CERT to close that gap.
 */
export function sslConfigFor(url: string, env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: boolean; ca?: string } {
  const hosted = url.includes('supabase.co') || url.includes('supabase.com');
  const ca = env.DATABASE_CA_CERT?.trim();
  if (ca) return { rejectUnauthorized: true, ca };
  if (!hosted) return false;
  console.warn('[athena-backend] database TLS certificate is not verified; set DATABASE_CA_CERT to enable verification');
  return { rejectUnauthorized: false };
}

export const db = new Pool({
  connectionString,
  ssl: sslConfigFor(connectionString),
});

export async function ensureAuthSchema(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS supabase_user_id TEXT UNIQUE;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_users_supabase_user_id
    ON users(supabase_user_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_token_hash TEXT UNIQUE NOT NULL,
      refresh_token_hash TEXT UNIQUE NOT NULL,
      access_expires_at TIMESTAMPTZ NOT NULL,
      refresh_expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_refresh_hash ON auth_sessions(refresh_token_hash);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scans (
      id BIGSERIAL PRIMARY KEY,
      scan_id TEXT UNIQUE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      repo_name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      ai_percentage INTEGER NOT NULL,
      flagged_units INTEGER NOT NULL,
      files_scanned INTEGER NOT NULL,
      total_units INTEGER NOT NULL,
      findings JSONB NOT NULL,
      risk_density JSONB NOT NULL,
      duration INTEGER NOT NULL
    );
  `);

  await db.query(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_provenance JSONB;`);
  await db.query(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS coverage JSONB;`);
  // What the user's own AI key did on this scan (mode, model, spend). Never the key.
  await db.query(`ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_summary JSONB;`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_scans_user_created_at ON scans(user_id, created_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scan_findings (
      id BIGSERIAL PRIMARY KEY,
      finding_id TEXT,
      scan_id TEXT NOT NULL REFERENCES scans(scan_id) ON DELETE CASCADE,
      severity TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      file TEXT NOT NULL,
      line INTEGER NOT NULL,
      "column" INTEGER NOT NULL,
      source TEXT NOT NULL,
      ai_score INTEGER NOT NULL,
      code TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      top_signals JSONB NOT NULL
    );
  `);

  // Offline-verification results (additive columns).
  await db.query(`ALTER TABLE scan_findings ADD COLUMN IF NOT EXISTS confidence TEXT;`);
  await db.query(`ALTER TABLE scan_findings ADD COLUMN IF NOT EXISTS evidence JSONB;`);
  await db.query(`ALTER TABLE scan_findings ADD COLUMN IF NOT EXISTS trace JSONB;`);
  await db.query(`ALTER TABLE scan_findings ADD COLUMN IF NOT EXISTS exposure TEXT;`);
  await db.query(`ALTER TABLE scan_findings ADD COLUMN IF NOT EXISTS ai_verdict JSONB;`);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_scan_findings_scan_id ON scan_findings(scan_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_scan_findings_scan_id_severity ON scan_findings(scan_id, severity);
  `);

  await db.query(`
    ALTER TABLE scan_findings
    ADD COLUMN IF NOT EXISTS finding_id TEXT;
  `);

  await db.query(`
    UPDATE scan_findings
    SET finding_id = id::text
    WHERE finding_id IS NULL;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scan_terminal_lines (
      id BIGSERIAL PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(scan_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (scan_id, seq)
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_scan_terminal_lines_scan_created_at
    ON scan_terminal_lines(scan_id, created_at);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scan_reports (
      scan_id TEXT PRIMARY KEY REFERENCES scans(scan_id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      markdown TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_scan_reports_user_created_at
    ON scan_reports(user_id, created_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scan_inventories (
      scan_id TEXT PRIMARY KEY REFERENCES scans(scan_id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      inventory JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS scan_alerts (
      id BIGSERIAL PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(scan_id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      advisory_id TEXT NOT NULL,
      ecosystem TEXT NOT NULL,
      package_name TEXT NOT NULL,
      package_version TEXT NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      fixed_in TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (scan_id, advisory_id, package_name, package_version)
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_scan_alerts_user ON scan_alerts(user_id, created_at DESC);`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS job_locks (
      name TEXT PRIMARY KEY,
      locked_until TIMESTAMPTZ NOT NULL
    );
  `);

  // Enable Row Level Security (RLS) on all tables for Supabase security compliance.
  // Then create a permissive policy for the 'postgres' role so our backend
  // (which connects as postgres) can still read/write data.
  // Without these policies, RLS blocks ALL access — including the table owner on Supabase.
  const tables = [
    'users',
    'auth_sessions',
    'scans',
    'scan_findings',
    'scan_terminal_lines',
    'scan_reports',
    'scan_inventories',
    'scan_alerts',
    'job_locks'
  ];
  for (const table of tables) {
    await db.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE tablename = '${table}' AND policyname = 'backend_full_access'
        ) THEN
          EXECUTE format(
            'CREATE POLICY backend_full_access ON %I FOR ALL TO postgres USING (true) WITH CHECK (true)',
            '${table}'
          );
        END IF;
      END
      $$;
    `);
  }
}

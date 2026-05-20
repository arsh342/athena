import 'dotenv/config';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL ?? '';
console.log('CONNECTION:', connectionString.replace(/:[^:@]+@/, ':***@'));

const pool = new Pool({ connectionString });

async function diagnose() {
  const client = await pool.connect();
  try {
    // 1. What role are we?
    const roleResult = await client.query('SELECT current_user, current_setting($$role$$) AS role');
    console.log('\n1. CURRENT ROLE:', roleResult.rows[0]);

    // 2. Does the role have BYPASSRLS?
    const bypassResult = await client.query(`
      SELECT rolname, rolbypassrls, rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `);
    console.log('2. ROLE FLAGS:', bypassResult.rows[0]);

    // 3. Do tables exist?
    const tablesResult = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log('\n3. PUBLIC TABLES:', tablesResult.rows.map(r => r.tablename));

    // 4. Is RLS enabled?
    const rlsResult = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('users','scans','scan_findings','scan_reports','auth_sessions','scan_terminal_lines')
    `);
    console.log('\n4. RLS STATUS:');
    for (const row of rlsResult.rows) {
      console.log(`   ${row.relname}: rls=${row.relrowsecurity} force=${row.relforcerowsecurity}`);
    }

    // 5. What policies exist?
    const policiesResult = await client.query(`
      SELECT tablename, policyname, permissive, roles, cmd
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log('\n5. POLICIES:');
    for (const row of policiesResult.rows) {
      console.log(`   ${row.tablename}: ${row.policyname} (${row.cmd}) roles=${row.roles}`);
    }

    // 6. Test INSERT into users
    console.log('\n6. TEST INSERT:');
    try {
      await client.query('BEGIN');
      const insertResult = await client.query(`
        INSERT INTO users (email, password_hash)
        VALUES ('diagnose-test@test.com', 'test-hash')
        RETURNING id, email
      `);
      console.log('   INSERT result:', insertResult.rows[0]);

      // 7. Test SELECT
      const selectResult = await client.query(`
        SELECT id, email FROM users WHERE email = 'diagnose-test@test.com'
      `);
      console.log('   SELECT result:', selectResult.rows);

      // Rollback test data
      await client.query('ROLLBACK');
      console.log('   (rolled back test data)');
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('   INSERT/SELECT ERROR:', (err as Error).message);
    }

    // 7. Count existing data
    console.log('\n7. ROW COUNTS:');
    for (const table of ['users', 'scans', 'scan_findings', 'scan_reports', 'auth_sessions']) {
      const countResult = await client.query(`SELECT count(*) FROM ${table}`);
      console.log(`   ${table}: ${countResult.rows[0].count} rows`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

diagnose().catch((err) => {
  console.error('DIAGNOSE FAILED:', err);
  process.exit(1);
});

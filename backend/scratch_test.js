import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

async function main() {
  console.log("DB URL from env:", process.env.DATABASE_URL);
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set in env!");
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log("Success! Connected to database.");
    const res = await client.query("SELECT version();");
    console.log("Postgres version:", res.rows[0].version);
    
    // Check tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    console.log("Tables in public schema:", tablesRes.rows.map(r => r.table_name));

    // Check if RLS is enabled
    const rlsRes = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public';
    `);
    console.log("RLS Status:");
    console.table(rlsRes.rows);

    // Let's see if we have scans stored
    const scansCount = await client.query("SELECT count(*) FROM scans;");
    console.log("Scans count:", scansCount.rows[0].count);

    const usersCount = await client.query("SELECT count(*) FROM users;");
    console.log("Users count:", usersCount.rows[0].count);

  } catch (err) {
    console.error("Connection failed:", err);
  } finally {
    await client.end();
  }
}

main();

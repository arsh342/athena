import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

async function main() {
  console.log("DB URL from env:", process.env.DATABASE_URL);
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set in env!");
    process.exit(1);
  }

  // Exact same way db.ts connects (no SSL configured)
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log("Success! Connected to database without SSL.");
    const res = await client.query("SELECT version();");
    console.log("Postgres version:", res.rows[0].version);
  } catch (err) {
    console.error("Connection failed without SSL:", err);
  } finally {
    await client.end();
  }
}

main();

/**
 * init-db.js — Run once on start to guarantee tables exist in Render PostgreSQL
 */
require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL supplied, skipping DB init.");
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log("Running database initialization...");

  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS journal_entries (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL,
          mood       INTEGER NOT NULL,
          note       TEXT DEFAULT '',
          tags       JSONB DEFAULT '[]'::jsonb,
          created_at TEXT NOT NULL,
          synced_at  TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_entries_user ON journal_entries (user_id);`).catch(() => {});

      await client.query(`
        CREATE TABLE IF NOT EXISTS todos (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL,
          text       TEXT NOT NULL,
          completed  BOOLEAN DEFAULT FALSE,
          priority   TEXT DEFAULT 'medium',
          category   TEXT DEFAULT 'general',
          created_at TEXT NOT NULL,
          synced_at  TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_todos_user ON todos (user_id);`).catch(() => {});

      await client.query(`
        CREATE TABLE IF NOT EXISTS user_settings (
          user_id    TEXT PRIMARY KEY,
          privacy    BOOLEAN DEFAULT FALSE,
          tags       JSONB DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      console.log("✅ Database tables verified/created successfully!");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("⚠️ Init-db non-fatal warning:", err.message);
  } finally {
    await pool.end();
  }
}

main();

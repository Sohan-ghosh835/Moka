/**
 * Moka Journal — Cloud Sync Backend
 *
 * A lightweight Express API that persists journal entries, to-do tasks
 * and user settings in a Render-hosted PostgreSQL database.
 *
 * Environment variables (set in Render dashboard):
 *   DATABASE_URL  – Render PostgreSQL internal/external connection string
 *   PORT          – (optional, Render sets this automatically)
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ─── Database Pool ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

let tablesEnsured = false;

// ─── Database Table Creation Helper ───────────────────────────────────────────
async function ensureTables() {
  if (tablesEnsured) return;
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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_entries (user_id);`).catch(() => {});

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

    tablesEnsured = true;
    console.log("Database tables verified/created successfully.");
  } catch (err) {
    console.error("Failed to initialize database tables:", err);
    throw err;
  } finally {
    client.release();
  }
}

async function initDbWithRetry(retries = 5, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await ensureTables();
      return;
    } catch (err) {
      console.warn(`Database connection attempt ${i + 1}/${retries} failed. Retrying in ${delay}ms...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  console.error("Could not connect to database after multiple retries.");
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", tablesEnsured, timestamp: new Date().toISOString() });
});

// ─── Manual Table Initializer Route ───────────────────────────────────────────
app.get("/api/init-db", async (_req, res) => {
  try {
    tablesEnsured = false;
    await ensureTables();
    res.json({ success: true, message: "Database tables initialized successfully" });
  } catch (err) {
    console.error("Manual init-db error:", err);
    res.status(500).json({ error: "Failed to initialize database tables", details: err.message });
  }
});

// ─── POST /api/sync ───────────────────────────────────────────────────────────
// Accepts { userId, entries[], todos[], privacy, tags[] } from the client.
// Upserts every entry/todo and saves user-level settings atomically.
app.post("/api/sync", async (req, res) => {
  const { userId, entries, todos, privacy, tags } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  try {
    await ensureTables();
  } catch (e) {}

  const performSync = async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (Array.isArray(entries)) {
        for (const e of entries) {
          if (!e || !e.id) continue;
          await client.query(
            `INSERT INTO journal_entries (id, user_id, mood, note, tags, created_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)
             ON CONFLICT (id) DO UPDATE SET
               mood       = EXCLUDED.mood,
               note       = EXCLUDED.note,
               tags       = EXCLUDED.tags,
               synced_at  = NOW()`,
            [e.id, userId, e.mood, e.note || "", JSON.stringify(e.tags || []), e.createdAt]
          );
        }
      }

      if (Array.isArray(todos)) {
        for (const t of todos) {
          if (!t || !t.id) continue;
          await client.query(
            `INSERT INTO todos (id, user_id, text, completed, priority, category, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
               text       = EXCLUDED.text,
               completed  = EXCLUDED.completed,
               priority   = EXCLUDED.priority,
               category   = EXCLUDED.category,
               synced_at  = NOW()`,
            [t.id, userId, t.text, Boolean(t.completed), t.priority || "medium", t.category || "general", t.createdAt]
          );
        }
      }

      await client.query(
        `INSERT INTO user_settings (user_id, privacy, tags)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET
           privacy    = EXCLUDED.privacy,
           tags       = EXCLUDED.tags,
           updated_at = NOW()`,
        [userId, !!privacy, JSON.stringify(tags || [])]
      );

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  };

  try {
    await performSync();
    res.json({ success: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    if (err && err.code === "42P01") {
      console.warn("Table missing (42P01) on sync. Resetting table guard and retrying...");
      tablesEnsured = false;
      try {
        await ensureTables();
        await performSync();
        return res.json({ success: true, syncedAt: new Date().toISOString() });
      } catch (retryErr) {
        console.error("Retry sync failed:", retryErr);
      }
    }
    console.error("Sync error:", err);
    res.status(500).json({ error: "Sync failed" });
  }
});

// ─── GET /api/data/:userId ────────────────────────────────────────────────────
// Returns all cloud-stored data for a given anonymous user ID.
app.get("/api/data/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    await ensureTables();
  } catch (e) {}

  const performFetch = async () => {
    const [entriesResult, todosResult, settingsResult] = await Promise.all([
      pool.query(
        `SELECT id, mood, note, tags, created_at AS "createdAt"
         FROM journal_entries WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT id, text, completed, priority, category, created_at AS "createdAt"
         FROM todos WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      ),
      pool.query(
        `SELECT privacy, tags FROM user_settings WHERE user_id = $1`,
        [userId]
      ),
    ]);

    const settings = settingsResult.rows[0] || { privacy: false, tags: [] };

    return {
      entries: entriesResult.rows.map((row) => ({
        ...row,
        tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
      })),
      todos: todosResult.rows,
      privacy: settings.privacy,
      tags: typeof settings.tags === "string" ? JSON.parse(settings.tags) : settings.tags,
    };
  };

  try {
    const data = await performFetch();
    res.json(data);
  } catch (err) {
    if (err && err.code === "42P01") {
      console.warn("Table missing (42P01) on data fetch. Resetting table guard and retrying...");
      tablesEnsured = false;
      try {
        await ensureTables();
        const data = await performFetch();
        return res.json(data);
      } catch (retryErr) {
        console.error("Retry data fetch failed:", retryErr);
      }
    }
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
initDbWithRetry().then(() => {
  app.listen(PORT, () => {
    console.log(`Moka sync backend listening on port ${PORT}`);
  });
});

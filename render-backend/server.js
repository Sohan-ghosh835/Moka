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

// ─── Database ─────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── POST /api/sync ───────────────────────────────────────────────────────────
// Accepts { userId, entries[], todos[], privacy, tags[] } from the client.
// Upserts every entry/todo and saves user-level settings atomically.
app.post("/api/sync", async (req, res) => {
  const { userId, entries, todos, privacy, tags } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Upsert journal entries
    if (Array.isArray(entries)) {
      for (const e of entries) {
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

    // Upsert to-do tasks
    if (Array.isArray(todos)) {
      for (const t of todos) {
        await client.query(
          `INSERT INTO todos (id, user_id, text, completed, priority, category, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             text       = EXCLUDED.text,
             completed  = EXCLUDED.completed,
             priority   = EXCLUDED.priority,
             category   = EXCLUDED.category,
             synced_at  = NOW()`,
          [t.id, userId, t.text, t.completed, t.priority || "medium", t.category || "general", t.createdAt]
        );
      }
    }

    // Upsert user settings (privacy mode, tag palette)
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
    res.json({ success: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Sync error:", err);
    res.status(500).json({ error: "Sync failed" });
  } finally {
    client.release();
  }
});

// ─── GET /api/data/:userId ────────────────────────────────────────────────────
// Returns all cloud-stored data for a given anonymous user ID.
app.get("/api/data/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
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

    res.json({
      entries: entriesResult.rows.map((row) => ({
        ...row,
        tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
      })),
      todos: todosResult.rows,
      privacy: settings.privacy,
      tags: typeof settings.tags === "string" ? JSON.parse(settings.tags) : settings.tags,
    });
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Moka sync backend listening on port ${PORT}`);
});

-- Moka Journal Cloud Sync Schema
-- Run this against your Render PostgreSQL database to initialise tables.

CREATE TABLE IF NOT EXISTS journal_entries (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  mood         INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
  note         TEXT NOT NULL DEFAULT '',
  tags         JSONB DEFAULT '[]'::jsonb,
  created_at   TEXT NOT NULL,
  synced_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS todos (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  text         TEXT NOT NULL,
  completed    BOOLEAN NOT NULL DEFAULT false,
  priority     TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  category     TEXT DEFAULT 'general',
  created_at   TEXT NOT NULL,
  synced_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id      TEXT PRIMARY KEY,
  privacy      BOOLEAN NOT NULL DEFAULT false,
  tags         JSONB DEFAULT '[]'::jsonb,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS idx_entries_user ON journal_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_todos_user   ON todos (user_id);

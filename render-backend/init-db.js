/**
 * init-db.js — Run once to create tables in Render PostgreSQL
 *
 * Usage:
 *   DATABASE_URL=<your-render-pg-url> node init-db.js
 */
require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  console.log("Running schema.sql against the database...");

  try {
    await pool.query(schema);
    console.log("✅ Database tables created successfully!");
  } catch (err) {
    console.error("❌ Error creating tables:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { SQLITE_PATH } = require("./config");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  api_key_prefix TEXT NOT NULL,
  sms_quota INTEGER NOT NULL DEFAULT 0,
  otp_length INTEGER NOT NULL DEFAULT 4,
  brand_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

let db = null;

function isMemoryPath(dbPath) {
  return dbPath === ":memory:";
}

function openDb(dbPath = SQLITE_PATH) {
  closeDb();
  if (!isMemoryPath(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  db = new Database(dbPath);
  if (!isMemoryPath(dbPath)) {
    db.pragma("journal_mode = WAL");
  }
  db.exec(SCHEMA);
  return db;
}

function getDb() {
  if (!db) {
    openDb();
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, openDb, closeDb };

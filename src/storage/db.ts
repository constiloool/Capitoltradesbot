import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

let database: DatabaseSync | undefined;

export function getDatabase(): DatabaseSync {
  if (!database) {
    mkdirSync(path.dirname(config.databasePath), { recursive: true });
    database = new DatabaseSync(config.databasePath);
    database.exec("PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;");
  }
  return database;
}

export function initializeDatabase(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      politician_name TEXT NOT NULL,
      politician_party TEXT,
      politician_chamber TEXT,
      politician_state TEXT,
      issuer_name TEXT NOT NULL,
      ticker TEXT,
      raw_ticker TEXT,
      published_at_raw TEXT NOT NULL,
      traded_at_raw TEXT NOT NULL,
      filed_after_raw TEXT,
      owner TEXT,
      transaction_type TEXT NOT NULL,
      size_raw TEXT,
      size_min REAL,
      size_max REAL,
      price_raw TEXT,
      price REAL,
      detail_url TEXT,
      source_url TEXT NOT NULL,
      scraped_at TEXT NOT NULL,
      raw_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_trades_scraped_at ON trades(scraped_at);
    CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);
  `);
}

export function closeDatabase(): void {
  database?.close();
  database = undefined;
}

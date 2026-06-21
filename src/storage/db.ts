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
  const db = getDatabase();
  const existingTradeColumns = db
    .prepare("PRAGMA table_info(trades)")
    .all() as Array<{ name: string }>;
  if (
    existingTradeColumns.length > 0 &&
    !existingTradeColumns.some((column) => column.name === "filing_id")
  ) {
    db.exec(`
      ALTER TABLE trades RENAME TO legacy_capitol_trades;
      DROP INDEX IF EXISTS idx_trades_scraped_at;
      DROP INDEX IF EXISTS idx_trades_ticker;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS filings (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('house', 'senate')),
      source_filing_id TEXT NOT NULL,
      politician_name TEXT NOT NULL,
      chamber TEXT NOT NULL,
      filing_type TEXT NOT NULL,
      filing_date TEXT NOT NULL,
      document_url TEXT NOT NULL,
      document_kind TEXT NOT NULL,
      document_hash TEXT,
      raw_pdf_path TEXT,
      parse_status TEXT NOT NULL CHECK(parse_status IN ('pending', 'parsed', 'failed')),
      parse_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, source_filing_id)
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      filing_id TEXT NOT NULL REFERENCES filings(id),
      source TEXT NOT NULL,
      politician_name TEXT NOT NULL,
      chamber TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      filing_date TEXT NOT NULL,
      ticker TEXT,
      asset_name TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_range TEXT NOT NULL,
      owner TEXT,
      raw_text TEXT,
      source_url TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_filings_status ON filings(parse_status);
    CREATE INDEX IF NOT EXISTS idx_filings_date ON filings(filing_date);
    CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
    CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);
  `);
}

export function closeDatabase(): void {
  database?.close();
  database = undefined;
}

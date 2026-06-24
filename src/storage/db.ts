import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

let database: DatabaseSync | undefined;

export function getDatabase(): DatabaseSync {
  if (!database) {
    mkdirSync(path.dirname(config.databasePath), { recursive: true });
    database = new DatabaseSync(config.databasePath);
    database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;",
    );
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
      created_at TEXT NOT NULL,
      strategy_processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_filings_status ON filings(parse_status);
    CREATE INDEX IF NOT EXISTS idx_filings_date ON filings(filing_date);
    CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
    CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);
    CREATE TABLE IF NOT EXISTS bot_positions (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      entry_price REAL NOT NULL,
      quantity REAL NOT NULL,
      notional_value REAL NOT NULL,
      politician_name TEXT NOT NULL,
      politician_names TEXT NOT NULL,
      source_trade_id TEXT NOT NULL,
      disclosure_id TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      filing_date TEXT NOT NULL,
      signal_count INTEGER NOT NULL,
      last_signal_date TEXT NOT NULL,
      cluster_signal INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'CLOSED')),
      execution_mode TEXT NOT NULL DEFAULT 'SIMULATED'
        CHECK(execution_mode IN ('SIMULATED', 'PAPER')),
      exit_reason TEXT,
      alpaca_order_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_positions_open_ticker
      ON bot_positions(ticker) WHERE status = 'OPEN';
    CREATE TABLE IF NOT EXISTS bot_position_signals (
      position_id TEXT NOT NULL REFERENCES bot_positions(id),
      trade_id TEXT NOT NULL REFERENCES trades(id),
      politician_name TEXT NOT NULL,
      signal_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(position_id, trade_id)
    );
    CREATE TABLE IF NOT EXISTS trade_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL,
      ticker TEXT,
      politician_name TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      filing_date TEXT NOT NULL,
      effective_trade_date TEXT,
      trade_date_source TEXT,
      trade_age_days INTEGER,
      action TEXT NOT NULL,
      value_range TEXT NOT NULL,
      politician_score REAL NOT NULL,
      value_score REAL NOT NULL,
      current_price REAL,
      reference_price REAL,
      runup_pct REAL,
      account_equity REAL,
      calculated_position_size REAL,
      final_position_size REAL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      alpaca_order_id TEXT,
      safe_mode INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trade_decisions_trade_id
      ON trade_decisions(trade_id);
    CREATE INDEX IF NOT EXISTS idx_trade_decisions_created_at
      ON trade_decisions(created_at);
    CREATE TABLE IF NOT EXISTS pending_orders (
      id TEXT PRIMARY KEY,
      trade_id TEXT NOT NULL UNIQUE REFERENCES trades(id),
      ticker TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'EXECUTED', 'SKIPPED')),
      reason TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      executed_at TEXT,
      alpaca_order_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_orders_status
      ON pending_orders(status);
  `);
  const positionColumns = db
    .prepare("PRAGMA table_info(bot_positions)")
    .all() as Array<{ name: string }>;
  if (
    positionColumns.length > 0 &&
    !positionColumns.some((column) => column.name === "execution_mode")
  ) {
    db.exec(
      "ALTER TABLE bot_positions ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'SIMULATED'",
    );
  }
  const tradeColumns = db
    .prepare("PRAGMA table_info(trades)")
    .all() as Array<{ name: string }>;
  if (
    tradeColumns.length > 0 &&
    !tradeColumns.some((column) => column.name === "strategy_processed_at")
  ) {
    db.exec("ALTER TABLE trades ADD COLUMN strategy_processed_at TEXT");
  }
  const decisionColumns = db
    .prepare("PRAGMA table_info(trade_decisions)")
    .all() as Array<{ name: string }>;
  if (
    decisionColumns.length > 0 &&
    !decisionColumns.some((column) => column.name === "effective_trade_date")
  ) {
    db.exec(
      "ALTER TABLE trade_decisions ADD COLUMN effective_trade_date TEXT",
    );
  }
  if (
    decisionColumns.length > 0 &&
    !decisionColumns.some((column) => column.name === "trade_date_source")
  ) {
    db.exec("ALTER TABLE trade_decisions ADD COLUMN trade_date_source TEXT");
  }
  if (
    decisionColumns.length > 0 &&
    !decisionColumns.some((column) => column.name === "trade_age_days")
  ) {
    db.exec("ALTER TABLE trade_decisions ADD COLUMN trade_age_days INTEGER");
  }
}

export function closeDatabase(): void {
  database?.close();
  database = undefined;
}

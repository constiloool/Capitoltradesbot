import { createHash } from "node:crypto";
import type {
  DisclosureTrade,
  DisclosureTradeDraft,
} from "../types/disclosure.js";
import { cleanText } from "../utils/normalize.js";
import { getDatabase } from "./db.js";

export function createDisclosureDedupeKey(
  trade: DisclosureTradeDraft,
): string {
  const identity = [
    trade.source,
    trade.sourceFilingId,
    trade.politicianName,
    trade.transactionDate,
    trade.ticker || "",
    trade.assetName,
    trade.transactionType,
    trade.amountRange,
    trade.owner || "",
  ]
    .map((value) => cleanText(value).toLowerCase())
    .join("|");
  return createHash("sha256").update(identity).digest("hex");
}

export function insertDisclosureTrades(
  drafts: DisclosureTradeDraft[],
): { inserted: DisclosureTrade[]; duplicates: number } {
  const db = getDatabase();
  const statement = db.prepare(
    `INSERT OR IGNORE INTO trades (
      id, filing_id, source, politician_name, chamber, transaction_date,
      filing_date, ticker, asset_name, transaction_type, amount_range, owner,
      raw_text, source_url, dedupe_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const inserted: DisclosureTrade[] = [];
  let duplicates = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const draft of drafts) {
      const dedupeKey = createDisclosureDedupeKey(draft);
      const normalized: DisclosureTrade = {
        ...draft,
        id: dedupeKey,
        dedupeKey,
        createdAt: new Date().toISOString(),
      };
      const result = statement.run(
        normalized.id,
        normalized.filingId,
        normalized.source,
        normalized.politicianName,
        normalized.chamber,
        normalized.transactionDate,
        normalized.filingDate,
        normalized.ticker ?? null,
        normalized.assetName,
        normalized.transactionType,
        normalized.amountRange,
        normalized.owner ?? null,
        normalized.rawText ?? null,
        normalized.sourceUrl,
        normalized.dedupeKey,
        normalized.createdAt,
      );
      if (result.changes === 1) inserted.push(normalized);
      else duplicates += 1;
    }
    db.exec("COMMIT");
    return { inserted, duplicates };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function countDisclosureTrades(): number {
  return (
    getDatabase().prepare("SELECT COUNT(*) AS count FROM trades").get() as {
      count: number;
    }
  ).count;
}

type TradeRow = {
  id: string;
  filing_id: string;
  source: "house" | "senate";
  source_filing_id: string;
  politician_name: string;
  chamber: "House" | "Senate";
  transaction_date: string;
  filing_date: string;
  ticker?: string;
  asset_name: string;
  transaction_type: "purchase" | "sale" | "exchange" | "other";
  amount_range: string;
  owner?: string;
  raw_text?: string;
  source_url: string;
  dedupe_key: string;
  created_at: string;
};

export function listUnprocessedTrades(limit = 5_000): DisclosureTrade[] {
  const rows = getDatabase()
    .prepare(
      `SELECT trades.*, filings.source_filing_id
       FROM trades JOIN filings ON filings.id = trades.filing_id
       WHERE trades.strategy_processed_at IS NULL
       ORDER BY trades.created_at ASC LIMIT ?`,
    )
    .all(limit) as TradeRow[];
  return rows.map((row) => ({
    id: row.id,
    filingId: row.filing_id,
    source: row.source,
    sourceFilingId: row.source_filing_id,
    politicianName: row.politician_name,
    chamber: row.chamber,
    transactionDate: row.transaction_date,
    filingDate: row.filing_date,
    ticker: row.ticker,
    assetName: row.asset_name,
    transactionType: row.transaction_type,
    amountRange: row.amount_range,
    owner: row.owner,
    rawText: row.raw_text,
    sourceUrl: row.source_url,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
  }));
}

export function markTradeStrategyProcessed(id: string): void {
  getDatabase()
    .prepare("UPDATE trades SET strategy_processed_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function getDisclosureTrade(id: string): DisclosureTrade | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT trades.*, filings.source_filing_id
       FROM trades JOIN filings ON filings.id = trades.filing_id
       WHERE trades.id = ?`,
    )
    .get(id) as TradeRow | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    filingId: row.filing_id,
    source: row.source,
    sourceFilingId: row.source_filing_id,
    politicianName: row.politician_name,
    chamber: row.chamber,
    transactionDate: row.transaction_date,
    filingDate: row.filing_date,
    ticker: row.ticker,
    assetName: row.asset_name,
    transactionType: row.transaction_type,
    amountRange: row.amount_range,
    owner: row.owner,
    rawText: row.raw_text,
    sourceUrl: row.source_url,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
  };
}

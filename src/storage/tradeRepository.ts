import type { CapitolTrade } from "../types/trade.js";
import { getDatabase } from "./db.js";

const INSERT_SQL = `
  INSERT OR IGNORE INTO trades (
    id, politician_name, politician_party, politician_chamber, politician_state,
    issuer_name, ticker, raw_ticker, published_at_raw, traded_at_raw,
    filed_after_raw, owner, transaction_type, size_raw, size_min, size_max,
    price_raw, price, detail_url, source_url, scraped_at, raw_json
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`;

export function insertNewTrades(trades: CapitolTrade[]): CapitolTrade[] {
  const db = getDatabase();
  const insert = db.prepare(INSERT_SQL);
  const inserted: CapitolTrade[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const trade of trades) {
      const result = insert.run(
        trade.id,
        trade.politicianName,
        trade.politicianParty ?? null,
        trade.politicianChamber ?? null,
        trade.politicianState ?? null,
        trade.issuerName,
        trade.ticker ?? null,
        trade.rawTicker ?? null,
        trade.publishedAtRaw,
        trade.tradedAtRaw,
        trade.filedAfterRaw ?? null,
        trade.owner ?? null,
        trade.transactionType,
        trade.sizeRaw ?? null,
        trade.sizeMin ?? null,
        trade.sizeMax ?? null,
        trade.priceRaw ?? null,
        trade.price ?? null,
        trade.detailUrl ?? null,
        trade.sourceUrl,
        trade.scrapedAt,
        trade.rawJson ?? null,
      );
      if (result.changes === 1) inserted.push(trade);
    }
    db.exec("COMMIT");
    return inserted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function countTrades(): number {
  const row = getDatabase()
    .prepare("SELECT COUNT(*) AS count FROM trades")
    .get() as { count: number };
  return row.count;
}

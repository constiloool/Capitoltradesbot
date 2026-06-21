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
    trade.ticker || trade.assetName,
    trade.transactionType,
    trade.amountRange,
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

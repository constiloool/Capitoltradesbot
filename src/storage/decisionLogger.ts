import type { TradeDecisionLog } from "../types/trading.js";
import { logger } from "../utils/logger.js";
import { getDatabase } from "./db.js";

export function logTradeDecision(decision: TradeDecisionLog): void {
  getDatabase()
    .prepare(
      `INSERT INTO trade_decisions (
        trade_id, ticker, politician_name, transaction_date, filing_date,
        action, value_range, politician_score, value_score, current_price,
        reference_price, runup_pct, account_equity, calculated_position_size,
        final_position_size, decision, reason, alpaca_order_id, safe_mode,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      decision.tradeId,
      decision.ticker ?? null,
      decision.politicianName,
      decision.transactionDate,
      decision.filingDate,
      decision.action,
      decision.valueRange,
      decision.politicianScore,
      decision.valueScore,
      decision.currentPrice ?? null,
      decision.referencePrice ?? null,
      decision.runupPct ?? null,
      decision.accountEquity ?? null,
      decision.calculatedPositionSize ?? null,
      decision.finalPositionSize ?? null,
      decision.decision,
      decision.reason,
      decision.alpacaOrderId ?? null,
      decision.safeMode ? 1 : 0,
      decision.createdAt,
    );
  logger.info("DECISION", decision.decision, {
    ticker: decision.ticker,
    politician: decision.politicianName,
    reason: decision.reason,
  });
}

export function getDecisionSummary(since: string): {
  buyCandidates: number;
  skippedAge: number;
  skippedAction: number;
  skippedMissingTicker: number;
  skippedRunup: number;
  simulatedBuys: number;
} {
  const rows = getDatabase()
    .prepare(
      `SELECT decision, reason, safe_mode, COUNT(*) AS count
       FROM trade_decisions WHERE created_at >= ?
       GROUP BY decision, reason, safe_mode`,
    )
    .all(since) as Array<{
    decision: string;
    reason: string;
    safe_mode: number;
    count: number;
  }>;
  const count = (predicate: (row: (typeof rows)[number]) => boolean) =>
    rows.filter(predicate).reduce((sum, row) => sum + row.count, 0);
  return {
    buyCandidates: count((row) =>
      ["BUY", "PENDING"].includes(row.decision),
    ),
    skippedAge: count((row) =>
      row.reason.includes("older than MAX_TRADE_AGE_DAYS"),
    ),
    skippedAction: count(
      (row) => row.reason === "Transaction action is not BUY/PURCHASE",
    ),
    skippedMissingTicker: count(
      (row) => row.reason === "Skipped because ticker is missing",
    ),
    skippedRunup: count((row) =>
      row.reason.includes("ran up more than MAX_RUNUP_PCT"),
    ),
    simulatedBuys: count(
      (row) => row.decision === "BUY" && row.safe_mode === 1,
    ),
  };
}

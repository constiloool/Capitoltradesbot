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

import { randomUUID } from "node:crypto";
import type {
  PendingOrder,
  PendingOrderStatus,
} from "../types/trading.js";
import { getDatabase } from "./db.js";

type PendingRow = {
  id: string;
  trade_id: string;
  ticker: string;
  status: PendingOrderStatus;
  reason: string;
  attempts: number;
  last_checked_at?: string;
  executed_at?: string;
  alpaca_order_id?: string;
  created_at: string;
  updated_at: string;
};

function fromRow(row: PendingRow): PendingOrder {
  return {
    id: row.id,
    tradeId: row.trade_id,
    ticker: row.ticker,
    status: row.status,
    reason: row.reason,
    attempts: row.attempts,
    lastCheckedAt: row.last_checked_at,
    executedAt: row.executed_at,
    alpacaOrderId: row.alpaca_order_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPendingOrder(
  tradeId: string,
  ticker: string,
  reason: string,
): PendingOrder {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO pending_orders (
        id, trade_id, ticker, status, reason, created_at, updated_at
      ) VALUES (?, ?, ?, 'PENDING', ?, ?, ?)
      ON CONFLICT(trade_id) DO UPDATE SET
        status = 'PENDING', reason = excluded.reason, updated_at = excluded.updated_at`,
    )
    .run(randomUUID(), tradeId, ticker, reason, now, now);
  const row = getDatabase()
    .prepare("SELECT * FROM pending_orders WHERE trade_id = ?")
    .get(tradeId) as PendingRow;
  return fromRow(row);
}

export function listPendingOrders(): PendingOrder[] {
  return (
    getDatabase()
      .prepare(
        "SELECT * FROM pending_orders WHERE status = 'PENDING' ORDER BY created_at",
      )
      .all() as PendingRow[]
  ).map(fromRow);
}

export function updatePendingOrder(
  id: string,
  status: PendingOrderStatus,
  reason: string,
  alpacaOrderId?: string,
): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE pending_orders SET status = ?, reason = ?, attempts = attempts + 1,
       last_checked_at = ?, executed_at = CASE WHEN ? = 'EXECUTED' THEN ? ELSE executed_at END,
       alpaca_order_id = COALESCE(?, alpaca_order_id), updated_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      reason,
      now,
      status,
      now,
      alpacaOrderId ?? null,
      now,
      id,
    );
}

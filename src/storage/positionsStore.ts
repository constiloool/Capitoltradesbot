import { randomUUID } from "node:crypto";
import type {
  BotPosition,
  PositionExitReason,
} from "../types/trading.js";
import { getDatabase } from "./db.js";

type PositionRow = {
  id: string;
  ticker: string;
  entry_date: string;
  entry_price: number;
  quantity: number;
  notional_value: number;
  politician_name: string;
  politician_names: string;
  source_trade_id: string;
  disclosure_id: string;
  transaction_date: string;
  filing_date: string;
  signal_count: number;
  last_signal_date: string;
  cluster_signal: number;
  status: "OPEN" | "CLOSED";
  execution_mode: "SIMULATED" | "PAPER";
  exit_reason?: PositionExitReason;
  alpaca_order_id?: string;
  created_at: string;
  updated_at: string;
};

function fromRow(row: PositionRow): BotPosition {
  return {
    id: row.id,
    ticker: row.ticker,
    entryDate: row.entry_date,
    entryPrice: row.entry_price,
    quantity: row.quantity,
    notionalValue: row.notional_value,
    politicianName: row.politician_name,
    politicianNames: JSON.parse(row.politician_names) as string[],
    sourceTradeId: row.source_trade_id,
    disclosureId: row.disclosure_id,
    transactionDate: row.transaction_date,
    filingDate: row.filing_date,
    signalCount: row.signal_count,
    lastSignalDate: row.last_signal_date,
    clusterSignal: Boolean(row.cluster_signal),
    status: row.status,
    executionMode: row.execution_mode,
    exitReason: row.exit_reason,
    alpacaOrderId: row.alpaca_order_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function findOpenPosition(ticker: string): BotPosition | undefined {
  const row = getDatabase()
    .prepare("SELECT * FROM bot_positions WHERE ticker = ? AND status = 'OPEN'")
    .get(ticker) as PositionRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listOpenPositions(): BotPosition[] {
  return (
    getDatabase()
      .prepare("SELECT * FROM bot_positions WHERE status = 'OPEN'")
      .all() as PositionRow[]
  ).map(fromRow);
}

export function totalOpenExposure(): number {
  const row = getDatabase()
    .prepare(
      "SELECT COALESCE(SUM(notional_value), 0) AS exposure FROM bot_positions WHERE status = 'OPEN'",
    )
    .get() as { exposure: number };
  return row.exposure;
}

export function createOpenPosition(input: {
  ticker: string;
  entryPrice: number;
  quantity: number;
  notionalValue: number;
  politicianName: string;
  sourceTradeId: string;
  disclosureId: string;
  transactionDate: string;
  filingDate: string;
  alpacaOrderId?: string;
  executionMode: "SIMULATED" | "PAPER";
}): BotPosition {
  const now = new Date().toISOString();
  const position: BotPosition = {
    id: randomUUID(),
    ticker: input.ticker,
    entryDate: now.slice(0, 10),
    entryPrice: input.entryPrice,
    quantity: input.quantity,
    notionalValue: input.notionalValue,
    politicianName: input.politicianName,
    politicianNames: [input.politicianName],
    sourceTradeId: input.sourceTradeId,
    disclosureId: input.disclosureId,
    transactionDate: input.transactionDate,
    filingDate: input.filingDate,
    signalCount: 1,
    lastSignalDate: input.transactionDate,
    clusterSignal: false,
    status: "OPEN",
    executionMode: input.executionMode,
    alpacaOrderId: input.alpacaOrderId,
    createdAt: now,
    updatedAt: now,
  };
  getDatabase()
    .prepare(
      `INSERT INTO bot_positions (
        id, ticker, entry_date, entry_price, quantity, notional_value,
        politician_name, politician_names, source_trade_id, disclosure_id,
        transaction_date, filing_date, signal_count, last_signal_date,
        cluster_signal, status, execution_mode, alpaca_order_id, created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    )
    .run(
      position.id,
      position.ticker,
      position.entryDate,
      position.entryPrice,
      position.quantity,
      position.notionalValue,
      position.politicianName,
      JSON.stringify(position.politicianNames),
      position.sourceTradeId,
      position.disclosureId,
      position.transactionDate,
      position.filingDate,
      position.signalCount,
      position.lastSignalDate,
      0,
      position.executionMode,
      position.alpacaOrderId ?? null,
      now,
      now,
    );
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO bot_position_signals (
        position_id, trade_id, politician_name, signal_date, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      position.id,
      position.sourceTradeId,
      position.politicianName,
      position.transactionDate,
      now,
    );
  return position;
}

export function addSignalToPosition(
  position: BotPosition,
  tradeId: string,
  politicianName: string,
  signalDate: string,
): BotPosition {
  const names = [...new Set([...position.politicianNames, politicianName])];
  const signalCount = position.signalCount + 1;
  const windowStart = new Date(
    new Date(`${signalDate}T00:00:00Z`).getTime() - 7 * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO bot_position_signals (
        position_id, trade_id, politician_name, signal_date, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(position.id, tradeId, politicianName, signalDate, now);
  const clusterCount = (
    getDatabase()
      .prepare(
        `SELECT COUNT(DISTINCT politician_name) AS count
         FROM bot_position_signals
         WHERE position_id = ? AND signal_date >= ? AND signal_date <= ?`,
      )
      .get(position.id, windowStart, signalDate) as { count: number }
  ).count;
  const clusterSignal = position.clusterSignal || clusterCount >= 3;
  getDatabase()
    .prepare(
      `UPDATE bot_positions SET politician_names = ?, signal_count = ?,
       last_signal_date = ?, cluster_signal = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      JSON.stringify(names),
      signalCount,
      signalDate,
      clusterSignal ? 1 : 0,
      now,
      position.id,
    );
  return {
    ...position,
    politicianNames: names,
    signalCount,
    lastSignalDate: signalDate,
    clusterSignal,
    updatedAt: now,
  };
}

export function closePosition(
  id: string,
  reason: PositionExitReason,
  alpacaOrderId?: string,
): void {
  getDatabase()
    .prepare(
      `UPDATE bot_positions SET status = 'CLOSED', exit_reason = ?,
       alpaca_order_id = COALESCE(?, alpaca_order_id), updated_at = ?
       WHERE id = ?`,
    )
    .run(reason, alpacaOrderId ?? null, new Date().toISOString(), id);
}

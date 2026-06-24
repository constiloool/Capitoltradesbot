import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  getMarketClock,
  getPaperAccount,
  getPortfolioHistory,
  getPositions,
} from "../alpaca/alpacaClient.js";
import { config } from "../config.js";
import { getDatabase, initializeDatabase } from "../storage/db.js";
import { logger } from "../utils/logger.js";

type DecisionRow = {
  transaction_date: string;
  politician_name: string;
  ticker: string | null;
  asset_name: string | null;
  action: string;
  reason: string;
  final_position_size: number | null;
  decision: string;
  alpaca_order_id: string | null;
  created_at: string;
};

type PositionRow = {
  ticker: string;
  politician_name: string;
  transaction_date: string;
  notional_value: number;
  status: string;
  execution_mode: string;
  alpaca_order_id: string | null;
  created_at: string;
};

function writeJson(directory: string, filename: string, value: unknown): void {
  writeFileSync(
    path.join(directory, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function signalAge(transactionDate: string, createdAt: string): string {
  const transaction = new Date(`${transactionDate}T00:00:00Z`).getTime();
  const decision = new Date(createdAt).getTime();
  const days = Math.max(0, Math.floor((decision - transaction) / 86_400_000));
  return `${days} day${days === 1 ? "" : "s"}`;
}

function displaySkipReason(decision: DecisionRow): string {
  if (!decision.reason.includes("older than MAX_TRADE_AGE_DAYS")) {
    return decision.reason;
  }

  const transaction = new Date(
    `${decision.transaction_date}T00:00:00Z`,
  ).getTime();
  const decisionTime = new Date(decision.created_at).getTime();
  if (!Number.isFinite(transaction) || !Number.isFinite(decisionTime)) {
    return `Trade exceeds the ${config.maxTradeAgeDays}-day freshness limit`;
  }

  const ageDays = Math.max(
    0,
    Math.floor((decisionTime - transaction) / 86_400_000),
  );
  const daysOverLimit = Math.max(0, ageDays - config.maxTradeAgeDays);
  return `Trade is ${ageDays} days old — ${daysOverLimit} day${daysOverLimit === 1 ? "" : "s"} over the ${config.maxTradeAgeDays}-day limit`;
}

export async function exportDashboardData(
  outputDirectory = process.env.DASHBOARD_DATA_DIR?.trim() || "./dashboard-data",
): Promise<void> {
  initializeDatabase();
  mkdirSync(outputDirectory, { recursive: true });

  const [account, positions, history, clock] = await Promise.all([
    getPaperAccount(),
    getPositions(),
    getPortfolioHistory(),
    getMarketClock(),
  ]);

  const db = getDatabase();
  const copiedRows = db
    .prepare(
      `SELECT ticker, politician_name, transaction_date, notional_value,
              status, execution_mode, alpaca_order_id, created_at
       FROM bot_positions
       WHERE execution_mode = 'PAPER' AND alpaca_order_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 25`,
    )
    .all() as unknown as PositionRow[];
  const copiedTradeCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM bot_positions
         WHERE execution_mode = 'PAPER' AND alpaca_order_id IS NOT NULL`,
      )
      .get() as { count: number }
  ).count;
  const skippedRows = db
    .prepare(
      `SELECT td.transaction_date, td.politician_name, td.ticker,
              t.asset_name, td.action, td.reason, td.final_position_size,
              td.decision, td.alpaca_order_id, td.created_at
       FROM trade_decisions td
       LEFT JOIN trades t ON t.id = td.trade_id
       WHERE td.decision = 'SKIP'
         AND td.id = (
           SELECT MAX(latest.id)
           FROM trade_decisions latest
           WHERE latest.trade_id = td.trade_id
         )
       ORDER BY td.id DESC
       LIMIT 25`,
    )
    .all() as unknown as DecisionRow[];

  const timestamps = history.timestamp ?? [];
  const equities = history.equity ?? [];
  const portfolioHistory = timestamps
    .map((timestamp, index) => ({
      date: formatDate(timestamp),
      equity: Number(equities[index]),
    }))
    .filter((point) => Number.isFinite(point.equity) && point.equity > 0);

  const copiedTrades = copiedRows.map((position) => ({
    date: position.created_at.slice(0, 10),
    politician: position.politician_name,
    ticker: position.ticker,
    action: "BUY",
    signalAge: signalAge(position.transaction_date, position.created_at),
    allocation: formatMoney(position.notional_value),
    status: position.status === "OPEN" ? "Copied" : "Closed",
  }));
  const skippedTrades = skippedRows.map((decision) => ({
    date: decision.created_at.slice(0, 10),
    politician: decision.politician_name,
    ticker:
      decision.ticker?.trim() ||
      decision.asset_name?.trim() ||
      "Ticker missing",
    action: decision.action,
    reason: displaySkipReason(decision),
    status: "Skipped",
  }));

  const equity = Number(account.equity ?? account.portfolio_value);
  const portfolioValue = Number(account.portfolio_value ?? account.equity);
  const buyingPower = Number(account.buying_power);
  const cash = Number(account.cash);
  const generatedAt = new Date().toISOString();

  writeJson(outputDirectory, "portfolio-history.json", portfolioHistory);
  writeJson(outputDirectory, "copied-trades.json", copiedTrades);
  writeJson(outputDirectory, "skipped-trades.json", skippedTrades);
  writeJson(outputDirectory, "bot-status.json", {
    botStatus: account.status === "ACTIVE" ? "Running" : (account.status ?? "Unknown"),
    lastScan: generatedAt,
    dataSource: "Official disclosure filings",
    broker: "Alpaca Paper Trading",
    safeMode: config.safeMode,
    cron: "Active",
    lastError: "None",
    marketOpen: clock.is_open,
    equity,
    portfolioValue,
    buyingPower,
    cash,
    openPositions: positions.length,
    copiedTrades: copiedTradeCount,
    positions: positions.map((position) => ({
      ticker: position.symbol,
      quantity: Number(position.qty),
      marketValue: Number(position.market_value),
      currentPrice: Number(position.current_price),
      averageEntryPrice: Number(position.avg_entry_price),
      unrealizedProfitLoss: Number(position.unrealized_pl ?? 0),
      unrealizedProfitLossPct: Number(position.unrealized_plpc ?? 0),
    })),
  });

  logger.info("DASHBOARD", "Published safe dashboard data", {
    outputDirectory,
    portfolioPoints: portfolioHistory.length,
    copiedTrades: copiedTrades.length,
    skippedTrades: skippedTrades.length,
    openPositions: positions.length,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportDashboardData().catch((error) => {
    logger.error("DASHBOARD", "Could not export dashboard data", error);
    process.exitCode = 1;
  });
}

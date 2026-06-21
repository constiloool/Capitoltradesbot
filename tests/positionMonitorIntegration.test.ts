import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("position monitor persists take-profit, stop-loss and time exits", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "position-monitor-"));
  process.env.DATABASE_PATH = path.join(directory, "monitor.sqlite");
  process.env.SAFE_MODE = "true";
  const { initializeDatabase, closeDatabase, getDatabase } = await import(
    "../src/storage/db.js"
  );
  const { insertPendingFiling } = await import(
    "../src/storage/filingRepository.js"
  );
  const { insertDisclosureTrades } = await import(
    "../src/storage/disclosureTradeRepository.js"
  );
  const { createOpenPosition } = await import(
    "../src/storage/positionsStore.js"
  );
  const { monitorOpenPositions } = await import(
    "../src/monitor/positionMonitor.js"
  );

  initializeDatabase();
  const today = new Date().toISOString().slice(0, 10);
  const filing = {
    id: "house:monitor",
    source: "house" as const,
    sourceFilingId: "monitor",
    politicianName: "Monitor Politician",
    chamber: "House" as const,
    filingType: "Periodic Transaction Report",
    filingDate: today,
    documentUrl: "https://example.test/monitor.pdf",
    documentKind: "pdf" as const,
  };
  insertPendingFiling(filing);
  const tickers = ["TPROF", "SLOSS", "TEXIT"];
  const trades = insertDisclosureTrades(
    tickers.map((ticker, index) => ({
      filingId: filing.id,
      source: filing.source,
      sourceFilingId: filing.sourceFilingId,
      politicianName: filing.politicianName,
      chamber: filing.chamber,
      transactionDate: today,
      filingDate: today,
      ticker,
      assetName: `${ticker} Corp`,
      transactionType: "purchase" as const,
      amountRange:
        index === 0
          ? "$1,001 - $15,000"
          : index === 1
            ? "$15,001 - $50,000"
            : "$50,001 - $100,000",
      sourceUrl: filing.documentUrl,
    })),
  ).inserted;
  for (const trade of trades) {
    createOpenPosition({
      ticker: trade.ticker!,
      entryPrice: 100,
      quantity: 10,
      notionalValue: 1_000,
      politicianName: trade.politicianName,
      sourceTradeId: trade.id,
      disclosureId: trade.filingId,
      transactionDate: trade.transactionDate,
      filingDate: trade.filingDate,
      executionMode: "SIMULATED",
    });
  }
  const oldDate = new Date(Date.now() - 46 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  getDatabase()
    .prepare("UPDATE bot_positions SET entry_date = ? WHERE ticker = 'TEXIT'")
    .run(oldDate);

  const prices: Record<string, number> = {
    TPROF: 130,
    SLOSS: 88,
    TEXIT: 100,
  };
  await monitorOpenPositions(true, {
    getCurrentPrice: async (ticker) => prices[ticker],
    executeSellOrder: async () => ({ simulated: true }),
  });

  const positions = getDatabase()
    .prepare(
      "SELECT ticker, status, exit_reason FROM bot_positions ORDER BY ticker",
    )
    .all() as Array<{
    ticker: string;
    status: string;
    exit_reason: string;
  }>;
  assert.deepEqual(positions.map((position) => ({ ...position })), [
    { ticker: "SLOSS", status: "CLOSED", exit_reason: "STOP_LOSS" },
    { ticker: "TEXIT", status: "CLOSED", exit_reason: "TIME_EXIT" },
    { ticker: "TPROF", status: "CLOSED", exit_reason: "TAKE_PROFIT" },
  ]);
  const decisions = getDatabase()
    .prepare(
      "SELECT reason, COUNT(*) AS count FROM trade_decisions WHERE decision = 'SELL' GROUP BY reason",
    )
    .all() as Array<{ reason: string; count: number }>;
  assert.deepEqual(
    Object.fromEntries(decisions.map((row) => [row.reason, row.count])),
    { STOP_LOSS: 1, TAKE_PROFIT: 1, TIME_EXIT: 1 },
  );
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

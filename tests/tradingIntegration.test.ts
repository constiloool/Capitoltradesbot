import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("complete fresh BUY path persists simulated position and rich decision", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "trading-integration-"));
  process.env.DATABASE_PATH = path.join(directory, "trading.sqlite");
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
  const { processTradeSignal } = await import(
    "../src/rules/processTradeSignal.js"
  );
  const { executeBuy } = await import("../src/execution/alpacaExecutor.js");

  initializeDatabase();
  assert.equal(
    (getDatabase().prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    }).foreign_keys,
    1,
  );
  const today = new Date().toISOString().slice(0, 10);
  const filing = {
    id: "house:buy-path",
    source: "house" as const,
    sourceFilingId: "buy-path",
    politicianName: "Unknown Test Politician",
    chamber: "House" as const,
    filingType: "Periodic Transaction Report",
    filingDate: today,
    documentUrl: "https://example.test/buy.pdf",
    documentKind: "pdf" as const,
  };
  insertPendingFiling(filing);
  const trade = insertDisclosureTrades([
    {
      filingId: filing.id,
      source: filing.source,
      sourceFilingId: filing.sourceFilingId,
      politicianName: filing.politicianName,
      chamber: filing.chamber,
      transactionDate: today,
      filingDate: today,
      ticker: "AAPL",
      assetName: "Apple Inc.",
      transactionType: "purchase",
      amountRange: "$15,001 - $50,000",
      sourceUrl: filing.documentUrl,
    },
  ]).inserted[0];

  const result = await processTradeSignal(
    trade,
    {
      marketOpen: true,
      accountSnapshot: {
        accountEquity: 100_000,
        buyingPower: 200_000,
        cash: 100_000,
        mode: "paper",
      },
    },
    {
      isAlpacaConfigured: () => true,
      getBrokerPositions: async () => [],
      getBrokerAsset: async () => ({
        symbol: "AAPL",
        tradable: true,
        fractionable: true,
        status: "active",
      }),
      getCurrentPrice: async () => 100,
      getHistoricalReferencePrice: async () => 98,
      executeBuyOrder: executeBuy,
    },
  );

  assert.equal(result.decision, "BUY");
  const position = getDatabase()
    .prepare(
      "SELECT ticker, status, execution_mode, notional_value FROM bot_positions",
    )
    .get() as {
    ticker: string;
    status: string;
    execution_mode: string;
    notional_value: number;
  };
  assert.deepEqual({ ...position }, {
    ticker: "AAPL",
    status: "OPEN",
    execution_mode: "SIMULATED",
    notional_value: 1_000,
  });
  const decision = getDatabase()
    .prepare(
      `SELECT decision, current_price, reference_price, runup_pct,
       effective_trade_date, trade_date_source, trade_age_days,
       account_equity, calculated_position_size, final_position_size,
       alpaca_order_id, safe_mode FROM trade_decisions`,
    )
    .get() as Record<string, number | string | null>;
  assert.equal(decision.decision, "BUY");
  assert.equal(decision.current_price, 100);
  assert.equal(decision.reference_price, 98);
  assert.ok(Number(decision.runup_pct) > 0);
  assert.equal(decision.effective_trade_date, today);
  assert.equal(decision.trade_date_source, "transaction_date");
  assert.equal(decision.trade_age_days, 0);
  assert.equal(decision.account_equity, 100_000);
  assert.equal(decision.calculated_position_size, 1_000);
  assert.equal(decision.final_position_size, 1_000);
  assert.equal(decision.alpaca_order_id, null);
  assert.equal(decision.safe_mode, 1);
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

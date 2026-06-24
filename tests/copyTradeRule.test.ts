import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldCopyTrade,
  type CopyTradeMarketData,
} from "../src/rules/copyTradeRule.js";
import type { DisclosureTrade } from "../src/types/disclosure.js";

const now = new Date("2026-06-21T12:00:00Z");

function trade(overrides: Partial<DisclosureTrade> = {}): DisclosureTrade {
  return {
    id: "copy-rule-1",
    dedupeKey: "copy-rule-1",
    filingId: "house:copy-rule",
    source: "house",
    sourceFilingId: "copy-rule",
    politicianName: "Jane Example",
    chamber: "House",
    transactionDate: "2026-06-11",
    filingDate: "2026-06-20",
    ticker: "AAPL",
    assetName: "Apple Inc.",
    transactionType: "purchase",
    amountRange: "$15,001 - $50,000",
    sourceUrl: "https://example.test",
    createdAt: now.toISOString(),
    ...overrides,
  };
}

function marketData(
  referencePrice?: number,
  currentPrice?: number,
): CopyTradeMarketData {
  return {
    getHistoricalClose: async () => referencePrice,
    getCurrentPrice: async () => currentPrice,
  };
}

test("shouldCopyTrade buys a 10-day-old trade with an 8% increase", async () => {
  const result = await shouldCopyTrade(trade(), marketData(100, 108), now);

  assert.equal(result.shouldCopy, true);
  assert.equal(result.decision, "BUY");
  assert.equal(result.ageDays, 10);
  assert.ok(Math.abs((result.priceChangePct ?? 0) - 0.08) < 1e-12);
});

test("shouldCopyTrade skips an increase above 10%", async () => {
  const result = await shouldCopyTrade(trade(), marketData(100, 112), now);

  assert.equal(result.shouldCopy, false);
  assert.equal(result.decision, "SKIP");
  assert.match(result.reason, /more than 10%/);
});

test("shouldCopyTrade uses filing date as an explicitly marked fallback", async () => {
  let requestedDate = "";
  const result = await shouldCopyTrade(
    trade({ transactionDate: "", filingDate: "2026-06-20" }),
    {
      getHistoricalClose: async (_ticker, date) => {
        requestedDate = date;
        return 100;
      },
      getCurrentPrice: async () => 95,
    },
    now,
  );

  assert.equal(result.shouldCopy, true);
  assert.equal(requestedDate, "2026-06-20");
  assert.equal(result.tradeDateSource, "filing_date_fallback");
});

test("shouldCopyTrade skips separately for missing historical and current prices", async () => {
  const noHistory = await shouldCopyTrade(
    trade(),
    marketData(undefined, 100),
    now,
  );
  const noCurrent = await shouldCopyTrade(
    trade(),
    marketData(100, undefined),
    now,
  );

  assert.equal(noHistory.reason, "Skipped because historical price is missing");
  assert.equal(noHistory.currentPrice, 100);
  assert.equal(noCurrent.reason, "Skipped because current price is missing");
  assert.equal(noCurrent.referencePrice, 100);
});

test("shouldCopyTrade does not call market data for an invalid ticker", async () => {
  let calls = 0;
  const result = await shouldCopyTrade(
    trade({ ticker: " " }),
    {
      getHistoricalClose: async () => {
        calls += 1;
        return 100;
      },
      getCurrentPrice: async () => {
        calls += 1;
        return 100;
      },
    },
    now,
  );

  assert.equal(result.shouldCopy, false);
  assert.equal(result.reason, "Skipped because ticker is missing");
  assert.equal(calls, 0);
});

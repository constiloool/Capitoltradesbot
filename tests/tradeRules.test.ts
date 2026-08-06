import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTradeRules } from "../src/rules/tradeRules.js";
import { evaluatePositionExit } from "../src/monitor/positionMonitor.js";
import { calculateAllowedOrderValue } from "../src/risk/positionSizing.js";
import type { DisclosureTrade } from "../src/types/disclosure.js";
import type { BotPosition, MarketContext } from "../src/types/trading.js";

const now = new Date("2026-06-21T12:00:00Z");

function trade(overrides: Partial<DisclosureTrade> = {}): DisclosureTrade {
  return {
    id: "trade-1",
    dedupeKey: "trade-1",
    filingId: "house:1",
    source: "house",
    sourceFilingId: "1",
    politicianName: "Jane Example",
    chamber: "House",
    transactionDate: "2026-06-18",
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

function market(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    accountEquity: 100_000,
    totalExposure: 0,
    currentTickerExposure: 0,
    currentPrice: 100,
    referencePrice: 98,
    tradable: true,
    fractionable: true,
    minOrderValueUsd: 25,
    tickerAlreadyHeld: false,
    ...overrides,
  };
}

test("trade that is 10 days old remains eligible", () => {
  const result = evaluateTradeRules(
    trade({ transactionDate: "2026-06-11" }),
    market(),
    1,
    now,
  );
  assert.equal(result.decision, "BUY");
  assert.equal(result.tradeAgeDays, 10);
});

test("trade that is 31 days old remains eligible", () => {
  const result = evaluateTradeRules(
    trade({ transactionDate: "2026-05-21" }),
    market(),
    1,
    now,
  );
  assert.equal(result.decision, "BUY");
  assert.equal(result.tradeAgeDays, 31);
});

test("trade that is 32 days old is skipped", () => {
  const result = evaluateTradeRules(
    trade({ transactionDate: "2026-05-20" }),
    market(),
    1,
    now,
  );
  assert.equal(result.decision, "SKIP");
  assert.match(result.reason, /older than 31 days/);
});

test("filing date is marked and used when transaction date is missing", () => {
  const result = evaluateTradeRules(
    trade({ transactionDate: "", filingDate: "2026-06-20" }),
    market(),
    1,
    now,
  );
  assert.equal(result.decision, "BUY");
  assert.equal(result.effectiveTradeDate, "2026-06-20");
  assert.equal(result.tradeDateSource, "filing_date_fallback");
  assert.equal(result.tradeAgeDays, 1);
});

test("missing transaction and filing dates are skipped", () => {
  const result = evaluateTradeRules(
    trade({ transactionDate: "", filingDate: "" }),
    market(),
    1,
    now,
  );
  assert.equal(result.decision, "SKIP");
  assert.match(result.reason, /dates are missing/);
});

test("missing or blank ticker is skipped with explicit reason", () => {
  for (const ticker of [undefined, ""]) {
    const result = evaluateTradeRules(
      trade({ ticker }),
      market(),
      1,
      now,
    );
    assert.equal(result.decision, "SKIP");
    assert.equal(result.reason, "Skipped because ticker is missing");
  }
});

test("sale is skipped", () => {
  const result = evaluateTradeRules(
    trade({ transactionType: "sale" }),
    market(),
    1,
    now,
  );
  assert.equal(result.decision, "SKIP");
});

test("fresh purchase is eligible to buy", () => {
  assert.equal(evaluateTradeRules(trade(), market(), 1, now).decision, "BUY");
});

test("held ticker can be purchased again below its position limit", () => {
  const result = evaluateTradeRules(
    trade(),
    market({ tickerAlreadyHeld: true, currentTickerExposure: 3_000 }),
    1,
    now,
  );
  assert.equal(result.decision, "BUY");
  assert.equal(result.finalPositionSize, 1_000);
  assert.match(result.reason, /Additional BUY/);
});

test("politician score zero is skipped", () => {
  const result = evaluateTradeRules(trade(), market(), 0, now);
  assert.equal(result.decision, "SKIP");
  assert.equal(result.reason, "Politician score is 0");
});

test("share price below five dollars is skipped", () => {
  const result = evaluateTradeRules(
    trade(),
    market({ currentPrice: 4.99 }),
    1,
    now,
  );
  assert.equal(result.decision, "SKIP");
  assert.match(result.reason, /MIN_SHARE_PRICE/);
});

test("run-up above ten percent is skipped", () => {
  const result = evaluateTradeRules(
    trade(),
    market({ currentPrice: 111, referencePrice: 100 }),
    1,
    now,
  );
  assert.equal(result.decision, "SKIP");
  assert.match(result.reason, /more than 10%/);
});

test("run-up of exactly ten percent is eligible", () => {
  const result = evaluateTradeRules(
    trade(),
    market({ currentPrice: 110, referencePrice: 100 }),
    1,
    now,
  );
  assert.equal(result.decision, "BUY");
  assert.ok(Math.abs((result.runupPct ?? 0) - 0.1) < 1e-12);
});

test("unchanged or fallen price remains eligible", () => {
  for (const currentPrice of [100, 85]) {
    const result = evaluateTradeRules(
      trade(),
      market({ currentPrice, referencePrice: 100 }),
      1,
      now,
    );
    assert.equal(result.decision, "BUY");
  }
});

test("position size uses politician and disclosed value scores", () => {
  const result = evaluateTradeRules(
    trade({ amountRange: "$100,001 - $250,000" }),
    market(),
    1.5,
    now,
  );
  assert.equal(result.decision, "BUY");
  assert.equal(result.calculatedPositionSize, 2_250);
  assert.equal(result.finalPositionSize, 2_250);
});

test("position size is reduced by total exposure capacity", () => {
  const result = evaluateTradeRules(
    trade({ amountRange: "$100,001 - $250,000" }),
    market({ totalExposure: 29_000 }),
    1.5,
    now,
  );
  assert.equal(result.decision, "BUY");
  assert.equal(result.finalPositionSize, 1_000);
  assert.ok(result.notes.includes("Position size reduced due to total exposure limit"));
});

test("position limit allows a new ticker without an existing position", () => {
  assert.deepEqual(
    calculateAllowedOrderValue(100_000, 0, 1_500, 5, 25),
    {
      finalOrderValue: 1_500,
      status: "allowed",
      reason: "Purchase allowed below per-ticker position limit",
    },
  );
});

test("position limit allows adding to an existing position below limit", () => {
  const result = calculateAllowedOrderValue(100_000, 3_000, 1_500, 5, 25);
  assert.equal(result.status, "allowed");
  assert.equal(result.finalOrderValue, 1_500);
  assert.match(result.reason, /Additional purchase allowed/);
});

test("position limit reduces an order to the remaining capacity", () => {
  const result = calculateAllowedOrderValue(100_000, 3_000, 3_000, 5, 25);
  assert.equal(result.status, "reduced");
  assert.equal(result.finalOrderValue, 2_000);
  assert.match(result.reason, /MAX_POSITION_PERCENT_PER_TICKER/);
});

test("position limit skips a position already at its cap", () => {
  const result = calculateAllowedOrderValue(100_000, 5_000, 1_000, 5, 25);
  assert.equal(result.status, "skipped_position_limit");
  assert.equal(result.finalOrderValue, 0);
});

test("position limit skips when reduced order is below minimum", () => {
  const result = calculateAllowedOrderValue(100_000, 4_990, 1_000, 5, 25);
  assert.equal(result.status, "skipped_min_order");
  assert.equal(result.finalOrderValue, 0);
  assert.match(result.reason, /MIN_ORDER_VALUE_USD/);
});

test("missing price history is skipped conservatively", () => {
  const result = evaluateTradeRules(
    trade(),
    market({ referencePrice: undefined }),
    1,
    now,
  );
  assert.equal(result.decision, "SKIP");
  assert.match(result.reason, /historical price/);
});

test("missing current price is skipped explicitly", () => {
  const result = evaluateTradeRules(
    trade(),
    market({ currentPrice: undefined }),
    1,
    now,
  );
  assert.equal(result.decision, "SKIP");
  assert.equal(result.reason, "Skipped because current price is missing");
});

function position(overrides: Partial<BotPosition> = {}): BotPosition {
  return {
    id: "position-1",
    ticker: "AAPL",
    entryDate: "2026-06-01",
    entryPrice: 100,
    quantity: 10,
    notionalValue: 1_000,
    politicianName: "Jane Example",
    politicianNames: ["Jane Example"],
    sourceTradeId: "trade-1",
    disclosureId: "house:1",
    transactionDate: "2026-05-31",
    filingDate: "2026-06-01",
    signalCount: 1,
    lastSignalDate: "2026-05-31",
    clusterSignal: false,
    status: "OPEN",
    executionMode: "SIMULATED",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

test("take profit at plus 30 percent sells", () => {
  assert.equal(evaluatePositionExit(position(), 130, now), "TAKE_PROFIT");
});

test("stop loss at minus 12 percent sells", () => {
  assert.equal(evaluatePositionExit(position(), 88, now), "STOP_LOSS");
});

test("position older than 45 days sells", () => {
  assert.equal(
    evaluatePositionExit(
      position({ entryDate: "2026-04-01" }),
      100,
      now,
    ),
    "TIME_EXIT",
  );
});

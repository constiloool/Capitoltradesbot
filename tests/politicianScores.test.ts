import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getPoliticianScore,
  loadPoliticianScores,
} from "../src/storage/politicianScoresStore.js";
import { evaluateTradeRules } from "../src/rules/tradeRules.js";
import type { DisclosureTrade } from "../src/types/disclosure.js";

test("loads politician scores and applies zero, multiplier and default", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "politician-scores-"));
  const file = path.join(directory, "scores.json");
  writeFileSync(
    file,
    JSON.stringify({
      default_score: 1,
      politicians: { Blocked: 0, Conviction: 1.5 },
    }),
  );
  const scores = loadPoliticianScores(file);
  assert.equal(getPoliticianScore("Blocked", scores), 0);
  assert.equal(getPoliticianScore("Conviction", scores), 1.5);
  assert.equal(getPoliticianScore("Unknown Name", scores), 1);

  const trade: DisclosureTrade = {
    id: "score-trade",
    dedupeKey: "score-trade",
    filingId: "house:score",
    source: "house",
    sourceFilingId: "score",
    politicianName: "Conviction",
    chamber: "House",
    transactionDate: new Date().toISOString().slice(0, 10),
    filingDate: new Date().toISOString().slice(0, 10),
    ticker: "AAPL",
    assetName: "Apple Inc.",
    transactionType: "purchase",
    amountRange: "$15,001 - $50,000",
    sourceUrl: "https://example.test",
    createdAt: new Date().toISOString(),
  };
  const market = {
    accountEquity: 100_000,
    totalExposure: 0,
    currentTickerExposure: 0,
    currentPrice: 100,
    referencePrice: 100,
    tradable: true,
    fractionable: true,
    brokerMinimumOrderValue: 1,
    tickerAlreadyHeld: false,
  };
  assert.equal(
    evaluateTradeRules(trade, market, getPoliticianScore("Blocked", scores))
      .decision,
    "SKIP",
  );
  assert.equal(
    evaluateTradeRules(
      trade,
      market,
      getPoliticianScore("Conviction", scores),
    ).calculatedPositionSize,
    1_500,
  );
  assert.equal(
    evaluateTradeRules(
      trade,
      market,
      getPoliticianScore("Unknown Name", scores),
    ).calculatedPositionSize,
    1_000,
  );
  rmSync(directory, { recursive: true, force: true });
});

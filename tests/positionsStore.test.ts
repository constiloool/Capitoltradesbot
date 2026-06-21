import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("persists positions and marks a three-politician cluster", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capitol-positions-"));
  process.env.DATABASE_PATH = path.join(directory, "positions.sqlite");
  const { initializeDatabase, closeDatabase } = await import(
    "../src/storage/db.js"
  );
  const {
    addSignalToPosition,
    createOpenPosition,
    findOpenPosition,
  } = await import("../src/storage/positionsStore.js");
  const { insertPendingFiling } = await import(
    "../src/storage/filingRepository.js"
  );
  const { insertDisclosureTrades } = await import(
    "../src/storage/disclosureTradeRepository.js"
  );

  initializeDatabase();
  const filing = {
    id: "house:positions",
    source: "house" as const,
    sourceFilingId: "positions",
    politicianName: "Politician One",
    chamber: "House" as const,
    filingType: "Periodic Transaction Report",
    filingDate: "2026-06-16",
    documentUrl: "https://example.test/positions.pdf",
    documentKind: "pdf" as const,
  };
  insertPendingFiling(filing);
  const storedTrade = insertDisclosureTrades([
    {
      filingId: filing.id,
      source: filing.source,
      sourceFilingId: filing.sourceFilingId,
      politicianName: filing.politicianName,
      chamber: filing.chamber,
      transactionDate: "2026-06-15",
      filingDate: filing.filingDate,
      ticker: "AAPL",
      assetName: "Apple Inc.",
      transactionType: "purchase",
      amountRange: "$15,001 - $50,000",
      sourceUrl: filing.documentUrl,
    },
  ]).inserted[0];
  const additionalTrades = insertDisclosureTrades(
    ["Politician Two", "Politician Three"].map((politicianName, index) => ({
      filingId: filing.id,
      source: filing.source,
      sourceFilingId: filing.sourceFilingId,
      politicianName,
      chamber: filing.chamber,
      transactionDate: index === 0 ? "2026-06-17" : "2026-06-20",
      filingDate: filing.filingDate,
      ticker: "AAPL",
      assetName: "Apple Inc.",
      transactionType: "purchase" as const,
      amountRange:
        index === 0 ? "$1,001 - $15,000" : "$50,001 - $100,000",
      sourceUrl: filing.documentUrl,
    })),
  ).inserted;
  let position = createOpenPosition({
    ticker: "AAPL",
    entryPrice: 100,
    quantity: 10,
    notionalValue: 1_000,
    politicianName: "Politician One",
    sourceTradeId: storedTrade.id,
    disclosureId: "house:1",
    transactionDate: "2026-06-15",
    filingDate: "2026-06-16",
    executionMode: "SIMULATED",
  });
  position = addSignalToPosition(
    position,
    additionalTrades[0].id,
    "Politician Two",
    "2026-06-17",
  );
  position = addSignalToPosition(
    position,
    additionalTrades[1].id,
    "Politician Three",
    "2026-06-20",
  );

  const stored = findOpenPosition("AAPL");
  assert.equal(stored?.signalCount, 3);
  assert.deepEqual(stored?.politicianNames, [
    "Politician One",
    "Politician Two",
    "Politician Three",
  ]);
  assert.equal(stored?.clusterSignal, true);
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

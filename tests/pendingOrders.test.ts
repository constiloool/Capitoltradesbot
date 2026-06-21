import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("retains pending orders while the regular market is closed", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capitol-pending-"));
  process.env.DATABASE_PATH = path.join(directory, "pending.sqlite");
  const { initializeDatabase, closeDatabase } = await import(
    "../src/storage/db.js"
  );
  const { insertPendingFiling } = await import(
    "../src/storage/filingRepository.js"
  );
  const { insertDisclosureTrades } = await import(
    "../src/storage/disclosureTradeRepository.js"
  );
  const {
    createPendingOrder,
    listPendingOrders,
  } = await import("../src/storage/pendingOrdersStore.js");
  const { processPendingOrders } = await import(
    "../src/jobs/processPendingOrders.js"
  );

  initializeDatabase();
  const filing = {
    id: "house:pending",
    source: "house" as const,
    sourceFilingId: "pending",
    politicianName: "Jane Example",
    chamber: "House" as const,
    filingType: "Periodic Transaction Report",
    filingDate: "2026-06-21",
    documentUrl: "https://example.test/pending.pdf",
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
      transactionDate: "2026-06-20",
      filingDate: filing.filingDate,
      ticker: "AAPL",
      assetName: "Apple Inc.",
      transactionType: "purchase",
      amountRange: "$15,001 - $50,000",
      sourceUrl: filing.documentUrl,
    },
  ]).inserted[0];
  createPendingOrder(trade.id, "AAPL", "Market is closed");

  const result = await processPendingOrders(false);
  assert.equal(result.marketOpen, false);
  assert.equal(result.executed, 0);
  assert.equal(listPendingOrders().length, 1);
  assert.equal(listPendingOrders()[0].status, "PENDING");
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

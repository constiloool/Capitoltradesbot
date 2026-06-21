import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("deduplicates duplicate filings and duplicate trades", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capitoltradesbot-"));
  process.env.DATABASE_PATH = path.join(directory, "test.sqlite");

  const { initializeDatabase, closeDatabase, getDatabase } = await import(
    "../src/storage/db.js"
  );
  const { insertPendingFiling, updateFilingStatus } = await import(
    "../src/storage/filingRepository.js"
  );
  const { insertDisclosureTrades } = await import(
    "../src/storage/disclosureTradeRepository.js"
  );

  const filing = JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, "fixtures", "duplicate-filing.json"),
      "utf8",
    ),
  ) as {
    id: string;
    source: "house";
    sourceFilingId: string;
    politicianName: string;
    chamber: "House";
    filingType: string;
    filingDate: string;
    documentUrl: string;
    documentKind: "pdf";
  };
  const trade = {
    filingId: filing.id,
    source: filing.source,
    sourceFilingId: filing.sourceFilingId,
    politicianName: filing.politicianName,
    chamber: filing.chamber,
    transactionDate: "2026-05-12",
    filingDate: filing.filingDate,
    ticker: "AAPL",
    assetName: "Apple Inc. Common Stock",
    transactionType: "purchase" as const,
    amountRange: "$15,001 - $50,000",
    owner: "SP",
    sourceUrl: filing.documentUrl,
  };

  initializeDatabase();
  assert.equal(insertPendingFiling(filing), true);
  assert.equal(insertPendingFiling(filing), false);
  assert.equal(insertDisclosureTrades([trade]).inserted.length, 1);
  const duplicateResult = insertDisclosureTrades([trade]);
  assert.equal(duplicateResult.inserted.length, 0);
  assert.equal(duplicateResult.duplicates, 1);
  updateFilingStatus(filing.id, "failed", {
    parseError: "Fixture parser failure",
  });
  const failed = getDatabase()
    .prepare("SELECT parse_status, parse_error FROM filings WHERE id = ?")
    .get(filing.id) as { parse_status: string; parse_error: string };
  assert.equal(failed.parse_status, "failed");
  assert.equal(failed.parse_error, "Fixture parser failure");
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

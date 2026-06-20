import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("stores the same trade only once", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capitoltradesbot-"));
  process.env.DATABASE_PATH = path.join(directory, "test.sqlite");

  const { parseTrades } = await import("../src/scraper/parseTrades.js");
  const { closeDatabase, initializeDatabase } = await import("../src/storage/db.js");
  const { countTrades, insertNewTrades } = await import(
    "../src/storage/tradeRepository.js"
  );

  const html = `
    <table>
      <thead><tr><th>Politician</th><th>Traded Issuer</th><th>Published</th>
      <th>Traded</th><th>Owner</th><th>Type</th><th>Size</th></tr></thead>
      <tbody><tr><td>Jane Doe Democrat House CA</td><td>NVIDIA NVDA:US</td>
      <td>20 Jun 2026</td><td>10 Jun 2026</td><td>Self</td><td>Buy</td>
      <td>15K–50K</td></tr></tbody>
    </table>`;
  const trades = parseTrades(html, "https://www.capitoltrades.com/trades");

  initializeDatabase();
  assert.equal(insertNewTrades(trades).length, 1);
  assert.equal(insertNewTrades(trades).length, 0);
  assert.equal(countTrades(), 1);
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

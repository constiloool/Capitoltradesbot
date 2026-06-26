import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTicker,
  normalizeTransactionType,
  parsePrice,
  parseTradeSize,
} from "../src/utils/normalize.js";

test("normalizes US tickers", () => {
  assert.equal(normalizeTicker("NVDA:US"), "NVDA");
  assert.equal(normalizeTicker("BRK/B:US"), "BRK.B");
  assert.equal(normalizeTicker("brk/b"), "BRK.B");
  assert.equal(normalizeTicker("BMW:DE"), undefined);
});

test("parses sizes and prices", () => {
  assert.deepEqual(parseTradeSize("15K–50K"), { min: 15_000, max: 50_000 });
  assert.equal(parsePrice("$215.20"), 215.2);
  assert.equal(parsePrice("N/A"), undefined);
});

test("normalizes transaction types", () => {
  assert.equal(normalizeTransactionType("Purchase"), "buy");
  assert.equal(normalizeTransactionType("Sale"), "sell");
  assert.equal(normalizeTransactionType("Exchange"), "exchange");
});

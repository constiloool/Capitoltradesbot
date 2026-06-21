import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  parseHousePtrText,
  parseSenatePtrHtml,
} from "../src/parsers/disclosureParser.js";
import type { DisclosureFiling } from "../src/types/disclosure.js";

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");

const houseFiling: DisclosureFiling = {
  id: "house:fixture-1",
  source: "house",
  sourceFilingId: "fixture-1",
  politicianName: "Jane Example",
  chamber: "House",
  filingType: "Periodic Transaction Report",
  filingDate: "2026-05-21",
  documentUrl: "https://disclosures-clerk.house.gov/example.pdf",
  documentKind: "pdf",
};

const senateFiling: DisclosureFiling = {
  id: "senate:fixture-1",
  source: "senate",
  sourceFilingId: "fixture-1",
  politicianName: "John Example",
  chamber: "Senate",
  filingType: "Periodic Transaction Report",
  filingDate: "2026-05-22",
  documentUrl: "https://efdsearch.senate.gov/example/",
  documentKind: "html",
};

test("parses a House PTR text fixture", () => {
  const trades = parseHousePtrText(fixture("house-ptr.txt"), houseFiling);
  assert.equal(trades.length, 2);
  assert.equal(trades[0].ticker, "AAPL");
  assert.equal(trades[0].assetName, "Apple Inc. Common Stock");
  assert.equal(trades[0].owner, "SP");
  assert.equal(trades[0].transactionType, "purchase");
  assert.equal(trades[1].assetName, "NVIDIA Corporation Common Stock");
  assert.equal(trades[1].owner, "DC");
  assert.equal(trades[1].transactionType, "sale");
});

test("parses a Senate PTR HTML fixture", () => {
  const trades = parseSenatePtrHtml(fixture("senate-ptr.html"), senateFiling);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].ticker, "MSFT");
  assert.equal(trades[0].owner, "Self");
});

test("rejects an unparseable filing without inventing trades", () => {
  assert.throws(
    () => parseHousePtrText(fixture("malformed-filing.txt"), houseFiling),
    /No House PTR transaction rows recognized/,
  );
});

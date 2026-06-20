import assert from "node:assert/strict";
import test from "node:test";
import { parseTrades } from "../src/scraper/parseTrades.js";

const fixture = `
  <table>
    <thead><tr>
      <th>Politician</th><th>Traded Issuer</th><th>Published</th>
      <th>Traded</th><th>Filed After</th><th>Owner</th>
      <th>Type</th><th>Size</th><th>Price</th>
    </tr></thead>
    <tbody><tr>
      <td>Jane Doe Democrat House CA</td>
      <td>NVIDIA Corp NVDA:US</td><td>20 Jun 2026</td><td>10 Jun 2026</td>
      <td>10 days</td><td>Spouse</td><td>Buy</td><td>15K–50K</td>
      <td>$215.20 <a href="/trades/123">Details</a></td>
    </tr></tbody>
  </table>`;

test("parses and deterministically identifies a trade", () => {
  const first = parseTrades(fixture, "https://www.capitoltrades.com/trades");
  const second = parseTrades(fixture, "https://www.capitoltrades.com/trades");
  assert.equal(first.length, 1);
  assert.equal(first[0].ticker, "NVDA");
  assert.equal(first[0].transactionType, "buy");
  assert.equal(first[0].sizeMin, 15_000);
  assert.equal(first[0].id, second[0].id);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseCapitolTradesDate } from "../src/sources/capitolTradesSenateFallback.js";

const now = new Date("2026-06-26T12:00:00.000Z");

test("parses CapitolTrades relative and absolute dates", () => {
  assert.equal(parseCapitolTradesDate("13:01 Today", now), "2026-06-26");
  assert.equal(parseCapitolTradesDate("08:15 Yesterday", now), "2026-06-25");
  assert.equal(parseCapitolTradesDate("27 May 2026", now), "2026-05-27");
  assert.equal(parseCapitolTradesDate("27 Sept 2026", now), "2026-09-27");
  assert.equal(parseCapitolTradesDate("not a date", now), undefined);
});

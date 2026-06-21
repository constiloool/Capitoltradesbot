import assert from "node:assert/strict";
import test from "node:test";
import { loadStrategyAccountSnapshot } from "../src/alpaca/accountSnapshot.js";

test("loads equity, buying power and cash once for a strategy run", async () => {
  let calls = 0;
  const snapshot = await loadStrategyAccountSnapshot({
    isConfigured: () => true,
    getAccount: async () => {
      calls += 1;
      return {
        equity: "123456.78",
        portfolio_value: "120000",
        buying_power: "200000",
        cash: "50000",
      };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(snapshot, {
    accountEquity: 123456.78,
    buyingPower: 200000,
    cash: 50000,
    mode: "paper",
  });
});

test("returns undefined instead of crashing when account loading fails", async () => {
  const snapshot = await loadStrategyAccountSnapshot({
    isConfigured: () => true,
    getAccount: async () => {
      throw new Error("invalid credentials");
    },
  });
  assert.equal(snapshot, undefined);
});

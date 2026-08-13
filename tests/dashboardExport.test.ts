import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("dashboard export tolerates temporary Alpaca positions outage", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashboard-export-"));
  const databasePath = path.join(directory, "dashboard.sqlite");
  const outputDirectory = path.join(directory, "dashboard-data");
  process.env.DATABASE_PATH = databasePath;
  process.env.ALPACA_API_KEY = "test-key";
  process.env.ALPACA_SECRET_KEY = "test-secret";
  process.env.ALPACA_BASE_URL = "https://paper-api.alpaca.markets";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/v2/positions")) {
      return new Response("gateway timeout", { status: 504 });
    }
    if (url.includes("/v2/account/portfolio/history")) {
      return Response.json({
        timestamp: [1_725_235_200],
        equity: [100_000],
      });
    }
    if (url.includes("/v2/clock")) {
      return Response.json({
        timestamp: "2026-08-13T17:00:00Z",
        is_open: true,
        next_open: "2026-08-14T13:30:00Z",
        next_close: "2026-08-13T20:00:00Z",
      });
    }
    if (url.includes("/v2/account")) {
      return Response.json({
        status: "ACTIVE",
        equity: "100000",
        portfolio_value: "100000",
        buying_power: "50000",
        cash: "50000",
      });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const { exportDashboardData } = await import(
      "../src/dashboard/exportDashboardData.js"
    );
    const { closeDatabase } = await import("../src/storage/db.js");

    await exportDashboardData(outputDirectory);

    const botStatusPath = path.join(outputDirectory, "bot-status.json");
    assert.equal(existsSync(botStatusPath), true);
    const botStatus = JSON.parse(readFileSync(botStatusPath, "utf8")) as {
      botStatus: string;
      brokerDataAvailable: boolean;
      lastError: string;
      openPositions: number;
    };
    assert.equal(botStatus.botStatus, "Running");
    assert.equal(botStatus.brokerDataAvailable, false);
    assert.match(botStatus.lastError, /positions.*HTTP 504/);
    assert.equal(botStatus.openPositions, 0);
    closeDatabase();
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

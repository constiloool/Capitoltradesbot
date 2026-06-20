import "dotenv/config";
import path from "node:path";

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  capitolTradesUrl:
    process.env.CAPITOL_TRADES_URL?.trim() ||
    "https://www.capitoltrades.com/trades",
  databasePath: path.resolve(
    process.env.DATABASE_PATH?.trim() || "./data/capitoltrades.sqlite",
  ),
  alpacaApiKey: process.env.ALPACA_API_KEY?.trim() || "",
  alpacaSecretKey: process.env.ALPACA_SECRET_KEY?.trim() || "",
  alpacaBaseUrl:
    process.env.ALPACA_BASE_URL?.trim() ||
    "https://paper-api.alpaca.markets",
  tradingEnabled: booleanEnv("TRADING_ENABLED", false),
  paperOrderQty: Math.max(1, numberEnv("PAPER_ORDER_QTY", 1)),
  debugSaveHtml: booleanEnv("DEBUG_SAVE_HTML", false),
  playwrightFallback: booleanEnv("PLAYWRIGHT_FALLBACK", true),
  scraperTimeoutMs: Math.max(5_000, numberEnv("SCRAPER_TIMEOUT_MS", 45_000)),
  minTradeSize: Math.max(0, numberEnv("MIN_TRADE_SIZE", 0)),
} as const;

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
  sourceMode:
    (process.env.SOURCE_MODE?.trim() as
      | "official_disclosures"
      | "house"
      | "senate"
      | "capitol_trades") || "official_disclosures",
  safeMode: booleanEnv("SAFE_MODE", true),
  storeRawPdfs: booleanEnv("STORE_RAW_PDFS", false),
  pdfRetentionDays: Math.max(0, numberEnv("PDF_RETENTION_DAYS", 7)),
  rawPdfDir: path.resolve(process.env.RAW_PDF_DIR?.trim() || "./data/raw-pdfs"),
  downloadTimeoutMs: Math.max(
    5_000,
    numberEnv("DOWNLOAD_TIMEOUT_MS", 30_000),
  ),
  maxFilingsPerRun: Math.max(1, numberEnv("MAX_FILINGS_PER_RUN", 50)),
  senateCapitolTradesFallback: booleanEnv(
    "SENATE_CAPITOL_TRADES_FALLBACK",
    true,
  ),
  userAgent:
    process.env.USER_AGENT?.trim() ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
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
  alpacaDataUrl:
    process.env.ALPACA_DATA_URL?.trim() || "https://data.alpaca.markets",
  tradingEnabled: booleanEnv("TRADING_ENABLED", false),
  allowLiveTrading: booleanEnv("ALLOW_LIVE_TRADING", false),
  paperOrderQty: Math.max(1, numberEnv("PAPER_ORDER_QTY", 1)),
  maxTradeAgeDays: Math.max(0, numberEnv("MAX_TRADE_AGE_DAYS", 31)),
  basePositionPct: Math.max(0, numberEnv("BASE_POSITION_PCT", 0.01)),
  maxPositionPerTickerPct: Math.max(
    0,
    numberEnv("MAX_POSITION_PER_TICKER_PCT", 0.03),
  ),
  maxTotalExposurePct: Math.max(
    0,
    numberEnv("MAX_TOTAL_EXPOSURE_PCT", 0.3),
  ),
  minSharePrice: Math.max(0, numberEnv("MIN_SHARE_PRICE", 5)),
  brokerMinimumOrderValue: Math.max(
    0,
    numberEnv("BROKER_MIN_ORDER_VALUE", 1),
  ),
  takeProfitPct: Math.max(0, numberEnv("TAKE_PROFIT_PCT", 0.3)),
  stopLossPct: Math.max(0, numberEnv("STOP_LOSS_PCT", 0.12)),
  maxHoldingDays: Math.max(1, numberEnv("MAX_HOLDING_DAYS", 45)),
  maxRunupPct: Math.max(0, numberEnv("MAX_RUNUP_PCT", 0.1)),
  skipIfPriceHistoryMissing: booleanEnv(
    "SKIP_IF_PRICE_HISTORY_MISSING",
    true,
  ),
  politicianScoresPath: path.resolve(
    process.env.POLITICIAN_SCORES_PATH?.trim() ||
      "./data/politician_scores.json",
  ),
  debugSaveHtml: booleanEnv("DEBUG_SAVE_HTML", false),
  playwrightFallback: booleanEnv("PLAYWRIGHT_FALLBACK", true),
  scraperTimeoutMs: Math.max(5_000, numberEnv("SCRAPER_TIMEOUT_MS", 45_000)),
  minTradeSize: Math.max(0, numberEnv("MIN_TRADE_SIZE", 0)),
} as const;

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { config } from "../config.js";
import type { CapitolTrade } from "../types/trade.js";
import { logger } from "../utils/logger.js";
import { parseTrades } from "./parseTrades.js";

const USER_AGENT =
  "Mozilla/5.0 (compatible; CapitolTradesBot/1.0; +https://github.com/constiloool/Capitol-tradesbot)";

function challenged(status: number, html: string): boolean {
  return (
    status === 429 ||
    /Vercel Security Checkpoint|verifying your browser|Enable JavaScript to continue/i.test(html)
  );
}

async function saveDebugHtml(html: string, method: string) {
  if (!config.debugSaveHtml) return;
  const directory = path.dirname(config.databasePath);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `debug-${method}-${Date.now()}.html`);
  await writeFile(file, html, "utf8");
  logger.info("SCRAPER", "Saved debug HTML", { file });
}

async function fetchHtml(): Promise<string> {
  const response = await fetch(config.capitolTradesUrl, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(config.scraperTimeoutMs),
  });
  const html = await response.text();
  await saveDebugHtml(html, "fetch");
  if (!response.ok || challenged(response.status, html)) {
    throw new Error(`Direct request blocked or failed (HTTP ${response.status})`);
  }
  return html;
}

async function browserHtml(): Promise<string> {
  logger.info("SCRAPER", "Using Playwright fallback");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(config.capitolTradesUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.scraperTimeoutMs,
    });
    await page.locator("table tbody tr").first().waitFor({
      state: "attached",
      timeout: config.scraperTimeoutMs,
    });
    const html = await page.content();
    await saveDebugHtml(html, "playwright");
    return html;
  } finally {
    await browser.close();
  }
}

export async function scrapeCapitolTrades(): Promise<CapitolTrade[]> {
  try {
    let html: string;
    try {
      html = await fetchHtml();
    } catch (error) {
      if (!config.playwrightFallback) throw error;
      logger.warn("SCRAPER", "Direct request unavailable", {
        reason: error instanceof Error ? error.message : String(error),
      });
      html = await browserHtml();
    }

    const trades = parseTrades(html, config.capitolTradesUrl);
    logger.info("SCRAPER", `Found ${trades.length} trades`);
    if (!trades.length) {
      logger.warn("SCRAPER", "No trade rows parsed; the site markup may have changed");
    }
    return trades;
  } catch (error) {
    logger.error("SCRAPER", "Scrape failed", error);
    return [];
  }
}

import { placeOrderForTrade } from "../alpaca/orderService.js";
import { scrapeCapitolTrades } from "../scraper/scrapeCapitolTrades.js";
import { closeDatabase, initializeDatabase } from "../storage/db.js";
import { countTrades, insertNewTrades } from "../storage/tradeRepository.js";
import { logger } from "../utils/logger.js";

export async function runScrapeJob(): Promise<void> {
  initializeDatabase();
  try {
    const trades = await scrapeCapitolTrades();
    const inserted = insertNewTrades(trades);
    logger.info("DB", `Inserted ${inserted.length} new trades`, {
      total: countTrades(),
    });

    for (const trade of inserted) {
      try {
        await placeOrderForTrade(trade);
      } catch (error) {
        logger.error("ALPACA", `Order handling failed for ${trade.ticker ?? trade.id}`, error);
      }
    }
    logger.info("GITHUB_ACTION", "Job completed", {
      found: trades.length,
      new: inserted.length,
    });
  } finally {
    closeDatabase();
  }
}

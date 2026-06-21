import { config } from "../config.js";
import { runDeprecatedCapitolTradesSource } from "../sources/capitolTradesSource.js";
import { closeDatabase, initializeDatabase } from "../storage/db.js";
import { logger } from "../utils/logger.js";
import { runOfficialDisclosuresJob } from "./runOfficialDisclosuresJob.js";

export async function runScrapeJob(): Promise<void> {
  initializeDatabase();
  try {
    if (config.sourceMode === "capitol_trades") {
      logger.warn(
        "SOURCE",
        "CapitolTrades is deprecated and disabled by default; running explicit legacy mode",
      );
      const trades = await runDeprecatedCapitolTradesSource();
      logger.info("INGEST", "Legacy source completed without official-schema storage", {
        found: trades.length,
      });
      return;
    }
    await runOfficialDisclosuresJob();
    logger.info("GITHUB_ACTION", "Job completed");
  } finally {
    closeDatabase();
  }
}

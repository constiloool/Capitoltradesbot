import { runScrapeJob } from "./jobs/runScrapeJob.js";
import { logger } from "./utils/logger.js";

runScrapeJob().catch((error) => {
  logger.error("ERROR", "Unhandled job failure", error);
  process.exitCode = 1;
});

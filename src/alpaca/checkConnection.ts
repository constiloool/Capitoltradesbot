import { alpacaConfigured, getPaperAccount } from "./alpacaClient.js";
import { logger } from "../utils/logger.js";

async function checkConnection(): Promise<void> {
  if (!alpacaConfigured()) {
    logger.warn("ALPACA", "Paper account check skipped because API keys are missing");
    return;
  }

  const account = await getPaperAccount();
  logger.info("ALPACA", "Paper account connection verified", {
    status: account.status ?? "unknown",
    blocked: account.account_blocked ?? false,
  });
}

checkConnection().catch((error) => {
  logger.error("ALPACA", "Paper account connection failed", error);
  process.exitCode = 1;
});

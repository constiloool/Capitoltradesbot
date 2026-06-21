import { config } from "../config.js";
import type { StrategyAccountSnapshot } from "../types/trading.js";
import { logger } from "../utils/logger.js";
import { alpacaConfigured, getPaperAccount } from "./alpacaClient.js";

export async function loadStrategyAccountSnapshot(
  dependencies: {
    isConfigured(): boolean;
    getAccount(): ReturnType<typeof getPaperAccount>;
  } = {
    isConfigured: alpacaConfigured,
    getAccount: getPaperAccount,
  },
): Promise<StrategyAccountSnapshot | undefined> {
  const mode = config.alpacaBaseUrl.startsWith(
    "https://paper-api.alpaca.markets",
  )
    ? "paper"
    : "live";
  try {
    if (!dependencies.isConfigured()) {
      throw new Error("Alpaca credentials are missing");
    }
    const account = await dependencies.getAccount();
    const accountEquity = Number(account.equity ?? account.portfolio_value);
    const buyingPower = Number(account.buying_power);
    const cash = Number(account.cash);
    if (!Number.isFinite(accountEquity) || accountEquity <= 0) {
      throw new Error("Alpaca account equity is unavailable");
    }
    const snapshot = {
      accountEquity,
      buyingPower: Number.isFinite(buyingPower) ? buyingPower : 0,
      cash: Number.isFinite(cash) ? cash : 0,
      mode,
    } satisfies StrategyAccountSnapshot;
    logger.info(
      "ALPACA",
      `Alpaca account equity loaded: ${snapshot.accountEquity}`,
    );
    logger.info("STRATEGY", "Account snapshot loaded", {
      accountEquity: snapshot.accountEquity,
      buyingPower: snapshot.buyingPower,
      cash: snapshot.cash,
      mode: snapshot.mode,
      safeMode: config.safeMode,
    });
    return snapshot;
  } catch (error) {
    logger.error("ALPACA", "Could not load Alpaca account equity", error);
    logger.info("STRATEGY", "Continuing without account equity", {
      mode,
      safeMode: config.safeMode,
    });
    return undefined;
  }
}

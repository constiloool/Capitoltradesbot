import { config } from "../config.js";
import type { CapitolTrade } from "../types/trade.js";

export type StrategyDecision = {
  action: "order" | "log-only" | "ignore";
  reason: string;
};

export function evaluateTrade(trade: CapitolTrade): StrategyDecision {
  if (!trade.ticker || trade.rawTicker && !trade.rawTicker.endsWith(":US")) {
    return { action: "ignore", reason: "No supported US ticker" };
  }
  if (config.minTradeSize > 0 && (trade.sizeMin ?? 0) < config.minTradeSize) {
    return { action: "ignore", reason: "Below configured minimum trade size" };
  }
  if (trade.transactionType === "buy") {
    return { action: "order", reason: "Eligible buy disclosure" };
  }
  if (trade.transactionType === "sell") {
    return { action: "log-only", reason: "Sell disclosures are log-only in MVP" };
  }
  return { action: "ignore", reason: "Exchange or unknown transaction type" };
}

import { config } from "../config.js";
import type { DisclosureTrade } from "../types/disclosure.js";

export type StrategyDecision = {
  action: "order" | "log-only" | "ignore";
  reason: string;
};

export function evaluateTrade(trade: DisclosureTrade): StrategyDecision {
  if (!trade.ticker) {
    return { action: "ignore", reason: "No supported US ticker" };
  }
  if (trade.transactionType === "purchase") {
    return { action: "order", reason: "Eligible buy disclosure" };
  }
  if (trade.transactionType === "sale") {
    return { action: "log-only", reason: "Sell disclosures are log-only in MVP" };
  }
  return { action: "ignore", reason: "Exchange or unknown transaction type" };
}

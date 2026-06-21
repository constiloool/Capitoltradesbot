import { config } from "../config.js";
import {
  alpacaConfigured,
  submitPaperOrder,
  type AlpacaOrder,
} from "../alpaca/alpacaClient.js";
import type { PositionExitReason } from "../types/trading.js";
import { logger } from "../utils/logger.js";

export type ExecutionResult = {
  orderId?: string;
  simulated: boolean;
};

function ensureTradingDestination(): void {
  const isPaper = config.alpacaBaseUrl.startsWith(
    "https://paper-api.alpaca.markets",
  );
  if (!isPaper && !config.allowLiveTrading) {
    throw new Error("Live trading refused because ALLOW_LIVE_TRADING=false");
  }
}

export async function executeBuy(input: {
  ticker: string;
  quantity?: number;
  notional?: number;
  clientOrderId: string;
}): Promise<ExecutionResult> {
  ensureTradingDestination();
  const order: AlpacaOrder = {
    symbol: input.ticker,
    qty: input.quantity,
    notional: input.notional,
    side: "buy",
    type: "market",
    time_in_force: "day",
    client_order_id: input.clientOrderId,
  };
  if (config.safeMode || !alpacaConfigured()) {
    logger.info("EXECUTION", "Would place buy order", {
      ticker: input.ticker,
      qty: input.quantity,
      notional: input.notional,
      reason: config.safeMode ? "SAFE_MODE=true" : "API keys missing",
    });
    return { simulated: true };
  }
  const response = await submitPaperOrder(order);
  return { simulated: false, orderId: response.id };
}

export async function executeSell(input: {
  ticker: string;
  quantity: number;
  clientOrderId: string;
  reason: PositionExitReason;
  forceSimulation?: boolean;
}): Promise<ExecutionResult> {
  ensureTradingDestination();
  if (input.forceSimulation || config.safeMode || !alpacaConfigured()) {
    logger.info("EXECUTION", "Would place sell order", {
      ticker: input.ticker,
      qty: input.quantity,
      reason: input.reason,
    });
    return { simulated: true };
  }
  const response = await submitPaperOrder({
    symbol: input.ticker,
    qty: input.quantity,
    side: "sell",
    type: "market",
    time_in_force: "day",
    client_order_id: input.clientOrderId,
  });
  return { simulated: false, orderId: response.id };
}

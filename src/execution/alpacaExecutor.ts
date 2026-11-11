import { config } from "../config.js";
import {
  alpacaConfigured,
  getPaperOrder,
  submitPaperOrder,
  type AlpacaOrder,
  type AlpacaOrderResponse,
} from "../alpaca/alpacaClient.js";
import type { PositionExitReason } from "../types/trading.js";
import { logger } from "../utils/logger.js";

export type ExecutionResult = {
  orderId?: string;
  simulated: boolean;
  /** True only after Alpaca reports that the complete market order filled. */
  confirmedFill?: boolean;
  filledQuantity?: number;
  filledAveragePrice?: number;
};

const TERMINAL_UNFILLED_STATUSES = new Set([
  "canceled",
  "expired",
  "rejected",
  "suspended",
  "stopped",
]);

function numberOrUndefined(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function filledExecution(order: AlpacaOrderResponse): ExecutionResult | undefined {
  if (order.status !== "filled") return undefined;
  const filledQuantity = numberOrUndefined(order.filled_qty);
  const filledAveragePrice = numberOrUndefined(order.filled_avg_price);
  if (!filledQuantity || !filledAveragePrice) return undefined;
  return {
    orderId: order.id,
    simulated: false,
    confirmedFill: true,
    filledQuantity,
    filledAveragePrice,
  };
}

async function confirmFill(submitted: AlpacaOrderResponse): Promise<ExecutionResult> {
  const immediatelyFilled = filledExecution(submitted);
  if (immediatelyFilled) return immediatelyFilled;
  if (!submitted.id) throw new Error("Alpaca accepted an order without an order id");

  // Market orders normally fill immediately. A short confirmation window avoids
  // recording a local position merely because the broker accepted an order.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await getPaperOrder(submitted.id);
    const filled = filledExecution(current);
    if (filled) return filled;
    if (current.status && TERMINAL_UNFILLED_STATUSES.has(current.status)) {
      throw new Error(`Alpaca order ${submitted.id} ended as ${current.status}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(
    `Alpaca order ${submitted.id} was submitted but not confirmed filled within 6 seconds`,
  );
}

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
    return { simulated: true, confirmedFill: true };
  }
  return confirmFill(await submitPaperOrder(order));
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
    return { simulated: true, confirmedFill: true };
  }
  return confirmFill(await submitPaperOrder({
    symbol: input.ticker,
    qty: input.quantity,
    side: "sell",
    type: "market",
    time_in_force: "day",
    client_order_id: input.clientOrderId,
  }));
}

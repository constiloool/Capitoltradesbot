import { config } from "../config.js";
import type { CapitolTrade } from "../types/trade.js";
import { logger } from "../utils/logger.js";
import { evaluateTrade } from "../strategy/basicStrategy.js";
import { alpacaConfigured, submitPaperOrder, type AlpacaOrder } from "./alpacaClient.js";

// This software is not financial advice. Real execution must only be enabled
// after deliberate paper testing, risk controls, monitoring and legal review.
export async function placeOrderForTrade(trade: CapitolTrade): Promise<void> {
  const decision = evaluateTrade(trade);
  if (decision.action === "ignore") {
    logger.info("ALPACA", "Trade ignored", { ticker: trade.ticker, reason: decision.reason });
    return;
  }
  if (decision.action === "log-only") {
    logger.info("ALPACA", "Sell disclosure logged without an order", {
      ticker: trade.ticker,
      reason: decision.reason,
    });
    return;
  }

  const order: AlpacaOrder = {
    symbol: trade.ticker!,
    qty: config.paperOrderQty,
    side: "buy",
    type: "market",
    time_in_force: "day",
    client_order_id: `ctb-${trade.id.slice(0, 28)}`,
  };

  if (!config.tradingEnabled || !alpacaConfigured()) {
    logger.info("ALPACA", "Would place paper order", {
      ticker: order.symbol,
      side: order.side,
      qty: order.qty,
      reason: !config.tradingEnabled ? "TRADING_ENABLED=false" : "API keys missing",
    });
    return;
  }

  await submitPaperOrder(order);
  logger.info("ALPACA", "Paper order submitted", {
    ticker: order.symbol,
    side: order.side,
    qty: order.qty,
  });
}

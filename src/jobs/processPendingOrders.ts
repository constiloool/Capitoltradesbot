import { getMarketClock } from "../alpaca/alpacaClient.js";
import { processTradeSignal } from "../rules/processTradeSignal.js";
import { getDisclosureTrade } from "../storage/disclosureTradeRepository.js";
import {
  listPendingOrders,
  updatePendingOrder,
} from "../storage/pendingOrdersStore.js";
import { logger } from "../utils/logger.js";
import type { StrategyAccountSnapshot } from "../types/trading.js";

export async function processPendingOrders(
  marketOpen?: boolean,
  accountSnapshot?: StrategyAccountSnapshot,
): Promise<{ marketOpen: boolean; checked: number; executed: number }> {
  const pending = listPendingOrders();
  if (!pending.length) {
    if (marketOpen !== undefined) {
      return { marketOpen, checked: 0, executed: 0 };
    }
    try {
      const clock = await getMarketClock();
      return { marketOpen: clock.is_open, checked: 0, executed: 0 };
    } catch (error) {
      logger.error("MARKET", "Market clock unavailable", error);
      return { marketOpen: false, checked: 0, executed: 0 };
    }
  }

  let isOpen = marketOpen;
  if (isOpen === undefined) {
    try {
      isOpen = (await getMarketClock()).is_open;
    } catch (error) {
      logger.error("MARKET", "Market clock unavailable", error);
      return { marketOpen: false, checked: 0, executed: 0 };
    }
  }
  if (!isOpen) {
    logger.info("PENDING", "Regular US market is closed; pending orders retained", {
      count: pending.length,
    });
    return { marketOpen: false, checked: 0, executed: 0 };
  }

  let executed = 0;
  for (const order of pending) {
    const trade = getDisclosureTrade(order.tradeId);
    if (!trade) {
      updatePendingOrder(order.id, "SKIPPED", "Source trade no longer exists");
      continue;
    }
    try {
      const result = await processTradeSignal(trade, {
        marketOpen: true,
        allowPendingCreation: false,
        accountSnapshot,
      });
      const status = result.decision === "BUY" ? "EXECUTED" : "SKIPPED";
      updatePendingOrder(
        order.id,
        status,
        result.reason,
        result.alpacaOrderId,
      );
      if (status === "EXECUTED") executed += 1;
    } catch (error) {
      logger.error("PENDING", `Pending order failed for ${order.ticker}`, error);
    }
  }
  return { marketOpen: true, checked: pending.length, executed };
}

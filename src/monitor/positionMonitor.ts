import { config } from "../config.js";
import { getLatestPrice } from "../alpaca/alpacaClient.js";
import { executeSell } from "../execution/alpacaExecutor.js";
import {
  closePosition,
  listOpenPositions,
} from "../storage/positionsStore.js";
import { logTradeDecision } from "../storage/decisionLogger.js";
import type {
  BotPosition,
  PositionExitReason,
} from "../types/trading.js";
import { logger } from "../utils/logger.js";

export function evaluatePositionExit(
  position: BotPosition,
  currentPrice: number,
  now = new Date(),
): PositionExitReason | undefined {
  const performance = (currentPrice - position.entryPrice) / position.entryPrice;
  if (performance >= config.takeProfitPct) return "TAKE_PROFIT";
  if (performance <= -config.stopLossPct) return "STOP_LOSS";
  const entry = new Date(`${position.entryDate}T00:00:00Z`);
  const holdingDays = Math.floor(
    (now.getTime() - entry.getTime()) / 86_400_000,
  );
  if (holdingDays >= config.maxHoldingDays) return "TIME_EXIT";
  return undefined;
}

export async function monitorOpenPositions(): Promise<void> {
  for (const position of listOpenPositions()) {
    try {
      const currentPrice = await getLatestPrice(position.ticker);
      const reason = evaluatePositionExit(position, currentPrice);
      if (!reason) continue;
      const execution = await executeSell({
        ticker: position.ticker,
        quantity: position.quantity,
        reason,
        clientOrderId: `ctb-exit-${position.id.slice(0, 24)}`,
        forceSimulation: position.executionMode === "SIMULATED",
      });
      closePosition(position.id, reason, execution.orderId);
      logTradeDecision({
        tradeId: position.sourceTradeId,
        ticker: position.ticker,
        politicianName: position.politicianName,
        transactionDate: position.transactionDate,
        filingDate: position.filingDate,
        action: "sale",
        valueRange: String(position.notionalValue),
        politicianScore: 1,
        valueScore: 1,
        currentPrice,
        referencePrice: position.entryPrice,
        runupPct:
          (currentPrice - position.entryPrice) / position.entryPrice,
        calculatedPositionSize: position.notionalValue,
        finalPositionSize: position.notionalValue,
        decision: "SELL",
        reason,
        alpacaOrderId: execution.orderId,
        safeMode: config.safeMode,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        "MONITOR",
        `Position monitor failed for ${position.ticker}`,
        error,
      );
    }
  }
}

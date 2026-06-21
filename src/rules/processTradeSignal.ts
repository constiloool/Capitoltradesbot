import { config } from "../config.js";
import {
  alpacaConfigured,
  getAsset,
  getLatestPrice,
  getPaperAccount,
  getPositions,
  getReferencePrice,
} from "../alpaca/alpacaClient.js";
import { executeBuy } from "../execution/alpacaExecutor.js";
import {
  evaluateSignalEligibility,
  evaluateTradeRules,
} from "./tradeRules.js";
import { logTradeDecision } from "../storage/decisionLogger.js";
import { getPoliticianScore } from "../storage/politicianScoresStore.js";
import { createPendingOrder } from "../storage/pendingOrdersStore.js";
import {
  addSignalToPosition,
  createOpenPosition,
  findOpenPosition,
  totalOpenExposure,
} from "../storage/positionsStore.js";
import type { DisclosureTrade } from "../types/disclosure.js";
import type {
  MarketContext,
  RuleEvaluation,
  TradeDecisionLog,
  TradeDecisionType,
} from "../types/trading.js";

export type ProcessTradeResult = {
  decision: TradeDecisionType;
  reason: string;
  alpacaOrderId?: string;
};

function decisionLog(
  trade: DisclosureTrade,
  evaluation: RuleEvaluation,
  market?: MarketContext,
  alpacaOrderId?: string,
): TradeDecisionLog {
  return {
    tradeId: trade.id,
    ticker: trade.ticker,
    politicianName: trade.politicianName,
    transactionDate: trade.transactionDate,
    filingDate: trade.filingDate,
    action: trade.transactionType,
    valueRange: trade.amountRange,
    politicianScore: evaluation.politicianScore,
    valueScore: evaluation.valueScore,
    currentPrice: market?.currentPrice,
    referencePrice: market?.referencePrice,
    runupPct: evaluation.runupPct,
    accountEquity: market?.accountEquity,
    calculatedPositionSize: evaluation.calculatedPositionSize,
    finalPositionSize: evaluation.finalPositionSize,
    decision: evaluation.decision,
    reason: evaluation.reason,
    alpacaOrderId,
    safeMode: config.safeMode,
    createdAt: new Date().toISOString(),
  };
}

export async function processTradeSignal(
  trade: DisclosureTrade,
  options: { marketOpen: boolean; allowPendingCreation?: boolean },
): Promise<ProcessTradeResult> {
  const politicianScore = getPoliticianScore(trade.politicianName);
  const preliminary = evaluateSignalEligibility(trade, politicianScore);
  if (preliminary) {
    logTradeDecision(decisionLog(trade, preliminary));
    return { decision: preliminary.decision, reason: preliminary.reason };
  }

  const existingBotPosition = findOpenPosition(trade.ticker!);
  if (existingBotPosition) {
    const market: MarketContext = {
      accountEquity: 0,
      totalExposure: totalOpenExposure(),
      currentTickerExposure: existingBotPosition.notionalValue,
      brokerMinimumOrderValue: config.brokerMinimumOrderValue,
      tickerAlreadyHeld: true,
    };
    const evaluation = evaluateTradeRules(trade, market, politicianScore);
    addSignalToPosition(
      existingBotPosition,
      trade.id,
      trade.politicianName,
      trade.transactionDate,
    );
    logTradeDecision(decisionLog(trade, evaluation, market));
    return { decision: evaluation.decision, reason: evaluation.reason };
  }

  if (!alpacaConfigured()) {
    const evaluation: RuleEvaluation = {
      decision: "SKIP",
      reason: "Skipped because Alpaca credentials are missing",
      politicianScore,
      valueScore: 1,
      calculatedPositionSize: 0,
      finalPositionSize: 0,
      useNotional: false,
      notes: [],
    };
    logTradeDecision(decisionLog(trade, evaluation));
    return { decision: evaluation.decision, reason: evaluation.reason };
  }

  let account;
  let positions;
  let asset;
  let currentPrice;
  let referencePrice;
  try {
    [account, positions, asset, currentPrice, referencePrice] =
      await Promise.all([
        getPaperAccount(),
        getPositions(),
        getAsset(trade.ticker!),
        getLatestPrice(trade.ticker!),
        getReferencePrice(trade.ticker!, trade.transactionDate),
      ]);
  } catch (error) {
    const evaluation: RuleEvaluation = {
      decision: config.skipIfPriceHistoryMissing ? "SKIP" : "WATCHLIST",
      reason: `Market or account data unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
      politicianScore,
      valueScore: 1,
      calculatedPositionSize: 0,
      finalPositionSize: 0,
      useNotional: false,
      notes: [],
    };
    logTradeDecision(decisionLog(trade, evaluation));
    return { decision: evaluation.decision, reason: evaluation.reason };
  }
  const accountEquity = Number(account.equity);
  if (!Number.isFinite(accountEquity) || accountEquity <= 0) {
    const reason = "Alpaca account equity is unavailable";
    const evaluation: RuleEvaluation = {
      decision: "SKIP",
      reason,
      politicianScore,
      valueScore: 1,
      calculatedPositionSize: 0,
      finalPositionSize: 0,
      useNotional: false,
      notes: [],
    };
    logTradeDecision(decisionLog(trade, evaluation));
    return { decision: "SKIP", reason };
  }
  const brokerPosition = positions.find(
    (position) => position.symbol === trade.ticker,
  );
  const market: MarketContext = {
    accountEquity,
    totalExposure: totalOpenExposure(),
    currentTickerExposure: brokerPosition
      ? Math.abs(Number(brokerPosition.market_value))
      : 0,
    currentPrice,
    referencePrice,
    tradable: asset.tradable && asset.status === "active",
    fractionable: asset.fractionable,
    brokerMinimumOrderValue: config.brokerMinimumOrderValue,
    tickerAlreadyHeld: Boolean(brokerPosition),
  };
  const evaluation = evaluateTradeRules(trade, market, politicianScore);
  if (evaluation.decision !== "BUY") {
    logTradeDecision(decisionLog(trade, evaluation, market));
    return { decision: evaluation.decision, reason: evaluation.reason };
  }

  if (!options.marketOpen) {
    const reason =
      "Market is closed; signal stored as pending for next regular session";
    if (options.allowPendingCreation !== false) {
      createPendingOrder(trade.id, trade.ticker!, reason);
    }
    const pendingEvaluation: RuleEvaluation = {
      ...evaluation,
      decision: "PENDING",
      reason,
    };
    logTradeDecision(decisionLog(trade, pendingEvaluation, market));
    return { decision: "PENDING", reason };
  }

  const quantity = evaluation.useNotional
    ? evaluation.finalPositionSize / currentPrice
    : evaluation.quantity!;
  let execution;
  try {
    execution = await executeBuy({
      ticker: trade.ticker!,
      quantity: evaluation.useNotional ? undefined : evaluation.quantity,
      notional: evaluation.useNotional
        ? Number(evaluation.finalPositionSize.toFixed(2))
        : undefined,
      clientOrderId: `ctb-buy-${trade.id.slice(0, 24)}`,
    });
  } catch (error) {
    const failed = {
      ...evaluation,
      decision: "SKIP" as const,
      reason: `Order execution failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
    logTradeDecision(decisionLog(trade, failed, market));
    return { decision: "SKIP", reason: failed.reason };
  }
  createOpenPosition({
    ticker: trade.ticker!,
    entryPrice: currentPrice,
    quantity,
    notionalValue: evaluation.finalPositionSize,
    politicianName: trade.politicianName,
    sourceTradeId: trade.id,
    disclosureId: trade.filingId,
    transactionDate: trade.transactionDate,
    filingDate: trade.filingDate,
    alpacaOrderId: execution.orderId,
    executionMode: execution.simulated ? "SIMULATED" : "PAPER",
  });
  logTradeDecision(
    decisionLog(trade, evaluation, market, execution.orderId),
  );
  return {
    decision: "BUY",
    reason: evaluation.reason,
    alpacaOrderId: execution.orderId,
  };
}

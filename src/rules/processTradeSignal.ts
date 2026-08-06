import { config } from "../config.js";
import {
  alpacaConfigured,
  getAsset,
  getLatestPrice,
  getPositions,
  getReferencePrice,
  type AlpacaAsset,
  type AlpacaPosition,
} from "../alpaca/alpacaClient.js";
import {
  executeBuy,
  type ExecutionResult,
} from "../execution/alpacaExecutor.js";
import {
  evaluateSignalEligibility,
  evaluateTradeRules,
} from "./tradeRules.js";
import {
  resolveTradeDate,
  shouldCopyTrade,
  tradeAgeInCalendarDays,
} from "./copyTradeRule.js";
import { logTradeDecision } from "../storage/decisionLogger.js";
import { getPoliticianScore } from "../storage/politicianScoresStore.js";
import { createPendingOrder } from "../storage/pendingOrdersStore.js";
import {
  addPurchaseToPosition,
  createOpenPosition,
  findOpenPosition,
  totalOpenExposure,
} from "../storage/positionsStore.js";
import { logger } from "../utils/logger.js";
import type { DisclosureTrade } from "../types/disclosure.js";
import type {
  MarketContext,
  RuleEvaluation,
  StrategyAccountSnapshot,
  TradeDecisionLog,
  TradeDecisionType,
} from "../types/trading.js";

export type ProcessTradeResult = {
  decision: TradeDecisionType;
  reason: string;
  alpacaOrderId?: string;
};

export type TradeSignalDependencies = {
  isAlpacaConfigured(): boolean;
  getBrokerPositions(): Promise<AlpacaPosition[]>;
  getBrokerAsset(symbol: string): Promise<AlpacaAsset>;
  getCurrentPrice(symbol: string): Promise<number>;
  getHistoricalReferencePrice(
    symbol: string,
    transactionDate: string,
  ): Promise<number | undefined>;
  executeBuyOrder(input: {
    ticker: string;
    quantity?: number;
    notional?: number;
    clientOrderId: string;
  }): Promise<ExecutionResult>;
};

const defaultDependencies: TradeSignalDependencies = {
  isAlpacaConfigured: alpacaConfigured,
  getBrokerPositions: getPositions,
  getBrokerAsset: getAsset,
  getCurrentPrice: getLatestPrice,
  getHistoricalReferencePrice: getReferencePrice,
  executeBuyOrder: executeBuy,
};

function decisionLog(
  trade: DisclosureTrade,
  evaluation: RuleEvaluation,
  market?: MarketContext,
  alpacaOrderId?: string,
): TradeDecisionLog {
  const resolvedDate = resolveTradeDate(trade);
  return {
    tradeId: trade.id,
    ticker: trade.ticker,
    politicianName: trade.politicianName,
    transactionDate: trade.transactionDate,
    filingDate: trade.filingDate,
    effectiveTradeDate:
      evaluation.effectiveTradeDate ?? resolvedDate?.tradeDate,
    tradeDateSource: evaluation.tradeDateSource ?? resolvedDate?.source,
    tradeAgeDays:
      evaluation.tradeAgeDays ??
      (resolvedDate
        ? tradeAgeInCalendarDays(resolvedDate.tradeDate)
        : undefined),
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
  options: {
    marketOpen: boolean;
    allowPendingCreation?: boolean;
    accountSnapshot?: StrategyAccountSnapshot;
  },
  dependencies: TradeSignalDependencies = defaultDependencies,
): Promise<ProcessTradeResult> {
  const politicianScore = getPoliticianScore(trade.politicianName);
  const preliminary = evaluateSignalEligibility(trade, politicianScore);
  if (preliminary) {
    logTradeDecision(decisionLog(trade, preliminary));
    return { decision: preliminary.decision, reason: preliminary.reason };
  }

  const existingBotPosition = findOpenPosition(trade.ticker!);

  if (!dependencies.isAlpacaConfigured()) {
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
  if (!options.accountSnapshot) {
    const reason = "Could not load Alpaca account equity";
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

  let positions;
  let asset;
  let currentPrice;
  let referencePrice;
  let copyRule;
  try {
    [positions, asset, copyRule] =
      await Promise.all([
        dependencies.getBrokerPositions(),
        dependencies.getBrokerAsset(trade.ticker!),
        shouldCopyTrade(trade, {
          getCurrentPrice: dependencies.getCurrentPrice,
          getHistoricalClose: dependencies.getHistoricalReferencePrice,
        }),
      ]);
    currentPrice = copyRule.currentPrice;
    referencePrice = copyRule.referencePrice;
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
    logTradeDecision(
      decisionLog(trade, evaluation, {
        accountEquity: options.accountSnapshot.accountEquity,
        totalExposure: totalOpenExposure(),
        currentTickerExposure: 0,
        minOrderValueUsd: config.minOrderValueUsd,
        tickerAlreadyHeld: false,
      }),
    );
    return { decision: evaluation.decision, reason: evaluation.reason };
  }
  const accountEquity = options.accountSnapshot.accountEquity;
  if (
    accountEquity === undefined ||
    !Number.isFinite(accountEquity) ||
    accountEquity <= 0
  ) {
    const reason = "Could not load Alpaca account equity";
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
    (position) => position.symbol.toUpperCase() === trade.ticker!.toUpperCase(),
  );
  const brokerPositionValue = brokerPosition
    ? Math.abs(Number(brokerPosition.market_value))
    : 0;
  const botPositionValue = existingBotPosition
    ? existingBotPosition.quantity * currentPrice!
    : 0;
  const currentTickerExposure = Math.max(
    Number.isFinite(brokerPositionValue) ? brokerPositionValue : 0,
    botPositionValue,
  );
  const market: MarketContext = {
    accountEquity,
    totalExposure: totalOpenExposure(),
    currentTickerExposure,
    currentPrice,
    referencePrice,
    tradable: asset.tradable && asset.status === "active",
    fractionable: asset.fractionable,
    minOrderValueUsd: config.minOrderValueUsd,
    tickerAlreadyHeld: Boolean(brokerPosition || existingBotPosition),
  };
  const evaluation = evaluateTradeRules(trade, market, politicianScore);
  if (evaluation.decision !== "BUY") {
    if (evaluation.reason.includes("MAX_POSITION_PERCENT_PER_TICKER")) {
      logger.info("STRATEGY", evaluation.reason, {
        ticker: trade.ticker,
        currentPositionValue: currentTickerExposure,
        portfolioValue: accountEquity,
      });
    } else if (evaluation.reason.includes("MIN_ORDER_VALUE_USD")) {
      logger.info("STRATEGY", evaluation.reason, { ticker: trade.ticker });
    }
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

  const executionPrice = currentPrice!;
  const quantity = evaluation.useNotional
    ? evaluation.finalPositionSize / executionPrice
    : evaluation.quantity!;
  let execution;
  if (existingBotPosition) {
    logger.info("STRATEGY", "Additional purchase allowed for existing position", {
      ticker: trade.ticker,
      currentPositionValue: currentTickerExposure,
      orderValue: evaluation.finalPositionSize,
    });
  }
  if (evaluation.notes.some((note) => note.includes("MAX_POSITION_PERCENT_PER_TICKER"))) {
    logger.info("STRATEGY", "Order reduced by per-ticker position limit", {
      ticker: trade.ticker,
      plannedOrderValue: evaluation.calculatedPositionSize,
      finalOrderValue: evaluation.finalPositionSize,
    });
  }
  try {
    execution = await dependencies.executeBuyOrder({
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
  const effectiveTradeDate =
    resolveTradeDate(trade)?.tradeDate || trade.filingDate;
  const positionInput = {
    ticker: trade.ticker!,
    entryPrice: executionPrice,
    quantity,
    notionalValue: evaluation.finalPositionSize,
    politicianName: trade.politicianName,
    sourceTradeId: trade.id,
    disclosureId: trade.filingId,
    transactionDate: effectiveTradeDate,
    filingDate: trade.filingDate,
    alpacaOrderId: execution.orderId,
    executionMode: execution.simulated ? "SIMULATED" : "PAPER",
  } as const;
  if (existingBotPosition) {
    addPurchaseToPosition(existingBotPosition, {
      tradeId: trade.id,
      politicianName: trade.politicianName,
      signalDate: effectiveTradeDate,
      price: executionPrice,
      quantity,
      notionalValue: evaluation.finalPositionSize,
      alpacaOrderId: execution.orderId,
    });
  } else {
    createOpenPosition(positionInput);
  }
  logTradeDecision(
    decisionLog(trade, evaluation, market, execution.orderId),
  );
  return {
    decision: "BUY",
    reason: evaluation.reason,
    alpacaOrderId: execution.orderId,
  };
}

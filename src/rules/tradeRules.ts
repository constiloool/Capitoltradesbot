import { config } from "../config.js";
import { calculatePositionSize } from "../risk/positionSizing.js";
import type { DisclosureTrade } from "../types/disclosure.js";
import type { MarketContext, RuleEvaluation } from "../types/trading.js";
import {
  evaluateCopyTradeRule,
  resolveTradeDate,
  tradeAgeInCalendarDays,
} from "./copyTradeRule.js";

export function valueScoreForRange(amountRange: string): {
  score: number;
  note?: string;
} {
  const values = [...amountRange.matchAll(/\$?([\d,]+)/g)].map((match) =>
    Number(match[1].replace(/,/g, "")),
  );
  const upper = values.at(-1);
  if (upper === undefined) {
    return {
      score: 1,
      note: "Unknown value range, using default value score",
    };
  }
  if (upper <= 15_000) return { score: 0.5 };
  if (upper <= 50_000) return { score: 1 };
  if (upper <= 100_000) return { score: 1.25 };
  return { score: 1.5 };
}

function skipped(
  reason: string,
  politicianScore: number,
  valueScore: number,
  notes: string[] = [],
  runupPct?: number,
  dateDetails?: Pick<
    RuleEvaluation,
    "effectiveTradeDate" | "tradeDateSource" | "tradeAgeDays"
  >,
): RuleEvaluation {
  return {
    decision: "SKIP",
    reason,
    politicianScore,
    valueScore,
    runupPct,
    ...dateDetails,
    calculatedPositionSize: 0,
    finalPositionSize: 0,
    useNotional: false,
    notes,
  };
}

export function evaluateSignalEligibility(
  trade: DisclosureTrade,
  politicianScore: number,
  now = new Date(),
): RuleEvaluation | undefined {
  const value = valueScoreForRange(trade.amountRange);
  const notes = value.note ? [value.note] : [];
  if (trade.transactionType !== "purchase") {
    return skipped(
      "Transaction action is not BUY/PURCHASE",
      politicianScore,
      value.score,
      notes,
    );
  }
  const resolvedDate = resolveTradeDate(trade);
  if (!resolvedDate) {
    return skipped(
      "Skipped because transaction and filing dates are missing",
      politicianScore,
      value.score,
      notes,
    );
  }
  const age = tradeAgeInCalendarDays(resolvedDate.tradeDate, now);
  const dateDetails = {
    effectiveTradeDate: resolvedDate.tradeDate,
    tradeDateSource: resolvedDate.source,
    tradeAgeDays: age,
  };
  if (age === undefined) {
    return skipped(
      "Skipped because transaction and filing dates are missing",
      politicianScore,
      value.score,
      notes,
      undefined,
      dateDetails,
    );
  }
  if (age < 0 || age > config.maxTradeAgeDays) {
    return skipped(
      `Skipped because trade is older than ${config.maxTradeAgeDays} days`,
      politicianScore,
      value.score,
      notes,
      undefined,
      dateDetails,
    );
  }
  if (!trade.ticker?.trim()) {
    return skipped(
      "Skipped because ticker is missing",
      politicianScore,
      value.score,
      notes,
      undefined,
      dateDetails,
    );
  }
  if (politicianScore === 0) {
    return skipped(
      "Politician score is 0",
      0,
      value.score,
      notes,
      undefined,
      dateDetails,
    );
  }
  return undefined;
}

export function evaluateTradeRules(
  trade: DisclosureTrade,
  market: MarketContext,
  politicianScore: number,
  now = new Date(),
): RuleEvaluation {
  const value = valueScoreForRange(trade.amountRange);
  const notes = value.note ? [value.note] : [];
  const ineligible = evaluateSignalEligibility(trade, politicianScore, now);
  if (ineligible) return ineligible;
  const copyRule = evaluateCopyTradeRule(
    trade,
    {
      currentPrice: market.currentPrice,
      referencePrice: market.referencePrice,
    },
    now,
  );
  const dateDetails = {
    effectiveTradeDate: copyRule.tradeDate,
    tradeDateSource: copyRule.tradeDateSource,
    tradeAgeDays: copyRule.ageDays,
  };
  if (market.tradable !== true) {
    return skipped(
      "Skipped because ticker is not tradable on Alpaca",
      politicianScore,
      value.score,
      notes,
    );
  }
  if (market.currentPrice === undefined) {
    return skipped(
      "Skipped because current price is missing",
      politicianScore,
      value.score,
      notes,
      undefined,
      dateDetails,
    );
  }
  if (market.currentPrice < config.minSharePrice) {
    return skipped(
      "Skipped because share price is below MIN_SHARE_PRICE",
      politicianScore,
      value.score,
      notes,
      undefined,
      dateDetails,
    );
  }
  if (!copyRule.shouldCopy) {
    return skipped(
      copyRule.reason,
      politicianScore,
      value.score,
      notes,
      copyRule.priceChangePct,
      dateDetails,
    );
  }
  const runupPct = copyRule.priceChangePct;

  const sizing = calculatePositionSize({
    politicianScore,
    valueScore: value.score,
    market,
  });
  if (sizing.skipReason) {
    return {
      decision: "SKIP",
      reason: sizing.skipReason,
      politicianScore,
      valueScore: value.score,
      runupPct,
      ...sizing,
    };
  }
  return {
    decision: "BUY",
    reason: market.tickerAlreadyHeld
      ? "Additional BUY/PURCHASE passed all rules"
      : "Fresh BUY/PURCHASE signal passed all rules",
    politicianScore,
    valueScore: value.score,
    runupPct,
    ...dateDetails,
    ...sizing,
  };
}

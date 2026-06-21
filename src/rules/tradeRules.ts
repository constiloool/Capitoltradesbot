import { config } from "../config.js";
import { calculatePositionSize } from "../risk/positionSizing.js";
import type { DisclosureTrade } from "../types/disclosure.js";
import type { MarketContext, RuleEvaluation } from "../types/trading.js";

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

function ageInCalendarDays(date: string, now: Date): number | undefined {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!date || Number.isNaN(parsed.getTime())) return undefined;
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((today - parsed.getTime()) / 86_400_000);
}

function skipped(
  reason: string,
  politicianScore: number,
  valueScore: number,
  notes: string[] = [],
  runupPct?: number,
): RuleEvaluation {
  return {
    decision: "SKIP",
    reason,
    politicianScore,
    valueScore,
    runupPct,
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
  if (!trade.transactionDate) {
    return skipped(
      "Skipped because transaction date is missing",
      politicianScore,
      value.score,
      notes,
    );
  }
  const age = ageInCalendarDays(trade.transactionDate, now);
  if (age === undefined) {
    return skipped(
      "Skipped because transaction date is missing",
      politicianScore,
      value.score,
      notes,
    );
  }
  if (age < 0 || age > config.maxTradeAgeDays) {
    return skipped(
      "Skipped because transaction is older than MAX_TRADE_AGE_DAYS",
      politicianScore,
      value.score,
      notes,
    );
  }
  if (!trade.ticker?.trim()) {
    return skipped(
      "Skipped because ticker is missing",
      politicianScore,
      value.score,
      notes,
    );
  }
  if (politicianScore === 0) {
    return skipped("Politician score is 0", 0, value.score, notes);
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
  if (market.tickerAlreadyHeld) {
    return {
      decision: "WATCHLIST",
      reason: "Ticker already held, signal added to existing position",
      politicianScore,
      valueScore: value.score,
      calculatedPositionSize: 0,
      finalPositionSize: 0,
      useNotional: false,
      notes,
    };
  }
  if (market.tradable !== true) {
    return skipped(
      "Skipped because ticker is not tradable on Alpaca",
      politicianScore,
      value.score,
      notes,
    );
  }
  if (
    market.currentPrice === undefined ||
    market.currentPrice < config.minSharePrice
  ) {
    return skipped(
      "Skipped because share price is below MIN_SHARE_PRICE",
      politicianScore,
      value.score,
      notes,
    );
  }
  if (market.referencePrice === undefined) {
    return {
      decision: config.skipIfPriceHistoryMissing ? "SKIP" : "WATCHLIST",
      reason: config.skipIfPriceHistoryMissing
        ? "Skipped because price history is missing"
        : "Price history missing, signal added to watchlist",
      politicianScore,
      valueScore: value.score,
      calculatedPositionSize: 0,
      finalPositionSize: 0,
      useNotional: false,
      notes,
    };
  }

  const runupPct =
    (market.currentPrice - market.referencePrice) / market.referencePrice;
  if (runupPct > config.maxRunupPct) {
    return skipped(
      "Skipped because price already ran up more than MAX_RUNUP_PCT",
      politicianScore,
      value.score,
      notes,
      runupPct,
    );
  }

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
    reason: "Fresh BUY/PURCHASE signal passed all rules",
    politicianScore,
    valueScore: value.score,
    runupPct,
    ...sizing,
  };
}

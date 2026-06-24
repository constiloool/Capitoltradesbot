import { config } from "../config.js";
import type { DisclosureTrade } from "../types/disclosure.js";

export type TradeDateSource = "transaction_date" | "filing_date_fallback";

export type CopyTradeMarketData = {
  getCurrentPrice(ticker: string): Promise<number | undefined>;
  getHistoricalClose(
    ticker: string,
    tradeDate: string,
  ): Promise<number | undefined>;
};

export type CopyTradeRuleResult = {
  shouldCopy: boolean;
  decision: "BUY" | "SKIP";
  reason: string;
  ticker?: string;
  tradeDate?: string;
  tradeDateSource?: TradeDateSource;
  ageDays?: number;
  referencePrice?: number;
  currentPrice?: number;
  priceChangePct?: number;
};

function validIsoDate(value?: string): value is string {
  if (!value) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

export function resolveTradeDate(
  trade: Pick<DisclosureTrade, "transactionDate" | "filingDate">,
): { tradeDate: string; source: TradeDateSource } | undefined {
  if (validIsoDate(trade.transactionDate)) {
    return { tradeDate: trade.transactionDate, source: "transaction_date" };
  }
  if (validIsoDate(trade.filingDate)) {
    return {
      tradeDate: trade.filingDate,
      source: "filing_date_fallback",
    };
  }
  return undefined;
}

export function tradeAgeInCalendarDays(
  tradeDate: string,
  now = new Date(),
): number | undefined {
  if (!validIsoDate(tradeDate)) return undefined;
  const parsed = new Date(`${tradeDate}T00:00:00Z`);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((today - parsed.getTime()) / 86_400_000);
}

function skip(
  reason: string,
  details: Omit<
    CopyTradeRuleResult,
    "shouldCopy" | "decision" | "reason"
  > = {},
): CopyTradeRuleResult {
  return { shouldCopy: false, decision: "SKIP", reason, ...details };
}

export function evaluateCopyTradeRule(
  trade: DisclosureTrade,
  prices: { referencePrice?: number; currentPrice?: number },
  now = new Date(),
): CopyTradeRuleResult {
  const ticker = trade.ticker?.trim().toUpperCase();
  if (!ticker) return skip("Skipped because ticker is missing");

  const resolvedDate = resolveTradeDate(trade);
  if (!resolvedDate) {
    return skip("Skipped because transaction and filing dates are missing", {
      ticker,
    });
  }

  const ageDays = tradeAgeInCalendarDays(resolvedDate.tradeDate, now);
  const common = {
    ticker,
    tradeDate: resolvedDate.tradeDate,
    tradeDateSource: resolvedDate.source,
    ageDays,
  };
  if (
    ageDays === undefined ||
    ageDays < 0 ||
    ageDays > config.maxTradeAgeDays
  ) {
    return skip(
      `Skipped because trade is older than ${config.maxTradeAgeDays} days`,
      common,
    );
  }

  const referencePrice = prices.referencePrice;
  const currentPrice = prices.currentPrice;
  if (
    referencePrice === undefined ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0
  ) {
    return skip("Skipped because historical price is missing", {
      ...common,
      currentPrice:
        currentPrice !== undefined && Number.isFinite(currentPrice)
          ? currentPrice
          : undefined,
    });
  }

  if (
    currentPrice === undefined ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return skip("Skipped because current price is missing", {
      ...common,
      referencePrice,
    });
  }

  const priceChangePct = (currentPrice - referencePrice) / referencePrice;
  const details = {
    ...common,
    referencePrice,
    currentPrice,
    priceChangePct,
  };
  if (priceChangePct > config.maxRunupPct) {
    return skip(
      `Skipped because price increased more than ${config.maxRunupPct * 100}% since trade date`,
      details,
    );
  }

  return {
    shouldCopy: true,
    decision: "BUY",
    reason: "Trade age and price-change rules passed",
    ...details,
  };
}

export async function shouldCopyTrade(
  trade: DisclosureTrade,
  marketData: CopyTradeMarketData,
  now = new Date(),
): Promise<CopyTradeRuleResult> {
  const ticker = trade.ticker?.trim().toUpperCase();
  if (!ticker) return evaluateCopyTradeRule(trade, {}, now);

  const resolvedDate = resolveTradeDate(trade);
  if (!resolvedDate) return evaluateCopyTradeRule(trade, {}, now);

  const ageDays = tradeAgeInCalendarDays(resolvedDate.tradeDate, now);
  if (
    ageDays === undefined ||
    ageDays < 0 ||
    ageDays > config.maxTradeAgeDays
  ) {
    return evaluateCopyTradeRule(trade, {}, now);
  }

  const [referenceResult, currentResult] = await Promise.allSettled([
    marketData.getHistoricalClose(ticker, resolvedDate.tradeDate),
    marketData.getCurrentPrice(ticker),
  ]);
  const referencePrice =
    referenceResult.status === "fulfilled"
      ? referenceResult.value
      : undefined;
  const currentPrice =
    currentResult.status === "fulfilled" ? currentResult.value : undefined;
  return evaluateCopyTradeRule(
    trade,
    { referencePrice, currentPrice },
    now,
  );
}

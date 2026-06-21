import { config } from "../config.js";
import type { MarketContext, RuleEvaluation } from "../types/trading.js";

export type PositionSizeInput = {
  politicianScore: number;
  valueScore: number;
  market: MarketContext;
};

export function calculatePositionSize(
  input: PositionSizeInput,
): Pick<
  RuleEvaluation,
  | "calculatedPositionSize"
  | "finalPositionSize"
  | "quantity"
  | "useNotional"
  | "notes"
> & { skipReason?: string } {
  const { market, politicianScore, valueScore } = input;
  const calculated =
    market.accountEquity *
    config.basePositionPct *
    politicianScore *
    valueScore;
  const tickerCapacity =
    market.accountEquity * config.maxPositionPerTickerPct -
    market.currentTickerExposure;
  const totalCapacity =
    market.accountEquity * config.maxTotalExposurePct - market.totalExposure;

  if (tickerCapacity <= 0) {
    return {
      calculatedPositionSize: calculated,
      finalPositionSize: 0,
      useNotional: false,
      notes: [],
      skipReason: "Skipped because max ticker exposure would be exceeded",
    };
  }
  if (totalCapacity <= 0) {
    return {
      calculatedPositionSize: calculated,
      finalPositionSize: 0,
      useNotional: false,
      notes: [],
      skipReason: "Skipped because max total exposure would be exceeded",
    };
  }

  let finalPositionSize = Math.min(calculated, tickerCapacity, totalCapacity);
  const notes =
    finalPositionSize < calculated
      ? ["Position size reduced due to exposure limits"]
      : [];
  const price = market.currentPrice ?? 0;

  if (market.fractionable) {
    if (finalPositionSize < market.brokerMinimumOrderValue) {
      return {
        calculatedPositionSize: calculated,
        finalPositionSize,
        useNotional: true,
        notes,
        skipReason:
          "Skipped because calculated order value is below broker minimum",
      };
    }
    return {
      calculatedPositionSize: calculated,
      finalPositionSize,
      useNotional: true,
      notes,
    };
  }

  const quantity = price > 0 ? Math.floor(finalPositionSize / price) : 0;
  finalPositionSize = quantity * price;
  if (quantity < 1 || finalPositionSize < market.brokerMinimumOrderValue) {
    return {
      calculatedPositionSize: calculated,
      finalPositionSize,
      quantity,
      useNotional: false,
      notes,
      skipReason:
        "Skipped because calculated order value is below broker minimum",
    };
  }
  return {
    calculatedPositionSize: calculated,
    finalPositionSize,
    quantity,
    useNotional: false,
    notes,
  };
}

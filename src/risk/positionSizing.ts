import { config } from "../config.js";
import type { MarketContext, RuleEvaluation } from "../types/trading.js";

export type PositionSizeInput = {
  politicianScore: number;
  valueScore: number;
  market: MarketContext;
};

export type PositionLimitDecision =
  | "allowed"
  | "reduced"
  | "skipped_position_limit"
  | "skipped_min_order";

export type AllowedOrderValueResult = {
  finalOrderValue: number;
  status: PositionLimitDecision;
  reason: string;
};

export function calculateAllowedOrderValue(
  portfolioValue: number,
  currentPositionValue: number,
  plannedOrderValue: number,
  maxPositionPercent: number,
  minOrderValue: number,
): AllowedOrderValueResult {
  const maxPositionValue = portfolioValue * (maxPositionPercent / 100);
  const remainingAllowedValue = maxPositionValue - currentPositionValue;

  if (remainingAllowedValue <= 0) {
    return {
      finalOrderValue: 0,
      status: "skipped_position_limit",
      reason: "Skipped because position is already at MAX_POSITION_PERCENT_PER_TICKER limit",
    };
  }

  const finalOrderValue = Math.min(plannedOrderValue, remainingAllowedValue);
  if (finalOrderValue < minOrderValue) {
    return {
      finalOrderValue: 0,
      status: "skipped_min_order",
      reason: "Skipped because reduced order value is below MIN_ORDER_VALUE_USD",
    };
  }

  if (finalOrderValue < plannedOrderValue) {
    return {
      finalOrderValue,
      status: "reduced",
      reason: "Order value reduced due to MAX_POSITION_PERCENT_PER_TICKER limit",
    };
  }

  return {
    finalOrderValue,
    status: "allowed",
    reason:
      currentPositionValue > 0
        ? "Additional purchase allowed below per-ticker position limit"
        : "Purchase allowed below per-ticker position limit",
  };
}

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
  const totalCapacity =
    market.accountEquity * config.maxTotalExposurePct - market.totalExposure;
  if (totalCapacity <= 0) {
    return {
      calculatedPositionSize: calculated,
      finalPositionSize: 0,
      useNotional: false,
      notes: [],
      skipReason: "Skipped because max total exposure would be exceeded",
    };
  }

  const plannedOrderValue = Math.min(calculated, totalCapacity);
  const positionLimit = calculateAllowedOrderValue(
    market.accountEquity,
    market.currentTickerExposure,
    plannedOrderValue,
    config.maxPositionPercentPerTicker,
    config.minOrderValueUsd,
  );
  if (positionLimit.status.startsWith("skipped_")) {
    return {
      calculatedPositionSize: calculated,
      finalPositionSize: 0,
      useNotional: false,
      notes: [],
      skipReason: positionLimit.reason,
    };
  }
  let finalPositionSize = positionLimit.finalOrderValue;
  const notes: string[] = [];
  if (plannedOrderValue < calculated) {
    notes.push("Position size reduced due to total exposure limit");
  }
  if (positionLimit.status === "reduced") notes.push(positionLimit.reason);
  if (market.currentTickerExposure > 0 && positionLimit.status === "allowed") {
    notes.push(positionLimit.reason);
  }
  const price = market.currentPrice ?? 0;

  if (market.fractionable) {
    if (finalPositionSize < config.minOrderValueUsd) {
      return {
        calculatedPositionSize: calculated,
        finalPositionSize,
        useNotional: true,
        notes,
        skipReason:
          "Skipped because order value is below MIN_ORDER_VALUE_USD",
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
  if (quantity < 1 || finalPositionSize < config.minOrderValueUsd) {
    return {
      calculatedPositionSize: calculated,
      finalPositionSize,
      quantity,
      useNotional: false,
      notes,
      skipReason:
        "Skipped because order value is below MIN_ORDER_VALUE_USD",
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

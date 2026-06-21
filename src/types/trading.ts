import type { DisclosureTrade } from "./disclosure.js";

export type TradeDecisionType =
  | "BUY"
  | "SKIP"
  | "WATCHLIST"
  | "EXIT_SIGNAL"
  | "SELL";

export type MarketContext = {
  accountEquity: number;
  totalExposure: number;
  currentTickerExposure: number;
  currentPrice?: number;
  referencePrice?: number;
  tradable?: boolean;
  fractionable?: boolean;
  brokerMinimumOrderValue: number;
  tickerAlreadyHeld: boolean;
};

export type RuleEvaluation = {
  decision: TradeDecisionType;
  reason: string;
  politicianScore: number;
  valueScore: number;
  runupPct?: number;
  calculatedPositionSize: number;
  finalPositionSize: number;
  quantity?: number;
  useNotional: boolean;
  notes: string[];
};

export type TradeDecisionLog = {
  tradeId: string;
  ticker?: string;
  politicianName: string;
  transactionDate: string;
  filingDate: string;
  action: string;
  valueRange: string;
  politicianScore: number;
  valueScore: number;
  currentPrice?: number;
  referencePrice?: number;
  runupPct?: number;
  accountEquity?: number;
  calculatedPositionSize?: number;
  finalPositionSize?: number;
  decision: TradeDecisionType;
  reason: string;
  alpacaOrderId?: string;
  safeMode: boolean;
  createdAt: string;
};

export type BotPositionStatus = "OPEN" | "CLOSED";
export type PositionExecutionMode = "SIMULATED" | "PAPER";
export type PositionExitReason = "TAKE_PROFIT" | "STOP_LOSS" | "TIME_EXIT";

export type BotPosition = {
  id: string;
  ticker: string;
  entryDate: string;
  entryPrice: number;
  quantity: number;
  notionalValue: number;
  politicianName: string;
  politicianNames: string[];
  sourceTradeId: string;
  disclosureId: string;
  transactionDate: string;
  filingDate: string;
  signalCount: number;
  lastSignalDate: string;
  clusterSignal: boolean;
  status: BotPositionStatus;
  executionMode: PositionExecutionMode;
  exitReason?: PositionExitReason;
  alpacaOrderId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ExecutableTrade = {
  trade: DisclosureTrade;
  evaluation: RuleEvaluation;
  market: MarketContext;
};

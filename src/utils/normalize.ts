import { createHash } from "node:crypto";
import type { TradeDraft, TransactionType } from "../types/trade.js";

export function cleanText(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeTicker(rawTicker?: string): string | undefined {
  const value = cleanText(rawTicker).toUpperCase();
  if (!value) return undefined;
  const [ticker, market] = value.split(":");
  if (market && market !== "US") return undefined;
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : undefined;
}

function amount(value: string): number | undefined {
  const match = value.replace(/[$,\s]/g, "").match(/^([\d.]+)([KMB])?$/i);
  if (!match) return undefined;
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[
    (match[2]?.toUpperCase() || "") as "K" | "M" | "B"
  ] ?? 1;
  return Number(match[1]) * multiplier;
}

export function parseTradeSize(value?: string): { min?: number; max?: number } {
  const normalized = cleanText(value).replace(/[–—]/g, "-");
  if (!normalized) return {};
  const parts = normalized.split("-").map(amount).filter((item) => item !== undefined);
  if (parts.length === 1) return { min: parts[0], max: parts[0] };
  return { min: parts[0], max: parts[1] };
}

export function parsePrice(value?: string): number | undefined {
  const numeric = cleanText(value).replace(/[^0-9.-]/g, "");
  if (!numeric) return undefined;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeTransactionType(value?: string): TransactionType {
  const normalized = cleanText(value).toLowerCase();
  if (/\b(buy|bought|purchase|purchased)\b/.test(normalized)) return "buy";
  if (/\b(sell|sold|sale)\b/.test(normalized)) return "sell";
  if (/\bexchange\b/.test(normalized)) return "exchange";
  return "unknown";
}

export function createTradeId(trade: TradeDraft): string {
  const identity = [
    trade.detailUrl || "",
    trade.politicianName,
    trade.issuerName,
    trade.rawTicker || "",
    trade.tradedAtRaw,
    trade.transactionType,
    trade.sizeRaw || "",
    trade.owner || "",
  ]
    .map((value) => cleanText(value).toLowerCase())
    .join("|");
  return createHash("sha256").update(identity).digest("hex");
}

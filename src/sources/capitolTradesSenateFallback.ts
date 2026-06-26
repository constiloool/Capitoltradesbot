import type { CapitolTrade, TransactionType } from "../types/trade.js";
import type {
  DisclosureFiling,
  DisclosureTradeDraft,
  DisclosureTransactionType,
} from "../types/disclosure.js";
import { cleanText } from "../utils/normalize.js";
import { scrapeCapitolTrades } from "../scraper/scrapeCapitolTrades.js";

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export type CapitolTradesSenateFallbackResult = {
  filings: DisclosureFiling[];
  trades: DisclosureTradeDraft[];
  skipped: number;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseCapitolTradesDate(
  value: string | undefined,
  now = new Date(),
): string | undefined {
  const text = cleanText(value).toLowerCase();
  if (!text) return undefined;
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (/\btoday\b/.test(text)) return isoDate(base);
  if (/\byesterday\b/.test(text)) {
    base.setUTCDate(base.getUTCDate() - 1);
    return isoDate(base);
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dayMonthYear = text.match(
    /\b(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/i,
  );
  if (!dayMonthYear) return undefined;
  const month = MONTHS[dayMonthYear[2].toLowerCase()];
  if (month === undefined) return undefined;
  const date = new Date(
    Date.UTC(Number(dayMonthYear[3]), month, Number(dayMonthYear[1])),
  );
  if (Number.isNaN(date.getTime())) return undefined;
  return isoDate(date);
}

function disclosureType(type: TransactionType): DisclosureTransactionType {
  if (type === "buy") return "purchase";
  if (type === "sell") return "sale";
  if (type === "exchange") return "exchange";
  return "other";
}

function fallbackFilingId(trade: CapitolTrade): string {
  return `senate:capitol-trades:${trade.id}`;
}

function toFallbackTrade(
  trade: CapitolTrade,
  now = new Date(),
): { filing: DisclosureFiling; trade: DisclosureTradeDraft } | undefined {
  if (trade.politicianChamber?.toLowerCase() !== "senate") return undefined;
  const filingDate = parseCapitolTradesDate(trade.publishedAtRaw, now);
  const transactionDate = parseCapitolTradesDate(trade.tradedAtRaw, now);
  if (!filingDate || !transactionDate) return undefined;
  const filingId = fallbackFilingId(trade);
  const sourceFilingId = `capitol-trades:${trade.id}`;
  const filing: DisclosureFiling = {
    id: filingId,
    source: "senate",
    sourceFilingId,
    politicianName: trade.politicianName,
    chamber: "Senate",
    filingType: "Periodic Transaction Report",
    filingDate,
    documentUrl: trade.detailUrl ?? trade.sourceUrl,
    documentKind: "html",
  };
  return {
    filing,
    trade: {
      filingId,
      source: "senate",
      sourceFilingId,
      politicianName: trade.politicianName,
      chamber: "Senate",
      transactionDate,
      filingDate,
      ticker: trade.ticker,
      assetName: trade.issuerName,
      transactionType: disclosureType(trade.transactionType),
      amountRange: trade.sizeRaw ?? "Undisclosed",
      owner: trade.owner,
      rawText: trade.rawJson,
      sourceUrl: trade.detailUrl ?? trade.sourceUrl,
    },
  };
}

export async function fetchCapitolTradesSenateFallback(): Promise<CapitolTradesSenateFallbackResult> {
  const scraped = await scrapeCapitolTrades();
  const filings = new Map<string, DisclosureFiling>();
  const trades: DisclosureTradeDraft[] = [];
  let skipped = 0;

  for (const scrapedTrade of scraped) {
    const converted = toFallbackTrade(scrapedTrade);
    if (!converted) {
      skipped += 1;
      continue;
    }
    filings.set(converted.filing.id, converted.filing);
    trades.push(converted.trade);
  }

  return {
    filings: [...filings.values()],
    trades,
    skipped,
  };
}

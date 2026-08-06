import * as cheerio from "cheerio";
import pdf from "pdf-parse/lib/pdf-parse.js";
import type {
  DisclosureFiling,
  DisclosureTradeDraft,
  DisclosureTransactionType,
} from "../types/disclosure.js";
import { cleanText, normalizeTicker } from "../utils/normalize.js";

export class NoDisclosureTradesRecognizedError extends Error {
  constructor(source: DisclosureFiling["source"]) {
    super(`No ${source === "house" ? "House" : "Senate"} PTR transaction rows recognized`);
    this.name = "NoDisclosureTradesRecognizedError";
  }
}

export function isNoDisclosureTradesRecognizedError(
  error: unknown,
): error is NoDisclosureTradesRecognizedError {
  return error instanceof NoDisclosureTradesRecognizedError;
}

function transactionType(value: string): DisclosureTransactionType {
  const normalized = cleanText(value).toLowerCase();
  if (/^(p|purchase|buy)/.test(normalized)) return "purchase";
  if (/^(s|sale|sell)/.test(normalized)) return "sale";
  if (/^(e|exchange)/.test(normalized)) return "exchange";
  return "other";
}

function isoDate(value: string): string {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match
    ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`
    : cleanText(value);
}

function trade(
  filing: DisclosureFiling,
  values: {
    transactionDate: string;
    assetName: string;
    ticker?: string;
    transactionType: string;
    amountRange: string;
    owner?: string;
    rawText?: string;
  },
): DisclosureTradeDraft {
  return {
    filingId: filing.id,
    source: filing.source,
    sourceFilingId: filing.sourceFilingId,
    politicianName: filing.politicianName,
    chamber: filing.chamber,
    transactionDate: isoDate(values.transactionDate),
    filingDate: filing.filingDate,
    ticker: normalizeTicker(values.ticker),
    assetName: cleanText(values.assetName),
    transactionType: transactionType(values.transactionType),
    amountRange: cleanText(values.amountRange),
    owner: cleanText(values.owner) || undefined,
    rawText: cleanText(values.rawText) || undefined,
    sourceUrl: filing.documentUrl,
  };
}

export function parseHousePtrText(
  text: string,
  filing: DisclosureFiling,
): DisclosureTradeDraft[] {
  let cleaned = text
    .replace(/\0/g, "")
    .replace(/\r/g, "");
  const firstHeader = cleaned.search(/AmountCap\.\s*Gains >\s*\$200\?/);
  if (firstHeader >= 0) {
    const header = cleaned
      .slice(firstHeader)
      .match(/AmountCap\.\s*Gains >\s*\$200\?/)![0];
    cleaned = cleaned.slice(firstHeader + header.length);
  } else {
    const plainHeader = cleaned.match(
      /ID\s+Owner\s+Asset\s+Transaction\s+Type\s+Date\s+Notification\s+Date\s+Amount[^\n]*/i,
    );
    if (plainHeader?.index !== undefined) {
      cleaned = cleaned.slice(plainHeader.index + plainHeader[0].length);
    }
  }
  cleaned = cleaned
    .replace(/Filing ID #[^\n]+/g, "")
    .replace(/(?:Filing\s+Status|F\s*S)\s*:\s*(?:New|Amendment)/gi, "")
    .replace(/S\s*O\s*:[^\n]*/gi, "")
    .replace(/IDOwnerAssetTransaction\s*Type\s*DateNotification\s*Date\s*AmountCap\.\s*Gains >\s*\$200\?/g, "");
  const rowPattern =
    /(?:^|\n)(?:(SP|DC|JT)\s*)?([\s\S]*?)(?:\s*\(([A-Z][A-Z0-9.-]{0,9})\))?\s*\[[A-Z]+\]\s*(P|S(?:\s*\(partial\))?|E)\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}\/\d{2}\/\d{4})\s*(\$[\d,]+\s*-\s*\$[\d,]+)/g;
  const trades: DisclosureTradeDraft[] = [];
  for (const match of cleaned.matchAll(rowPattern)) {
    let owner = match[1];
    let asset = cleanText(match[2]);
    const attachedOwner = asset.match(/^(SP|DC|JT)(?:\s+|(?=[A-Z]))/);
    if (!owner && attachedOwner) {
      owner = attachedOwner[1];
      asset = cleanText(asset.slice(attachedOwner[0].length));
    }
    if (!asset || /Clerk of the House|Filer Information|Transactions/i.test(asset)) {
      continue;
    }
    trades.push(
      trade(filing, {
        owner,
        assetName: asset,
        ticker: match[3],
        transactionType: match[4],
        transactionDate: match[5],
        amountRange: match[7],
        rawText: match[0],
      }),
    );
  }
  if (!trades.length) throw new NoDisclosureTradesRecognizedError("house");
  return trades;
}

function headerKey(value: string): string {
  return cleanText(value).toLowerCase().replace(/[^a-z]/g, "");
}

export function parseSenatePtrHtml(
  html: string,
  filing: DisclosureFiling,
): DisclosureTradeDraft[] {
  const $ = cheerio.load(html);
  const trades: DisclosureTradeDraft[] = [];
  $("table").each((_, tableElement) => {
    const headers = $(tableElement)
      .find("thead th")
      .map((__, th) => headerKey($(th).text()))
      .get();
    if (!headers.some((header) => /transactiondate|date/.test(header))) return;

    $(tableElement)
      .find("tbody tr")
      .each((__, rowElement) => {
        const cells = $(rowElement)
          .find("th,td")
          .map((___, td) => cleanText($(td).text()))
          .get();
        const row = new Map(headers.map((header, index) => [header, cells[index] || ""]));
        const get = (...keys: string[]) =>
          keys.map(headerKey).map((key) => row.get(key)).find(Boolean) || "";
        const asset = get("asset name", "asset", "description");
        const date = get("transaction date", "date");
        const amount = get("amount", "amount range");
        if (!asset || !date || !amount) return;
        const ticker =
          asset.match(/\(([A-Z][A-Z0-9.-]{0,9})\)/)?.[1] ||
          get("ticker", "symbol");
        trades.push(
          trade(filing, {
            owner: get("owner"),
            assetName: ticker ? asset.replace(`(${ticker})`, "") : asset,
            ticker,
            transactionType: get("type", "transaction type"),
            transactionDate: date,
            amountRange: amount,
            rawText: cells.join(" | "),
          }),
        );
      });
  });
  if (!trades.length) throw new NoDisclosureTradesRecognizedError("senate");
  return trades;
}

export function parseSenatePtrText(
  text: string,
  filing: DisclosureFiling,
): DisclosureTradeDraft[] {
  const cleaned = text.replace(/\0/g, "").replace(/\r/g, "");
  const pattern =
    /(?:^|\n)(?:(Self|Spouse|Joint)\s+)?(.+?)(?:\s+\(([A-Z][A-Z0-9.-]{0,9})\))?\s+(Purchase|Sale|Exchange|P|S|E)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\$[\d,]+\s*-\s*\$[\d,]+)/gi;
  const trades: DisclosureTradeDraft[] = [];
  for (const match of cleaned.matchAll(pattern)) {
    trades.push(
      trade(filing, {
        owner: match[1],
        assetName: match[2],
        ticker: match[3],
        transactionType: match[4],
        transactionDate: match[5],
        amountRange: match[6],
        rawText: match[0],
      }),
    );
  }
  if (!trades.length) throw new NoDisclosureTradesRecognizedError("senate");
  return trades;
}

export async function parseDisclosureDocument(
  content: Buffer,
  filing: DisclosureFiling,
): Promise<DisclosureTradeDraft[]> {
  if (filing.documentKind === "html") {
    return parseSenatePtrHtml(content.toString("utf8"), filing);
  }
  const parsed = await pdf(content);
  return filing.source === "house"
    ? parseHousePtrText(parsed.text, filing)
    : parseSenatePtrText(parsed.text, filing);
}

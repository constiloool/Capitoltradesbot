import * as cheerio from "cheerio";
import type { CapitolTrade, TradeDraft } from "../types/trade.js";
import {
  cleanText,
  createTradeId,
  normalizeTicker,
  normalizeTransactionType,
  parsePrice,
  parseTradeSize,
} from "../utils/normalize.js";

type RowMap = Record<string, string>;

function key(value: string): string {
  return cleanText(value).toLowerCase().replace(/[^a-z]/g, "");
}

function value(row: RowMap, ...names: string[]): string {
  for (const name of names) {
    const found = row[key(name)];
    if (found) return found;
  }
  return "";
}

function parsePolitician(text: string) {
  const clean = cleanText(text);
  const party = clean.match(/(Republican|Democrat|Independent|Other)/i)?.[1];
  const chamber = clean.match(/(House|Senate)/i)?.[1];
  const state = clean.match(/([A-Z]{2})$/)?.[1];
  let name = clean;
  for (const token of [party, chamber, state]) {
    if (token) name = name.replace(new RegExp(token, "i"), "");
  }
  return {
    name: cleanText(name.replace(/[|•·]/g, " ")),
    party: party === "Other" ? "Independent" : party,
    chamber,
    state,
  };
}

function parseIssuer(text: string) {
  const clean = cleanText(text);
  const rawTicker = clean.match(/\b[A-Z][A-Z0-9./-]{0,9}:US\b/)?.[0];
  return {
    name: cleanText(rawTicker ? clean.replace(rawTicker, "") : clean),
    rawTicker,
  };
}

export function parseTrades(html: string, sourceUrl: string): CapitolTrade[] {
  const $ = cheerio.load(html);
  const headers = $("table thead th")
    .map((_, element) => key($(element).text()))
    .get();
  const trades: CapitolTrade[] = [];

  $("table tbody tr").each((_, element) => {
    const cells = $(element)
      .find("th,td")
      .map((__, cell) => cleanText($(cell).text()))
      .get();
    if (!cells.length) return;

    const row: RowMap = {};
    cells.forEach((cell, index) => {
      row[headers[index] || `column${index}`] = cell;
    });

    const politicianText = value(row, "politician") || cells[0] || "";
    const issuerText =
      value(row, "traded issuer", "issuer", "asset") || cells[1] || "";
    const politician = parsePolitician(politicianText);
    const issuer = parseIssuer(issuerText);
    const rawTicker =
      value(row, "ticker") ||
      issuer.rawTicker ||
      cells.find((cell) => /\b[A-Z][A-Z0-9./-]{0,9}:US\b/.test(cell))?.match(
        /\b[A-Z][A-Z0-9./-]{0,9}:US\b/,
      )?.[0];
    const publishedAtRaw = value(row, "published", "published date");
    const tradedAtRaw = value(row, "traded", "transaction date");
    const transactionType = normalizeTransactionType(value(row, "type", "transaction"));
    const sizeRaw = value(row, "size", "amount");
    const size = parseTradeSize(sizeRaw);
    const priceRaw = value(row, "price");
    const href = $(element).find('a[href*="/trades/"]').last().attr("href");
    const detailUrl = href ? new URL(href, sourceUrl).toString() : undefined;

    if (!politician.name || !issuer.name) return;

    const draft: TradeDraft = {
      politicianName: politician.name,
      politicianParty: politician.party,
      politicianChamber: politician.chamber,
      politicianState: politician.state,
      issuerName: issuer.name,
      ticker: normalizeTicker(rawTicker),
      rawTicker,
      publishedAtRaw,
      tradedAtRaw,
      filedAfterRaw: value(row, "filed after"),
      owner: value(row, "owner"),
      transactionType,
      sizeRaw: sizeRaw || undefined,
      sizeMin: size.min,
      sizeMax: size.max,
      priceRaw: priceRaw || undefined,
      price: parsePrice(priceRaw),
      detailUrl,
      sourceUrl,
      scrapedAt: new Date().toISOString(),
      rawJson: JSON.stringify({ headers, cells }),
    };
    trades.push({ id: createTradeId(draft), ...draft });
  });

  return trades;
}

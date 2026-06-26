import * as cheerio from "cheerio";
import type {
  DisclosureFiling,
  DisclosureTradeDraft,
  DisclosureTransactionType,
} from "../types/disclosure.js";
import { cleanText, normalizeTicker } from "../utils/normalize.js";

const INSIDER_FINANCE_URL = "https://www.insiderfinance.io/congress-trades";
const SENATE_CONTACTS_URL = "https://www.senate.gov/senators/senators-contact.htm";

type InsiderFinanceFallbackResult = {
  filings: DisclosureFiling[];
  trades: DisclosureTradeDraft[];
  skipped: number;
};

function slug(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function politicianName(value: string): string {
  return cleanText(value).replace(/^[A-Z]{1,3}(?=[A-Z][a-z])/, "");
}

function transactionType(value: string): DisclosureTransactionType {
  const normalized = cleanText(value).toLowerCase();
  if (/purchase|buy/.test(normalized)) return "purchase";
  if (/sale|sell/.test(normalized)) return "sale";
  if (/exchange/.test(normalized)) return "exchange";
  return "other";
}

function lastName(name: string): string {
  const parts = cleanText(name).split(/\s+/);
  return parts.at(-1)?.toLowerCase().replace(/[^a-z-]/g, "") ?? "";
}

function knownTicker(assetText: string, assetName: string): string | undefined {
  const prefix = cleanText(assetText).match(
    /^([A-Z][A-Z0-9./-]{0,8})(?=[A-Z][a-z])/,
  )?.[1];
  if (prefix && !["BUY", "SELL"].includes(prefix)) return normalizeTicker(prefix);
  if (/^berkshire hathaway\b/i.test(assetName)) return "BRK.B";
  return undefined;
}

async function fetchSenatorLastNames(): Promise<Set<string>> {
  const response = await fetch(SENATE_CONTACTS_URL, {
    headers: { "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Senate contacts failed (HTTP ${response.status})`);
  const $ = cheerio.load(await response.text());
  const names = new Set<string>();
  $("option").each((_, option) => {
    const match = cleanText($(option).text()).match(/^([A-Za-z'-]+)/);
    if (match) names.add(match[1].toLowerCase());
  });
  return names;
}

export async function fetchInsiderFinanceSenateFallback(): Promise<InsiderFinanceFallbackResult> {
  const [senatorLastNames, html] = await Promise.all([
    fetchSenatorLastNames(),
    fetch(INSIDER_FINANCE_URL, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30_000),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`InsiderFinance congress trades failed (HTTP ${response.status})`);
      }
      return response.text();
    }),
  ]);

  const $ = cheerio.load(html);
  const filings = new Map<string, DisclosureFiling>();
  const trades: DisclosureTradeDraft[] = [];
  let skipped = 0;

  $("tbody tr").each((_, row) => {
    const cell = (name: string) =>
      cleanText($(row).find(`[data-name="${name}"]`).first().text());
    const politician = politicianName(cell("Politician"));
    if (!politician || !senatorLastNames.has(lastName(politician))) {
      skipped += 1;
      return;
    }
    const assetCell = $(row).find('[data-name="Asset"]').first();
    const assetText = cleanText(assetCell.text());
    const assetName = cleanText(assetCell.find("[title]").first().attr("title")) || assetText;
    const filingDate = cell("Reported");
    const transactionDate = cell("Traded");
    const action = transactionType(cell("Buy/Sell"));
    const amountRange = cell("Amount");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(filingDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate) ||
      !assetName ||
      !amountRange
    ) {
      skipped += 1;
      return;
    }

    const filingId = `senate:insiderfinance:${slug(politician)}:${filingDate}`;
    const sourceFilingId = `insiderfinance:${slug(politician)}:${filingDate}`;
    filings.set(filingId, {
      id: filingId,
      source: "senate",
      sourceFilingId,
      politicianName: politician,
      chamber: "Senate",
      filingType: "Periodic Transaction Report",
      filingDate,
      documentUrl: INSIDER_FINANCE_URL,
      documentKind: "html",
    });
    trades.push({
      filingId,
      source: "senate",
      sourceFilingId,
      politicianName: politician,
      chamber: "Senate",
      transactionDate,
      filingDate,
      ticker: knownTicker(assetText, assetName),
      assetName,
      transactionType: action,
      amountRange,
      owner: cell("Owner") || undefined,
      rawText: assetText,
      sourceUrl: INSIDER_FINANCE_URL,
    });
  });

  return {
    filings: [...filings.values()],
    trades,
    skipped,
  };
}

import {
  cleanupRetainedDocuments,
  downloadDocument,
} from "../documents/documentStore.js";
import { parseDisclosureDocument } from "../parsers/disclosureParser.js";
import { HouseDisclosureSource } from "../sources/houseDisclosureSource.js";
import { SenateDisclosureSource } from "../sources/senateDisclosureSource.js";
import { fetchCapitolTradesSenateFallback } from "../sources/capitolTradesSenateFallback.js";
import { fetchInsiderFinanceSenateFallback } from "../sources/insiderFinanceSenateFallback.js";
import type {
  DisclosureFiling,
  DisclosureTradeDraft,
} from "../types/disclosure.js";
import type { DisclosureSourceAdapter } from "../sources/sourceAdapter.js";
import { config } from "../config.js";
import {
  filingExists,
  insertPendingFiling,
  updateFilingStatus,
} from "../storage/filingRepository.js";
import {
  insertDisclosureTrades,
  listUnprocessedTrades,
  markTradeStrategyProcessed,
} from "../storage/disclosureTradeRepository.js";
import type { IngestionSummary } from "../types/disclosure.js";
import { logger } from "../utils/logger.js";
import { processTradeSignal } from "../rules/processTradeSignal.js";
import { monitorOpenPositions } from "../monitor/positionMonitor.js";
import { processPendingOrders } from "./processPendingOrders.js";
import { getMarketClock } from "../alpaca/alpacaClient.js";
import { getDecisionSummary } from "../storage/decisionLogger.js";
import { countOpenPositions } from "../storage/positionsStore.js";
import { loadStrategyAccountSnapshot } from "../alpaca/accountSnapshot.js";

function adapters(): DisclosureSourceAdapter[] {
  if (config.sourceMode === "house") return [new HouseDisclosureSource()];
  if (config.sourceMode === "senate") return [new SenateDisclosureSource()];
  return [new HouseDisclosureSource(), new SenateDisclosureSource()];
}

function storeParsedFallback(
  label: string,
  fallback: {
    filings: DisclosureFiling[];
    trades: DisclosureTradeDraft[];
    skipped: number;
  },
  summary: IngestionSummary,
): void {
  let fallbackNewFilings = 0;
  for (const filing of fallback.filings) {
    if (!filingExists(filing.id) && insertPendingFiling(filing)) {
      fallbackNewFilings += 1;
      updateFilingStatus(filing.id, "parsed");
    }
  }
  const stored = insertDisclosureTrades(fallback.trades);
  summary.newFilingsFound += fallbackNewFilings;
  summary.tradesParsed += fallback.trades.length;
  summary.newTradesInserted += stored.inserted.length;
  summary.duplicatesSkipped += stored.duplicates;
  logger.info("SOURCE", `${label} Senate fallback completed`, {
    filings: fallback.filings.length,
    newFilings: fallbackNewFilings,
    trades: fallback.trades.length,
    inserted: stored.inserted.length,
    duplicates: stored.duplicates,
    skipped: fallback.skipped,
  });
}

export async function runOfficialDisclosuresJob(): Promise<IngestionSummary> {
  const runStartedAt = new Date().toISOString();
  const summary: IngestionSummary = {
    filingsChecked: 0,
    newFilingsFound: 0,
    documentsDownloaded: 0,
    tradesParsed: 0,
    duplicatesSkipped: 0,
    parserFailures: 0,
    newTradesInserted: 0,
  };

  const removed = await cleanupRetainedDocuments();
  if (removed) logger.info("PDF", "Removed expired retained documents", { removed });
  const accountSnapshot = await loadStrategyAccountSnapshot();
  let marketOpen = false;
  try {
    marketOpen = (await getMarketClock()).is_open;
  } catch (error) {
    logger.error("MARKET", "Market clock unavailable; execution disabled", error);
  }
  await monitorOpenPositions(marketOpen);
  const pendingResult = await processPendingOrders(marketOpen, accountSnapshot);
  logger.info("MARKET", "Regular-session execution gate checked", {
    marketOpen: pendingResult.marketOpen,
    pendingChecked: pendingResult.checked,
    pendingExecuted: pendingResult.executed,
  });

  for (const adapter of adapters()) {
    let result;
    try {
      result = await adapter.fetchFilings();
    } catch (error) {
      logger.error("SOURCE", "Source index failed", error);
      continue;
    }
    summary.filingsChecked += result.checked;
    if (result.error) {
      logger.warn("SOURCE", "Official source unavailable", {
        source: result.source,
        reason: result.error,
      });
      if (result.source === "senate" && config.senateCapitolTradesFallback) {
        try {
          const fallback = await fetchCapitolTradesSenateFallback();
          storeParsedFallback("CapitolTrades", fallback, summary);
        } catch (error) {
          logger.warn("SOURCE", "CapitolTrades Senate fallback failed", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        try {
          const fallback = await fetchInsiderFinanceSenateFallback();
          storeParsedFallback("InsiderFinance", fallback, summary);
        } catch (error) {
          logger.warn("SOURCE", "InsiderFinance Senate fallback failed", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    for (const filing of result.filings) {
      if (filingExists(filing.id) || !insertPendingFiling(filing)) {
        summary.duplicatesSkipped += 1;
        continue;
      }
      summary.newFilingsFound += 1;
      let downloaded;
      try {
        downloaded = await downloadDocument(filing);
        summary.documentsDownloaded += 1;
        const trades = await parseDisclosureDocument(downloaded.content, filing);
        summary.tradesParsed += trades.length;
        const stored = insertDisclosureTrades(trades);
        summary.newTradesInserted += stored.inserted.length;
        summary.duplicatesSkipped += stored.duplicates;
        updateFilingStatus(filing.id, "parsed", {
          documentHash: downloaded.documentHash,
          rawPdfPath: downloaded.storedPath,
        });

      } catch (error) {
        summary.parserFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        updateFilingStatus(filing.id, "failed", { parseError: message });
        logger.error(
          "PARSER",
          `Filing ${filing.source}:${filing.sourceFilingId} failed`,
          error,
        );
      } finally {
        await downloaded?.cleanup();
      }
    }
  }

  for (const trade of listUnprocessedTrades()) {
    try {
      await processTradeSignal(trade, {
        marketOpen: pendingResult.marketOpen,
        allowPendingCreation: true,
        accountSnapshot,
      });
      markTradeStrategyProcessed(trade.id);
    } catch (error) {
      logger.error(
        "STRATEGY",
        `Trade decision failed for ${trade.ticker ?? trade.id}`,
        error,
      );
    }
  }

  logger.info("INGEST", "Official disclosure ingestion completed", {
    filingsChecked: summary.filingsChecked,
    newFilings: summary.newFilingsFound,
    documentsDownloaded: summary.documentsDownloaded,
    tradesParsed: summary.tradesParsed,
    duplicatesSkipped: summary.duplicatesSkipped,
    parserFailures: summary.parserFailures,
    newTradesInserted: summary.newTradesInserted,
  });
  const decisionSummary = getDecisionSummary(runStartedAt);
  logger.info("SUMMARY", "Run summary", {
    scrapedFilings: summary.filingsChecked,
    trades: summary.tradesParsed,
    buyCandidates: decisionSummary.buyCandidates,
    skippedAge: decisionSummary.skippedAge,
    skippedAction: decisionSummary.skippedAction,
    skippedMissingTicker: decisionSummary.skippedMissingTicker,
    skippedRunup: decisionSummary.skippedRunup,
    simulatedBuys: decisionSummary.simulatedBuys,
    openPositions: countOpenPositions(),
    safeMode: config.safeMode,
  });
  return summary;
}

import { placeOrderForTrade } from "../alpaca/orderService.js";
import {
  cleanupRetainedDocuments,
  downloadDocument,
} from "../documents/documentStore.js";
import { parseDisclosureDocument } from "../parsers/disclosureParser.js";
import { HouseDisclosureSource } from "../sources/houseDisclosureSource.js";
import { SenateDisclosureSource } from "../sources/senateDisclosureSource.js";
import type { DisclosureSourceAdapter } from "../sources/sourceAdapter.js";
import { config } from "../config.js";
import {
  filingExists,
  insertPendingFiling,
  updateFilingStatus,
} from "../storage/filingRepository.js";
import { insertDisclosureTrades } from "../storage/disclosureTradeRepository.js";
import type { IngestionSummary } from "../types/disclosure.js";
import { logger } from "../utils/logger.js";

function adapters(): DisclosureSourceAdapter[] {
  if (config.sourceMode === "house") return [new HouseDisclosureSource()];
  if (config.sourceMode === "senate") return [new SenateDisclosureSource()];
  return [new HouseDisclosureSource(), new SenateDisclosureSource()];
}

export async function runOfficialDisclosuresJob(): Promise<IngestionSummary> {
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

        for (const trade of stored.inserted) {
          try {
            await placeOrderForTrade(trade);
          } catch (error) {
            logger.error(
              "ALPACA",
              `Order handling failed for ${trade.ticker ?? trade.id}`,
              error,
            );
          }
        }
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

  logger.info("INGEST", "Official disclosure ingestion completed", {
    filingsChecked: summary.filingsChecked,
    newFilings: summary.newFilingsFound,
    documentsDownloaded: summary.documentsDownloaded,
    tradesParsed: summary.tradesParsed,
    duplicatesSkipped: summary.duplicatesSkipped,
    parserFailures: summary.parserFailures,
    newTradesInserted: summary.newTradesInserted,
  });
  return summary;
}

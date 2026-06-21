import { scrapeCapitolTrades } from "../scraper/scrapeCapitolTrades.js";

/**
 * Deprecated reference adapter. It is never selected by default and exists
 * only for explicit SOURCE_MODE=capitol_trades compatibility.
 */
export async function runDeprecatedCapitolTradesSource() {
  return scrapeCapitolTrades();
}

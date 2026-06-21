export type DisclosureSource = "house" | "senate";
export type FilingDocumentKind = "pdf" | "html";
export type FilingParseStatus = "pending" | "parsed" | "failed";
export type DisclosureTransactionType =
  | "purchase"
  | "sale"
  | "exchange"
  | "other";

export type DisclosureFiling = {
  id: string;
  source: DisclosureSource;
  sourceFilingId: string;
  politicianName: string;
  chamber: "House" | "Senate";
  filingType: string;
  filingDate: string;
  documentUrl: string;
  documentKind: FilingDocumentKind;
  requestHeaders?: Record<string, string>;
};

export type StoredFiling = DisclosureFiling & {
  documentHash?: string;
  rawPdfPath?: string;
  parseStatus: FilingParseStatus;
  parseError?: string;
  createdAt: string;
  updatedAt: string;
};

export type DisclosureTradeDraft = {
  filingId: string;
  source: DisclosureSource;
  sourceFilingId: string;
  politicianName: string;
  chamber: "House" | "Senate";
  transactionDate: string;
  filingDate: string;
  ticker?: string;
  assetName: string;
  transactionType: DisclosureTransactionType;
  amountRange: string;
  owner?: string;
  rawText?: string;
  sourceUrl: string;
};

export type DisclosureTrade = DisclosureTradeDraft & {
  id: string;
  dedupeKey: string;
  createdAt: string;
};

export type SourceFetchResult = {
  source: DisclosureSource;
  checked: number;
  filings: DisclosureFiling[];
  error?: string;
};

export type IngestionSummary = {
  filingsChecked: number;
  newFilingsFound: number;
  documentsDownloaded: number;
  tradesParsed: number;
  duplicatesSkipped: number;
  parserFailures: number;
  newTradesInserted: number;
};

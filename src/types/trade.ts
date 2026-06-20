export type TransactionType = "buy" | "sell" | "exchange" | "unknown";

export type CapitolTrade = {
  id: string;
  politicianName: string;
  politicianParty?: string;
  politicianChamber?: string;
  politicianState?: string;
  issuerName: string;
  ticker?: string;
  rawTicker?: string;
  publishedAtRaw: string;
  tradedAtRaw: string;
  filedAfterRaw?: string;
  owner?: string;
  transactionType: TransactionType;
  sizeRaw?: string;
  sizeMin?: number;
  sizeMax?: number;
  priceRaw?: string;
  price?: number;
  detailUrl?: string;
  sourceUrl: string;
  scrapedAt: string;
  rawJson?: string;
};

export type TradeDraft = Omit<CapitolTrade, "id">;

import { config } from "../config.js";

export type AlpacaOrder = {
  symbol: string;
  qty?: number;
  notional?: number;
  side: "buy" | "sell";
  type: "market";
  time_in_force: "day";
  client_order_id: string;
};

export type AlpacaAccount = {
  status?: string;
  account_blocked?: boolean;
  equity?: string;
  portfolio_value?: string;
  buying_power?: string;
  cash?: string;
};

export type AlpacaAsset = {
  symbol: string;
  tradable: boolean;
  fractionable: boolean;
  status: string;
};

export type AlpacaPosition = {
  symbol: string;
  qty: string;
  market_value: string;
  current_price: string;
  avg_entry_price: string;
};

export type AlpacaClock = {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
};

export function alpacaConfigured(): boolean {
  return Boolean(config.alpacaApiKey && config.alpacaSecretKey);
}

function paperApiUrl(path: string): string {
  const paper = config.alpacaBaseUrl.startsWith(
    "https://paper-api.alpaca.markets",
  );
  if (!paper && !config.allowLiveTrading) {
    throw new Error("Live Alpaca URL refused because ALLOW_LIVE_TRADING=false");
  }
  return `${config.alpacaBaseUrl}${path}`;
}

function authHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": config.alpacaApiKey,
    "APCA-API-SECRET-KEY": config.alpacaSecretKey,
  };
}

export async function getPaperAccount(): Promise<AlpacaAccount> {
  const response = await fetch(paperApiUrl("/v2/account"), {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Alpaca account check failed (HTTP ${response.status})`);
  }
  return response.json() as Promise<AlpacaAccount>;
}

export async function getAsset(symbol: string): Promise<AlpacaAsset> {
  const response = await fetch(paperApiUrl(`/v2/assets/${symbol}`), {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Alpaca asset check failed (HTTP ${response.status})`);
  }
  return response.json() as Promise<AlpacaAsset>;
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  const response = await fetch(paperApiUrl("/v2/positions"), {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Alpaca positions request failed (HTTP ${response.status})`);
  }
  return response.json() as Promise<AlpacaPosition[]>;
}

export async function getMarketClock(): Promise<AlpacaClock> {
  const response = await fetch(paperApiUrl("/v2/clock"), {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Alpaca market clock failed (HTTP ${response.status})`);
  }
  return response.json() as Promise<AlpacaClock>;
}

async function marketData(path: string): Promise<Response> {
  return fetch(`${config.alpacaDataUrl}${path}`, {
    headers: authHeaders(),
  });
}

export async function getLatestPrice(symbol: string): Promise<number> {
  const response = await marketData(
    `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`,
  );
  if (!response.ok) {
    throw new Error(`Latest price request failed (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as { trade?: { p?: number } };
  const price = payload.trade?.p;
  if (!price || !Number.isFinite(price)) throw new Error("Latest price missing");
  return price;
}

export async function getReferencePrice(
  symbol: string,
  transactionDate: string,
): Promise<number | undefined> {
  const transaction = new Date(`${transactionDate}T00:00:00Z`);
  if (Number.isNaN(transaction.getTime())) return undefined;
  const end = new Date(transaction.getTime() + 4 * 86_400_000);
  const nearTransactionParams = new URLSearchParams({
    timeframe: "1Day",
    start: transaction.toISOString(),
    end: end.toISOString(),
    adjustment: "all",
    feed: "iex",
    limit: "10",
  });
  const nearResponse = await marketData(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?${nearTransactionParams}`,
  );
  if (nearResponse.ok) {
    const nearPayload = (await nearResponse.json()) as {
      bars?: Array<{ t: string; c: number }>;
    };
    const nearPrice = nearPayload.bars?.[0]?.c;
    if (nearPrice) return nearPrice;
  }

  const recentEnd = new Date();
  const recentStart = new Date(recentEnd.getTime() - 20 * 86_400_000);
  const fallbackParams = new URLSearchParams({
    timeframe: "1Day",
    start: recentStart.toISOString(),
    end: recentEnd.toISOString(),
    adjustment: "all",
    feed: "iex",
    limit: "20",
  });
  const fallbackResponse = await marketData(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?${fallbackParams}`,
  );
  if (!fallbackResponse.ok) return undefined;
  const fallbackPayload = (await fallbackResponse.json()) as {
    bars?: Array<{ t: string; c: number }>;
  };
  const bars = fallbackPayload.bars ?? [];
  return bars.length >= 5 ? bars.at(-5)?.c : undefined;
}

export async function submitPaperOrder(
  order: AlpacaOrder,
): Promise<{ id?: string; filled_avg_price?: string; filled_qty?: string }> {
  const response = await fetch(paperApiUrl("/v2/orders"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": "application/json",
    },
    body: JSON.stringify(order),
  });
  if (!response.ok) {
    throw new Error(`Alpaca rejected order (HTTP ${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<{
    id?: string;
    filled_avg_price?: string;
    filled_qty?: string;
  }>;
}

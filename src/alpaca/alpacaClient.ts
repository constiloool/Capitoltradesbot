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
  const start = new Date(transaction.getTime() - 8 * 86_400_000);
  const end = new Date(transaction.getTime() + 4 * 86_400_000);
  const params = new URLSearchParams({
    timeframe: "1Day",
    start: start.toISOString(),
    end: end.toISOString(),
    adjustment: "all",
    feed: "iex",
    limit: "20",
  });
  const response = await marketData(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?${params}`,
  );
  if (!response.ok) return undefined;
  const payload = (await response.json()) as {
    bars?: Array<{ t: string; c: number }>;
  };
  const bars = payload.bars ?? [];
  const target = transaction.getTime();
  const afterOrSame = bars.find(
    (bar) => new Date(bar.t).getTime() >= target,
  );
  const fallback = bars.at(-1);
  return afterOrSame?.c ?? fallback?.c;
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

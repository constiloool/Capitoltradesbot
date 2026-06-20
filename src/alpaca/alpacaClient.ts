import { config } from "../config.js";

export type AlpacaOrder = {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type: "market";
  time_in_force: "day";
  client_order_id: string;
};

export function alpacaConfigured(): boolean {
  return Boolean(config.alpacaApiKey && config.alpacaSecretKey);
}

function paperApiUrl(path: string): string {
  if (!config.alpacaBaseUrl.startsWith("https://paper-api.alpaca.markets")) {
    throw new Error("MVP refuses non-paper Alpaca base URLs");
  }
  return `${config.alpacaBaseUrl}${path}`;
}

function authHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": config.alpacaApiKey,
    "APCA-API-SECRET-KEY": config.alpacaSecretKey,
  };
}

export async function getPaperAccount(): Promise<{ status?: string; account_blocked?: boolean }> {
  const response = await fetch(paperApiUrl("/v2/account"), {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Alpaca account check failed (HTTP ${response.status})`);
  }
  return response.json() as Promise<{ status?: string; account_blocked?: boolean }>;
}

export async function submitPaperOrder(order: AlpacaOrder): Promise<unknown> {
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
  return response.json();
}

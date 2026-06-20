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

export async function submitPaperOrder(order: AlpacaOrder): Promise<unknown> {
  if (!config.alpacaBaseUrl.startsWith("https://paper-api.alpaca.markets")) {
    throw new Error("MVP refuses non-paper Alpaca base URLs");
  }
  const response = await fetch(`${config.alpacaBaseUrl}/v2/orders`, {
    method: "POST",
    headers: {
      "APCA-API-KEY-ID": config.alpacaApiKey,
      "APCA-API-SECRET-KEY": config.alpacaSecretKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(order),
  });
  if (!response.ok) {
    throw new Error(`Alpaca rejected order (HTTP ${response.status}): ${await response.text()}`);
  }
  return response.json();
}

from __future__ import annotations

import logging
import os
from typing import Any

from alpaca.trading.client import TradingClient
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.trading.requests import MarketOrderRequest

from .risk import RiskConfig


class AlpacaBroker:
    def __init__(self, config: RiskConfig, logger: logging.Logger) -> None:
        api_key = os.environ.get("ALPACA_API_KEY")
        secret_key = os.environ.get("ALPACA_SECRET_KEY")
        paper = os.environ.get("ALPACA_PAPER", "true").strip().lower() == "true"

        if not api_key or not secret_key:
            raise RuntimeError(
                "Missing Alpaca API credentials. Set ALPACA_API_KEY and "
                "ALPACA_SECRET_KEY as environment variables."
            )
        expected_paper = config.trading_mode == "paper"
        if paper != expected_paper:
            raise RuntimeError(
                "Alpaca environment mismatch: ALPACA_PAPER must be true for "
                "TRADING_MODE=paper and false for TRADING_MODE=live."
            )

        self.logger = logger
        self.client = TradingClient(api_key, secret_key, paper=paper)

    def account_summary(self) -> dict[str, Any]:
        account = self.client.get_account()
        return {"status": str(account.status), "equity": str(account.equity), "buying_power": str(account.buying_power)}

    def market_is_open(self) -> bool:
        return bool(self.client.get_clock().is_open)

    def symbol_exposure(self, symbol: str) -> float:
        try:
            position = self.client.get_open_position(symbol)
            return abs(float(position.market_value or 0))
        except Exception as exc:
            if exc.__class__.__name__ in {"APIError", "HTTPError"} and "404" in str(exc):
                return 0.0
            self.logger.warning("Could not determine %s exposure: %s", symbol, exc)
            return 0.0

    def submit(self, order: dict[str, Any]) -> dict[str, Any]:
        request = MarketOrderRequest(
            symbol=order["symbol"],
            notional=order["notional"],
            side=OrderSide.BUY,
            time_in_force=TimeInForce.DAY,
            client_order_id=order["client_order_id"],
        )
        response = self.client.submit_order(order_data=request)
        return {
            "id": str(response.id),
            "client_order_id": response.client_order_id,
            "symbol": response.symbol,
            "status": str(response.status),
        }

from __future__ import annotations

from typing import Any

from .risk import RiskConfig


def map_trade_to_order(trade: dict[str, Any], config: RiskConfig) -> dict[str, Any]:
    return {
        "symbol": trade["ticker"],
        "notional": round(config.default_notional, 2),
        "side": "buy",
        "type": "market",
        "time_in_force": "day",
        "client_order_id": f"ct-{trade['unique_id'][:32]}",
    }

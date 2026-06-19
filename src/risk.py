from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any


TRUE_VALUES = {"1", "true", "yes", "on"}


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in TRUE_VALUES


def ticker_set(name: str) -> set[str]:
    return {value.strip().upper() for value in os.getenv(name, "").split(",") if value.strip()}


@dataclass(frozen=True)
class RiskConfig:
    enable_trading: bool
    dry_run: bool
    trading_mode: str
    default_notional: float
    max_trades: int
    max_symbol_exposure: float
    allowed_tickers: set[str]
    blocked_tickers: set[str]
    allow_after_hours_queue: bool
    allow_live_market_orders: bool

    @classmethod
    def from_env(cls, cli_dry_run: bool = False) -> "RiskConfig":
        mode = os.getenv("TRADING_MODE", "paper").lower()
        if mode not in {"paper", "live"}:
            raise ValueError("TRADING_MODE must be paper or live")
        if mode == "live" and os.getenv("CONFIRM_LIVE_TRADING") != "yes_i_understand_the_risk":
            raise ValueError("Live trading blocked: explicit confirmation is missing")
        if mode == "live" and env_bool("ALPACA_PAPER", True):
            raise ValueError("Live trading blocked: ALPACA_PAPER must be false")
        return cls(
            enable_trading=env_bool("ENABLE_TRADING"),
            dry_run=cli_dry_run or env_bool("DRY_RUN", True),
            trading_mode=mode,
            default_notional=float(os.getenv("DEFAULT_NOTIONAL_USD", "10")),
            max_trades=int(os.getenv("MAX_TRADES_PER_RUN", "3")),
            max_symbol_exposure=float(os.getenv("MAX_SYMBOL_EXPOSURE_USD", "50")),
            allowed_tickers=ticker_set("ALLOWED_TICKERS"),
            blocked_tickers=ticker_set("BLOCKED_TICKERS"),
            allow_after_hours_queue=env_bool("ALLOW_AFTER_HOURS_QUEUE"),
            allow_live_market_orders=env_bool("ALLOW_LIVE_MARKET_ORDERS"),
        )

    def evaluate(self, trade: dict[str, Any], placed_count: int, exposure: float = 0) -> tuple[bool, str]:
        ticker = trade.get("ticker", "")
        if not self.enable_trading:
            return False, "trading disabled"
        if self.dry_run:
            return False, "dry run"
        if placed_count >= self.max_trades:
            return False, "maximum trades per run reached"
        if trade.get("transaction_type") != "purchase":
            return False, "v1 only copies purchases; no sale or shorting"
        if not re.fullmatch(r"[A-Z]{1,5}(?:\.[A-Z])?", ticker):
            return False, "missing or unsupported US equity ticker"
        if self.allowed_tickers and ticker not in self.allowed_tickers:
            return False, "ticker not in allowlist"
        if ticker in self.blocked_tickers:
            return False, "ticker is blocked"
        if exposure + self.default_notional > self.max_symbol_exposure:
            return False, "maximum symbol exposure exceeded"
        if self.trading_mode == "live" and not self.allow_live_market_orders:
            return False, "live market orders disabled; v1 does not infer a safe limit price"
        return True, "approved"

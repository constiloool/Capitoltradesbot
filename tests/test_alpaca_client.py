import logging

import pytest

from src.alpaca_client import AlpacaBroker
from src.risk import RiskConfig


def paper_config() -> RiskConfig:
    return RiskConfig(
        enable_trading=True,
        dry_run=False,
        trading_mode="paper",
        default_notional=10,
        max_trades=3,
        max_symbol_exposure=50,
        allowed_tickers=set(),
        blocked_tickers=set(),
        allow_after_hours_queue=False,
        allow_live_market_orders=False,
    )


def test_credentials_are_required_from_environment(monkeypatch):
    monkeypatch.delenv("ALPACA_API_KEY", raising=False)
    monkeypatch.delenv("ALPACA_SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError, match="Missing Alpaca API credentials"):
        AlpacaBroker(paper_config(), logging.getLogger("test"))


def test_paper_environment_must_match_mode(monkeypatch):
    monkeypatch.setenv("ALPACA_API_KEY", "test-key")
    monkeypatch.setenv("ALPACA_SECRET_KEY", "test-secret")
    monkeypatch.setenv("ALPACA_PAPER", "false")
    with pytest.raises(RuntimeError, match="environment mismatch"):
        AlpacaBroker(paper_config(), logging.getLogger("test"))

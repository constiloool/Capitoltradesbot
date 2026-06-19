import pytest

from src.risk import RiskConfig


def test_defaults_never_trade(monkeypatch):
    for name in ("ENABLE_TRADING", "DRY_RUN", "TRADING_MODE", "CONFIRM_LIVE_TRADING", "ALPACA_PAPER"):
        monkeypatch.delenv(name, raising=False)
    config = RiskConfig.from_env()
    approved, reason = config.evaluate({"ticker": "AAPL", "transaction_type": "purchase"}, 0)
    assert not approved
    assert reason == "trading disabled"


def test_live_requires_confirmation(monkeypatch):
    monkeypatch.setenv("TRADING_MODE", "live")
    monkeypatch.delenv("CONFIRM_LIVE_TRADING", raising=False)
    with pytest.raises(ValueError, match="confirmation"):
        RiskConfig.from_env()

from src.parser import parse_trade, stable_id


def test_stable_id_is_deterministic():
    trade = parse_trade(
        {"raw_text": "Jane Doe House AAPL purchase $1,001 - $15,000 01/02/2026", "url": "/trades/1"},
        "https://example.com",
    )
    assert trade["unique_id"] == stable_id(trade)
    assert trade["transaction_type"] == "purchase"
    assert trade["chamber"] == "House"


def test_raw_text_changes_id_when_url_missing():
    first = parse_trade({"raw_text": "Jane Doe AAPL purchase"}, "https://example.com")
    second = parse_trade({"raw_text": "Jane Doe AAPL purchase amended"}, "https://example.com")
    assert first["unique_id"] != second["unique_id"]

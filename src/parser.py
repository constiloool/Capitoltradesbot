from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any
from urllib.parse import urljoin


DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%b %d, %Y", "%d %b %Y")


def _date(value: str | None) -> str | None:
    if not value:
        return None
    value = " ".join(value.split()).strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    match = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", value)
    return match.group(0) if match else None


def _transaction_type(text: str) -> str:
    lowered = text.lower()
    if re.search(r"\b(purchase|buy|bought)\b", lowered):
        return "purchase"
    if re.search(r"\b(sale|sell|sold)\b", lowered):
        return "sale"
    if "exchange" in lowered:
        return "exchange"
    return "unknown"


def _ticker(text: str) -> str:
    candidates = re.findall(r"(?:NASDAQ|NYSE|AMEX)?\s*:?\s*\b([A-Z]{1,5}(?:\.[A-Z])?)\b", text)
    blocked = {"HOUSE", "SENATE", "SALE", "BUY", "BOUGHT", "SOLD", "USD", "ETF"}
    return next((item for item in candidates if item not in blocked), "")


def stable_id(trade: dict[str, Any]) -> str:
    raw_hash = hashlib.sha256((trade.get("raw_text") or "").encode()).hexdigest()
    parts = [
        trade.get("politician") or "",
        trade.get("ticker") or "",
        trade.get("transaction_type") or "",
        trade.get("reported_date") or "",
        trade.get("transaction_date") or "",
        trade.get("amount_range") or "",
        trade.get("url") or raw_hash,
    ]
    return hashlib.sha256("|".join(parts).lower().encode()).hexdigest()


def parse_trade(raw: dict[str, Any], base_url: str) -> dict[str, Any]:
    text = " ".join((raw.get("raw_text") or "").split())
    fields = raw.get("fields") or []
    amount = next((f for f in fields if "$" in f), "")
    dates = [_date(f) for f in fields]
    dates = [d for d in dates if d]
    chamber = "House" if "house" in text.lower() else "Senate" if "senate" in text.lower() else "Unknown"
    trade = {
        "source": "capitoltrades",
        "politician": raw.get("politician") or (fields[0] if fields else "Unknown"),
        "chamber": chamber,
        "ticker": (raw.get("ticker") or _ticker(text)).upper(),
        "asset_name": raw.get("asset_name") or "",
        "transaction_type": _transaction_type(raw.get("transaction_type") or text),
        "amount_range": amount,
        "reported_date": raw.get("reported_date") or (dates[-1] if dates else None),
        "transaction_date": raw.get("transaction_date") or (dates[0] if dates else None),
        "url": urljoin(base_url, raw["url"]) if raw.get("url") else "",
        "raw_text": text,
    }
    trade["unique_id"] = stable_id(trade)
    return trade


def parse_trades(raw_rows: list[dict[str, Any]], base_url: str) -> list[dict[str, Any]]:
    return [parse_trade(row, base_url) for row in raw_rows if (row.get("raw_text") or "").strip()]

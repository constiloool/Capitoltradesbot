from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .logger import utc_now, write_json


class TradeState:
    def __init__(self, path: str = "data/processed_trades.json") -> None:
        self.path = Path(path)
        self.records = self._load()

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return {item: {"unique_id": item, "status": "legacy"} for item in payload}
        return payload.get("trades", payload)

    def contains(self, unique_id: str) -> bool:
        return unique_id in self.records

    def mark(self, trade: dict[str, Any], status: str, details: dict[str, Any] | None = None) -> None:
        record = {
            "unique_id": trade["unique_id"],
            "processed_at": utc_now(),
            "status": status,
            "trade": trade,
        }
        if details:
            record["details"] = details
        self.records[trade["unique_id"]] = record
        self.save()

    def save(self) -> None:
        write_json(self.path, {"version": 1, "trades": self.records})

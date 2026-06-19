from __future__ import annotations

import argparse
import asyncio
import logging
from typing import Any

from dotenv import load_dotenv

from .alpaca_client import AlpacaBroker
from .logger import setup_logging, utc_now, write_json
from .parser import parse_trades
from .risk import RiskConfig
from .scraper import scrape_trades
from .state import TradeState
from .trade_mapper import map_trade_to_order


def fake_trade() -> dict[str, Any]:
    from .parser import parse_trade
    return parse_trade(
        {
            "politician": "Paper Test",
            "ticker": "AAPL",
            "transaction_type": "purchase",
            "reported_date": "2026-01-01",
            "transaction_date": "2026-01-01",
            "raw_text": "Paper Test AAPL purchase $1,001 - $15,000",
            "url": "https://example.invalid/fake-trade",
        },
        "https://example.invalid",
    )


async def run(args: argparse.Namespace) -> int:
    load_dotenv()
    logger = setup_logging()
    started = utc_now()
    config = RiskConfig.from_env(cli_dry_run=args.dry_run)
    state = TradeState()
    broker: AlpacaBroker | None = None
    summary = {"started_at": started, "found": 0, "new": 0, "skipped": 0, "orders_placed": 0, "errors": 0}

    if args.test_fake_trade:
        trades = [fake_trade()]
        logger.warning("Using a synthetic trade; this does not represent a congressional disclosure")
    else:
        raw_rows, source_url = await scrape_trades(logger)
        write_json("data/raw_trades.json", {"captured_at": utc_now(), "source_url": source_url, "rows": raw_rows})
        trades = parse_trades(raw_rows, source_url)
    summary["found"] = len(trades)

    for trade in trades:
        if state.contains(trade["unique_id"]):
            summary["skipped"] += 1
            logger.info("Skipped duplicate %s %s", trade["politician"], trade["ticker"])
            continue
        summary["new"] += 1
        state.mark(trade, "discovered")

        if args.scrape_only:
            state.mark(trade, "skipped", {"reason": "scrape only"})
            summary["skipped"] += 1
            continue

        try:
            if config.enable_trading and not config.dry_run and broker is None:
                broker = AlpacaBroker(config, logger)
                logger.info("Alpaca account connected: %s", broker.account_summary())
            exposure = broker.symbol_exposure(trade["ticker"]) if broker else 0
            approved, reason = config.evaluate(trade, summary["orders_placed"], exposure)
            order = map_trade_to_order(trade, config)
            logger.info("Order plan: %s; decision=%s (%s)", order, approved, reason)
            if not approved:
                state.mark(trade, "skipped", {"reason": reason, "planned_order": order})
                summary["skipped"] += 1
                continue
            if broker is None:
                raise RuntimeError("Broker was not initialized")
            if not broker.market_is_open() and not config.allow_after_hours_queue:
                state.mark(trade, "skipped", {"reason": "market closed", "planned_order": order})
                summary["skipped"] += 1
                logger.info("Skipped %s: market closed", trade["ticker"])
                continue
            # Persist the idempotent client order ID before making the external request.
            state.mark(trade, "order_attempted", {"planned_order": order})
            response = broker.submit(order)
            state.mark(trade, "order_submitted", {"order": response})
            summary["orders_placed"] += 1
            logger.info("Order placed: %s", response)
        except Exception as exc:
            summary["errors"] += 1
            state.mark(trade, "error", {"error": str(exc)})
            logger.exception("Trade processing failed for %s", trade["unique_id"])

    summary["finished_at"] = utc_now()
    write_json("data/last_run.json", summary)
    logger.info("Run summary: %s", summary)
    return 1 if summary["errors"] else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capitol Trades paper-first copytrader")
    parser.add_argument("--dry-run", action="store_true", help="Never submit an order")
    parser.add_argument("--test-fake-trade", action="store_true", help="Process a synthetic AAPL purchase")
    parser.add_argument("--scrape-only", action="store_true", help="Scrape and persist without order evaluation")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run(parse_args())))

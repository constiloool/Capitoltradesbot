from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from playwright.async_api import async_playwright


DEFAULT_SELECTORS = {"trade_rows": "table tbody tr", "links": "a"}


def load_scraper_config() -> dict[str, Any]:
    config = {"source_url": os.getenv("CAPITOL_TRADES_URL", "https://www.capitoltrades.com/trades")}
    config["selectors"] = DEFAULT_SELECTORS.copy()
    path = Path("config.json")
    if path.exists():
        user_config = json.loads(path.read_text(encoding="utf-8"))
        config.update({k: v for k, v in user_config.items() if k != "selectors"})
        config["selectors"].update(user_config.get("selectors", {}))
    return config


async def scrape_trades(logger: logging.Logger) -> tuple[list[dict[str, Any]], str]:
    config = load_scraper_config()
    url = config["source_url"]
    timeout = int(os.getenv("SCRAPER_TIMEOUT_MS", "30000"))
    headless = os.getenv("SCRAPER_HEADLESS", "true").lower() != "false"
    Path("logs").mkdir(exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=headless)
        page = await browser.new_page()
        page.set_default_timeout(timeout)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
            await page.wait_for_timeout(2500)
            rows = page.locator(config["selectors"]["trade_rows"])
            count = await rows.count()
            output: list[dict[str, Any]] = []
            for index in range(count):
                row = rows.nth(index)
                cells = await row.locator("th,td").all_inner_texts()
                link = row.locator(config["selectors"]["links"]).first
                href = await link.get_attribute("href") if await link.count() else ""
                output.append({"raw_text": await row.inner_text(), "fields": cells, "url": href or ""})
            if not output:
                logger.warning("No trades parsed / selector may need update")
            return output, url
        except Exception:
            logger.exception("Scraper failed; selector, timeout, or site availability may need attention")
            try:
                await page.screenshot(path="logs/error_screenshot.png", full_page=True)
            except Exception:
                logger.exception("Could not save error screenshot")
            return [], url
        finally:
            await browser.close()

from src.scraper import DEFAULT_SOURCE_URL, load_scraper_config


def test_blank_source_url_uses_default(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CAPITOL_TRADES_URL", "")
    assert load_scraper_config()["source_url"] == DEFAULT_SOURCE_URL

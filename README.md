# Capitol Trade Copytrader

Ein konservativer Python-Prototyp, der **neu veröffentlichte** Congressional Trading Disclosures von CapitolTrades einliest, normalisiert, dedupliziert und optional über Alpaca kopiert. Veröffentlichungen können Wochen verspätet sein; dies ist kein Live-Signal und keine Anlageberatung.

## Sicherheitsmodell

- Standard: `ENABLE_TRADING=false`, `DRY_RUN=true`, `TRADING_MODE=paper`.
- Live-Trading erfordert gleichzeitig `TRADING_MODE=live`, `ALPACA_PAPER=false` und `CONFIRM_LIVE_TRADING=yes_i_understand_the_risk`.
- Version 1 kauft nur unterstützte US-Aktien. Verkäufe, Shorts, Optionen, Crypto, Margin und Leverage werden nicht ausgeführt.
- Paper-Modus nutzt kleine Market-Notional-Orders. Live-Market-Orders bleiben gesperrt, bis `ALLOW_LIVE_MARKET_ORDERS=true` gesetzt wird.
- Jede Order erhält eine stabile `client_order_id`; der Zustand wird vor dem API-Aufruf gespeichert. Das reduziert Doppelorders nach Teilfehlern.
- Secrets gehören ausschließlich in `.env` oder GitHub Secrets und werden nicht geloggt.

## Lokales Setup

Voraussetzung: Python 3.11+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env
python -m src.main --dry-run
```

Nützliche Befehle:

```bash
python -m src.main --scrape-only
python -m src.main --dry-run
python -m src.main --test-fake-trade --dry-run
pytest
```

`--test-fake-trade` erzeugt ein synthetisches AAPL-Kaufsignal. Um damit wirklich eine **Paper**-Order zu testen, setze `ENABLE_TRADING=true`, `DRY_RUN=false`, `TRADING_MODE=paper`, gültige Alpaca-Paper-Keys und rufe `python -m src.main --test-fake-trade` auf. Lösche den betreffenden Fake-Eintrag aus `data/processed_trades.json`, bevor du denselben Test wiederholst.

## Konfiguration

| Variable | Standard | Bedeutung |
|---|---:|---|
| `CAPITOL_TRADES_URL` | CapitolTrades Trades-Seite | Datenquelle |
| `SCRAPER_TIMEOUT_MS` | `30000` | Browser-Timeout |
| `ENABLE_TRADING` | `false` | Orders grundsätzlich aktivieren |
| `DRY_RUN` | `true` | Jede Order unterbinden |
| `TRADING_MODE` | `paper` | `paper` oder `live` |
| `ALPACA_PAPER` | `true` | Zusätzlicher Live-Sicherheitscheck |
| `DEFAULT_NOTIONAL_USD` | `10` | Dollargröße je Order |
| `MAX_TRADES_PER_RUN` | `3` | Maximale Orders pro Lauf |
| `MAX_SYMBOL_EXPOSURE_USD` | `50` | Maximales Exposure pro Symbol |
| `ALLOWED_TICKERS` | leer | Optionale Komma-Allowlist |
| `BLOCKED_TICKERS` | leer | Optionale Komma-Blocklist |
| `ALLOW_AFTER_HOURS_QUEUE` | `false` | Orders bei geschlossenem Markt zulassen |
| `ALLOW_LIVE_MARKET_ORDERS` | `false` | Explizite, riskante Live-Freigabe |

Selektoren lassen sich ohne Codeänderung anpassen: `config.example.json` nach `config.json` kopieren und `selectors.trade_rows` oder `selectors.links` ändern. Rohdaten landen zur Diagnose in `data/raw_trades.json` (nicht versioniert), Fehler-Screenshots in `logs/error_screenshot.png`. Es gibt bewusst keinen Captcha-, Login-, Rate-Limit- oder Anti-Bot-Bypass. Prüfe vor dem Betrieb die aktuellen Nutzungsbedingungen und `robots.txt` der Quelle.

Eine weitere Datenquelle sollte ein Modul hinzufügen, das dieselbe rohe Zeilenstruktur oder direkt das normalisierte Trade-Schema liefert. Parser, State, Risk und Broker bleiben dadurch unabhängig von der Quelle.

## GitHub Actions

1. Repository zu GitHub pushen.
2. Unter **Settings → Secrets and variables → Actions** als Secrets setzen:
   - `ALPACA_API_KEY`
   - `ALPACA_SECRET_KEY`
   - nur für Live: `CONFIRM_LIVE_TRADING`
3. Als Repository Variables setzen: `ENABLE_TRADING`, `DRY_RUN`, `TRADING_MODE`, `ALPACA_PAPER`, `DEFAULT_NOTIONAL_USD`, `MAX_TRADES_PER_RUN`, `MAX_SYMBOL_EXPOSURE_USD` und bei Bedarf die übrigen Variablen.
4. Unter **Actions → General → Workflow permissions** Schreibzugriff erlauben.
5. Workflow zunächst manuell per `workflow_dispatch` mit Paper-/Dry-Run-Einstellungen testen.

Der Workflow verhindert parallele Läufe, installiert Chromium und committet nur `data/processed_trades.json` sowie `data/last_run.json` mit `chore: update trade bot state`.

## cronjob.org

Erstelle einen Fine-Grained PAT mit Zugriff auf das Repository und Actions (oder einen Classic PAT mit passendem `repo`-Zugriff). Behandle ihn wie ein Passwort. Konfiguriere bei cronjob.org alle 15 Minuten:

- Methode: `POST`
- URL: `https://api.github.com/repos/OWNER/REPO/actions/workflows/run-bot.yml/dispatches`
- Header:
  - `Authorization: Bearer GITHUB_PAT`
  - `Accept: application/vnd.github+json`
  - `X-GitHub-Api-Version: 2022-11-28`
- JSON-Body:

```json
{"ref":"main"}
```

GitHubs eigene Schedules sind nicht sekundengenau und können sich unter Last verzögern; ein externer Trigger kann ein gewünschtes Raster besser anstoßen, garantiert aber ebenfalls keine exakte Ausführungszeit.

## Live-Freischaltung

Live-Trading erst nach längerem Paper-Test aktivieren. Erforderlich sind:

```dotenv
ENABLE_TRADING=true
DRY_RUN=false
TRADING_MODE=live
ALPACA_PAPER=false
CONFIRM_LIVE_TRADING=yes_i_understand_the_risk
```

Zusätzlich würde Version 1 eine Live-Market-Order nur mit `ALLOW_LIVE_MARKET_ORDERS=true` senden. Eine sicherere Weiterentwicklung wäre eine bewusst definierte Limitpreis-Strategie; der Bot erfindet deshalb aktuell keinen Limitpreis.

## Troubleshooting und Risiken

- `No trades parsed / selector may need update`: Seite manuell prüfen, Screenshot/Rohdaten ansehen und `config.json` aktualisieren.
- Browser fehlt: `python -m playwright install chromium`.
- Keine Order: Log-Grund prüfen (Dry Run, deaktiviert, Markt geschlossen, Limit, Allow-/Blocklist).
- Wiederholte Fake-Tests werden dedupliziert; State-Eintrag gezielt entfernen.
- Git-Push schlägt fehl: Workflow-Schreibrechte und Branch Protection prüfen.

Congress-Copytrading ist besonders riskant: Disclosures sind verzögert, Betragsgrößen meist nur Spannen, Motive und Gesamtportfolio sind unbekannt, der Markt kann die Information bereits eingepreist haben, und Steuern/Regulierung können abweichen. Scraping kann jederzeit durch Seitenänderungen oder Nutzungsbedingungen brechen.

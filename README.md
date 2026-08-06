# CapitolTradesBot

Ein kleines Node.js-/TypeScript-MVP, das offizielle Periodic Transaction
Reports (PTRs) des U.S. House und U.S. Senate einliest, Dokumente defensiv
parst, Trades normalisiert, dedupliziert und in SQLite speichert.

Der Bot scrapt **CapitolTrades nicht mehr standardmäßig**. Der alte Adapter
bleibt ausschließlich als expliziter, veralteter Referenzmodus erhalten. Es
gibt keinen CAPTCHA-, Cloudflare-, Rate-Limit- oder Anti-Bot-Bypass.

> Congressional Disclosures werden häufig Tage oder Wochen nach einer
> Transaktion veröffentlicht. Sie sind keine Echtzeitdaten und dieses Projekt
> ist keine Finanzberatung.

## Offizielle Quellen

- **House:** Office of the Clerk, Financial Disclosure/PTR-Index und offizielle
  PTR-PDFs unter `disclosures-clerk.house.gov`
- **Senate:** Senate eFD Public Financial Disclosure Search unter
  `efdsearch.senate.gov`

Der House Clerk stellt einen jährlichen ZIP/XML-Index bereit. Der Adapter
filtert `FilingType=P` und lädt nur neue PTR-PDFs.

Senate eFD verlangt vor der Suche die gesetzliche Nutzungsbestätigung. Der
Adapter führt diesen offiziellen Session-Ablauf aus. eFD kann Rechenzentren
oder Regionen mit HTTP 403 ablehnen oder temporär mit 5xx antworten. Das wird
protokolliert; der House-Ingest läuft trotzdem weiter. Schutzmechanismen werden
nicht umgangen.

## Standard-Sicherheitsmodus

```dotenv
SOURCE_MODE=official_disclosures
SAFE_MODE=true
STORE_RAW_PDFS=false
```

- `SAFE_MODE=true`: Es wird niemals eine Alpaca-Order gesendet.
- Fehlende Alpaca-Schlüssel stoppen die Datenerfassung nicht.
- Der Broker-Client akzeptiert ausschließlich die Alpaca-Paper-URL.
- Käufe werden im Safe-Mode nur als `Would place paper order` geloggt.
- Verkäufe bleiben im MVP immer `log-only`.
- Tickerlose Assets werden gespeichert, aber nicht an Alpaca übergeben.

`TRADING_ENABLED` ist nur noch eine veraltete Kompatibilitätsvariable und
schaltet keine Orders frei. Für Paper-Orders müssen bewusst gleichzeitig
`SAFE_MODE=false`, gültige Paper-Keys und die Paper-API-URL gesetzt sein.

## Installation und lokaler Lauf

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
cp .env.example .env
npm run db:init
npm run ingest
```

Der bestehende Einstiegspunkt bleibt kompatibel:

```bash
npm run scrape
```

Weitere Befehle:

```bash
npm run typecheck
npm test
npm run build
npm run alpaca:check
npm start
npm run dev
```

## Konfiguration

| Variable | Standard | Bedeutung |
|---|---|---|
| `SOURCE_MODE` | `official_disclosures` | `official_disclosures`, `house`, `senate` oder veraltet `capitol_trades` |
| `SAFE_MODE` | `true` | Unterbindet Alpaca-Orders |
| `STORE_RAW_PDFS` | `false` | Dokumente dauerhaft speichern |
| `PDF_RETENTION_DAYS` | `7` | Aufbewahrung gespeicherter Dokumente |
| `RAW_PDF_DIR` | `./data/raw-pdfs` | Zielordner für gespeicherte Dokumente |
| `DOWNLOAD_TIMEOUT_MS` | `30000` | Download-Timeout |
| `MAX_FILINGS_PER_RUN` | `50` | Maximale Filings pro Quelle und Lauf |
| `SENATE_CAPITOL_TRADES_FALLBACK` | `true` | Nutzt alternative Senate-Fallbacks, wenn Senate eFD blockt/ausfällt |
| `USER_AGENT` | Browser-UA | User-Agent für offizielle Disclosure-Quellen |
| `DATABASE_PATH` | `./data/capitoltrades.sqlite` | SQLite-Datenbank |
| `ALPACA_API_KEY` | leer | Alpaca Paper API Key |
| `ALPACA_SECRET_KEY` | leer | Alpaca Paper Secret |
| `ALPACA_BASE_URL` | Paper-API | Muss Paper-API bleiben |
| `PAPER_ORDER_QTY` | `1` | Feste Paper-Ordergröße |

## PDF- und Dokument-Speicherung

Bei `STORE_RAW_PDFS=false`:

1. Dokument wird in einen temporären Ordner geladen.
2. SHA-256-Dokumenthash wird berechnet.
3. Dokument wird geparst.
4. Filing-Metadaten und normalisierte Trades werden gespeichert.
5. Der temporäre Ordner wird auch bei Parserfehlern entfernt.

Bei `STORE_RAW_PDFS=true` werden Dokumente unter `RAW_PDF_DIR` gespeichert:

```text
house_20034783_2026-06-18_thomas-h-kean-jr.pdf
```

Bei jedem Lauf werden Dateien gelöscht, die älter als
`PDF_RETENTION_DAYS` sind.

## Datenbank

`filings` enthält Quelle, offizielle Filing-ID, Politiker, Kammer, Typ, Datum,
Dokument-URL/-Hash, optionalen Dateipfad und Parserstatus.

`trades` enthält Filing-Verknüpfung, Quelle, Politiker, Datum, Ticker,
Assetname, Transaktionstyp, Betragsspanne, Owner, Rohtext, URL und Dedupe-Key.

Eine vorhandene Datenbank mit dem alten CapitolTrades-Schema wird beim
`db:init` einmalig nach `legacy_capitol_trades` verschoben. Die historischen
Daten werden dadurch nicht gelöscht.

Der stabile Dedupe-Key enthält:

```text
source + sourceFilingId + politicianName + transactionDate
+ ticker/assetName + transactionType + amountRange
```

## Fehlerverhalten und Logs

Ein unparseierbares Filing stoppt nicht den Lauf. Es erhält:

```text
parse_status=failed
parse_error=<verständliche Fehlermeldung>
```

Die Abschlusszeile enthält:

- geprüfte Filings
- neue Filings
- geladene Dokumente
- geparste Trades
- übersprungene Duplikate
- Parserfehler
- neu gespeicherte Trades

Beispiel:

```text
[INGEST] Official disclosure ingestion completed
filingsChecked=3846 newFilings=1 documentsDownloaded=1
tradesParsed=5 duplicatesSkipped=0 parserFailures=0 newTradesInserted=5
```

## GitHub Actions

Der Workflow
[`scrape.yml`](.github/workflows/scrape.yml) bleibt manuell über
`workflow_dispatch` startbar und verwendet zwei UTC-Zeitpläne:

```yaml
cron: "7 7 * * 1-5"
cron: "7,37 13-21 * * 1-5"
```

Der Morgenlauf liest neue Meldungen ein. Der Nachmittagsplan läuft vor,
während und nach der regulären US-Sitzung. GitHub-Zeitpläne verwenden UTC,
können sich verzögern und bilden die deutsche Sommer-/Winterzeit nicht
automatisch ab. Für die tatsächliche Ausführung ist deshalb ausschließlich
Alpacas Market Clock maßgeblich. Die Läufe sind bewusst auf Minute `07` und
`37` versetzt und enthalten bei geplanten Läufen eine kurze zufällige Pause,
damit offizielle Quellen wie Senate eFD nicht im exakt scraperartigen Takt
angefragt werden.

Der Workflow:

1. installiert Node-Abhängigkeiten,
2. stellt die SQLite-Datei aus dem Actions-Cache wieder her,
3. baut und initialisiert/migriert die Datenbank,
4. prüft die Alpaca-Paper-Verbindung read-only,
5. führt den offiziellen Ingest aus,
6. speichert Cache und Datenbank-Artefakt.

## Pending Orders und Börsenöffnung

Eine gültige `BUY`-Entscheidung wird außerhalb der regulären US-Sitzung nicht
als Market-Order an Alpaca gesendet. Stattdessen speichert der Bot sie in der
SQLite-Tabelle `pending_orders`.

Bei jedem Lauf:

1. Alpaca `GET /v2/clock` bestimmt, ob die reguläre Sitzung geöffnet ist.
2. Bei geschlossenem Markt bleiben Pending Orders unverändert erhalten.
3. Bei offenem Markt werden sie vollständig neu geprüft:
   - tatsächliches Transaktionsalter
   - Politiker- und Value-Score
   - aktueller Preis und Run-up
   - Tradability und Fractional-Unterstützung
   - bestehende Positionen
   - Ticker- und Gesamt-Exposure
4. Nur weiterhin gültige Signale werden ausgeführt oder im Safe-Mode
   simuliert.
5. Danach erhält die Pending Order den Status `EXECUTED` oder `SKIPPED`.

Auch Stop-Loss-, Take-Profit- und Time-Exit-Verkäufe werden bei geschlossenem
regulärem US-Markt zurückgestellt. Der Bot sendet keine normalen Market-Orders
blind außerhalb der regulären Sitzung.

### Repository Secrets

GitHub:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Empfohlener Wert |
|---|---|
| `ALPACA_API_KEY` | Alpaca Paper Key |
| `ALPACA_SECRET_KEY` | Alpaca Paper Secret |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` |
| `PAPER_ORDER_QTY` | `1` |
| `SAFE_MODE` | `true` |

Secrets werden nicht geloggt. `SAFE_MODE` sollte während Entwicklung und
Paper-Beobachtung auf `true` bleiben.

### Workflow manuell starten

1. Repository auf GitHub öffnen.
2. **Actions** wählen.
3. **Ingest Official Congressional Disclosures** öffnen.
4. **Run workflow** wählen.
5. Logs und Datenbank-Artifact prüfen.

## Tests

Alle Tests verwenden lokale Fixtures und keine Live-Netzwerkaufrufe:

```bash
npm test
```

Abgedeckt sind:

- House-PTR
- Senate-PTR
- unparseierbares Filing
- doppeltes Filing und doppelter Trade
- Normalisierung und Legacy-HTML-Parser

## Vor einer Aufhebung von SAFE_MODE

- längerer Beobachtungszeitraum ohne Orders
- Altersgrenze für verspätete Meldungen
- Positions-, Buying-Power- und Marktzeitenprüfung
- Tages-/Symbol-/Portfoliolimits
- Broker-Reconciliation und idempotente Orderhistorie
- Alerts und manueller Kill-Switch
- kontrollierte Behandlung von Optionen, Fonds und tickerlosen Assets
- rechtliche, steuerliche und regulatorische Prüfung

Der aktuelle Stand ist bewusst ein sicherer Dateningest mit vorbereiteter
Paper-Trading-Anbindung, kein autonomer Live-Trading-Bot.

## Rule-Engine und Risk Management

Jedes neue normalisierte Signal wird durch
`src/rules/tradeRules.ts` verarbeitet. Die Pipeline trennt:

- Scraper/Parser: liefert nur normalisierte Disclosure-Trades
- Rule-Engine: entscheidet `BUY`, `SKIP` oder `WATCHLIST`
- Risk-Modul: berechnet die Positionsgröße und Exposure-Limits
- Execution: sendet ausschließlich erlaubte Alpaca-Orders
- Position-Monitor: erzeugt `SELL`-Entscheidungen

Aktuelle Kaufregeln:

- ausschließlich `purchase`
- echtes `transaction_date` höchstens sieben Kalendertage alt
- Alpaca-Asset aktiv und handelbar
- Preis mindestens 5 USD
- maximal 10 % Kursanstieg seit Transaktionsdatum
- kein bereits gehaltener Ticker
- Politiker-Score größer null

Positionsgröße:

```text
Equity × BASE_POSITION_PCT × politician_score × value_score
```

Limits:

- 1 % Basisgröße
- maximal 3 % pro Ticker
- maximal 30 % Bot-Gesamtexposure
- Fractionals werden als Notional-Order verwendet
- andernfalls wird auf ganze Aktien abgerundet

Value-Scores:

- `$1,001 - $15,000`: `0.5`
- `$15,001 - $50,000`: `1.0`
- `$50,001 - $100,000`: `1.25`
- über `$100,000`: `1.5`

## Politiker-Scores

Scores werden manuell in
[`data/politician_scores.json`](data/politician_scores.json) gepflegt:

```json
{
  "default_score": 1,
  "politicians": {
    "Unknown": 1
  }
}
```

Score `0` sperrt den Politiker. Unbekannte Namen verwenden `default_score`.

## Positionen, Cluster und Exits

Offene Bot-Positionen liegen dauerhaft in der SQLite-Tabelle
`bot_positions`. Weitere Signale desselben Tickers öffnen keine zweite
Position. Stattdessen werden `signal_count`, `politician_names` und
`last_signal_date` aktualisiert. Drei verschiedene Politiker innerhalb von
sieben Tagen markieren die Position als `cluster_signal`.

Der Monitor läuft zu Beginn jedes Ingest-Laufs und verkauft vollständig bei:

- `TAKE_PROFIT`: mindestens +30 %
- `STOP_LOSS`: höchstens -12 %
- `TIME_EXIT`: mindestens 45 Kalendertage

Im Safe-Mode werden Kauf und Verkauf simuliert und trotzdem als Bot-Position
gespeichert, damit die Regeln beobachtet werden können.

## Entscheidungsprotokoll

Jede geprüfte neue Meldung wird in `trade_decisions` gespeichert, unter
anderem mit:

- Politiker, Ticker, Transaktions- und Filing-Datum
- Politiker- und Value-Score
- aktuellem und historischem Referenzpreis
- Run-up, Equity und Positionsgrößen
- Entscheidung und exaktem Grund
- Alpaca-Order-ID
- Safe-Mode-Status

Dadurch können spätere Auswertungen direkt aus SQLite erfolgen.

Am Ende jedes Laufs erscheint zusätzlich eine kompakte `[SUMMARY]`-Zeile mit:

- geprüften Filings und neu geparsten Trades
- BUY-Kandidaten
- Skips wegen Alter, Aktion, fehlendem Ticker oder Run-up
- simulierten Käufen
- offenen Bot-Positionen
- aktuellem `SAFE_MODE`

Zu Beginn jedes Strategy-Runs wird das Alpaca-Konto genau einmal geladen.
Geloggte Felder:

- `accountEquity` (`equity`, ersatzweise `portfolio_value`)
- `buyingPower`
- `cash`
- `mode` (`paper` oder `live`)
- `safeMode`

Ein erfolgreicher Abruf erzeugt zusätzlich:

```text
Alpaca account equity loaded: <Wert>
```

Fehlende oder ungültige Zugangsdaten stoppen den Ingest nicht. Der Bot loggt
`Could not load Alpaca account equity`, verarbeitet frühe SKIP-Regeln weiter
und verweigert BUY-Kandidaten, solange kein verlässliches Equity vorliegt.

## Zusätzliche Strategievariablen

```dotenv
MAX_TRADE_AGE_DAYS=31
BASE_POSITION_PCT=0.01
MAX_POSITION_PERCENT_PER_TICKER=5
MAX_TOTAL_EXPOSURE_PCT=0.30
MIN_SHARE_PRICE=5
MIN_ORDER_VALUE_USD=25
TAKE_PROFIT_PCT=0.30
STOP_LOSS_PCT=0.12
MAX_HOLDING_DAYS=45
MAX_RUNUP_PCT=0.10
SKIP_IF_PRICE_HISTORY_MISSING=true
ALLOW_LIVE_TRADING=false
```

`ALLOW_LIVE_TRADING=false` verweigert nicht-Paper-Alpaca-URLs auch dann, wenn
`SAFE_MODE=false` gesetzt wird.

`MAX_POSITION_PERCENT_PER_TICKER` begrenzt den aktuellen Marktwert eines
Tickers nach einem Kauf. Bestehende Positionen dürfen bis zu diesem Limit
aufgestockt werden; Teilorders unter `MIN_ORDER_VALUE_USD` werden verworfen.

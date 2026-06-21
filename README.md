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
`workflow_dispatch` startbar und läuft alle sechs Stunden:

```yaml
cron: "17 */6 * * *"
```

GitHub-Zeitpläne verwenden UTC und können sich verzögern. Der Workflow:

1. installiert Node-Abhängigkeiten,
2. stellt die SQLite-Datei aus dem Actions-Cache wieder her,
3. baut und initialisiert/migriert die Datenbank,
4. prüft die Alpaca-Paper-Verbindung read-only,
5. führt den offiziellen Ingest aus,
6. speichert Cache und Datenbank-Artefakt.

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

# CapitolTradesBot

Ein bewusst kleines Node.js-/TypeScript-MVP, das die erste Seite von
[CapitolTrades](https://www.capitoltrades.com/trades) einliest, Trades
normalisiert, per stabiler SHA-256-ID dedupliziert und in SQLite speichert.
Neue Trades können anschließend durch eine defensive Strategie bewertet
werden. Alpaca ist vorbereitet, bleibt standardmäßig aber vollständig im
Safe-Mode.

> Congressional Disclosures werden oft verspätet veröffentlicht. Dieses
> Projekt ist kein Echtzeitsignal und keine Finanzberatung.

## Sicherheitsmodell

- `TRADING_ENABLED=false` ist der Standard.
- Ohne beide Alpaca-Keys wird niemals eine Order gesendet.
- Der MVP akzeptiert ausschließlich
  `https://paper-api.alpaca.markets` als Alpaca-URL.
- Käufe werden im Safe-Mode nur als `Would place paper order` geloggt.
- Verkäufe sind im MVP immer `log-only`.
- Exchange-/unbekannte Transaktionen und Nicht-US-Ticker werden ignoriert.
- Die Ordergröße ist fest (`PAPER_ORDER_QTY=1`) und wird nicht aus der
  veröffentlichten Betragsspanne abgeleitet.

## Projektstruktur

```text
src/
  alpaca/       # Paper-Alpaca-Client und Order-Service
  jobs/         # Ein kompletter Scrape-Lauf
  scraper/      # Fetch, Playwright-Fallback und HTML-Parser
  storage/      # SQLite-Verbindung und Repository
  strategy/     # Defensive MVP-Entscheidungen
  types/        # Trade-Modell
  utils/        # Logging und Normalisierung
.github/workflows/scrape.yml
```

## Lokal installieren

Voraussetzungen: Node.js 22 oder neuer.

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run db:init
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

`npm run dev` startet den Job beim Start und nach lokalen Codeänderungen neu.
Der produktive Zeitplan liegt bewusst in GitHub Actions, nicht in einer
Endlosschleife auf dem Laptop.

## Konfiguration

| Variable | Standard | Zweck |
|---|---|---|
| `CAPITOL_TRADES_URL` | CapitolTrades Trades-Seite | Datenquelle |
| `DATABASE_PATH` | `./data/capitoltrades.sqlite` | SQLite-Datei |
| `ALPACA_API_KEY` | leer | Alpaca-Key |
| `ALPACA_SECRET_KEY` | leer | Alpaca-Secret |
| `ALPACA_BASE_URL` | Paper-API | Nur Paper-Trading wird akzeptiert |
| `TRADING_ENABLED` | `false` | Paper-Orders ausdrücklich aktivieren |
| `PAPER_ORDER_QTY` | `1` | Feste Anzahl Aktien |
| `DEBUG_SAVE_HTML` | `false` | HTML unter `data/` speichern |
| `PLAYWRIGHT_FALLBACK` | `true` | Browser-Fallback erlauben |
| `SCRAPER_TIMEOUT_MS` | `45000` | Netzwerk-/Browser-Timeout |
| `MIN_TRADE_SIZE` | `0` | Optionale Mindestgröße |

API-Keys gehören lokal ausschließlich in `.env`. Diese Datei ist ignoriert
und darf nicht committed werden.

## Scraper-Verhalten und aktueller Seiten-Schutz

Der Scraper probiert zuerst einen sparsamen HTTP-Request und parst die Tabelle
mit Cheerio. Wird eine clientseitige Seite oder ein Vercel-Sicherheitscheckpoint
erkannt, startet er einmalig einen gekapselten Playwright-/Chromium-Fallback.
Es gibt bewusst keinen CAPTCHA-, Rate-Limit- oder Anti-Bot-Bypass.

Bei der technischen Prüfung am 20. Juni 2026 antwortete CapitolTrades sowohl
auf direkte Requests als auch auf frische headless Browser-Sessions mit einem
Vercel-Sicherheitscheckpoint. In diesem Fall loggt der Bot den Fehler, schreibt
keine falschen Daten und beendet den Lauf sauber. Die Website kann ihren Schutz
oder ihr Markup jederzeit ändern. Vor einem dauerhaften Betrieb sollten außerdem
die aktuellen Nutzungsbedingungen und `robots.txt` manuell geprüft werden.

Mit `DEBUG_SAVE_HTML=true` lässt sich die erhaltene Antwort zur Diagnose unter
`data/debug-*.html` sichern.

## Deduplizierung und gespeicherte Trades prüfen

Die ID enthält Detail-URL, Politiker, Issuer, Ticker, Handelsdatum,
Transaktionstyp, Größenbereich und Owner. `INSERT OR IGNORE` auf dem
Primärschlüssel verhindert Doppelungen.

Lokal kann die Anzahl so geprüft werden:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('./data/capitoltrades.sqlite'); console.log(db.prepare('SELECT COUNT(*) AS count FROM trades').get())"
```

Die Logs zeigen außerdem:

```text
[SCRAPER] Found X trades
[DB] Inserted Y new trades total=Z
[GITHUB_ACTION] Job completed found=X new=Y
```

## Auf GitHub pushen

Das Repository besitzt bereits den Remote `origin`. Nach eigener Prüfung:

```bash
git add .
git commit -m "feat: rebuild CapitolTradesBot MVP"
git push origin main
```

Falls ein neues Repository verwendet wird:

```bash
git remote add origin https://github.com/DEIN-NAME/DEIN-REPO.git
git push -u origin main
```

## GitHub Repository Secrets einrichten

Repository öffnen:

**Settings → Secrets and variables → Actions → New repository secret**

Folgende Secrets anlegen:

| Secret | Empfohlener Wert |
|---|---|
| `ALPACA_API_KEY` | zunächst leer lassen oder Paper-Key |
| `ALPACA_SECRET_KEY` | zunächst leer lassen oder Paper-Secret |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` |
| `TRADING_ENABLED` | `false` |
| `PAPER_ORDER_QTY` | `1` |

Fehlende Secrets stoppen den Scraper nicht. Alpaca bleibt dann deaktiviert und
der Bot loggt nur hypothetische Paper-Orders.

Der GitHub-Workflow führt vor jedem Scrape einen read-only Kontotest gegen
`GET /v2/account` aus. Dabei wird keine Order gesendet und es werden weder
Schlüssel noch Kontonummern geloggt.

## GitHub Actions aktivieren und manuell starten

Der Workflow liegt in
`.github/workflows/scrape.yml`. Nach dem Push:

1. GitHub-Repository öffnen.
2. **Actions** auswählen.
3. **Scrape CapitolTrades** öffnen.
4. **Run workflow** anklicken.
5. Den Lauf und seine Logs öffnen.

Der Workflow installiert Node und Chromium, baut TypeScript, initialisiert
SQLite, führt den Scraper aus und lädt die Datenbank als 30 Tage verfügbares
Artifact hoch.

## Cron-Frequenz ändern

In `.github/workflows/scrape.yml`:

```yaml
schedule:
  - cron: "*/15 * * * *"
```

GitHub verwendet UTC und geplante Actions sind nicht sekundengenau. Besonders
zu vollen Stunden können Läufe verzögert oder bei sehr inaktiven Repositories
deaktiviert werden. Für weniger Last sind `*/30 * * * *` oder `0 * * * *`
sinnvolle Alternativen.

Für strengere Zeitpläne eignen sich später Render Cron Jobs, Railway Scheduled
Jobs, Vercel Cron oder Supabase Scheduled Functions.

## SQLite in GitHub Actions

Jeder Lauf:

1. stellt den jüngsten SQLite-Actions-Cache wieder her,
2. schreibt neue Trades,
3. speichert einen neuen unveränderlichen Cache,
4. lädt zusätzlich ein Datenbank-Artefakt zur Kontrolle hoch.

Das ist für ein MVP praktikabel, aber keine garantierte dauerhafte Datenbank:
GitHub darf Caches löschen, Artifacts laufen nach 30 Tagen ab und parallele
Schreibzugriffe sind ungeeignet. Der Workflow verhindert parallele Läufe über
`concurrency`.

Für echten Cloudbetrieb sollte die Storage-Schicht auf Supabase/Postgres
umgestellt werden. `tradeRepository.ts` kapselt die Speicherung bereits, sodass
Scraper und Strategie dabei unverändert bleiben können.

## Vor echten Orders unbedingt ergänzen

- längerer Paper-Test mit Monitoring und Alerts
- Marktzeiten-, Buying-Power- und Positionsprüfung
- Limits pro Tag, Symbol und Gesamtportfolio
- idempotente Broker-Order-Historie und Reconciliation
- Umgang mit Splits, Optionen, ETFs und ungültigen Symbolen
- kontrollierte Sell-/Short-Strategie
- Fehleralarme und manueller Kill-Switch
- rechtliche, steuerliche und regulatorische Prüfung
- ausdrückliche Entscheidung, ob verspätete Disclosures überhaupt handelbar
  sein sollen

Der aktuelle Code verweigert absichtlich Live-Alpaca-URLs. Eine spätere
Live-Freischaltung sollte als eigene, geprüfte Änderung mit zusätzlichen
Sicherheitsbarrieren erfolgen.

## Erweiterungsmöglichkeiten

- Pagination und inkrementelles Nachladen
- Supabase/Postgres
- Telegram-/Discord-Alerts
- Filter nach Politiker, Partei, Volumen oder Ticker
- Dashboard/API
- Backtesting
- mehrere Strategiemodule
- kontrollierte Paper-Order-Reconciliation

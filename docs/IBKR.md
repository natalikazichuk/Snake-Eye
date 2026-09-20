# Snake Eye — real data from Interactive Brokers

Snake Eye ships with a synthetic demo universe so it runs anywhere. This page
covers the other mode: pulling **your own** IBKR data onto **your own** machine,
for personal use.

```text
IB Gateway (localhost)  ←  your IBKR login and entitlements
        ↓
scripts/ibkr-ingest.mjs  ←  daily bars, one symbol at a time, paced
        ↓
data/stocks.local.json   ←  git-ignored
        ↓
Snake Eye in the browser ←  prefers the local file over the demo data
```

Nothing is uploaded, no API key is stored in this repository, and the data file
never leaves your machine.

---

## 1. What you need

| | |
|---|---|
| IBKR account | Paper accounts work for historical bars. |
| Market data subscription | US equities: *NYSE (Network A/CTA)*, *NASDAQ (Network C/UP)*, or the *US Securities Snapshot and Futures Value Bundle*. Delayed data is enough for end-of-day bars. |
| Client Portal Gateway | Free download from IBKR ("Client Portal API" / `clientportal.gw`). Java 8+ required. |
| Node.js 18+ | Already needed for the demo data generator. |

Fundamentals (P/E, ROE, revenue growth …) need a separate **Refinitiv/Reuters
Worldwide Fundamentals** subscription. Without it the ingest still works — see
§5.

---

## 2. Start the gateway

### 2.1 Check Java

```bash
java -version      # 8 or newer; 11+ recommended
```

No Java means the gateway will not start at all — install a JDK first.

### 2.2 Download and unpack

Get `clientportal.gw.zip` from IBKR's *Client Portal API* page and unzip it
somewhere permanent (not Downloads — you will start it every day):

```bash
mkdir -p ~/ibkr && cd ~/ibkr
unzip ~/Downloads/clientportal.gw.zip -d clientportal.gw
cd clientportal.gw
chmod +x bin/run.sh                  # macOS / Linux only
```

### 2.3 Run it

```bash
./bin/run.sh root/conf.yaml          # macOS / Linux
bin\run.bat root\conf.yaml           # Windows
```

The console prints a startup log ending with something like
`Open https://localhost:5000 to login`. **Leave this terminal open** — closing it
kills the gateway, and with it the ingest.

### 2.4 Log in through the browser

Open **https://localhost:5000**.

The certificate is self-signed, so the browser blocks the page once: choose
*Advanced → Proceed to localhost*. That warning is expected for a local gateway
and is not a sign that something is wrong.

Log in with your IBKR username and password, then confirm the push in IBKR
Mobile (or your security device). When it succeeds the page says
*Client login succeeds* — that tab can be closed, the gateway keeps the session.

### 2.5 Verify from the command line

```bash
npm run gateway
```

```text
✓ Gateway ready at https://localhost:5000
  authenticated: true   connected: true   competing: false

  Next:  npm run ingest -- --limit 10
```

It tells the four failure modes apart — nothing listening, something on the port
that is not the gateway, running but not logged in, and a competing session —
and prints the fix for each. It also exits non-zero when the gateway is not
ready, so a scheduled run can be guarded:

```bash
npm run gateway && npm run ingest
```

The raw endpoint is still there if you prefer it:

```bash
curl -sk https://localhost:5000/v1/api/iserver/auth/status
# {"authenticated":true,"connected":true,"competing":false, ...}
```

| Response | Meaning |
|---|---|
| `authenticated: true, connected: true` | Ready — run `npm run ingest`. |
| `authenticated: false` | Gateway is up, the browser login has not happened or has expired. |
| `Connection refused` | The gateway is not running, or is on a different port. |
| `competing: true` | TWS, the mobile app or another gateway holds the connection. Log out of that one. |

### 2.6 Keeping the session alive

The brokerage session drops after a few minutes of inactivity, which is why an
ingest that worked in the morning fails at lunchtime with nothing having
changed. Leave this running in its own window while you work:

```bash
npm run keepalive
```

```text
🐍 Keeping the IBKR session alive — https://localhost:5000, every 60s
   Leave this window open while you work. Ctrl+C to stop.

10:53:47  ✓ session alive
```

It says what it finds rather than failing silently: a session that expired, a
competing session from TWS or the mobile app, or a gateway whose window was
closed. `--quiet` prints only changes and problems, `--every 30` pings more
often.

It does **not** keep you logged in forever — the login itself expires roughly
every 24 hours and only a browser sign-in renews that. What it prevents is the
session going to sleep between scans.

The one-off equivalent, if you prefer:

```bash
curl -sk -X POST https://localhost:5000/v1/api/tickle
```

### 2.7 If port 5000 is taken

On macOS, **AirPlay Receiver occupies port 5000** — the symptom is a gateway
that seems to start while `https://localhost:5000` shows something that is not
IBKR. Either turn AirPlay Receiver off in *System Settings → General → AirDrop
& Handoff*, or move the gateway:

```yaml
# root/conf.yaml
listenPort: 5001
```

```bash
npm run ingest -- --gateway https://localhost:5001
```

---

## 3. Pick your symbols

`config/universe.json` is your scan list:

```json
{ "symbols": ["AAPL", "MSFT", "NVDA", "..."] }
```

Keep it to what you actually watch. IBKR paces historical requests (§4), so:

| Symbols | Roughly |
|---:|---|
| 50 | 3–4 minutes |
| 200 | ~35 minutes |
| 500 | ~1.5 hours |
| 3000 | 8+ hours — use a different provider for a full-market sweep |

---

## 4. Run the ingest

```bash
npm run ingest                    # everything in config/universe.json
npm run ingest -- --limit 5       # quick smoke test
npm run ingest -- --dry-run       # print the plan, call nothing
npm run ingest -- --period 2y     # more history (SMA200 needs 200+ sessions)
```

Output:

```text
[  1/ 50] AAPL    250 bars  last 2026-09-15  $331.34
[  2/ 50] MSFT    250 bars  last 2026-09-15  $512.80
...
✓ 50 symbols written to data/stocks.local.json
```

Reload Snake Eye in the browser — it picks the local file up automatically, and
the header stamp changes from `demo data` to `Interactive Brokers · end of day`.

**Pacing.** IBKR documents a limit of about 60 historical-data requests per 10
minutes; exceeding it gets the session throttled. The script tracks its own
request timestamps and waits rather than tripping the limit, so a long run is
slow by design, not stuck.

---

## 5. Two things that will bite you

### Volume comes in lots

The Client Portal reports US equity volume in **lots of 100 shares**. The script
multiplies by `--volume-factor` (default **100**) to get shares. Relative volume,
every volume filter and part of the Snake Score depend on this being right, so
verify once:

```text
sanity check : AAPL last volume 17,828,882
```

Compare that with the volume your broker or any quote page shows for the same
session. If it is 100x off, re-run with `--volume-factor 1`.

### Fundamentals are often missing — and how to fill them

Without the Refinitiv entitlement the fundamentals request returns nothing. That
is handled rather than hidden:

- fundamental fields stay `null` (never `0` — "no data" and "zero revenue" are
  different claims);
- the Snake Score **drops** the fundamental component and re-weights the rest to
  100 (technical 47%, momentum 29%, volume 24%), so no stock is silently docked
  15 points;
- the scanner shows a banner saying how far the coverage reaches;
- the stock page says so instead of printing dashes.

**To fill them in for free**, take the numbers from the filings themselves:

```bash
npm run fundamentals -- --contact you@example.com
```

SEC EDGAR publishes every filer's reported XBRL facts — no key, no account, no
subscription. The script reads the file the IBKR ingest wrote, adds revenue,
EPS, ROE, debt/equity, margins and the current ratio from the latest annual
filing, computes market cap, P/E and P/S from the price the ingest already has,
and writes it back. Prices are never touched.

SEC asks automated requests to identify themselves, which is what `--contact`
is for; the address goes into the User-Agent and nowhere else.

**Coverage is partial by nature.** Only companies that file XBRL with the SEC
are covered, so foreign private issuers and many ADRs (NIO, GRAB, ABEV, BBD,
ITUB and friends) come back empty and keep scoring on three components. The run
prints exactly who was left out and why:

```text
[  1/ 20] PLUG    7/7 fields  FY 2025-12-31  rev $700M  10-K
[  2/ 20] NIO    — no CIK

   without fundamentals (1):
     NIO    not listed in EDGAR (foreign private issuer or ADR)
```

Figures come from annual filings (10-K, or the 20-F/40-F a foreign issuer files)
rather than a stitched trailing twelve months: one audited filing is internally
consistent, while summing four quarters across restatements produces numbers no
filing ever reported.

---

## 6. Keeping it personal

`data/stocks.local.json` is in `.gitignore` on purpose:

- it is data from **your** subscription, and redistributing exchange data (for
  example by committing it to a public repository or publishing it on GitHub
  Pages) is what the exchange agreements prohibit;
- it goes stale every session;
- the committed demo universe keeps the public repo useful without it.

If you ever want the demo data back: delete the local file, or regenerate it with
`npm run demo-data`.

---

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ECONNREFUSED` | Gateway is not running, or is on another port — pass `--gateway https://localhost:5001`. |
| `not authenticated` | Open https://localhost:5000 and log in. The session expires daily. |
| Everything skipped, "no contract" | The gateway is up but not logged in, or the symbols are not US-listed stocks. |
| Volume looks 100x wrong | `--volume-factor` (see §5). |
| `only N bars` | IBKR returned a short history for a recent listing. `--period 2y` helps; under 200 sessions there is no SMA200 and the trend filters have no data for that symbol. |
| Prices look wrong across a split | Bars must be split-adjusted. The Client Portal returns adjusted history by default; if you switch to the TWS API, use `whatToShow=ADJUSTED_LAST`. |
| `competing` session warning | TWS or another gateway holds the connection. |
| `Server listen failed Address already in use: bind` | A gateway is already running. Do not start a second one — `npm run gateway` will confirm the first is alive. To start clean: `taskkill /IM java.exe /F` (Windows), then launch exactly one. |
| Login page repeats `Action failed` | Stale cookies from the previous attempt. Log in from a private browser window, and check the Live / Paper toggle matches the account. |
| `Error 403 - Access Denied` from the API | **You are not logged in yet.** This gateway build answers 403 to API calls until a browser session exists, instead of returning `{"authenticated":false}`. Sign in at https://localhost:5000 and the same call works. Verify independently with `curl -k https://localhost:5000/v1/api/iserver/auth/status`. |
| `404` for `data/stocks.local.json` in the browser console | Normal before your first ingest: the app probes for the local file and falls back to the demo universe. |

---

## 8. If you outgrow this

The ingest writes a plain JSON file, which is the right shape for one person and
a few hundred symbols. Beyond that:

- **More symbols than IBKR pacing allows** → a bulk EOD provider for the sweep,
  IBKR for detail and (later) order entry. `scripts/lib/ibkr-normalize.mjs` is
  already the provider adapter — a second adapter writes the same shape.
- **Scheduled refresh** → a cron entry running `npm run ingest` after the close.
- **Multiple devices** → that is the point where a small backend (`docs/API.md`)
  starts to pay for itself, not before.

# Running Snake Eye day to day

Two routines. Which one you need depends on whether the data on disk is fresh
enough — the site reads `data/stocks.local.json`, and that file changes only
when you refresh it.

---

## Just looking — one window

Nothing is being pulled, so the gateway is not needed at all.

**Window 1 — Command Prompt**

```bat
cd /d %USERPROFILE%\Snake-Eye
npm start
```

Leave it open; that window *is* the web server. Then in the browser:

**http://localhost:8080**

It must be `http://localhost:8080`, not the file itself. Opening
`index.html` by double-clicking blocks every script in the page — Snake Eye
says so in a red banner rather than hanging, but it still will not run.

To stop: `Ctrl + C` in that window.

---

## Refreshing the data — three windows

### Window 1 — the IBKR gateway

```bat
cd /d %USERPROFILE%\ibkr\clientportal.gw
bin\run.bat root\conf.yaml
```

Wait for a line like `Open https://localhost:5000 to login`, then log in at
**https://localhost:5000** — the certificate warning is expected for a local
gateway (*Advanced → Proceed to localhost*). Confirm on your phone. The page
says *Client login succeeds*; that browser tab can be closed.

**Do not close this window.** The gateway dies with it, and so does the ingest.

### Window 2 — the pull

```bat
cd /d %USERPROFILE%\Snake-Eye
npm run gateway
npm run ingest
npm run fundamentals -- --contact you@example.com
```

`npm run gateway` must print `ready` before the rest. If it says
`403 — not logged in`, the browser login did not land; repeat it.

The ingest paces itself: IBKR allows roughly 60 historical requests per 10
minutes, so twenty symbols take a couple of minutes on purpose.

### Window 3 — the site

```bat
cd /d %USERPROFILE%\Snake-Eye
npm start
```

Then **http://localhost:8080**, and **Ctrl + F5** to force the browser past its
cached copy of the scripts.

---

## Reading it from a phone

The site is served by your own machine, so the phone needs to be on the same
Wi-Fi and the PC needs to be on with `npm start` running. There is no cloud
copy: close the window and the phone sees nothing.

`npm start` prints the addresses it is listening on:

```
Available on:
  http://127.0.0.1:8080
  http://192.168.1.42:8080     <- this one
```

Type that second address on the phone. `localhost` means the phone itself, so
it will not work there.

Windows may ask to allow Node through the firewall the first time — allow it
for **private networks**. If the page will not load, that prompt was probably
declined; Windows Defender Firewall → Allow an app → Node.js → tick Private.

**The data is exactly as fresh as the last ingest.** Both devices read the same
file, so the phone shows what the PC shows — end-of-day bars from the session
named in the header, not live intraday prices. The header spells the age out
(`session 2026-09-18 · 3 days ago`) and turns amber once it is over a week old,
so a stale file cannot pass for a fresh one.

## Why three windows

Each of the three runs until you stop it. `npm start` holds the terminal for as
long as it is serving, and so does the gateway, which is why neither can share
a window with a command you want to type afterwards.

If the session has been idle for hours, `npm run keepalive` in a fourth window
pings the gateway so it does not sleep. The session expires daily regardless —
a fresh login is normal, not a fault.

---

## Common stumbles

| What you see | What it means |
|---|---|
| `Missing script: "..."` | The repository is behind — `git pull` |
| `npm error ENOENT ... C:\package.json` | Wrong directory — `cd /d %USERPROFILE%\Snake-Eye` |
| `Nothing is listening on localhost:5000` | Window 1 is closed or the gateway never started |
| `403 — not logged in` | The gateway runs, but the browser session is gone |
| `The system cannot find the path specified` | `run.bat` was started from the wrong folder |
| Page stuck on `loading…` | Opened as `file://` instead of `http://localhost:8080` |
| `Address already in use` | A second gateway is running — `taskkill /F /IM java.exe` |

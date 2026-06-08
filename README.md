# VM-Kassan ’26 ⚽ — World Cup 2026 Betting Tracker

A static site (GitHub Pages) that shows the **World Cup 2026 schedule, group tables and knockout bracket** with **Swedish kick-off times**, results auto-synced **once per day** via GitHub Actions, plus a **betting leaderboard** for the crew (Arvid, Edvin, Kevin, Felix, Wictor, Linus, Filip) — everyone starts at **200 SEK**, tracked against the **OMXS30** index.

## What's in the box

```
.
├── index.html                     # the site
├── assets/css/styles.css
├── assets/js/app.js
├── data/
│   ├── teams.json                 # the 12 groups (static reference)
│   ├── matches.json               # fixtures + results  (auto-updated)
│   ├── standings.json             # group tables         (auto-updated)
│   ├── omx.json                   # OMXS30 series        (auto-updated)
│   └── betting.json               # the shared money ledger (you edit this)
├── scripts/fetch_data.py          # the daily fetcher (stdlib only)
├── .github/workflows/update-data.yml
└── .nojekyll
```

## Setup (≈5 minutes)

1. **Create a repo** and drop this whole folder in (keep the structure).
2. **Enable Pages:** repo → *Settings → Pages →* Source = *Deploy from a branch*, Branch = `main` / `(root)`. Your site lands at `https://<you>.github.io/<repo>/`.
3. **Get a free football API token:** register at <https://www.football-data.org/client/register>. The free tier covers the World Cup.
4. **Add it as a secret:** repo → *Settings → Secrets and variables → Actions → New repository secret*, name it exactly `FOOTBALL_DATA_TOKEN`.
5. **Run the sync once:** repo → *Actions → “Update World Cup data” → Run workflow*. After it finishes, fixtures, results, tables, the bracket and the OMXS30 line all populate. It then re-runs automatically a few times a day.

Until step 5 runs, the site still loads and shows the 12 groups; the schedule/bracket just say “waiting for first sync”.

## How the daily auto-update works

`.github/workflows/update-data.yml` runs `scripts/fetch_data.py` on a cron (UTC):

- fixtures + results + group standings → **football-data.org** (competition `WC`)
- **OMXS30** index → **Stooq** (`^omxs30`), with a Yahoo Finance fallback

then commits the refreshed `data/*.json`. The script never overwrites good data with an empty response, so a failed fetch just keeps yesterday's numbers. Times are converted to **Europe/Stockholm** in the browser, so they're always correct for Sweden including DST.

## The betting side

`data/betting.json` is the single source of truth, shared by everyone once committed.

In the **The Kassa** tab you can:

- see the **current leader** (most money) with their % change, plus the full ranked board
- watch the **per-player graph** with the **OMXS30 normalised to 200** on the same scale (toggle SEK / % change)
- **log a day:** pick a date, type each person's end-of-day balance, hit **Apply** to preview locally, then **Export** (or **Copy**) the updated `betting.json` and commit it.

Because GitHub Pages is static (no server/database), saving is done by committing `betting.json`. The easiest flow for the group: edit on the site → **Copy JSON** → open `data/betting.json` on GitHub → paste → commit. Your in-progress edits are also kept in the browser (localStorage) so nothing is lost on refresh.

## Swapping the data source

If you'd rather not register a token, you can point `scripts/fetch_data.py` at the free open-source feed at <https://github.com/rezarahiminia/worldcup2026> — keep the same output JSON shape (`matches.json`, `standings.json`) and everything else works unchanged.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

That's it — good luck, and may the OMXS30 not embarrass you all. 📈

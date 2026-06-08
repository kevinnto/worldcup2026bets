# VM 2026 Betting Tracker

A static website for tracking betting money during the 2026 FIFA World Cup (11 June to 19 July 2026) for a group of friends. Hosted on GitHub Pages. Match results, the OMXS30 index, and the S&P 500 are refreshed automatically by a daily GitHub Action. Betting is shared live via Firebase, so anyone can submit their balance and everyone's site updates instantly.

## Views

- **Spelschema** full schedule of all 104 matches by day, with Swedish kick-off times and auto-fetched results
- **Grupper** the 12 group tables, recomputed in the browser from results (points, goal difference, goals for)
- **Slutspel** the knockout bracket from Round of 32 to the Final, auto-advancing winners as results come in
- **Stålarna** the betting side: pick your player, pick the day, enter your current balance, hit save. Shows the live leader with percentage change, plus a daily line chart of every player against the OMXS30 and S&P 500 indices (all normalised to 200)

## Repository layout

```
.
├── index.html                  Entry point
├── css/styles.css              Styling
├── js/
│   ├── config.js               Firebase config (paste yours here for live mode)
│   └── app.js                  All client logic (standings, bracket, betting, chart)
├── data/
│   ├── fixtures.json           104 matches, 48 teams, 12 groups (static)
│   ├── results.json            Scores, refreshed by the Action
│   ├── omx.json                OMXS30 daily closes, refreshed by the Action
│   ├── sp500.json              S&P 500 daily closes, refreshed by the Action
│   └── betting.json            Fallback betting balances (local mode only)
├── scripts/
│   ├── generate_fixtures.py    One-off builder for fixtures.json
│   ├── update_data.py          Daily fetcher (results + both indices), stdlib only
│   └── requirements.txt        Empty, no dependencies
├── .github/workflows/update.yml  Scheduled data refresh
└── .nojekyll                   Tells GitHub Pages to serve files as-is
```

## Deploy on GitHub Pages

1. Create a new repository and upload the entire folder (keep the structure intact, including the dotfiles `.nojekyll` and `.github/`)
2. Go to **Settings → Pages**, set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`, and save
3. Wait for the build, then open the published URL

## Enable live betting (Firebase, ~5 minutes, free)

This is what lets a friend submit their amount and have everyone's site update instantly. Without it, the site still works in local mode (see below).

1. Go to the Firebase console (console.firebase.google.com) and click **Add project** (any name)
2. In the left menu, open **Build → Realtime Database → Create database**. Pick a location, start in **locked mode**
3. Open the **Rules** tab and paste the rules below, then **Publish**
4. Open **Project settings** (gear icon) → **General** → scroll to **Your apps** → click the web icon `</>` → register the app → copy the `firebaseConfig` object
5. Paste it into `js/config.js`, replacing the placeholder, and commit

Database rules (validate the shape, allow the group to read and write):

```json
{
  "rules": {
    "balances": {
      ".read": true,
      ".write": true,
      "$date": {
        "$player": {
          ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 1000000"
        }
      }
    }
  }
}
```

Security note: these rules are public, which is fine for a small group of friends (worst case, someone edits a number). To lock it down further, enable Firebase **Anonymous Authentication** and change `.read`/`.write` to `"auth != null"`. The header on the betting view shows **🟢 Live** when Firebase is connected, or **💾 Lokalt läge** when it is not.

## Enable the daily auto-refresh

1. Go to **Settings → Actions → General → Workflow permissions**, select **Read and write permissions**, and save (this lets the Action commit refreshed data)
2. Optional but recommended: register a free token at football-data.org, then add it under **Settings → Secrets and variables → Actions** as a secret named `FOOTBALL_DATA_TOKEN` for the most reliable scores. Without it, the script falls back to the free TheSportsDB source
3. The workflow runs every 3 hours. To run it immediately, open the **Actions** tab, select "Update WC2026 data", and click **Run workflow**

## How betting works

Everyone starts at 200 SEK.

**Live mode (Firebase configured):** go to **Stålarna**, choose your player and the day, type your current balance, and click **Spara**. It writes to the shared database and every open site updates within a second. Days inherit the previous day's value until someone enters a new one.

**Local mode (no Firebase):** the same form saves to your browser only. Click **Ladda ner betting.json** to download the file and commit it to `data/betting.json` so the group sees the numbers. Nominate one scorekeeper to avoid conflicting commits.

## Editing results by hand

If a score is missing or wrong, edit `data/results.json`. Each entry is keyed by internal match id (`m1` to `m104`, see `fixtures.json`):

```json
{
  "matches": {
    "m1": { "status": "FINISHED", "homeScore": 3, "awayScore": 0 }
  }
}
```

For knockout matches decided on penalties, add `"homePens"` and `"awayPens"` so the bracket advances the correct team.

## Notes

- Group tables and the knockout bracket are computed in the browser, so the site never breaks if the Action fails or data is empty
- Round of 32 best-third-place slots show as labels until FIFA confirms the allocation after the group stage. Round of 16 onward use match-number linkage and auto-advance winners. Exact cross-pairings are confirmed by FIFA
- All kick-off times are stored in UTC and rendered in Stockholm time, so they stay correct across daylight saving
- Both indices are anchored to the day before kick-off and normalised to 200, so they sit on the same scale as the players

## Regenerating fixtures

Only needed if the schedule changes. Run `python scripts/generate_fixtures.py` to rewrite `data/fixtures.json`.

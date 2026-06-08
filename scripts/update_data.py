#!/usr/bin/env python3
"""
Daily updater for the VM 2026 tracker. Run by GitHub Actions.

Writes:
  data/results.json  — scores/status keyed by our internal match ids (m1..m104)
  data/omx.json      — OMXS30 daily closes (normalised to 200 in the browser)
  data/sp500.json    — S&P 500 daily closes (normalised to 200 in the browser)

Result sources (in priority order, both optional / degrade gracefully):
  1. football-data.org  — set repo secret FOOTBALL_DATA_TOKEN (free tier covers the World Cup)
  2. TheSportsDB        — free key '3' by default; set THESPORTSDB_KEY to use your own

OMXS30 source: Stooq CSV (symbol ^OMX), no key needed.

Nothing here ever deletes existing scores: a failed fetch leaves the file as-is,
so the website never breaks. You can also edit data/results.json by hand.
"""
import json, os, re, sys, unicodedata, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "data", "fixtures.json")
RESULTS = os.path.join(ROOT, "data", "results.json")
OMX = os.path.join(ROOT, "data", "omx.json")
SP500 = os.path.join(ROOT, "data", "sp500.json")
START_DATE = "2026-06-10"  # day before kickoff, baseline for the index

ALIASES = {
    "korearepublic": "southkorea", "republicofkorea": "southkorea", "korea": "southkorea",
    "turkiye": "turkey",
    "unitedstates": "usa", "unitedstatesofamerica": "usa",
    "ivorycoast": "cotedivoire",
    "drcongo": "congodr", "democraticrepublicofthecongo": "congodr", "dccongo": "congodr",
    "capeverde": "caboverde",
    "bosniaandherzegovina": "bosnia", "bosniaherzegovina": "bosnia", "bosniahercegovina": "bosnia",
    "czechrepublic": "czechia",
}


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z]", "", s.lower())
    return ALIASES.get(s, s)


def http_get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "wc2026-tracker"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def build_match_index(fixtures):
    """norm(home)|norm(away)|YYYY-MM-DD(UTC) -> match id, plus a date-loose fallback."""
    teams = fixtures["teams"]
    exact, loose = {}, {}
    for m in fixtures["matches"]:
        if m["stage"] != "GROUP":
            continue  # only group matches keyed by fixed teams; KO resolves client-side
        h = norm(teams[m["home"]]["en"])
        a = norm(teams[m["away"]]["en"])
        d = m["kickoff"][:10]
        exact[f"{h}|{a}|{d}"] = m["id"]
        loose.setdefault(f"{h}|{a}", []).append((d, m["id"]))
    return exact, loose


def match_id(exact, loose, home, away, date):
    h, a = norm(home), norm(away)
    key = f"{h}|{a}|{date}"
    if key in exact:
        return exact[key]
    # date-loose: nearest within +/- 1 day
    for k in (f"{h}|{a}", f"{a}|{h}"):
        if k in loose:
            cand = sorted(loose[k], key=lambda x: abs(
                (datetime.fromisoformat(x[0]) - datetime.fromisoformat(date)).days))
            if cand and abs((datetime.fromisoformat(cand[0][0]) - datetime.fromisoformat(date)).days) <= 1:
                return cand[0][1]
    return None


def status_norm(s):
    s = (s or "").upper()
    if s in ("FINISHED", "FT", "MATCH FINISHED", "AET", "PEN"):
        return "FINISHED"
    if s in ("IN_PLAY", "PAUSED", "1H", "2H", "HT", "LIVE", "ET"):
        return "IN_PLAY"
    return "SCHEDULED"


def fetch_football_data(token, exact, loose):
    out = {}
    url = "https://api.football-data.org/v4/competitions/WC/matches"
    data = json.loads(http_get(url, headers={"X-Auth-Token": token}))
    for m in data.get("matches", []):
        st = status_norm(m.get("status"))
        score = m.get("score", {}).get("fullTime", {})
        if score.get("home") is None or score.get("away") is None:
            continue
        date = m.get("utcDate", "")[:10]
        mid = match_id(exact, loose, m["homeTeam"]["name"], m["awayTeam"]["name"], date)
        if not mid:
            continue
        entry = {"homeScore": score["home"], "awayScore": score["away"], "status": st}
        pens = m.get("score", {}).get("penalties", {})
        if pens.get("home") is not None:
            entry["homePens"] = pens["home"]; entry["awayPens"] = pens["away"]
        out[mid] = entry
    return out


def fetch_thesportsdb(key, fixtures, exact, loose):
    out = {}
    dates = sorted({m["kickoff"][:10] for m in fixtures["matches"]})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for d in dates:
        if d > today:
            continue
        try:
            url = f"https://www.thesportsdb.com/api/v1/json/{key}/eventsday.php?d={d}&s=Soccer"
            data = json.loads(http_get(url))
        except Exception as e:
            print(f"  TheSportsDB {d}: {e}", file=sys.stderr)
            continue
        for ev in (data.get("events") or []):
            if "world cup" not in (ev.get("strLeague") or "").lower():
                continue
            hs, as_ = ev.get("intHomeScore"), ev.get("intAwayScore")
            if hs in (None, "") or as_ in (None, ""):
                continue
            mid = match_id(exact, loose, ev.get("strHomeTeam", ""), ev.get("strAwayTeam", ""), d)
            if not mid:
                continue
            out[mid] = {"homeScore": int(hs), "awayScore": int(as_),
                        "status": status_norm(ev.get("strStatus") or ev.get("strProgress"))}
    return out


def update_results(fixtures):
    exact, loose = build_match_index(fixtures)
    results = load(RESULTS, {"matches": {}})
    results.setdefault("matches", {})
    fetched = {}

    token = os.environ.get("FOOTBALL_DATA_TOKEN", "").strip()
    if token:
        try:
            fetched = fetch_football_data(token, exact, loose)
            print(f"football-data.org: matched {len(fetched)} results")
        except Exception as e:
            print(f"football-data.org failed: {e}", file=sys.stderr)

    if not fetched:
        key = os.environ.get("THESPORTSDB_KEY", "3").strip() or "3"
        try:
            fetched = fetch_thesportsdb(key, fixtures, exact, loose)
            print(f"TheSportsDB: matched {len(fetched)} results")
        except Exception as e:
            print(f"TheSportsDB failed: {e}", file=sys.stderr)

    # merge (never wipe existing finished scores with a worse/empty fetch)
    for mid, entry in fetched.items():
        results["matches"][mid] = entry
    results["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(RESULTS, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"results.json: {len(results['matches'])} total stored")


def update_index(path, stooq_symbol, default_symbol):
    idx = load(path, {"symbol": default_symbol, "history": []})
    url = "https://stooq.com/q/d/l/?s=%s&i=d" % stooq_symbol
    try:
        csv = http_get(url)
    except Exception as e:
        print(f"Stooq {default_symbol} failed: {e}", file=sys.stderr)
        return
    rows = [r for r in csv.strip().splitlines() if r and r[0].isdigit()]
    hist = {x["date"]: x for x in idx.get("history", [])}
    added = 0
    for r in rows:
        parts = r.split(",")
        if len(parts) < 5:
            continue
        date, close = parts[0], parts[4]
        if date < START_DATE or close in ("", "N/D"):
            continue
        try:
            c = float(close)
        except ValueError:
            continue
        if date not in hist:
            added += 1
        hist[date] = {"date": date, "close": c}
    idx["history"] = [hist[k] for k in sorted(hist)]
    idx["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=2)
    fname = os.path.basename(path)
    print(f"{fname}: {len(idx['history'])} closes ({added} new)")


def main():
    fixtures = load(FIXTURES, None)
    if not fixtures:
        print("fixtures.json missing", file=sys.stderr)
        sys.exit(1)
    update_results(fixtures)
    update_index(OMX, "%5Eomx", "^OMX")
    update_index(SP500, "%5Espx", "^SPX")


if __name__ == "__main__":
    main()

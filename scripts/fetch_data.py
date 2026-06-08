#!/usr/bin/env python3
"""
Fetch WC2026 fixtures + results + group standings (football-data.org, free tier)
and the OMX Stockholm 30 index (Stooq, with a Yahoo fallback), then write clean
JSON into ./data for the static site to read.

Design goals:
- Never destroy good data. If a source fails, the existing file is kept.
- No surprises: team names from the API are normalised to our codes via data/teams.json.

Env:
  FOOTBALL_DATA_TOKEN   free token from https://www.football-data.org/client/register
"""
import os, sys, json, time, unicodedata, urllib.request, urllib.error, csv, io, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
TOKEN = os.environ.get("FOOTBALL_DATA_TOKEN", "").strip()
FD_BASE = "https://api.football-data.org/v4/competitions/WC"
UA = "Mozilla/5.0 (compatible; wc26-tracker/1.0)"


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def save_json(name, obj):
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"  wrote data/{name}")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return "".join(c for c in s.lower() if c.isalnum())


def build_lookup():
    """alias/team -> {code, team, group} for matching API names."""
    teams = load_json("teams.json")["groups"]
    lut = {}
    for grp, rows in teams.items():
        for t in rows:
            keys = set(t.get("aliases", [])) | {t["team"]}
            for k in keys:
                lut[norm(k)] = {"code": t["code"], "team": t["team"], "group": grp}
    return lut


def match_team(name, lut):
    n = norm(name)
    if n in lut:
        return lut[n]
    for k, v in lut.items():  # loose containment fallback
        if k and (k in n or n in k):
            return v
    return {"code": "", "team": name, "group": None}


def http_get(url, headers=None, timeout=30, retries=3):
    headers = headers or {}
    headers.setdefault("User-Agent", UA)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa
            last = e
            print(f"  attempt {i+1} failed for {url}: {e}")
            time.sleep(2 * (i + 1))
    raise last


# ---------- football-data.org ----------

def fetch_matches(lut):
    if not TOKEN:
        print("! FOOTBALL_DATA_TOKEN not set — skipping fixtures (keeping existing file)")
        return None
    raw = http_get(f"{FD_BASE}/matches", headers={"X-Auth-Token": TOKEN})
    data = json.loads(raw)
    out = []
    for m in data.get("matches", []):
        h = match_team((m.get("homeTeam") or {}).get("name", ""), lut)
        a = match_team((m.get("awayTeam") or {}).get("name", ""), lut)
        ft = (m.get("score") or {}).get("fullTime") or {}
        grp = m.get("group")
        out.append({
            "id": m.get("id"),
            "utcDate": m.get("utcDate"),
            "stage": m.get("stage"),                       # GROUP_STAGE, LAST_32, ...
            "group": grp.replace("GROUP_", "") if grp else None,
            "status": m.get("status"),                     # SCHEDULED/TIMED/IN_PLAY/PAUSED/FINISHED
            "home": h["team"], "homeCode": h["code"],
            "away": a["team"], "awayCode": a["code"],
            "homeScore": ft.get("home"),
            "awayScore": ft.get("away"),
        })
    out.sort(key=lambda x: x["utcDate"] or "")
    print(f"  {len(out)} matches")
    return {"lastUpdated": now_iso(), "source": "football-data.org", "matches": out}


def fetch_standings(lut):
    if not TOKEN:
        print("! FOOTBALL_DATA_TOKEN not set — skipping standings (keeping existing file)")
        return None
    raw = http_get(f"{FD_BASE}/standings", headers={"X-Auth-Token": TOKEN})
    data = json.loads(raw)
    groups = {}
    for block in data.get("standings", []):
        if block.get("type") not in (None, "TOTAL"):
            continue
        grp = (block.get("group") or "").replace("GROUP_", "")
        if not grp:
            continue
        table = []
        for row in block.get("table", []):
            t = match_team((row.get("team") or {}).get("name", ""), lut)
            table.append({
                "team": t["team"], "code": t["code"],
                "played": row.get("playedGames", 0),
                "won": row.get("won", 0), "draw": row.get("draw", 0), "lost": row.get("lost", 0),
                "gf": row.get("goalsFor", 0), "ga": row.get("goalsAgainst", 0),
                "gd": row.get("goalDifference", 0), "points": row.get("points", 0),
            })
        if table:
            groups[grp] = table
    if not groups:
        return None
    print(f"  standings for groups: {sorted(groups)}")
    return {"lastUpdated": now_iso(), "source": "football-data.org", "groups": groups}


# ---------- OMX Stockholm 30 ----------

def fetch_omx():
    series = []
    # 1) Stooq CSV (no key)
    try:
        raw = http_get("https://stooq.com/q/d/l/?s=^omxs30&i=d").decode("utf-8", "ignore")
        rdr = csv.DictReader(io.StringIO(raw))
        for r in rdr:
            d, c = r.get("Date"), r.get("Close")
            if d and c and c.upper() != "N/D":
                try:
                    series.append({"date": d, "close": round(float(c), 2)})
                except ValueError:
                    pass
        if series:
            print(f"  OMXS30 via Stooq: {len(series)} rows")
    except Exception as e:  # noqa
        print(f"  Stooq failed: {e}")

    # 2) Yahoo fallback
    if not series:
        try:
            url = ("https://query1.finance.yahoo.com/v8/finance/chart/%5EOMXS30"
                   "?range=2y&interval=1d")
            data = json.loads(http_get(url))
            res = data["chart"]["result"][0]
            ts = res["timestamp"]
            closes = res["indicators"]["quote"][0]["close"]
            for t, c in zip(ts, closes):
                if c is None:
                    continue
                d = datetime.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")
                series.append({"date": d, "close": round(float(c), 2)})
            print(f"  OMXS30 via Yahoo: {len(series)} rows")
        except Exception as e:  # noqa
            print(f"  Yahoo failed: {e}")

    if not series:
        return None
    # keep from the start of the tournament month onward to keep the file small
    series = [s for s in series if s["date"] >= "2026-06-01"]
    series.sort(key=lambda x: x["date"])
    return {"lastUpdated": now_iso(), "source": "stooq/yahoo", "symbol": "^OMXS30", "series": series}


def main():
    lut = build_lookup()
    print("Fetching fixtures + results...")
    try:
        m = fetch_matches(lut)
        if m and m["matches"]:
            save_json("matches.json", m)
    except Exception as e:  # noqa
        print(f"! matches fetch error (keeping existing): {e}")

    print("Fetching group standings...")
    try:
        s = fetch_standings(lut)
        if s:
            save_json("standings.json", s)
    except Exception as e:  # noqa
        print(f"! standings fetch error (keeping existing): {e}")

    print("Fetching OMXS30...")
    try:
        o = fetch_omx()
        if o and o["series"]:
            save_json("omx.json", o)
    except Exception as e:  # noqa
        print(f"! omx fetch error (keeping existing): {e}")

    print("Done.")


if __name__ == "__main__":
    main()

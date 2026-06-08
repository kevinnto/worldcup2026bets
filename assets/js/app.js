/* ============================================================
   VM-KASSAN '26 — app logic
   Reads ./data/*.json (auto-updated by GitHub Actions) and renders
   schedule, group tables, knockout bracket and the betting leaderboard.
   ============================================================ */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const bust = () => "?t=" + Date.now();

  /* ---------- flags ---------- */
  const FLAG_OVERRIDE = { "GB-ENG": "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", "GB-SCT": "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}" };
  function flag(code) {
    if (!code) return "🏳️";
    if (FLAG_OVERRIDE[code]) return FLAG_OVERRIDE[code];
    if (code.length !== 2) return "🏳️";
    const A = 0x1f1e6;
    return String.fromCodePoint(A + code.charCodeAt(0) - 65, A + code.charCodeAt(1) - 65);
  }

  /* ---------- Swedish time helpers ---------- */
  const TZ = "Europe/Stockholm";
  const fmtTime = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDow = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, weekday: "long" });
  const fmtDate = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, day: "numeric", month: "long" });
  const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }); // YYYY-MM-DD
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const dayKeySE = iso => fmtKey.format(new Date(iso));
  const todayKeySE = () => fmtKey.format(new Date());

  /* ---------- state ---------- */
  const state = { teams: null, matches: [], standings: null, omx: [], betting: null, working: null, chart: null, chartMode: "balance" };

  const MEMES_TAG = [
    "26 nations of regret incoming", "diamond hands or diamond tears", "the group of death awaits",
    "trust the process, fade the favourites", "it's coming home (citation needed)", "VAR will betray us all"
  ];
  const MEMES_FOOT = [
    "may your parlays hit and your group survive 🙏", "remember: the house always wins, but so can Filip",
    "down bad is a temporary state of mind", "stonks only go up (they do not)"
  ];

  /* ---------- boot ---------- */
  async function boot() {
    $("#tagline").textContent = MEMES_TAG[Math.floor(Math.random() * MEMES_TAG.length)];
    $("#footMeme").textContent = MEMES_FOOT[Math.floor(Math.random() * MEMES_FOOT.length)];
    wireTabs();
    wireScheduleFilter();
    wireBetting();

    const [teams, matches, standings, omx, betting] = await Promise.all([
      getJSON("./data/teams.json"), getJSON("./data/matches.json"),
      getJSON("./data/standings.json"), getJSON("./data/omx.json"),
      getJSON("./data/betting.json"),
    ]);
    state.teams = teams; state.standings = standings;
    state.matches = (matches && matches.matches) || [];
    state.omx = (omx && omx.series) || [];
    state.betting = betting;
    loadWorking();

    setStatus(matches, standings);
    renderSchedule(); renderGroups(); renderBracket();
    renderBetting();
  }

  async function getJSON(url) {
    try { const r = await fetch(url + bust(), { cache: "no-store" }); if (!r.ok) throw 0; return await r.json(); }
    catch { return null; }
  }

  function setStatus(matches, standings) {
    const stamp = (matches && matches.lastUpdated) || (standings && standings.lastUpdated);
    const el = $("#dataStatusText");
    if (!stamp) { el.textContent = "awaiting first sync"; $("#dataStatus .dot").style.background = "var(--gold)"; return; }
    const d = new Date(stamp);
    el.textContent = "updated " + new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  }

  /* ============================================================
     SCHEDULE
     ============================================================ */
  let scheduleFilter = "all";
  const KO_STAGES = ["LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];
  const STAGE_LABEL = { GROUP_STAGE: "GROUP", LAST_32: "R32", LAST_16: "R16", QUARTER_FINALS: "QF", SEMI_FINALS: "SF", THIRD_PLACE: "3RD", FINAL: "FINAL" };

  function wireScheduleFilter() {
    $$("#scheduleFilter .seg-btn").forEach(b => b.addEventListener("click", () => {
      $$("#scheduleFilter .seg-btn").forEach(x => x.classList.remove("is-active"));
      b.classList.add("is-active"); scheduleFilter = b.dataset.filter; renderSchedule();
    }));
  }

  function renderSchedule() {
    const host = $("#scheduleList");
    let list = state.matches.slice();
    if (scheduleFilter === "group") list = list.filter(m => m.stage === "GROUP_STAGE");
    else if (scheduleFilter === "ko") list = list.filter(m => KO_STAGES.includes(m.stage));
    else if (scheduleFilter === "today") list = list.filter(m => dayKeySE(m.utcDate) === todayKeySE());

    if (!list.length) {
      host.innerHTML = emptyState("📡", "No fixtures here yet",
        state.matches.length ? "Nothing matches this filter." :
        "Fixtures load once the daily sync runs. Add your free API token + trigger the Action (see README) and the whole schedule fills in.");
      return;
    }
    const byDay = groupBy(list, m => dayKeySE(m.utcDate));
    host.innerHTML = Object.keys(byDay).sort().map(day => {
      const d = new Date(byDay[day][0].utcDate);
      const rows = byDay[day].sort((a, b) => a.utcDate.localeCompare(b.utcDate)).map(matchRow).join("");
      return `<div class="day-block">
        <div class="day-head">
          <span class="dow">${cap(fmtDow.format(d))}</span>
          <span class="date">${fmtDate.format(d)}</span>
          <span class="count">${byDay[day].length} match${byDay[day].length > 1 ? "es" : ""}</span>
        </div>${rows}</div>`;
    }).join("");
  }

  function matchRow(m) {
    const live = m.status === "IN_PLAY" || m.status === "PAUSED";
    const done = m.status === "FINISHED";
    const hasScore = m.homeScore != null && m.awayScore != null;
    const hw = hasScore && m.homeScore > m.awayScore, aw = hasScore && m.awayScore > m.homeScore;
    const stageTag = m.stage === "GROUP_STAGE" ? ("Group " + (m.group || "")) : (STAGE_LABEL[m.stage] || m.stage || "");
    let resultHTML;
    if (hasScore) {
      resultHTML = `<div class="score">${m.homeScore}<span class="x">–</span>${m.awayScore}</div>
        <span class="pill ${live ? "live" : "ft"}">${live ? "Live" : "FT"}</span>`;
    } else {
      resultHTML = `<span class="pill soon">${fmtTime.format(new Date(m.utcDate))}</span>`;
    }
    return `<div class="match">
      <div class="ko">${fmtTime.format(new Date(m.utcDate))}<small>${stageTag}</small></div>
      <div class="teams">
        <div class="team-line ${done && hw ? "win" : ""} ${done && aw ? "lose" : ""}"><span class="flag">${flag(m.homeCode)}</span><span class="nm">${m.home}</span></div>
        <div class="team-line ${done && aw ? "win" : ""} ${done && hw ? "lose" : ""}"><span class="flag">${flag(m.awayCode)}</span><span class="nm">${m.away}</span></div>
      </div>
      <div class="result">${resultHTML}</div>
    </div>`;
  }

  /* ============================================================
     GROUP TABLES
     ============================================================ */
  function renderGroups() {
    const host = $("#groupGrid");
    const groups = (state.standings && state.standings.groups) || {};
    const keys = Object.keys(groups).sort();
    if (!keys.length) { host.innerHTML = emptyState("📊", "Tables warming up", "Standings appear after the first sync."); return; }
    host.innerHTML = keys.map(g => {
      const rows = groups[g].slice().sort(sortStanding).map((t, i) => {
        const cls = i === 0 ? "q1" : i === 1 ? "q2" : i === 2 ? "q3" : "";
        return `<tr class="${cls}">
          <td class="rank">${i + 1}</td>
          <td class="tl"><span class="flag">${flag(t.code)}</span><span class="nm">${t.team}</span></td>
          <td>${t.played}</td><td>${t.won}-${t.draw}-${t.lost}</td>
          <td>${t.gd > 0 ? "+" + t.gd : t.gd}</td><td class="pts">${t.points}</td>
        </tr>`;
      }).join("");
      return `<div class="group-card">
        <h3>Group ${g}</h3>
        <table class="gtable">
          <thead><tr><th></th><th class="tl">Team</th><th>P</th><th>W-D-L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
    }).join("");
  }
  function sortStanding(a, b) {
    return b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team);
  }

  /* ============================================================
     BRACKET
     ============================================================ */
  const BRACKET_ORDER = [
    ["LAST_32", "Round of 32", 16], ["LAST_16", "Round of 16", 8],
    ["QUARTER_FINALS", "Quarter-finals", 4], ["SEMI_FINALS", "Semi-finals", 2],
    ["FINAL", "Final", 1],
  ];
  function renderBracket() {
    const host = $("#bracket");
    const byStage = groupBy(state.matches.filter(m => KO_STAGES.includes(m.stage)), m => m.stage);
    host.innerHTML = BRACKET_ORDER.map(([stage, label, count]) => {
      const ms = (byStage[stage] || []).sort((a, b) => (a.utcDate || "").localeCompare(b.utcDate || ""));
      const ties = ms.length ? ms.map(t => tieCard(t, stage === "FINAL")).join("")
        : Array.from({ length: count }, () => placeholderTie(stage === "FINAL")).join("");
      return `<div class="round"><div class="round-label">${label}</div>${ties}</div>`;
    }).join("");
    // third-place playoff appended subtly under the final column if present
    const third = state.matches.filter(m => m.stage === "THIRD_PLACE");
    if (third.length) {
      const col = `<div class="round"><div class="round-label">3rd place</div>${third.map(t => tieCard(t, false)).join("")}</div>`;
      host.insertAdjacentHTML("beforeend", col);
    }
  }
  function side(name, code, score, win) {
    return `<div class="side ${win ? "win" : ""} ${score != null && !win ? "lose" : ""}">
      <span class="flag">${flag(code)}</span><span class="nm">${name || "TBD"}</span>
      <span class="sc">${score != null ? score : ""}</span></div>`;
  }
  function tieCard(m, isFinal) {
    const has = m.homeScore != null && m.awayScore != null;
    const hw = has && m.homeScore > m.awayScore, aw = has && m.awayScore > m.homeScore;
    const when = m.utcDate ? `${cap(fmtDow.format(new Date(m.utcDate)))} ${fmtDate.format(new Date(m.utcDate))} · ${fmtTime.format(new Date(m.utcDate))}` : "";
    return `<div class="tie ${isFinal ? "final-tie" : ""}">
      <div class="when">${when}</div>
      ${side(m.home, m.homeCode, m.homeScore, hw)}
      ${side(m.away, m.awayCode, m.awayScore, aw)}
    </div>`;
  }
  function placeholderTie(isFinal) {
    return `<div class="tie ${isFinal ? "final-tie" : ""}">
      <div class="side"><span class="flag">🏳️</span><span class="nm placeholder">TBD</span></div>
      <div class="side"><span class="flag">🏳️</span><span class="nm placeholder">TBD</span></div></div>`;
  }

  /* ============================================================
     BETTING
     ============================================================ */
  const LS_KEY = "vmkassan26_working";

  function players() { return (state.working && state.working.players) || []; }
  function start() { return (state.working && state.working.startingAmount) || 200; }
  function entries() { return (state.working && state.working.entries) || []; }
  function sortedEntries() { return entries().slice().sort((a, b) => a.date.localeCompare(b.date)); }

  function loadWorking() {
    let base = state.betting ? JSON.parse(JSON.stringify(state.betting)) : { players: [], startingAmount: 200, currency: "SEK", entries: [] };
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const w = JSON.parse(saved);
        // only adopt local draft if it belongs to the same crew
        if (w && Array.isArray(w.players) && w.players.join() === base.players.join()) base = w;
      }
    } catch { /* sandbox preview: no localStorage, that's fine */ }
    state.working = base;
  }
  function persistWorking() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.working)); } catch { /* ignore */ }
  }

  function latestBalances() {
    const e = sortedEntries();
    const map = {};
    players().forEach(p => map[p] = start());
    e.forEach(row => players().forEach(p => { if (row.balances && row.balances[p] != null) map[p] = row.balances[p]; }));
    return map;
  }

  function renderBetting() {
    if (!players().length) { $("#leaderRow").innerHTML = emptyState("💸", "No crew loaded", "Check data/betting.json"); return; }
    const bal = latestBalances();
    const ranked = players().map(p => ({ p, bal: bal[p], pct: (bal[p] - start()) / start() * 100 }))
      .sort((a, b) => b.bal - a.bal);
    const last = sortedEntries().slice(-1)[0];
    $("#asOf").textContent = last ? "· as of " + last.date : "";

    // leader + loser cards
    const top = ranked[0], bot = ranked[ranked.length - 1];
    const sign = v => (v > 0 ? "+" : "") + v.toFixed(1) + "%";
    const cls = v => v > 0.0001 ? "up" : v < -0.0001 ? "down" : "flat";
    const topMeme = top.pct > 25 ? "absolutely cooking 🔥" : top.pct > 0 ? "quietly stacking 📈" : "leading the race to the bottom 💀";
    const botMeme = bot.pct < -25 ? "it might be time to stop 🫠" : bot.pct < 0 ? "down bad but not out" : "somehow still even";
    $("#leaderRow").innerHTML = `
      <div class="leader-card">
        <div class="crown">👑</div>
        <div class="lbl">Current leader</div>
        <div class="who">${top.p}</div>
        <div><span class="amt">${money(top.bal)}</span><span class="chg ${cls(top.pct)}">${sign(top.pct)}</span></div>
        <div class="meme">${topMeme}</div>
      </div>
      <div class="loser-card">
        <div class="lbl">🪦 Holding the bag</div>
        <div class="who">${bot.p}</div>
        <div><span class="amt">${money(bot.bal)}</span> <span class="chg ${cls(bot.pct)}">${sign(bot.pct)}</span></div>
        <div class="meme">${botMeme}</div>
      </div>`;

    // full board
    $("#moneyBoard").innerHTML = ranked.map((r, i) => `
      <div class="mb-row ${i === 0 ? "top1" : ""}">
        <span class="rk">${i + 1}</span>
        <span class="nm">${i === 0 ? "👑 " : ""}${r.p}</span>
        <span class="bal">${money(r.bal)}</span>
        <span class="pct ${cls(r.pct)}">${sign(r.pct)}</span>
      </div>`).join("");

    buildEditor();
    renderChart();
    quip(ranked);
  }

  function quip(ranked) {
    // compare best player vs OMX over the logged window
    const norm = omxNormalized();
    if (!norm.length) return;
    const omxPct = (norm[norm.length - 1].v - start()) / start() * 100;
    const best = ranked[0].pct;
    const q = best > omxPct ? `${ranked[0].p} is beating the OMXS30 by ${(best - omxPct).toFixed(1)} pts. Quit your job? 📈`
      : `The OMXS30 (${omxPct >= 0 ? "+" : ""}${omxPct.toFixed(1)}%) is beating all of you. Index funds stay undefeated 🧊`;
    $("#chartQuip").textContent = q;
  }

  function money(v) { return Math.round(v).toLocaleString("sv-SE") + " kr"; }

  /* ----- editor ----- */
  function buildEditor() {
    const dateInput = $("#entryDate");
    if (!dateInput.value) dateInput.value = (sortedEntries().slice(-1)[0] || {}).date || todayKeySE();
    fillEditorFor(dateInput.value);
  }
  function fillEditorFor(date) {
    const existing = entries().find(e => e.date === date);
    const base = existing ? existing.balances : latestBalances();
    $("#editorGrid").innerHTML = players().map(p => `
      <div class="eg-cell"><label>${p}</label>
        <input type="number" inputmode="decimal" data-player="${p}" value="${base[p] != null ? base[p] : start()}" /></div>`).join("");
  }

  function wireBetting() {
    $("#entryDate").addEventListener("change", e => fillEditorFor(e.target.value));
    $("#loadLatest").addEventListener("click", () => {
      const bal = latestBalances();
      $$("#editorGrid input").forEach(inp => inp.value = bal[inp.dataset.player] ?? start());
    });
    $("#applyEntry").addEventListener("click", applyEntry);
    $("#exportBtn").addEventListener("click", exportJSON);
    $("#copyBtn").addEventListener("click", copyJSON);
    $("#resetBtn").addEventListener("click", resetWorking);
    $$("#chartMode .seg-btn").forEach(b => b.addEventListener("click", () => {
      $$("#chartMode .seg-btn").forEach(x => x.classList.remove("is-active"));
      b.classList.add("is-active"); state.chartMode = b.dataset.mode; renderChart();
    }));
  }

  function applyEntry() {
    const date = $("#entryDate").value;
    if (!date) { note("Pick a date first.", true); return; }
    const balances = {};
    $$("#editorGrid input").forEach(inp => { const v = parseFloat(inp.value); balances[inp.dataset.player] = isNaN(v) ? start() : v; });
    const i = state.working.entries.findIndex(e => e.date === date);
    if (i >= 0) state.working.entries[i].balances = balances;
    else state.working.entries.push({ date, balances });
    persistWorking();
    renderBetting();
    note(`Logged ${date}. This is a local preview — Export + commit data/betting.json to share it.`, false);
  }

  function exportJSON() {
    const out = { _comment: state.betting && state.betting._comment, players: players(), startingAmount: start(), currency: (state.working.currency || "SEK"), entries: sortedEntries() };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "betting.json"; a.click();
    URL.revokeObjectURL(a.href);
    note("Downloaded betting.json — drop it into /data in your repo and commit.", false);
  }
  async function copyJSON() {
    const out = { _comment: state.betting && state.betting._comment, players: players(), startingAmount: start(), currency: (state.working.currency || "SEK"), entries: sortedEntries() };
    try { await navigator.clipboard.writeText(JSON.stringify(out, null, 2)); note("Copied! Paste into data/betting.json on GitHub.", false); }
    catch { note("Couldn't copy automatically — use Export instead.", true); }
  }
  function resetWorking() {
    state.working = state.betting ? JSON.parse(JSON.stringify(state.betting)) : state.working;
    persistWorking(); buildEditor(); renderBetting();
    note("Preview reset to the committed data/betting.json.", false);
  }
  function note(msg, warn) { const el = $("#saveNote"); el.textContent = msg; el.style.color = warn ? "var(--red)" : "var(--cyan)"; }

  /* ----- chart ----- */
  function omxNormalized() {
    const e = sortedEntries(); if (!e.length || !state.omx.length) return [];
    const base = e[0].date;
    // baseline = last omx close on/before the first betting date
    let baseClose = null;
    for (const row of state.omx) { if (row.date <= base) baseClose = row.close; }
    if (baseClose == null) baseClose = state.omx[0].close;
    return e.map(en => {
      let close = baseClose;
      for (const row of state.omx) { if (row.date <= en.date) close = row.close; }
      return { date: en.date, v: close / baseClose * start() };
    });
  }

  const LINE_COLORS = ["#ff2d75", "#ff8a1e", "#21e6c1", "#7b5cff", "#36e07a", "#ffd24a", "#5ab0ff"];
  function renderChart() {
    if (typeof Chart === "undefined") { setTimeout(renderChart, 200); return; }
    const e = sortedEntries();
    const labels = e.map(x => x.date);
    const pct = state.chartMode === "pct";
    const map = {}; players().forEach(p => map[p] = start());

    const datasets = players().map((p, i) => {
      const data = e.map(row => {
        if (row.balances && row.balances[p] != null) map[p] = row.balances[p];
        return pct ? (map[p] - start()) / start() * 100 : map[p];
      });
      const c = LINE_COLORS[i % LINE_COLORS.length];
      return { label: p, data, borderColor: c, backgroundColor: c, tension: .3, borderWidth: 2.4, pointRadius: 2.5, pointHoverRadius: 5 };
    });

    const norm = omxNormalized();
    if (norm.length) {
      const data = norm.map(n => pct ? (n.v - start()) / start() * 100 : n.v);
      datasets.push({ label: "OMXS30", data, borderColor: "#9aa7c7", backgroundColor: "#9aa7c7", borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: .25 });
    }

    if (state.chart) state.chart.destroy();
    const ctx = $("#moneyChart").getContext("2d");
    state.chart = new Chart(ctx, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#9aa7c7", font: { family: "Sora", size: 11 }, usePointStyle: true, pointStyle: "line" } },
          tooltip: {
            backgroundColor: "#0c1326", borderColor: "rgba(255,255,255,.12)", borderWidth: 1,
            titleColor: "#eaf0ff", bodyColor: "#eaf0ff", padding: 10, usePointStyle: true,
            callbacks: { label: c => `${c.dataset.label}: ${pct ? (c.parsed.y >= 0 ? "+" : "") + c.parsed.y.toFixed(1) + "%" : money(c.parsed.y)}` }
          }
        },
        scales: {
          x: { ticks: { color: "#65749a", font: { family: "Sora", size: 10 } }, grid: { color: "rgba(255,255,255,.05)" } },
          y: { ticks: { color: "#65749a", font: { family: "Sora", size: 10 }, callback: v => pct ? v + "%" : v + " kr" }, grid: { color: "rgba(255,255,255,.05)" } }
        }
      }
    });
  }

  /* ---------- shared ---------- */
  function wireTabs() {
    $$("#tabs .tab").forEach(t => t.addEventListener("click", () => {
      $$("#tabs .tab").forEach(x => x.classList.remove("is-active"));
      t.classList.add("is-active");
      $$(".view").forEach(v => v.classList.remove("is-active"));
      $("#view-" + t.dataset.view).classList.add("is-active");
      if (t.dataset.view === "betting" && state.chart) state.chart.resize();
    }));
  }
  function groupBy(arr, fn) { return arr.reduce((a, x) => { const k = fn(x); (a[k] = a[k] || []).push(x); return a; }, {}); }
  function emptyState(big, ttl, sub) { return `<div class="empty"><div class="big">${big}</div><div class="ttl">${ttl}</div><div>${sub}</div></div>`; }

  document.addEventListener("DOMContentLoaded", boot);
})();

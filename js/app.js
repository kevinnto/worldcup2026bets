/* ============================================================
   VM 2026 Tracker — app logic
   Fixtures are static. Results + indices (OMXS30, S&P 500) are
   refreshed daily by GitHub Actions. Betting is shared live via
   Firebase Realtime Database when configured (js/config.js),
   otherwise it falls back to local browser + betting.json.
   ============================================================ */
'use strict';

const TZ = 'Europe/Stockholm';
const DATA = { fixtures: null, results: null, omx: null, sp500: null, betting: null };
const DRAFT_KEY = 'wc2026_betting_draft_v1';
const BETTING = { mode: 'local', ref: null };

const MEMES = [
  '"Jag har en känsla om den här." — sista ordet före konkurs',
  'Värdet kan både öka och minska. Mest minska.',
  'OMXS30 har aldrig satt allt på Panama att vinna gruppen.',
  'Den som är skuldfri vid finalen bjuder på öl. 🍺',
  'Singelspel är för fegisar. Sa han med 4 SEK kvar.',
  'Statistiskt sett är nästa spel det som vänder allt.',
  'Treornas tabell — där drömmar och ångest möts.',
];

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function team(code) {
  const t = DATA.fixtures.teams[code];
  return t || { sv: code, en: code, flag: '🏳️' };
}

const swDate = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, day: '2-digit', month: 'short' });
const swTime = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const swDow = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'long' });
const swKey = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function kickoff(m) {
  const d = new Date(m.kickoff);
  return { date: swDate.format(d), time: swTime.format(d), dow: swDow.format(d), key: swKey.format(d), obj: d };
}
function todayKey() { return swKey.format(new Date()); }

function res(id) {
  const r = DATA.results.matches[id];
  if (!r || r.homeScore == null || r.awayScore == null) return null;
  return r;
}

/* ============================================================
   STANDINGS
   ============================================================ */
function computeGroup(letter) {
  const codes = DATA.fixtures.groups[letter];
  const row = {};
  codes.forEach(c => row[c] = { c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
  let played = 0, total = 0;
  DATA.fixtures.matches.forEach(m => {
    if (m.stage !== 'GROUP' || m.group !== letter) return;
    total++;
    const r = res(m.id);
    if (!r) return;
    played++;
    const h = row[m.home], a = row[m.away];
    h.p++; a.p++; h.gf += r.homeScore; h.ga += r.awayScore; a.gf += r.awayScore; a.ga += r.homeScore;
    if (r.homeScore > r.awayScore) { h.w++; a.l++; h.pts += 3; }
    else if (r.homeScore < r.awayScore) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  });
  const table = Object.values(row);
  table.forEach(t => t.gd = t.gf - t.ga);
  table.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || team(x.c).sv.localeCompare(team(y.c).sv));
  return { table, complete: played === total && total > 0, played, total };
}

function allStandings() {
  const out = {};
  Object.keys(DATA.fixtures.groups).forEach(g => out[g] = computeGroup(g));
  return out;
}

/* ============================================================
   KNOCKOUT RESOLUTION
   ============================================================ */
function refLabel(ref) {
  if (/^[12][A-L]$/.test(ref)) return (ref[0] === '1' ? 'Vinnare grupp ' : '2:a grupp ') + ref[1];
  if (ref.startsWith('3:')) return '3:a (' + ref.slice(2).split('').join('/') + ')';
  if (ref.startsWith('W')) return 'Vinnare match ' + ref.slice(1);
  if (ref.startsWith('L')) return 'Förlorare match ' + ref.slice(1);
  return ref;
}

// returns team code or null
function resolveRef(ref, standings) {
  if (/^[12][A-L]$/.test(ref)) {
    const g = standings[ref[1]];
    if (g && g.complete) return ref[0] === '1' ? g.table[0].c : g.table[1].c;
    return null;
  }
  if (ref.startsWith('3:')) return null; // best-third allocation confirmed by FIFA post-group stage
  if (ref.startsWith('W') || ref.startsWith('L')) {
    const id = 'm' + ref.slice(1);
    const m = DATA.fixtures.matches.find(x => x.id === id);
    if (!m) return null;
    const w = matchWinner(m, standings);
    if (!w) return null;
    return ref[0] === 'W' ? w.winner : w.loser;
  }
  return null;
}

function koTeams(m, standings) {
  return { home: resolveRef(m.homeRef, standings), away: resolveRef(m.awayRef, standings) };
}

// winner/loser by score (+ optional penalties field)
function matchWinner(m, standings) {
  const r = res(m.id);
  if (!r || r.status !== 'FINISHED') return null;
  const { home, away } = m.stage === 'KO' ? koTeams(m, standings) : { home: m.home, away: m.away };
  if (!home || !away) return null;
  let hw = r.homeScore > r.awayScore;
  if (r.homeScore === r.awayScore && r.homePens != null && r.awayPens != null) hw = r.homePens > r.awayPens;
  return hw ? { winner: home, loser: away } : { winner: away, loser: home };
}

/* ============================================================
   VIEW: SCHEDULE
   ============================================================ */
let scheduleFilter = 'all';

function matchCard(m, standings) {
  const ko = kickoff(m);
  let home, away;
  if (m.stage === 'KO') {
    const t = koTeams(m, standings);
    home = t.home ? team(t.home) : { flag: '⬜', sv: refLabel(m.homeRef), tbd: true };
    away = t.away ? team(t.away) : { flag: '⬜', sv: refLabel(m.awayRef), tbd: true };
  } else { home = team(m.home); away = team(m.away); }

  const r = res(m.id);
  const finished = r && r.status === 'FINISHED';
  const live = r && r.status === 'IN_PLAY';
  const mid = r
    ? `<div class="score">${r.homeScore}<span class="vs"> – </span>${r.awayScore}</div>`
    : `<div class="vs">${ko.time}</div>`;
  const badge = finished ? `<span class="badge ft">FT</span>`
    : live ? `<span class="badge live">LIVE</span>`
    : `<span class="badge up">${ko.time}</span>`;

  return `<div class="match ${m.stage === 'KO' ? 'ko' : ''} ${finished ? 'finished' : ''}">
    <div class="side home"><span class="flag">${home.flag}</span><span class="tname">${home.sv}</span></div>
    <div class="mid">${mid}</div>
    <div class="side away"><span class="tname">${away.sv}</span><span class="flag">${away.flag}</span></div>
    <div class="meta">
      <span>${m.round} · ${m.city}</span>
      <span class="ko-time">${badge}</span>
    </div>
  </div>`;
}

function renderSchedule() {
  const standings = allStandings();
  const body = $('#schedule-body');
  let ms = DATA.fixtures.matches.slice();
  if (scheduleFilter === 'GROUP') ms = ms.filter(m => m.stage === 'GROUP');
  if (scheduleFilter === 'KO') ms = ms.filter(m => m.stage === 'KO');
  ms.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  const byDay = {};
  ms.forEach(m => { const k = kickoff(m); (byDay[k.key] ||= { meta: k, items: [] }).items.push(m); });
  const tkey = todayKey();

  body.innerHTML = Object.values(byDay).map(d => {
    const isToday = d.meta.key === tkey;
    return `<div class="day-block">
      <div class="day-head ${isToday ? 'is-today' : ''}">
        <span class="dow">${d.meta.dow}</span>
        <span class="date">${d.meta.date}</span>
        ${isToday ? '<span class="today-pill">IDAG</span>' : ''}
      </div>
      <div class="match-grid">${d.items.map(m => matchCard(m, standings)).join('')}</div>
    </div>`;
  }).join('') || '<div class="loading">Inga matcher.</div>';
}

/* ============================================================
   VIEW: GROUPS
   ============================================================ */
function renderGroups() {
  const standings = allStandings();
  const body = $('#groups-body');
  body.innerHTML = Object.keys(DATA.fixtures.groups).map(g => {
    const st = standings[g];
    const rows = st.table.map((t, i) => {
      const cls = i === 0 ? 'q1' : i === 1 ? 'q2' : i === 2 ? 'q3' : '';
      const tt = team(t.c);
      return `<tr class="${cls}">
        <td class="tl"><span class="flag">${tt.flag}</span>${tt.sv}</td>
        <td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
        <td>${t.gf}-${t.ga}</td><td>${t.gd > 0 ? '+' + t.gd : t.gd}</td>
        <td class="pts">${t.pts}</td>
      </tr>`;
    }).join('');
    return `<div class="group-card">
      <h3>Grupp ${g}</h3>
      <table class="gtable">
        <thead><tr><th class="tl">Lag</th><th>S</th><th>V</th><th>O</th><th>F</th><th>Mål</th><th>+/−</th><th>P</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="qkey"><span class="k1">Vidare</span><span class="k3">Möjlig 3:a</span></div>
    </div>`;
  }).join('');
}

/* ============================================================
   VIEW: BRACKET
   ============================================================ */
const ROUND_COLS = [
  ['R32', 'Sextondel'],
  ['R16', 'Åttondel'],
  ['QF', 'Kvart'],
  ['SF', 'Semi'],
  ['FINAL', 'Final'],
];

function bracketRow(ref, code, score, isWin) {
  const t = code ? team(code) : null;
  const name = t ? t.sv : refLabel(ref);
  const flag = t ? t.flag : '⬜';
  return `<div class="brow ${isWin ? 'win' : ''}">
    <span class="flag">${flag}</span>
    <span class="bn ${t ? '' : 'tbd'}">${name}</span>
    <span class="bsc">${score ?? ''}</span>
  </div>`;
}

function renderBracket() {
  const standings = allStandings();
  const body = $('#bracket-body');
  const kos = DATA.fixtures.matches.filter(m => m.stage === 'KO');

  const cols = ROUND_COLS.map(([key, label]) => {
    const list = kos.filter(m => m.roundKey === key || (key === 'FINAL' && m.roundKey === '3RD'));
    const ties = list.map(m => {
      const { home, away } = koTeams(m, standings);
      const r = res(m.id);
      const w = matchWinner(m, standings);
      const isFinal = m.roundKey === 'FINAL';
      const k = kickoff(m);
      const tag = m.roundKey === '3RD' ? 'Brons' : ('M' + m.no);
      return `<div class="btie ${isFinal ? 'final-tie' : ''}">
        <div class="bno"><span>${tag}</span><span>${k.date} ${k.time}</span></div>
        ${bracketRow(m.homeRef, home, r ? r.homeScore : null, w && w.winner === home && home)}
        ${bracketRow(m.awayRef, away, r ? r.awayScore : null, w && w.winner === away && away)}
      </div>`;
    }).join('');
    return `<div class="bcol ${key === 'FINAL' ? 'bcol-final' : ''}">
      <div class="bcol-title">${label}</div>${ties}</div>`;
  }).join('');

  body.innerHTML = `<div class="bracket">${cols}</div>`;
}

/* ============================================================
   MONEY: data model
   ============================================================ */
function tournamentDays() {
  const ms = DATA.fixtures.matches.map(m => kickoff(m).key).sort();
  const start = ms[0], end = ms[ms.length - 1];
  const out = [];
  let d = new Date(start + 'T12:00:00');
  const endD = new Date(end + 'T12:00:00');
  while (d <= endD) { out.push(swKey.format(d)); d = new Date(d.getTime() + 864e5); }
  return out;
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; }
}
function saveDraft(d) { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); }

// merged balances: in live mode Firebase is the single source of truth;
// in local mode the committed file is overlaid by this browser's draft
function effectiveBalances() {
  const base = JSON.parse(JSON.stringify(DATA.betting.balances || {}));
  if (BETTING.mode === 'live') return base;
  const draft = loadDraft();
  Object.keys(draft).forEach(day => {
    base[day] = Object.assign({}, base[day] || {}, draft[day]);
  });
  return base;
}

// carry-forward series per player up to last day with any data
function moneySeries() {
  const players = DATA.betting.players;
  const start = DATA.betting.startAmount;
  const bal = effectiveBalances();
  const days = tournamentDays();
  const tkey = todayKey();
  // last day that has any entered value, but never beyond today
  let lastIdx = 0;
  days.forEach((d, i) => { if (bal[d] && Object.keys(bal[d]).length && d <= tkey) lastIdx = i; });
  const used = days.slice(0, lastIdx + 1);

  const last = {}; players.forEach(p => last[p] = start);
  const series = {}; players.forEach(p => series[p] = []);
  used.forEach(d => {
    players.forEach(p => {
      if (bal[d] && bal[d][p] != null && bal[d][p] !== '') last[p] = Number(bal[d][p]);
      series[p].push(last[p]);
    });
  });
  return { days: used, series, start, players };
}

function indexSeries(history, days) {
  const h = (history || []).filter(x => x.close != null);
  if (!h.length) return null;
  const map = {}; h.forEach(x => map[x.date] = Number(x.close));
  const start = DATA.betting.startAmount;
  const sorted = h.slice().sort((a, b) => a.date.localeCompare(b.date));
  const anchor = sorted[0].close;
  let lastClose = anchor;
  return days.map(d => {
    if (map[d] != null) lastClose = map[d];
    else {
      for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i].date <= d) { lastClose = sorted[i].close; break; } }
    }
    return +(lastClose / anchor * start).toFixed(2);
  });
}
function omxSeries(days) { return indexSeries(DATA.omx && DATA.omx.history, days); }
function sp500Series(days) { return indexSeries(DATA.sp500 && DATA.sp500.history, days); }

/* ---------- MONEY render ---------- */
function fmtPct(v) {
  const s = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
  return { s, cls };
}

function renderMoney() {
  const { days, series, start, players } = moneySeries();
  // latest value per player
  const latest = {}; players.forEach(p => latest[p] = series[p].length ? series[p][series[p].length - 1] : start);
  const ranked = players.slice().sort((a, b) => latest[b] - latest[a]);
  const top = ranked[0];
  const maxVal = Math.max(start, ...players.map(p => latest[p]));

  // leader card
  const topPct = (latest[top] / start - 1) * 100;
  const tp = fmtPct(topPct);
  $('#leader-card').innerHTML = `
    <div class="lc-tag">👑 LEDER LIGAN JUST NU</div>
    <div class="lc-name">${top}</div>
    <div>
      <span class="lc-amt">${latest[top].toFixed(2)} SEK</span>
      <span class="lc-chg ${tp.cls}">${tp.s}</span>
    </div>`;

  // board
  $('#standings-money').innerHTML = ranked.map((p, i) => {
    const pct = (latest[p] / start - 1) * 100;
    const f = fmtPct(pct);
    const w = Math.max(8, (latest[p] / maxVal) * 160);
    let emoji = '';
    if (i === 0) emoji = '👑'; else if (latest[p] <= 0.01) emoji = '💀'; else emoji = pct >= 0 ? '📈' : '📉';
    return `<div class="mrow">
      <span class="rk">${i + 1}</span>
      <span class="nm">${emoji} ${p}<span class="bar" style="width:${w}px"></span></span>
      <span class="amt">${latest[p].toFixed(2)}</span>
      <span class="chg ${f.cls}">${f.s}</span>
    </div>`;
  }).join('');

  // index chips (OMXS30 + S&P 500, normalised to start)
  renderIndexChips(days);
  renderChart(days, series, players);
  renderHistory();
}

function renderIndexChips(days) {
  const start = DATA.betting.startAmount;
  const chip = (label, ser) => {
    if (!ser || !ser.length) return '';
    const v = ser[ser.length - 1];
    const f = fmtPct((v / start - 1) * 100);
    return `<span class="ichip"><span class="ic-lbl">${label}</span>
      <span class="ic-val">${v.toFixed(1)}</span>
      <span class="chg ${f.cls}">${f.s}</span></span>`;
  };
  const html = chip('OMXS30', omxSeries(days)) + chip('S&P 500', sp500Series(days));
  $('#index-chips').innerHTML = html || '<span class="ichip muted-chip">Index uppdateras dagligen</span>';
}

/* ---------- chart ---------- */
let chartRef = null;
const PLAYER_COLORS = ['#ff2d78', '#19e3d6', '#c6ff3d', '#ffd23f', '#8a5cff', '#34e29b', '#ff8a3d'];

function renderChart(days, series, players) {
  if (typeof Chart === 'undefined') { setTimeout(() => renderChart(days, series, players), 200); return; }
  const labels = days.map(d => d.slice(5)); // MM-DD
  const datasets = players.map((p, i) => ({
    label: p, data: series[p], borderColor: PLAYER_COLORS[i % PLAYER_COLORS.length],
    backgroundColor: 'transparent', borderWidth: 2.5, tension: .25, pointRadius: 0, pointHoverRadius: 4,
  }));
  const omx = omxSeries(days);
  if (omx) datasets.push({
    label: 'OMXS30', data: omx, borderColor: '#ffffff', borderDash: [5, 4],
    borderWidth: 2, tension: .25, pointRadius: 0, pointHoverRadius: 4,
  });
  const sp = sp500Series(days);
  if (sp) datasets.push({
    label: 'S&P 500', data: sp, borderColor: '#ffd23f', borderDash: [2, 4],
    borderWidth: 2, tension: .25, pointRadius: 0, pointHoverRadius: 4,
  });

  const start = DATA.betting.startAmount;
  if (chartRef) chartRef.destroy();
  chartRef = new Chart($('#moneyChart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#cdd9ec', font: { family: 'Sora', size: 12 }, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            label: (c) => {
              const pct = (c.parsed.y / start - 1) * 100;
              return ` ${c.dataset.label}: ${c.parsed.y.toFixed(0)} SEK (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#8a9bb4', maxRotation: 0, autoSkip: true, font: { family: 'Space Mono', size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,.06)' }, ticks: { color: '#8a9bb4', font: { family: 'Space Mono', size: 10 }, callback: v => v + ' kr' } }
      }
    }
  });
}

/* ---------- history (read-only) ---------- */
function renderHistory() {
  const players = DATA.betting.players;
  const days = tournamentDays();
  const bal = effectiveBalances();
  const tkey = todayKey();

  const head = `<tr><th class="daycol">Dag</th>${players.map(p => `<th>${p}</th>`).join('')}</tr>`;
  // carry-forward for display so blanks show the inherited value greyed out
  const last = {}; players.forEach(p => last[p] = DATA.betting.startAmount);
  const rows = days.filter(d => d <= tkey).map((d, idx) => {
    const isToday = d === tkey;
    const cells = players.map(p => {
      const entered = bal[d] && bal[d][p] != null && bal[d][p] !== '';
      if (entered) last[p] = Number(bal[d][p]);
      const cls = entered ? '' : 'carry';
      return `<td class="${cls}">${last[p].toFixed(0)}</td>`;
    }).join('');
    return `<tr class="${isToday ? 'today-row' : ''}"><td class="daycol">${swDate.format(new Date(d + 'T12:00:00'))}</td>${cells}</tr>`;
  }).join('');

  $('#editor-grid').innerHTML = `<table class="egrid"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

/* ---------- betting backend (Firebase live, or local fallback) ---------- */
function bettingConfigured() {
  const c = window.FIREBASE_CONFIG;
  return !!(c && typeof c.databaseURL === 'string'
    && c.databaseURL && !/YOUR_|example|xxxx/i.test(c.databaseURL)
    && typeof firebase !== 'undefined');
}

function initBetting(onUpdate) {
  if (bettingConfigured()) {
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      BETTING.ref = firebase.database().ref('balances');
      BETTING.mode = 'live';
      BETTING.ref.on('value', (snap) => {
        DATA.betting.balances = snap.val() || {};
        // seed day-1 baseline (everyone at start) once, if missing
        const d1 = tournamentDays()[0];
        if (!DATA.betting.balances[d1]) {
          const base = {}; DATA.betting.players.forEach(p => base[p] = DATA.betting.startAmount);
          BETTING.ref.child(d1).set(base); // re-fires this listener with the seeded value
        }
        onUpdate();
      }, (err) => {
        console.error('Firebase read failed, switching to local mode', err);
        BETTING.mode = 'local'; updateBackendStatus(); onUpdate();
      });
      updateBackendStatus();
      return;
    } catch (e) {
      console.error('Firebase init failed, local mode', e);
    }
  }
  BETTING.mode = 'local';
  updateBackendStatus();
  onUpdate();
}

function updateBackendStatus() {
  const el = $('#backend-status'); if (!el) return;
  const exportRow = $('#export-row');
  if (BETTING.mode === 'live') {
    el.textContent = '🟢 Live';
    el.className = 'backend-status live';
    el.title = 'Alla ser dina ändringar direkt';
    if (exportRow) exportRow.classList.add('hidden');
  } else {
    el.textContent = '💾 Lokalt läge';
    el.className = 'backend-status local';
    el.title = 'Sparas i din webbläsare. Committa betting.json för att dela.';
    if (exportRow) exportRow.classList.remove('hidden');
  }
}

async function submitBalance(date, player, amount) {
  if (BETTING.mode === 'live' && BETTING.ref) {
    await BETTING.ref.child(date).child(player).set(amount); // listener re-renders for everyone
  } else {
    const draft = loadDraft();
    (draft[date] ||= {});
    draft[date][player] = amount;
    saveDraft(draft);
    renderMoney();
  }
}

function populateForm() {
  const psel = $('#f-player'), dsel = $('#f-date');
  psel.innerHTML = DATA.betting.players.map(p => `<option value="${p}">${p}</option>`).join('');
  const days = tournamentDays();
  const tkey = todayKey();
  // only days up to and including today are selectable
  const sel = days.filter(d => d <= tkey);
  const list = sel.length ? sel : [days[0]];
  dsel.innerHTML = list.map(d =>
    `<option value="${d}">${swDate.format(new Date(d + 'T12:00:00'))}</option>`).join('');
  dsel.value = list[list.length - 1]; // default to most recent valid day
}

function handleSubmit() {
  const player = $('#f-player').value;
  const date = $('#f-date').value;
  const raw = $('#f-amount').value;
  const msg = $('#submit-msg');
  if (raw === '' || isNaN(Number(raw)) || Number(raw) < 0) {
    msg.className = 'submit-msg err';
    msg.textContent = 'Ange ett giltigt belopp (0 eller mer)';
    return;
  }
  const amount = Math.round(Number(raw) * 100) / 100;
  submitBalance(date, player, amount).then(() => {
    msg.className = 'submit-msg ok';
    const dlabel = swDate.format(new Date(date + 'T12:00:00'));
    msg.textContent = `✓ Sparat: ${player} ${amount.toFixed(0)} kr för ${dlabel}`;
    $('#f-amount').value = '';
  }).catch((e) => {
    msg.className = 'submit-msg err';
    msg.textContent = 'Kunde inte spara: ' + e.message;
  });
}

function exportBetting() {
  const out = JSON.parse(JSON.stringify(DATA.betting));
  const bal = effectiveBalances();
  // keep only days that have data
  out.balances = {};
  Object.keys(bal).sort().forEach(d => {
    const clean = {};
    Object.keys(bal[d]).forEach(p => { if (bal[d][p] !== '' && bal[d][p] != null) clean[p] = Number(bal[d][p]); });
    if (Object.keys(clean).length) out.balances[d] = clean;
  });
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'betting.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   COUNTDOWN + MEME + NAV
   ============================================================ */
function renderCountdown() {
  const now = new Date();
  const upcoming = DATA.fixtures.matches
    .map(m => ({ m, d: new Date(m.kickoff) }))
    .filter(x => x.d > now)
    .sort((a, b) => a.d - b.d)[0];
  const el = $('#countdown');
  if (!upcoming) {
    const finished = Object.keys(DATA.results.matches).length;
    el.innerHTML = finished ? '🏆 VM 2026 är slut. Tack för spelandet.' : '⚽ Snart drar det igång!';
    return;
  }
  const k = kickoff(upcoming.m);
  let h, a;
  if (upcoming.m.stage === 'KO') {
    const t = koTeams(upcoming.m, allStandings());
    h = t.home ? team(t.home).sv : refLabel(upcoming.m.homeRef);
    a = t.away ? team(t.away).sv : refLabel(upcoming.m.awayRef);
  } else { h = team(upcoming.m.home).sv; a = team(upcoming.m.away).sv; }
  const diff = upcoming.d - now;
  const dd = Math.floor(diff / 864e5), hh = Math.floor(diff % 864e5 / 36e5), mm = Math.floor(diff % 36e5 / 6e4);
  const cd = dd > 0 ? `${dd}d ${hh}h` : `${hh}h ${mm}m`;
  el.innerHTML = `⚽ Nästa: <b>${h} – ${a}</b> · ${k.dow} ${k.time} · om <b>${cd}</b>`;
}

function setView(v) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  if (v === 'schedule') renderSchedule();
  if (v === 'groups') renderGroups();
  if (v === 'bracket') renderBracket();
  if (v === 'money') renderMoney();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function wire() {
  $$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
  $$('#schedule-filter .seg-btn').forEach(b => b.addEventListener('click', () => {
    $$('#schedule-filter .seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); scheduleFilter = b.dataset.f; renderSchedule();
  }));
  $('#f-submit').addEventListener('click', handleSubmit);
  $('#f-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(); });
  $('#export-json').addEventListener('click', exportBetting);
  $('#meme-ticker').textContent = MEMES[Math.floor(Math.random() * MEMES.length)];
  $('#foot-meme').textContent = '"' + ['Det är inte spelmissbruk om det är VM.',
    'House always wins. Utom mot gänget, förhoppningsvis.',
    'Vi spelar inte för pengarna. Vi spelar för skammen.'][Math.floor(Math.random() * 3)] + '" — Anonym i gänget';
}
function flash(sel, txt) {
  const el = $(sel), old = el.textContent; el.textContent = txt;
  setTimeout(() => el.textContent = old, 1200);
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  try {
    const [fixtures, results, omx, sp500, betting] = await Promise.all([
      getJSON('./data/fixtures.json'),
      getJSON('./data/results.json'),
      getJSON('./data/omx.json'),
      getJSON('./data/sp500.json').catch(() => ({ history: [] })),
      getJSON('./data/betting.json'),
    ]);
    DATA.fixtures = fixtures; DATA.results = results; DATA.omx = omx; DATA.sp500 = sp500; DATA.betting = betting;
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="loading">Kunde inte ladda data.<br>${e.message}</div>`;
    return;
  }
  wire();
  populateForm();
  renderSchedule();
  renderCountdown();
  setInterval(renderCountdown, 60000);
  // betting: live via Firebase if configured, else local. onUpdate re-renders money view.
  initBetting(renderMoney);

  if (DATA.results.updated) {
    $('#data-updated').textContent = 'Senast uppdaterad: ' +
      new Date(DATA.results.updated).toLocaleString('sv-SE', { timeZone: TZ });
  }
}
document.addEventListener('DOMContentLoaded', init);

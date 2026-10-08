// Chargement des données (docs/data/*.json) et calculs faits dans le navigateur.
// Une seule définition de la position : la position du jour de référence (dernier jour, ou dernier jour définitif
// si les jours provisoires sont exclus). Les cumuls (clics, impressions) sont toujours calculés sur des jours définitifs.
import { app, ui, store } from "@/state.js";
import { shift, ndays, calDates, today, DATA } from "@/util.js";

const cache = {};
// Version des données (manifest.json, jamais mis en cache) : chaque fichier est appelé avec cette version, il n'est donc
// retéléchargé que lorsqu'une synchro l'a changé, et peut être mis en cache sans limite par le navigateur et le CDN.
let VER = "";
const getJSON = async url => { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); };
const dataUrl = file => `${DATA}${file}?v=${VER}`;

export async function loadIndex() {
  const man = await fetch(DATA + "manifest.json", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  VER = man.version || String(Date.now());
  app.IDX = await getJSON(dataUrl("index.json"));
  return app.IDX;
}

export const projectMeta = name => (app.IDX.projects || []).find(p => p.name === name);
export const marketOf = name => { const p = projectMeta(name); return store.get("market:" + name) || (p && p.market) || "all"; };

function prepare(p) {
  p.keywords.forEach(k => {
    k.map = new Map(k.s.map(x => [x[0], x])); k.smap = new Map(k.ss.map(x => [x[0], x]));
    k.alt = k.alt || {}; k.tags = k.tags || []; k.variants = k.variants || [];
  });
  p.seg = {};
  Object.entries(p.segments).forEach(([s, rows]) => p.seg[s] = new Map(rows.map(x => [x[0], x])));
  p.dates = p.segments.total.map(x => x[0]);
  if (!p.dates.length) p.dates = [...new Set(p.keywords.flatMap(k => k.s.map(x => x[0])))].sort();
  p.moves = p.moves || []; p.actions = p.actions || []; p.alerts = p.alerts || []; p.events = p.events || [];
  p.suggestions = p.suggestions || []; p.cannib = p.cannib || []; p.page_queries = p.page_queries || {};
  p.inspection = p.inspection || { current: {}, history: [] };
  p.kwById = new Map(p.keywords.map(k => [k.i, k]));
  return p;
}

// Un projet pour un marché ; la promesse est gardée pour dédoublonner préchargement et navigation
export function project(name, market) {
  const key = name + "|" + market;
  if (!cache[key]) {
    const file = market === "all" ? name : `${name}.${market}`;
    cache[key] = getJSON(dataUrl(`${file}.json`)).then(prepare).catch(e => { delete cache[key]; throw e; });
  }
  return cache[key];
}
export const prefetch = name => { if (app.IDX && projectMeta(name)) project(name, marketOf(name)).catch(() => {}); };

export function sectionsData() {
  const P = app.P, key = P.name + "|" + P.market + "|sections";
  if (!cache[key]) {
    const file = P.market === "all" ? P.name : `${P.name}.${P.market}`;
    cache[key] = fetch(dataUrl(`${file}.sections.json`)).then(r => r.ok ? r.json() : null).then(d => {
      if (d) d.groupings.forEach(g => g.sections.forEach(s => { s.map = new Map((s.series.total || []).map(x => [x[0], x])); }));
      return d;
    }).catch(() => null);
  }
  return cache[key];
}

// ---------------------------------------------------------------- jour de référence, périodes, comparaisons

export const refDay = (P = app.P) => (ui.fresh ? P.last_date : P.last_final) || P.last_date;

export function ranges(P = app.P) {
  const ref = refDay(P), first = P.dates[0] || ref, lf = P.last_final || ref;
  let from, to;
  const preset = String(ui.range.preset);
  if (preset === "custom" && ui.range.from && ui.range.to) { from = ui.range.from; to = ui.range.to < ref ? ui.range.to : ref; }
  else if (preset === "0") { from = first; to = ref; }
  else { to = ref; from = shift(ref, -(+preset || 28) + 1); }
  if (from > to) from = to;
  const len = ndays(from, to) + 1;
  const cmpOf = (a, b, n) => ui.cmp.mode === "prev" ? [shift(a, -n), shift(a, -1)] : ui.cmp.mode === "n1" ? [shift(a, -364), shift(b, -364)]
    : ui.cmp.mode === "custom" && ui.cmp.from && ui.cmp.to ? [ui.cmp.from, ui.cmp.to] : null;
  const c = cmpOf(from, to, len);
  // Cumuls : même longueur, mais arrêtés au dernier jour définitif
  const sTo = to > lf ? lf : to;
  const sFrom = to > lf && preset !== "custom" && preset !== "0" ? shift(sTo, -(len - 1)) : from;
  const sLen = ndays(sFrom, sTo) + 1, sc = cmpOf(sFrom, sTo, sLen);
  const dates = calDates(from, to);
  return { from, to, len, dates, fresh: dates.filter(d => d > lf), cmp: c && { from: c[0], to: c[1], dates: calDates(c[0], c[1]) },
    sum: { from: sFrom, to: sTo, len: sLen, dates: calDates(sFrom, sTo), cmp: sc && { from: sc[0], to: sc[1], dates: calDates(sc[0], sc[1]) },
      freshDates: calDates(shift(lf, 1), P.last_date || lf).filter(d => d > lf && d <= (P.last_date || lf)) } };
}
export const cmpLabel = () => ({ n1: "vs N-1", prev: "vs période préc.", custom: "vs comparaison" }[ui.cmp.mode] || "");
export const periodBase = R => shift(R.from, -1);

// Position au jour d, sinon dernière position connue dans les 7 jours précédents
export function posAt(m, d, lookback = 7) {
  for (let n = 0; n <= lookback; n++) { const x = m.get(shift(d, -n)); if (x && x[1] != null) return x; }
  return null;
}
export const sumImpr = (m, end, n) => { let s = 0; for (let j = 0; j < n; j++) { const x = m.get(shift(end, -j)); if (x) s += x[3]; } return s; };

export function ctrAt(pos, P = app.P) {
  const c = P.ctr_curve;
  if (!c || pos == null) return 0;
  if (pos <= 1) return c[0];
  if (pos >= 20) return c[19];
  const lo = Math.floor(pos);
  return c[lo - 1] + (c[lo] - c[lo - 1]) * (pos - lo);
}
export const targetOf = (k, pos) => k.target || (pos != null && pos <= 3 ? 1 : 3);
export function potential(k, pos, demand) {
  if (!app.P.ctr_curve || pos == null) return null;
  return Math.round(demand * Math.max(0, ctrAt(targetOf(k, pos)) - ctrAt(pos)));
}

export function kstats(k, R) {
  const m = k.map;
  const pts = R.dates.map(d => m.get(d) || null);
  let clicks = 0, impr = 0;
  R.sum.dates.forEach(d => { const x = m.get(d); if (x) { clicks += x[2]; impr += x[3]; } });
  const cur = posAt(m, R.to), at = d => posAt(m, d);
  const dl = x => cur && x ? +(x[1] - cur[1]).toFixed(1) : null; // positif = gain de places
  const ps = pts.filter(Boolean).map(p => p[1]).filter(v => v != null);
  const p7 = at(shift(R.to, -7)), p28 = at(shift(R.to, -28)), pc = R.cmp ? at(R.cmp.to) : null;
  const st = { pts, clicks, impr, ctr: impr ? clicks / impr * 100 : null, cur, pos: cur ? cur[1] : null, exact: !!cur && cur[0] === R.to,
    d7: dl(p7), d28: dl(p28), dcmp: dl(pc), p7: p7 && p7[1], p28: p28 && p28[1], pc: pc && pc[1],
    best: ps.length ? Math.min(...ps) : null, demand: sumImpr(k.smap, R.to, 28), alt: k.alt[R.to] || null };
  st.potential = potential(k, st.pos, st.demand);
  return st;
}

export function visibilityAt(kws, d) {
  let a = 0, b = 0;
  kws.forEach(k => { const x = posAt(k.map, d), w = sumImpr(k.smap, d, 28); if (x && w) { a += w * ctrAt(x[1]); b += w * ctrAt(1); } });
  return b ? a / b * 100 : null;
}

export function segSum(seg, dates, P = app.P) {
  const m = P.seg[seg]; let c = 0, i = 0;
  dates.forEach(d => { const x = m && m.get(d); if (x) { c += x[2]; i += x[3]; } });
  return { clicks: c, impr: i };
}

export function trackedClicks(kws, dates) {
  let c = 0;
  kws.forEach(k => dates.forEach(d => { const x = k.map.get(d); if (x) c += x[2]; }));
  return c;
}

// Au-delà de 3 mois, regroupement par semaine (position pondérée, clics et impressions additionnés)
export function bucket(pts, dates, lf = app.P && app.P.last_final) {
  if (dates.length <= 92) return { labels: dates, ranges: dates.map(d => [d, d]), pts, weekly: false, fresh: dates.map(d => lf && d > lf) };
  const labels = [], ranges = [], out = [], fresh = [];
  for (let end = dates.length; end > 0; end -= 7) {
    const a = Math.max(0, end - 7), chunk = pts.slice(a, end).filter(Boolean);
    labels.unshift(dates[a]); ranges.unshift([dates[a], dates[end - 1]]); fresh.unshift(!!(lf && dates[end - 1] > lf));
    if (!chunk.length) { out.unshift(null); continue; }
    const i = chunk.reduce((s, p) => s + p[3], 0), c = chunk.reduce((s, p) => s + p[2], 0);
    out.unshift([dates[a], i ? +(chunk.reduce((s, p) => s + p[1] * p[3], 0) / i).toFixed(1) : chunk[0][1], c, i, chunk.some(p => p[4]) ? 1 : 0]);
  }
  return { labels, ranges, pts: out, weekly: true, fresh };
}

// ---------------------------------------------------------------- alertes vues / nouvelles (mémoire du navigateur)

export const alertKey = a => `${a.type}|${a.i ?? a.page ?? ""}`;
const SEEN = "seenAlerts";
export function seenMap() { return store.json(SEEN, null); }
// Nouvelles alertes d'un projet = clés jamais vues. Au tout premier passage, tout est considéré comme vu (pas de bruit).
export function newKeys(name, alerts) {
  const all = seenMap();
  if (!all) { initSeen(); return new Set(); }
  const s = all[name] || {};
  return new Set(alerts.map(alertKey).filter(k => !(k in s)));
}
export function initSeen() {
  const all = {};
  (app.IDX.projects || []).forEach(p => { all[p.name] = Object.fromEntries((p.alert_list || []).map(a => [alertKey(a), today()])); });
  store.put(SEEN, all);
}
// Marque vues les alertes en cours ; les alertes disparues sont oubliées (si elles reviennent, elles redeviennent nouvelles)
export function markSeen(name, alerts) {
  const all = seenMap() || {};
  const prev = all[name] || {};
  all[name] = Object.fromEntries(alerts.map(a => { const k = alertKey(a); return [k, prev[k] || today()]; }));
  store.put(SEEN, all);
}
export const newCount = p => newKeys(p.name, p.alert_list || []).size;

// État de synchro d'un projet : en échec, en retard (plus de 4 jours), ou à jour
export function syncState(p) {
  const late = p.last_date ? ndays(p.last_date, today()) : 99;
  if (p.status && p.status.ok === false) return { kind: "ko", late };
  if (late > 4) return { kind: "late", late };
  return { kind: "ok", late };
}

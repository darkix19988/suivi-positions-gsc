// État de l'application : données chargées, route, choix de l'utilisateur.
// Les choix durables vivent dans le navigateur (localStorage) ; l'état de la vue est aussi écrit dans l'URL pour être partageable.

export const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
  json: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  put: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export const VIEWS = [["mots-cles", "Mots-clés"], ["trafic", "Trafic du site"], ["actions", "Actions"], ["opportunites", "Opportunités"],
  ["cannibalisation", "Cannibalisation"], ["rapport", "Rapport"], ["a-traiter", "À traiter"]];
export const RANGE_VIEWS = ["mots-cles", "trafic"];
export const FRESH_VIEWS = ["mots-cles", "trafic", "opportunites"];

export const COLS = [
  { id: "page", label: "Page suivie", on: false }, { id: "url", label: "Autre page en tête", on: false },
  { id: "dcmp", label: "Comparaison", on: true }, { id: "d7", label: "7 j", on: true }, { id: "d28", label: "28 j", on: false },
  { id: "best", label: "Meilleure", on: false }, { id: "demand", label: "Impr. / mois", on: true },
  { id: "clicks", label: "Clics", on: true }, { id: "impr", label: "Impressions", on: false }, { id: "ctr", label: "Taux de clic", on: false },
  { id: "potential", label: "À gagner / mois", on: true }, { id: "status", label: "Statut", on: false }, { id: "target", label: "Objectif", on: false },
  { id: "trend", label: "Tendance", on: true }, { id: "tags", label: "Tags", on: false }];
export const defaultCols = () => COLS.filter(c => c.on).map(c => c.id);

// Données et route courantes, et points d'entrée de rendu (branchés par main.js)
export const app = { IDX: null, P: null, route: { site: null, view: "", params: {} }, render: () => {}, chrome: () => {} };

const savedCols = store.json("cols3", null);
export const ui = {
  fresh: store.get("fresh") !== "0",
  range: store.json("range", { preset: "28" }), cmp: store.json("cmp", { mode: "n1" }),
  cols: new Set(savedCols || defaultCols()), sort: store.json("sort", { key: "demand", dir: -1 }),
  sel: {}, query: "", tags: new Set(), statuses: new Set(), alertsOnly: false, view: "", openKw: null,
  kwMode: "kw", who: store.get("who") || "", chartOpen: store.get("chartOpen") === "1", metric: "position",
  trafSeg: "nonbrand", trafMode: store.get("trafMode") || "global", secGroup: null, secSort: { key: "clicks", dir: -1 }, secOpen: null, secRef: null,
  secMetric: "clicks", secBrand: store.get("secBrand") || "nonbrand", cannMode: "q", cannType: "", sug: "all", sugSel: new Set(), month: null,
  actMetric: store.get("actMetric") || "position", ovOpen: store.get("ovOpen2") === "1", ovChart: store.get("ovChart") || "pos",
  pSort: store.json("pSort", { key: "alerts", dir: -1 }), feedFilter: "all", more: {}, chipsOpen: false,
};

export const saveRange = () => { store.put("range", ui.range); store.put("cmp", ui.cmp); };

// ---------------------------------------------------------------- URL : #/projet/onglet?p=28&c=n1&m=fra&q=…&kw=12

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, qs = ""] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  return { site: parts[0] || null, view: parts[1] || "", params: Object.fromEntries(new URLSearchParams(qs)) };
}

// Applique les paramètres d'URL à l'état (l'URL gagne sur la mémoire du navigateur)
// reset : changement de projet, les filtres absents de l'URL repartent à zéro ; sinon ils sont gardés d'un onglet à l'autre
export function applyParams(p, reset = false) {
  if (p.p) {
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(p.p)) { const [from, to] = p.p.split("_"); ui.range = { preset: "custom", from, to }; }
    else if (["7", "28", "90", "365", "0"].includes(p.p)) ui.range = { preset: p.p };
  }
  if (p.c) {
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(p.c)) { const [from, to] = p.c.split("_"); ui.cmp = { mode: "custom", from, to }; }
    else if (["n1", "prev", "none"].includes(p.c)) ui.cmp = { mode: p.c };
  }
  if (p.prov === "0") ui.fresh = false; else if (p.prov === "1") ui.fresh = true;
  if (reset || ["q", "t", "s", "a"].some(k => k in p)) {
    ui.query = p.q || "";
    ui.tags = new Set((p.t || "").split(",").filter(Boolean));
    ui.statuses = new Set((p.s || "").split(",").filter(Boolean));
    ui.alertsOnly = p.a === "1";
    ui.view = "";
  }
  if (p.mode === "page") ui.kwMode = "page"; else if (p.mode === "kw" || (reset && !p.mode)) ui.kwMode = "kw";
  if (p.vue === "dossier" || p.vue === "global") ui.trafMode = p.vue;
  if (reset || "dos" in p) ui.secOpen = p.dos || null;
  if (reset || "g" in p) ui.secGroup = p.g || null;
  if (p.mois) ui.month = p.mois; else if (reset) ui.month = null;
}

// État courant -> chaîne de paramètres (seulement ce qui s'écarte du défaut)
export function currentParams() {
  const { site, view } = app.route;
  const o = {};
  if (!site || site === "guide") return o;
  const R = ui.range, C = ui.cmp;
  const ranged = ["mots-cles", "trafic"].includes(view);
  if (ranged) {
    if (R.preset === "custom" && R.from && R.to) o.p = `${R.from}_${R.to}`; else if (String(R.preset) !== "28") o.p = String(R.preset);
    if (C.mode === "custom" && C.from && C.to) o.c = `${C.from}_${C.to}`; else if (C.mode !== "n1") o.c = C.mode;
  }
  if (app.P && app.P.markets && app.P.markets.length > 1 && app.P.market !== app.P.default_market) o.m = app.P.market;
  if (!ui.fresh) o.prov = "0";
  if (view === "mots-cles") {
    if (ui.kwMode === "page") o.mode = "page";
    if (ui.query) o.q = ui.query;
    if (ui.tags.size) o.t = [...ui.tags].join(",");
    if (ui.statuses.size) o.s = [...ui.statuses].join(",");
    if (ui.alertsOnly) o.a = "1";
  }
  if (view === "trafic" && ui.trafMode === "dossier") { o.vue = "dossier"; if (ui.secGroup) o.g = ui.secGroup; if (ui.secOpen) o.dos = ui.secOpen; }
  if (view === "rapport" && ui.month) o.mois = ui.month;
  if (ui.openKw != null) o.kw = String(ui.openKw);
  return o;
}

export function hrefFor(site, view, extra = {}) {
  const qs = new URLSearchParams(extra).toString();
  return `#/${site}${view ? "/" + view : ""}${qs ? "?" + qs : ""}`;
}

// Réécrit l'URL sans déclencher de navigation
export function syncUrl() {
  const { site, view } = app.route;
  if (!site) return;
  const qs = new URLSearchParams(currentParams()).toString();
  const h = site === "guide" ? "#/guide" : `#/${site}/${view}${qs ? "?" + qs : ""}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}

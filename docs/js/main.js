// Point d'entrée : chargement, routage, raccourcis clavier.
import { app, ui, store, VIEWS, parseHash, applyParams, syncUrl } from "@/state.js";
import { $, esc } from "@/util.js";
import { loadIndex, project, marketOf, projectMeta } from "@/data.js";
import { readTheme, destroyCharts } from "@/charts.js";
import { initTooltips, closeMenus, skeleton, empty, ICON } from "@/ui.js";
import { bindChrome, renderChrome, myProjects, toggleRail, applyBrand } from "@/chrome.js";
import { openCmdk, closeCmdk, openKeys, cmdkOpen } from "@/cmdk.js";
import { openDrawer, closeDrawer, drawerOpen } from "@/drawer.js";
import { renderPortfolio } from "@/views/portfolio.js";
import { renderToday } from "@/views/today.js";
import { renderKeywords } from "@/views/keywords.js";

// Onglets moins fréquents chargés à la demande
const lazy = { trafic: () => import("@/views/traffic.js").then(m => m.renderTraffic), actions: () => import("@/views/actions.js").then(m => m.renderActions),
  opportunites: () => import("@/views/opps.js").then(m => m.renderOpps), cannibalisation: () => import("@/views/cannib.js").then(m => m.renderCannib),
  rapport: () => import("@/views/report.js").then(m => m.renderReport), guide: () => import("@/views/guide.js").then(m => m.renderGuide) };
const eager = { "mots-cles": renderKeywords, "a-traiter": renderToday };

let renderSeq = 0;
async function renderView() {
  const seq = ++renderSeq;
  destroyCharts();
  const { P, route } = app;
  if (route.site === "guide") { const f = await lazy.guide(); if (seq === renderSeq) f(); return; }
  if (!P) { renderPortfolio(); syncUrl(); return; }
  const fn = eager[route.view] || (lazy[route.view] && await lazy[route.view]()) || renderKeywords;
  if (seq !== renderSeq) return;
  fn();
  syncUrl();
}
app.render = () => { renderChrome(); return renderView(); };
// Re-rendu en gardant le panneau de détail ouvert
app.rerender = async () => { const keep = ui.openKw; renderChrome(); await renderView(); if (keep != null && app.P) openDrawer(keep, { silent: true }); };

async function onRoute() {
  let { site, view, params } = parseHash();
  if (view === "alertes") view = "a-traiter";                     // anciennes adresses
  if (view === "pages") { view = "mots-cles"; params.mode = "page"; }
  if (site && site !== "guide" && !view) view = "mots-cles";      // onglet d'arrivée d'un projet
  if (site && site !== "guide" && !VIEWS.some(v => v[0] === view)) view = "mots-cles";
  const siteChanged = site !== app.route.site;
  const viewChanged = siteChanged || view !== app.route.view;
  applyParams(params, siteChanged);
  if (params.m && site) store.set("market:" + site, params.m);
  closeDrawer(true); closeCmdk(); closeMenus();
  $("app").classList.remove("nav-open");
  app.route = { site, view, params };

  if (site && site !== "guide") {
    if (!app.P || app.P.name !== site || siteChanged) { $("view").innerHTML = skeleton(); }
    try { app.P = await project(site, marketOf(site)); }
    catch {
      try { store.set("market:" + site, "all"); app.P = await project(site, "all"); }
      catch {
        app.P = null; renderChrome();
        $("view").innerHTML = empty("Projet introuvable", `Aucun projet « ${esc(site)} » dans le portefeuille.`, ICON.folder, '<a class="btn secondary" href="#/">Retour au portefeuille</a>');
        return;
      }
    }
    if (app.route.site !== site) return; // une autre navigation a pris le relais
  } else app.P = null;

  renderChrome();
  await renderView();
  if (viewChanged) window.scrollTo(0, 0);
  if (params.kw != null && app.P && app.P.kwById.has(+params.kw)) openDrawer(+params.kw, { silent: true });
  if (viewChanged && document.activeElement === document.body) $("view").focus({ preventScroll: true });
}

const typing = e => { const t = e.target; if (!t) return false;
  if (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName)) return true;
  return t.tagName === "INPUT" && !/^(checkbox|radio|button|submit)$/.test(t.type); };
function onKey(e) {
  const k = e.key;
  if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "k") { e.preventDefault(); cmdkOpen() ? closeCmdk() : openCmdk(); return; }
  if (k === "Escape") { if (cmdkOpen()) return closeCmdk(); if (drawerOpen()) return closeDrawer(); closeMenus(); $("app").classList.remove("nav-open"); return; }
  if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || cmdkOpen()) return;
  if (drawerOpen()) return; // le panneau gère ses propres flèches
  const P = app.P;
  if (k === "/") { e.preventDefault(); const q = $("q"); q ? (q.focus(), q.select()) : openCmdk(); }
  else if (k === "?") { e.preventDefault(); openKeys(); }
  else if (k === "m") toggleRail();
  else if (k === "0") location.hash = "#/";
  else if (/^[1-7]$/.test(k) && P) location.hash = `#/${P.name}/${VIEWS[+k - 1][0]}`;
  else if ((k === "[" || k === "]") && app.IDX) {
    const list = myProjects(); if (!list.length) return;
    const i = Math.max(0, list.findIndex(p => P && p.name === P.name));
    const next = list[(i + (k === "]" ? 1 : -1) + list.length) % list.length];
    location.hash = `#/${next.name}/${app.route.view || "mots-cles"}`;
  }
}

async function boot() {
  readTheme();
  applyBrand();
  initTooltips();
  try { await loadIndex(); }
  catch {
    $("view").innerHTML = empty("Données indisponibles", "Le fichier du portefeuille n'a pas pu être chargé. Recharge la page dans un instant ; si le problème continue, la dernière publication a peut-être échoué.", ICON.alert,
      '<button class="btn secondary" onclick="location.reload()">Recharger</button>');
    return;
  }
  bindChrome();
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
  $("scrim").onclick = () => { closeDrawer(); $("app").classList.remove("nav-open"); };
  $("cmdk-btn").onclick = () => openCmdk();
  $("keys-btn").onclick = openKeys;
  addEventListener("hashchange", onRoute);
  onRoute();
}

if (window.Chart) boot(); else addEventListener("load", boot, { once: true });

// Coquille de l'application : barre latérale, barre du haut (filtres), bandeau d'état, sous-navigation, thème, menu réduit.
import { app, ui, store, VIEWS, RANGE_VIEWS, FRESH_VIEWS, saveRange, syncUrl, hrefFor } from "@/state.js";
import { $, $$, esc, fmtDate, fmtDateL, ndays, plural, issue, GH, humanError, copyText, isMac, shift, BRAND, PRODUCT, CFG } from "@/util.js";
import { ranges, refDay, cmpLabel, project, prefetch, newCount, syncState, projectMeta } from "@/data.js";
import { ICON, tip, toast, menuToggle } from "@/ui.js";
import { readTheme } from "@/charts.js";

const owners = () => [...new Set(app.IDX.projects.map(p => p.owner).filter(Boolean))].sort();
export const myProjects = () => app.IDX.projects.filter(p => !ui.who || p.owner === ui.who);
export const nAlerts = p => p.alerts.critique + p.alerts.attention;
const sevOf = p => p.alerts.critique ? "ko" : p.alerts.attention ? "warn" : "ok";

// ---------------------------------------------------------------- thème et menu réduit
export function setTheme(t) {
  store.set("theme", t);
  const eff = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
  document.documentElement.dataset.theme = eff;
  readTheme();
  paintThemeBtn();
  app.render();
}
const paintThemeBtn = () => { const dark = document.documentElement.dataset.theme === "dark"; $("theme-btn").innerHTML = dark ? ICON.sun : ICON.moon; $("theme-btn").setAttribute("data-tip", dark ? "Passer en thème clair" : "Passer en thème sombre"); };

export function applyRail() {
  const pref = store.get("rail");
  const rail = pref === "1" || (pref === null && innerWidth < 1360 && innerWidth > 860);
  $("app").classList.toggle("rail", rail);
  $("rail-btn").setAttribute("data-tip", rail ? "Déplier le menu (m)" : "Réduire le menu (m)");
  requestAnimationFrame(syncTopbar);
}
export const toggleRail = () => { store.set("rail", $("app").classList.contains("rail") ? "0" : "1"); applyRail(); };

// La sous-navigation colle sous la barre du haut, dont la hauteur varie avec les filtres affichés
export const syncTopbar = () => requestAnimationFrame(() => {
  const s = document.documentElement.style, tb = $("topbar");
  s.setProperty("--tb", (getComputedStyle(tb).position === "sticky" ? tb.offsetHeight : 0) + "px");
  s.setProperty("--sn", ($("subnav").hidden || getComputedStyle($("subnav")).position !== "sticky" ? 0 : $("subnav").offsetHeight) + "px");
});

// ---------------------------------------------------------------- événements (une fois)
export function bindChrome() {
  $("menu-btn").onclick = () => $("app").classList.toggle("nav-open");
  $("theme-btn").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $("rail-btn").onclick = toggleRail;
  $("filters-btn").onclick = () => { $("topbar").classList.toggle("f-open"); syncTopbar(); };
  $("share-btn").onclick = async () => { syncUrl(); if (await copyText(location.href)) toast("Lien de la vue copié"); };
  $("cmdk-kbd").textContent = isMac ? "⌘K" : "Ctrl K";
  menuToggle("opt-btn");
  addEventListener("resize", () => { applyRail(); syncTopbar(); });
  paintThemeBtn();
  applyRail();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (store.get("theme") === "system") setTheme("system"); });

  $("f-fresh").onchange = e => { ui.fresh = e.target.checked; store.set("fresh", ui.fresh ? "1" : "0"); app.rerender(); };
  $("f-market").onchange = async e => {
    const P = app.P; if (!P) return;
    store.set("market:" + P.name, e.target.value);
    $("view").classList.add("is-loading");
    try { app.P = await project(P.name, e.target.value); } finally { $("view").classList.remove("is-loading"); }
    ui.secOpen = null;
    app.rerender();
  };
  $$("#f-range button").forEach(b => b.onclick = () => {
    const v = b.dataset.v, P = app.P;
    ui.range = v === "custom" ? { preset: "custom", from: ui.range.from || (P ? shift(refDay(), -27) : null), to: ui.range.to || (P ? refDay() : null) } : { preset: v };
    saveRange(); app.rerender();
  });
  ["f-from", "f-to"].forEach(id => $(id).onchange = () => {
    ui.range = { preset: "custom", from: $("f-from").value, to: $("f-to").value };
    if (ui.range.from && ui.range.to && ui.range.from <= ui.range.to) { saveRange(); app.rerender(); }
  });
  $("f-cmp").onchange = e => {
    const v = e.target.value;
    if (v === "custom" && app.P) { const R = ranges(); ui.cmp = { mode: "custom", from: ui.cmp.from || shift(R.from, -364), to: ui.cmp.to || shift(R.to, -364) }; }
    else ui.cmp = { mode: v };
    saveRange(); app.rerender();
  };
  ["f-cfrom", "f-cto"].forEach(id => $(id).onchange = () => {
    ui.cmp = { mode: "custom", from: $("f-cfrom").value, to: $("f-cto").value };
    if (ui.cmp.from && ui.cmp.to && ui.cmp.from <= ui.cmp.to) { saveRange(); app.rerender(); }
  });
}

// ---------------------------------------------------------------- rendu (à chaque route)
export function renderChrome() {
  const { IDX, P, route } = app;
  const site = P ? P.name : "";
  const totalNew = IDX.projects.reduce((s, p) => s + newCount(p), 0);
  $("nav-main").innerHTML = `<a href="#/" class="${!route.site ? "active" : ""}" ${!route.site ? 'aria-current="page"' : ""} data-tip="${$("app").classList.contains("rail") ? "Portefeuille" : ""}">${ICON.grid}<span class="lbl">Portefeuille</span>${totalNew ? `<span class="count new" ${tip("Alertes apparues depuis ta dernière visite")}>${totalNew}</span>` : ""}</a>`;

  const owns = owners();
  $("who-wrap").innerHTML = owns.length > 1 ? `<select id="who" class="ctl sm" aria-label="Consultant"><option value="">Tous les consultants</option>${owns.map(o => `<option ${o === ui.who ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : "";
  $("who-wrap").hidden = owns.length <= 1;
  if ($("who")) $("who").onchange = e => { ui.who = e.target.value; store.set("who", ui.who); app.render(); };

  const rail = $("app").classList.contains("rail");
  $("projects").innerHTML = myProjects().map(p => {
    const n = nAlerts(p), nw = newCount(p), st = syncState(p);
    const hd = st.kind !== "ok" ? "ko" : sevOf(p);
    return `<a href="#/${p.name}" data-p="${esc(p.name)}" class="${route.site === p.name ? "active" : ""}" ${route.site === p.name ? 'aria-current="page"' : ""} ${rail ? tip(p.label) : ""}>
      <span class="avatar">${esc(p.label[0].toUpperCase())}<span class="hd ${hd}"></span></span><span class="lbl">${esc(p.label)}</span>
      ${n ? `<span class="count ${nw ? "new" : sevOf(p)}" data-alerts="${esc(p.name)}" role="link" ${tip(`${plural(n, "alerte", "alertes")}${nw ? `, dont ${nw} nouvelle${nw > 1 ? "s" : ""}` : ""} : ouvrir À traiter`)}>${n}</span>` : ""}</a>`;
  }).join("") || `<div class="empty-note" style="padding:0 10px">Aucun projet.</div>`;
  $$("#projects a").forEach(a => { a.onmouseenter = () => prefetch(a.dataset.p); a.onfocus = () => prefetch(a.dataset.p); });
  $$("#projects [data-alerts]").forEach(c => c.onclick = e => { e.preventDefault(); e.stopPropagation(); location.hash = `#/${c.dataset.alerts}/a-traiter`; });

  $("guide-btn").classList.toggle("active", route.site === "guide");
  renderSync();
  renderTopbar();
}

// Fraîcheur et synchro : une ligne par projet en échec, en clair
function renderSync() {
  const { IDX } = app;
  const states = IDX.projects.map(p => ({ p, ...syncState(p) }));
  const bad = states.filter(s => s.kind !== "ok");
  const gen = new Date(IDX.generated_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const ok = IDX.projects.length - bad.length;
  const detail = [`Dernier calcul : ${gen}.`].concat(bad.map(x => `${x.p.label} : ${x.kind === "ko" ? humanError(x.p.status.error) : `rien de nouveau depuis ${x.late} jours`}, données au ${fmtDate(x.p.last_date)}.`)).join("\n");
  $("sync").innerHTML = `<a class="sync" href="${bad.length === 1 ? "#/" + bad[0].p.name : GH + "/actions/workflows/daily.yml"}" ${bad.length === 1 ? "" : 'target="_blank" rel="noopener"'} ${tip(detail)}>
      <span class="dot ${bad.length ? (ok ? "warn" : "ko") : "ok"}"></span><span class="txt">${bad.length ? `${bad.length === 1 ? esc(bad[0].p.label) + " en échec" : bad.length + " synchros en échec"}` : "Synchros à jour"}</span></a>`;
}

function renderTopbar() {
  const { P, route } = app;
  const view = route.view;
  const crumbs = $("crumbs");
  const banner = $("banner");
  $("topbar").classList.remove("f-open");
  // Filtres affichés selon l'onglet
  $("f-market").hidden = !P || !(P.markets && P.markets.length > 1);
  if (P && P.markets) $("f-market").innerHTML = P.markets.map(m => `<option value="${m.code}" ${m.code === P.market ? "selected" : ""}>${esc(m.label)}</option>`).join("");
  const showRange = !!P && RANGE_VIEWS.includes(view);
  $("g-range").hidden = $("g-cmp").hidden = !showRange;
  $("g-fresh").hidden = !P || !FRESH_VIEWS.includes(view);
  $("f-fresh").checked = ui.fresh;
  $("share-btn").hidden = !P;
  const anyFilter = [$("f-market"), $("g-range"), $("g-fresh")].some(el => !el.hidden);
  $("filters-btn").hidden = !anyFilter;
  if (showRange) {
    const R = ranges();
    $$("#f-range button").forEach(b => { const on = b.dataset.v === String(ui.range.preset); b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
    $("d-range").hidden = ui.range.preset !== "custom";
    $("f-from").value = R.from; $("f-to").value = R.to;
    $("f-from").min = $("f-to").min = P.dates[0] || ""; $("f-from").max = $("f-to").max = refDay();
    $("f-cmp").value = ui.cmp.mode;
    $("d-cmp").hidden = ui.cmp.mode !== "custom";
    if (R.cmp) { $("f-cfrom").value = R.cmp.from; $("f-cto").value = R.cmp.to; }
  }
  if (anyFilter) {
    const rl = { "7": "7 j", "28": "28 j", "90": "90 j", "365": "12 mois", "0": "Tout", custom: "Dates" }[String(ui.range.preset)];
    $("filters-btn").textContent = ["Filtres", !$("f-market").hidden ? P.market_label : null, showRange ? rl : null, showRange && ui.cmp.mode !== "none" ? cmpLabel() : null].filter(Boolean).join(" · ");
  }

  if (!P) {
    crumbs.innerHTML = "";
    $("topbar").classList.add("bare");
    $("subnav").hidden = true;
    banner.innerHTML = ""; $("phead").innerHTML = "";
    document.title = `${route.site === "guide" ? "Guide" : "Portefeuille"} · ${PRODUCT} · ${BRAND}`;
    syncTopbar();
    return;
  }
  const vlabel = (VIEWS.find(v => v[0] === view) || VIEWS[0])[1];
  const fresh = P.last_date && P.last_final ? ndays(P.last_final, P.last_date) : 0;
  const meta = projectMeta(P.name) || P;
  const st = syncState(meta);
  crumbs.innerHTML = "";
  $("topbar").classList.toggle("bare", !anyFilter);
  // Bandeau : projet en échec ou en retard
  banner.innerHTML = st.kind === "ko" ? `<div class="banner ko" role="alert">${ICON.alert}<div><b>Synchro en échec</b> : ${esc(humanError(P.status.error))}. Les données s'arrêtent au ${fmtDateL(P.last_date)}. <a href="${GH}/actions/workflows/daily.yml" target="_blank" rel="noopener">Voir les synchros</a></div></div>`
    : st.kind === "late" ? `<div class="banner warn" role="status">${ICON.alert}<div><b>Données en retard</b> : rien de nouveau depuis le ${fmtDateL(P.last_date)} (${st.late} jours).</div></div>` : "";

  // En-tête du projet : identité, état, fraîcheur, actions principales
  const n = P.alerts.length, nw = newCount(meta.alert_list ? meta : { name: P.name, alert_list: P.alerts });
  const crit = P.alerts.filter(a => a.severity === "critique").length;
  const health = st.kind === "ko" ? `<span class="badge ko dotted">Synchro en échec</span>` : crit ? `<a class="badge ko dotted" href="#/${P.name}/a-traiter">${crit} urgente${crit > 1 ? "s" : ""}</a>`
    : n ? `<a class="badge warn dotted" href="#/${P.name}/a-traiter">${n} à surveiller</a>` : `<span class="badge ok dotted">Rien à signaler</span>`;
  const host = P.property.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const about = `${host}${P.market !== "all" ? " · " + P.market_label : ""}\n${plural(P.keywords.length, "mot-clé suivi", "mots-clés suivis")}${P.owner ? " · " + P.owner : ""}\nDonnées définitives jusqu'au ${fmtDateL(P.last_final)}${fresh ? `, puis ${fresh} jour${fresh > 1 ? "s" : ""} provisoire${fresh > 1 ? "s" : ""}` : ""}`;
  $("phead").innerHTML = `<div class="phead"><div class="phead-id"><span class="avatar xl" ${tip(about)}>${esc(P.label[0].toUpperCase())}</span>
      <div class="phead-t"><h1><button class="crumb-btn" id="proj-switch" type="button" aria-label="Changer de projet" ${tip("Changer de projet (⌘K, [ et ])")}>${esc(P.label)}${ICON.down}</button></h1>
        <div class="phead-meta">${health}${nw ? `<span class="badge new">${nw} nouvelle${nw > 1 ? "s" : ""}</span>` : ""}<span class="light" ${tip(about)}>${fmtDate(P.last_date)}</span></div></div></div>
      <div class="phead-act"><a class="btn ghost icon" href="${issue("mot-cle.yml", { projet: P.name, title: "Mots-clés : " })}" target="_blank" rel="noopener" ${tip("Suivre des mots-clés")} aria-label="Suivre des mots-clés">${ICON.plus}</a>
        <a class="btn secondary" href="${issue("action.yml", { projet: P.name, title: "Action : " })}" target="_blank" rel="noopener">${ICON.pen}Ajouter une action</a></div></div>`;
  $("proj-switch").onclick = () => import("@/cmdk.js").then(m => m.openCmdk("projets"));
  const TAB_ICON = { "mots-cles": ICON.hash, trafic: ICON.chart, actions: ICON.pen, opportunites: ICON.target, cannibalisation: ICON.split, rapport: ICON.file, "a-traiter": ICON.bell };
  $("subnav").hidden = false;
  $("subnav").innerHTML = VIEWS.map(([v, l], idx) => `<a href="${hrefFor(P.name, v)}" class="${view === v ? "active" : ""}${v === "a-traiter" ? " last" : ""}" ${view === v ? 'aria-current="page"' : ""} ${tip(`Touche ${idx + 1}`)}>${l}${
    v === "a-traiter" && n ? ` <span class="count ${nw ? "new" : crit ? "ko" : "warn"}">${n}</span>` : ""}${
    v === "actions" && P.actions.length ? ` <span class="count">${P.actions.length}</span>` : ""}</a>`).join("");
  const sn = $("subnav"), act = sn.querySelector(".active");
  if (act && innerWidth <= 860) { // sans scrollIntoView, qui ferait défiler la page
    const x = act.getBoundingClientRect().left - sn.getBoundingClientRect().left + sn.scrollLeft;
    if (x < sn.scrollLeft || x + act.offsetWidth > sn.scrollLeft + sn.clientWidth) sn.scrollLeft = Math.max(0, x - 16);
  }
  document.title = `${P.label} · ${vlabel} · ${PRODUCT}`;
  syncTopbar();
}

// Marque blanche (docs/config.js) : nom, produit et logo de la barre latérale
export function applyBrand() {
  const b = document.querySelector(".brand .txt");
  if (b) b.innerHTML = `${esc(BRAND)} <span class="product">${esc(PRODUCT)}</span>`;
  if (CFG.logo) { const svg = document.querySelector(".brand svg"); if (svg) svg.outerHTML = `<img src="${esc(CFG.logo)}" alt="" width="22" height="22">`; }
}

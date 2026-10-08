// Cannibalisation : requêtes hors marque dont les impressions se partagent entre plusieurs pages, et mots-clés suivis qui changent de page en tête.
import { app, ui } from "@/state.js";
import { DEF } from "@/defs.js";
import { $, $$, esc, fmt, fmt1, fmtDate, fmtDateY, shift, calDates, plural } from "@/util.js";
import { ranges, segSum, refDay } from "@/data.js";
import { chart, linScale, tooltip, C } from "@/charts.js";
import { ICON, tip, info, stat, viewBar, empty, urlLink, page, bindMore, rowNav } from "@/ui.js";
import { openDrawer } from "@/drawer.js";

const pageType = u => /\/blogs?\//.test(u) ? "blog" : /\/collections?\/|\/c\//.test(u) ? "collection" : /\/products?\/|\/p\//.test(u) ? "produit" : /\/pages\//.test(u) ? "page" : "autre";
const TYPE_L = { blog: "Blog", collection: "Collection", produit: "Produit", page: "Page", autre: "Autre" };
const pairKey = c => c[4].filter(x => x[2] >= 0.2 * c[1]).slice(0, 2).map(x => x[0]).sort().join(" | ");
const typeOf = c => c[4].slice(0, 2).map(x => pageType(x[0])).sort().join(" / ");
const typeLabel = t => t.split(" / ").map(x => TYPE_L[x]).join(" / ");

function leaderSwitches(k, R) {
  let prev = null, n = 0, days = 0;
  const pages = new Set();
  calDates(shift(R.to, -27), R.to).forEach(d => {
    const x = k.map.get(d), a = k.alt[d];
    if (!a && !(x && x[3] >= 5)) return;
    const lead = a ? a[0] : k.page;
    pages.add(lead);
    if (prev && lead !== prev) n++;
    prev = lead; days++;
  });
  return { n, days, pages: [...pages] };
}

// Piste d'action selon le type des deux pages (indicative : l'intention de la requête tranche)
function hint(t) {
  const [a, b] = t.split(" / ");
  if (a === "blog" && b === "blog") return "Fusionner les articles ou différencier leurs angles, puis relier ou rediriger.";
  if (t === "collection / produit") return "Souvent normal : la collection porte la requête générique, la fiche la requête précise. Vérifier que la bonne page sort.";
  if (a === b && a === "produit") return "Fiches en doublon possible : vérifier canonique, variantes ou fiche épuisée.";
  if (a === b && a === "collection") return "Collections proches : différencier titres et contenus, ou fusionner.";
  if ([a, b].includes("blog") || [a, b].includes("page")) return "Contenu éditorial contre page commerciale : recentrer l'article sur l'informationnel et le faire pointer vers la page commerciale.";
  return "Vérifier l'intention de la requête et choisir la page à pousser.";
}

export function renderCannib() {
  const P = app.P, R = ranges(), strip = P.market_path || "";
  const all = P.cannib || [];
  const per = P.extras_period || [shift(refDay(), -27), refDay()];
  const nb = segSum("nonbrand", calDates(per[0], per[1]));
  const impr = all.reduce((a, c) => a + c[1], 0), lost = all.reduce((a, c) => a + c[3], 0), clicks = all.reduce((a, c) => a + c[2], 0);
  const pairs = {}, byType = {}, pageLoad = {};
  all.forEach(c => {
    const k = pairKey(c); const x = pairs[k] = pairs[k] || { k, n: 0, lost: 0 }; x.n++; x.lost += c[3];
    const t = typeOf(c); const y = byType[t] = byType[t] || { n: 0, lost: 0 }; y.n++; y.lost += c[3];
    c[4].filter(z => z[2] >= 0.2 * c[1]).forEach(z => { const w = pageLoad[z[0]] = pageLoad[z[0]] || { n: 0, lost: 0 }; w.n++; w.lost += c[3]; });
  });
  const alt = P.keywords.map(k => ({ k, sw: leaderSwitches(k, R) })).filter(x => x.sw.n >= 3).sort((a, b) => b.sw.n - a.sw.n);
  const pctNb = v => nb.impr ? fmt1(v / nb.impr * 100) + "<small> %</small>" : "-";
  const types = Object.entries(byType).sort((a, b) => b[1].lost - a[1].lost);
  const loads = Object.entries(pageLoad).sort((a, b) => b[1].lost - a[1].lost).slice(0, 8);

  $("view").innerHTML = (all.length ? `<div class="kpi-grid">
      ${stat("Requêtes cannibalisées", fmt(all.length), "", "cannib", "", plural(Object.keys(pairs).length, "paire de pages", "paires de pages"))}
      ${stat("Demande concernée", pctNb(impr), "", "cannibDemandePart", "", `${fmt(impr)} impressions hors marque`)}
      ${stat("Impressions dispersées", pctNb(lost), "", "cannibPerte", "", `${fmt(lost)} impressions hors page principale`)}
      ${stat("Clics sur ces requêtes", fmt(clicks), "", "", "", nb.clicks ? `${fmt1(clicks / nb.clicks * 100)} % des clics hors marque` : "")}
      ${stat("Mots-clés instables", `${fmt(alt.length)}<small> / ${fmt(P.keywords.length)}</small>`, "", "alternance")}
    </div>
    <div class="grid-eq">
      <div class="card"><div class="card-head"><h2>Par type de pages ${info("cannibPerte")}</h2></div><div class="card-body"><div class="chart-box" style="height:${Math.max(120, types.length * 34 + 40)}px"><canvas id="c-cann-type"></canvas></div></div></div>
      <div class="card"><div class="card-head"><h2>Pages les plus impliquées</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Page</th><th class="num">Requêtes</th><th class="num def" data-tip="${esc(DEF.cannibPerte)}">Dispersées</th></tr></thead><tbody>
        ${loads.map(([u, x]) => `<tr><td style="max-width:300px"><div class="cann-p">${urlLink(u, { max: 34, strip })}<span class="badge outline">${TYPE_L[pageType(u)]}</span></div></td><td class="num">${fmt(x.n)}</td><td class="num">${fmt(x.lost)}</td></tr>`).join("")}
        </tbody></table></div></div>
    </div>
    <div id="cannib"></div>` : `<div class="card">${empty("Aucune cannibalisation détectée", "Aucune requête hors marque ne partage ses impressions entre plusieurs pages selon la règle de l'outil (voir l'info-bulle).", ICON.check)}</div><div id="cannib"></div>`);
  if (all.length) chart("c-cann-type", { type: "bar", data: { labels: types.map(([t]) => typeLabel(t)), datasets: [{ data: types.map(([, x]) => x.lost), backgroundColor: C.palette[0], borderRadius: 3, maxBarThickness: 20 }] },
    options: { indexAxis: "y", maintainAspectRatio: false, scales: { x: linScale(), y: { grid: { display: false }, ticks: { autoSkip: false, color: C.text } } },
      plugins: { legend: { display: false }, tooltip: tooltip({ label: c => ` ${fmt(c.parsed.x)} impressions dispersées, ${plural(types[c.dataIndex][1].n, "requête", "requêtes")}` }) } } });
  renderDetail(R, alt);
}

function renderDetail(R, alt) {
  const P = app.P, strip = P.market_path || "";
  const all = P.cannib || [];
  const types = [...new Set(all.map(typeOf))].sort();
  const rows = all.filter(c => !ui.cannType || typeOf(c) === ui.cannType);
  const pagesCell = c => c[4].filter(x => x[2] >= 0.05 * c[1]).map(x => `<div class="cann-p"><span class="badge">${Math.round(x[2] / c[1] * 100)} %</span>${urlLink(x[0], { max: 34, strip })}<span class="light">pos. ${fmt1(x[3])} · ${TYPE_L[pageType(x[0])]}</span></div>`).join("");
  let body, more = "";
  if (ui.cannMode === "pair") {
    const g = {};
    rows.forEach(c => { const k = pairKey(c); const x = g[k] = g[k] || { pages: k.split(" | "), n: 0, impr: 0, lost: 0, qs: [] }; x.n++; x.impr += c[1]; x.lost += c[3]; x.qs.push(c[0]); });
    const pg = page(Object.values(g).sort((a, b) => b.lost - a.lost), "cnp", 20); more = pg.more;
    body = `<table><thead><tr><th>Pages en concurrence</th><th class="num">Requêtes</th><th class="num def" data-tip="${esc(DEF.cannibDemande)}">Impressions</th><th class="num def" data-tip="${esc(DEF.cannibPerte)}">Dispersées</th><th>Exemples</th><th class="def" data-tip="${esc(DEF.cannibPiste)}">Piste</th></tr></thead><tbody>
      ${pg.items.map(x => `<tr><td style="max-width:300px">${x.pages.map(u => `<div class="cann-p">${urlLink(u, { max: 34, strip })}<span class="light">${TYPE_L[pageType(u)]}</span></div>`).join("")}</td><td class="num">${fmt(x.n)}</td><td class="num">${fmt(x.impr)}</td><td class="num"><b>${fmt(x.lost)}</b></td><td class="light wrap-cell" style="max-width:240px">${x.qs.slice(0, 4).map(esc).join(", ")}${x.qs.length > 4 ? "…" : ""}</td><td class="cann-hint">${esc(hint(x.pages.map(pageType).sort().join(" / ")))}</td></tr>`).join("") || `<tr><td colspan="6" class="empty-note" style="padding:14px 16px">Aucune paire.</td></tr>`}
      </tbody></table>`;
  } else {
    const pg = page(rows, "cnq", 25); more = pg.more;
    body = `<table><thead><tr><th>Requête</th><th class="num def" data-tip="${esc(DEF.cannibDemande)}">Impressions</th><th class="num">Clics</th><th>Pages <span class="th-sub">part des impressions, position moyenne</span></th><th class="num def" data-tip="${esc(DEF.cannibPerte)}">Dispersées</th></tr></thead><tbody>
      ${pg.items.map(c => `<tr><td class="wrap-cell" style="min-width:140px;max-width:220px"><b>${esc(c[0])}</b></td><td class="num">${fmt(c[1])}</td><td class="num">${fmt(c[2])}</td><td>${pagesCell(c)}</td><td class="num"><b>${fmt(c[3])}</b></td></tr>`).join("") || `<tr><td colspan="5" class="empty-note" style="padding:14px 16px">Aucune requête pour ce type.</td></tr>`}
      </tbody></table>`;
  }
  $("cannib").innerHTML = (all.length ? `<div class="card mt-4">
      <div class="toolbar"><div class="seg" id="cann-m" role="group" aria-label="Affichage"><button type="button" data-m="q" aria-pressed="${ui.cannMode !== "pair"}" class="${ui.cannMode !== "pair" ? "active" : ""}">Par requête</button><button type="button" data-m="pair" aria-pressed="${ui.cannMode === "pair"}" class="${ui.cannMode === "pair" ? "active" : ""}">Par paire de pages</button></div>
        <select class="ctl sm" id="cann-t" aria-label="Type de pages"><option value="">Tous les types de pages</option>${types.map(t => `<option value="${esc(t)}" ${t === ui.cannType ? "selected" : ""}>${esc(typeLabel(t))}</option>`).join("")}</select>
        <span class="spacer"></span><span class="badge outline">${fmt(rows.length)}</span></div>
      <div class="table-wrap">${body}</div>${more}</div>` : "")
    + `<div class="card mt-4"><div class="card-head"><h2>Mots-clés suivis qui changent de page ${info("alternance")}</h2></div>
      <div class="table-wrap"><table id="t-alt"><thead><tr><th>Mot-clé</th><th>Page suivie</th><th class="num">Changements de page en tête</th><th>Pages qui alternent</th></tr></thead><tbody>
      ${alt.map(x => `<tr class="click" data-alt="${x.k.i}"><td><b>${esc(x.k.keyword)}</b></td><td style="max-width:260px">${urlLink(x.k.page, { max: 34, strip })}</td><td class="num"><b>${x.sw.n}</b> <span class="light">sur ${x.sw.days} j</span></td><td style="max-width:320px">${x.sw.pages.filter(u => u !== x.k.page).map(u => `<div class="cann-p">${urlLink(u, { max: 38, strip })}</div>`).join("")}</td></tr>`).join("")
        || `<tr><td colspan="4" class="empty-note" style="padding:14px 16px">Aucun mot-clé suivi ne change de page en tête au moins 3 fois en 28 jours.</td></tr>`}
      </tbody></table></div></div>`;
  $$("#cann-m button").forEach(b => b.onclick = () => { ui.cannMode = b.dataset.m; renderDetail(R, alt); });
  if ($("cann-t")) $("cann-t").onchange = e => { ui.cannType = e.target.value; renderDetail(R, alt); };
  rowNav($("t-alt"), "tr[data-alt]", tr => openDrawer(+tr.dataset.alt));
  bindMore($("cannib"), () => renderDetail(R, alt));
}

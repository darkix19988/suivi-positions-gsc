// Trafic du site (données globales, jamais mélangées aux mots-clés suivis) : vue globale et vue par dossier.
import { app, ui, store, syncUrl, hrefFor } from "@/state.js";
import { DEF, DIST } from "@/defs.js";
import { $, $$, esc, fmt, fmt1, fmtDate, fmtDateY, fmtMonth, fmtMonthS, shiftMonth, monthDates, pct, plural } from "@/util.js";
import { ranges, segSum, cmpLabel, bucket, sectionsData } from "@/data.js";
import { chart, lineDs, posScale, linScale, xScale, tooltip, marksFor, C, label as chartLabel } from "@/charts.js";
import { ICON, tip, info, stat, areaSpark, viewBar, empty, sparkline, pctDelta, placesDelta, countDelta, ptsDelta, urlLink, sortable, th, rowNav, page, bindMore, skeleton } from "@/ui.js";

const legendShort = R => `<span class="lg" ${tip(`${fmtDate(R.from)} au ${fmtDate(R.to)}`)}><span class="line-sw" style="border-color:${C.ink}"></span>Période</span>${R.cmp ? `<span class="lg" ${tip(`${fmtDateY(R.cmp.from)} au ${fmtDateY(R.cmp.to)}`)}><span class="line-sw dash" style="border-color:${C.cmp}"></span>${cmpLabel().replace("vs ", "")}</span>` : ""}${R.fresh.length ? `<span class="lg" ${tip(DEF.provisoire)}><span class="sw fresh"></span>Provisoire</span>` : ""}`;
const SEGS = [["nonbrand", "Hors marque"], ["brand", "Marque"], ["total", "Total"], ["impr", "Impressions"]];

// Ce que la Search Console ne montre pas pour ce marché (bloc data_quality calculé à chaque synchro)
function dataNote(P) {
  const q = P.data_quality || {}, out = [];
  if (P.anonymized_share) out.push(`${fmt1(P.anonymized_share)} % des clics viennent de requêtes masquées par Google ${info("anonymes")} : comptées dans le total, ni en marque ni en hors marque.`);
  if (q.market_totals === "named_only") out.push(`Marché limité au dossier ${esc(P.market_path || "")} ${info("marcheDossier")} : chiffres des requêtes connues uniquement. Total complet du pays, tous dossiers confondus : ${fmt(q.country_clicks)} clics sur les 28 derniers jours définitifs.`);
  const tr = q.truncated_days || [];
  if (tr.length) out.push(`${plural(tr.length, "jour a atteint", "jours ont atteint")} la limite de lignes de la Search Console ${info("tronque")}, dernier le ${fmtDateY(tr[tr.length - 1].date)}.`);
  return out.map(t => `<p class="footnote">${t}</p>`).join("");
}

export function renderTraffic() {
  const P = app.P, R = ranges();
  const modeTabs = `<div class="seg" id="t-mode" role="group" aria-label="Affichage"><button type="button" data-m="global" aria-pressed="${ui.trafMode !== "dossier"}" class="${ui.trafMode !== "dossier" ? "active" : ""}">Vue globale</button><button type="button" data-m="dossier" aria-pressed="${ui.trafMode === "dossier"}" class="${ui.trafMode === "dossier" ? "active" : ""}">Par dossier</button></div>`;
  const note = `<i class="info" tabindex="0" data-tip="${esc(`Cumuls du ${fmtDateY(R.sum.from)} au ${fmtDateY(R.sum.to)}${R.sum.cmp ? `, comparés au ${fmtDateY(R.sum.cmp.from)} au ${fmtDateY(R.sum.cmp.to)}` : ""}, jours définitifs.${P.market !== "all" ? `\n${P.market_label}${P.market_path ? `, URL contenant ${P.market_path}` : ""}.` : ""}`)}">i</i>`;
  const bindMode = () => $$("#t-mode button").forEach(b => b.onclick = () => { ui.trafMode = b.dataset.m; store.set("trafMode", ui.trafMode); ui.secOpen = null; renderTraffic(); syncUrl(); });
  if (ui.trafMode === "dossier") { $("view").innerHTML = viewBar(modeTabs + note) + '<div id="folders"></div>'; bindMode(); renderFolders(); return; }

  const S = {}; ["nonbrand", "brand", "total"].forEach(s => { S[s] = segSum(s, R.sum.dates); S[s + "c"] = R.sum.cmp ? segSum(s, R.sum.cmp.dates) : null; S[s + "f"] = ui.fresh ? segSum(s, R.sum.freshDates) : null; });
  const cl = cmpLabel();
  const sub = (k, f = "clicks") => R.sum.cmp ? pctDelta(S[k][f], S[k + "c"][f], { cmp: cl }) : "";
  const seg = ui.trafSeg, segData = seg === "impr" ? "total" : seg, idx = seg === "impr" ? 3 : 2;
  const lm = R.to.slice(0, 7), months = []; for (let i = 12; i >= 0; i--) months.push(shiftMonth(lm, -i));
  const segL = SEGS.find(s => s[0] === seg)[1].toLowerCase();
  const wk = arr => arr.length <= 92 ? arr : arr.reduce((o, v, i) => { const w = Math.floor((arr.length - 1 - i) / 7); o[w] = (o[w] || 0) + v; return o; }, []).reverse();
  const sp = (sg, j) => areaSpark(wk(R.sum.dates.map(d => { const x = P.seg[sg] && P.seg[sg].get(d); return x ? x[j] : 0; })), C.palette[0]);

  $("view").innerHTML = viewBar(modeTabs + note)
    + `<div class="kpi-grid">
      ${stat("Clics hors marque", fmt(S.nonbrand.clicks), sub("nonbrand"), "horsMarque", sp("nonbrand", 2))}
      ${stat("Clics marque", fmt(S.brand.clicks), sub("brand"), "marque", sp("brand", 2))}
      ${stat("Clics au total", fmt(S.total.clicks), sub("total"), "", sp("total", 2))}
      ${stat("Impressions au total", fmt(S.total.impr), sub("total", "impr"), "", sp("total", 3))}
    </div>
    <div class="card mb-4"><div class="card-head"><h2>Par jour</h2>
      <div class="seg" id="t-seg" role="group" aria-label="Mesure">${SEGS.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${seg === v}" class="${seg === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
      <div class="card-body"><div class="legend mb-3">${legendShort(R)}</div>
      <div class="chart-box"><canvas id="c-traffic"></canvas></div><div id="marks-traffic"></div></div></div>
    <div class="card"><div class="card-head"><h2>Par mois</h2><div class="legend"><span class="lg"><span class="sw" style="background:${C.bar}"></span>${SEGS.find(x => x[0] === seg)[1]}</span><span class="lg"><span class="sw" style="background:${C["bar-soft"]}"></span>N-1</span></div></div>
      <div class="card-body"><div class="chart-box sm"><canvas id="c-months"></canvas></div></div></div>
    ${dataNote(P)}`;
  bindMode();
  $$("#t-seg button").forEach(b => b.onclick = () => { ui.trafSeg = b.dataset.v; renderTraffic(); });
  const segPts = ds_ => ds_.map(d => (P.seg[segData] && P.seg[segData].get(d)) || null);
  const tb = bucket(segPts(R.dates), R.dates);
  const ds = [lineDs(`${fmtDate(R.from)} au ${fmtDate(R.to)}`, tb.pts.map(p => p && p[idx]), C.ink, { fresh: tb.fresh, fill: true })];
  if (R.cmp) { const tc = bucket(segPts(R.cmp.dates), R.cmp.dates); ds.push(lineDs(`${fmtDateY(R.cmp.from)} au ${fmtDateY(R.cmp.to)}`, tb.labels.map((_, n) => tc.pts[n] ? tc.pts[n][idx] : null), C.cmp, { dash: [4, 4], width: 1.5 })); }
  const mk = marksFor(tb.ranges);
  chart("c-traffic", { type: "line", data: { labels: tb.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 16 } }, scales: { y: linScale(), x: xScale(tb.labels, tb.weekly) },
      plugins: { legend: { display: false }, marks: { items: mk.items }, freshZone: { fresh: tb.fresh },
        tooltip: tooltip({ title: c => chartLabel(tb.labels[c[0].dataIndex], tb.weekly) + (tb.fresh[c[0].dataIndex] ? " (provisoire, incomplet)" : ""), label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y)}` }) } } });
  $("marks-traffic").innerHTML = mk.html;
  const mval = x => { const s = segSum(segData, monthDates(x).filter(d => d <= P.last_final)); return seg === "impr" ? s.impr : s.clicks; };
  const lfm = P.last_final.slice(0, 7);
  chart("c-months", { type: "bar", data: { labels: months, datasets: [
      { label: "Un an plus tôt", data: months.map(x => mval(shiftMonth(x, -12))), backgroundColor: C["bar-soft"], borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "bottom", maxBarThickness: 18, categoryPercentage: 0.7, barPercentage: 0.9 },
      { label: "Mois", data: months.map(mval), backgroundColor: months.map(x => x === lfm ? C.bar + "88" : C.bar), borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "bottom", maxBarThickness: 18, categoryPercentage: 0.7, barPercentage: 0.9 }] },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: linScale(), x: { grid: { display: false }, border: { color: C.axis }, ticks: { color: C.text, callback: (v, i) => fmtMonthS(months[i]) } } },
      plugins: { legend: { display: false }, tooltip: tooltip({ title: c => fmtMonth(months[c[0].dataIndex]) + (months[c[0].dataIndex] === lfm ? " (mois en cours)" : ""),
        label: c => c.datasetIndex === 1 ? ` ${fmt(c.parsed.y)}${c.chart.data.datasets[0].data[c.dataIndex] ? ` (${pct(c.parsed.y, c.chart.data.datasets[0].data[c.dataIndex]) > 0 ? "+" : ""}${fmt(pct(c.parsed.y, c.chart.data.datasets[0].data[c.dataIndex]))} % sur un an)` : ""}` : ` Un an plus tôt : ${fmt(c.parsed.y)}` }) } } });
}

// ---------------------------------------------------------------- Par dossier

function secSum(s, dates) {
  let c = 0, i = 0, pw = 0;
  dates.forEach(d => { const x = s.map.get(d); if (x) { c += x[2]; i += x[3]; pw += x[1] * x[3]; } });
  return { clicks: c, impr: i, ctr: i ? c / i * 100 : null, pos: i ? pw / i : null };
}

async function renderFolders() {
  const P = app.P, site = P.name, market = P.market;
  $("folders").innerHTML = skeleton();
  const D = await sectionsData();
  if (!app.P || app.P.name !== site || app.P.market !== market || app.route.view !== "trafic" || ui.trafMode !== "dossier") return;
  if (!D) { $("folders").innerHTML = `<div class="card">${empty("Dossiers en préparation", "Les dossiers de ce projet arrivent à la prochaine synchro.", ICON.folder)}</div>`; return; }
  const G = D.groupings.find(g => g.id === ui.secGroup) || D.groupings[0];
  const R = ranges(), ref = ui.secRef || (ui.cmp.mode === "prev" ? "prev" : "n1");
  const rows = G.sections.map(s => {
    const cur = secSum(s, R.sum.dates), cmp = R.sum.cmp ? secSum(s, R.sum.cmp.dates) : null, sm = s.summary || {};
    return { s, cur, cmp, active: sm.pages ? sm.pages.active : null, activeRef: sm.pages && sm.pages[ref] ? sm.pages[ref].active : null };
  });
  const tot = rows.reduce((a, r) => a + r.cur.clicks, 0);
  rows.forEach(r => { r.share = tot ? r.cur.clicks / tot * 100 : null; r.dc = R.sum.cmp ? pct(r.cur.clicks, r.cmp.clicks) : null; });
  const sk = ui.secSort.key, dir = ui.secSort.dir;
  const val = r => ({ label: r.s.label, clicks: r.cur.clicks, dc: r.dc ?? -Infinity, impr: r.cur.impr, ctr: r.cur.ctr ?? -1, pos: r.cur.pos ?? 999, active: r.active ?? -1, share: r.share ?? -1 }[sk]);
  rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; });
  const root = rows.find(r => r.s.key === "racine"), named = rows.filter(r => r.s.key.startsWith("d:")).length;
  const flat = G.id === "dossier" && root && root.share >= 80 && named <= 1;
  const scopeNote = G.id === "langue" ? "Pages regroupées par préfixe de langue"
    : D.market_path ? `Dossiers lus après /${esc(D.market_path)}/` : D.languages && D.languages.length ? `Dossiers lus après le préfixe de langue (${D.languages.length} langues détectées)` : "Dossiers lus à la racine du site";
  const week = s => { const out = []; for (let e = R.dates.length; e > 0; e -= 7) { let c = 0; R.dates.slice(Math.max(0, e - 7), e).forEach(d => { const x = s.map.get(d); if (x) c += x[2]; }); out.push(c); } return out.reverse(); };
  const cl = cmpLabel();
  $("folders").innerHTML = `${D.groupings.length > 1 ? `<div class="view-bar"><div class="seg" id="sec-group" role="group" aria-label="Regroupement">${D.groupings.map(g => `<button type="button" data-g="${g.id}" aria-pressed="${g.id === G.id}" class="${g.id === G.id ? "active" : ""}">${esc(g.label)}</button>`).join("")}</div></div>` : ""}
    ${D.page_totals === "named_only" ? `<div class="note-box mb-3">Dossiers calculés sur les requêtes connues ${info("dossiersConnus")}${P.data_quality && P.data_quality.country_clicks ? ` : ${fmt1(P.data_quality.named_clicks / P.data_quality.country_clicks * 100)} % des clics du pays sur 28 jours, le reste vient de requêtes masquées par Google` : ""}.</div>` : ""}
    ${flat ? `<div class="note-box mb-3">Structure plate : ${fmt1(root.share)} % des clics vont à des pages sans dossier. Le découpage automatique n'apporte pas grand-chose sur ce site.</div>` : ""}
    <div class="card mb-4"><div class="card-head"><h2>${G.id === "langue" ? "Langues" : "Dossiers"}</h2><i class="info" tabindex="0" data-tip="${esc(scopeNote.replace(/<[^>]+>/g, "") + ". " + DEF.dossier)}">i</i></div>
    <div class="table-wrap"><table id="t-sec"><thead><tr>${th(G.id === "langue" ? "Langue" : "Dossier", "label", { cls: "" })}${th("Clics", "clicks")}${R.sum.cmp ? th(cl, "dc") : ""}${th("Part", "share", { defKey: "part" })}${th("Impressions", "impr")}${th("Taux de clic", "ctr", { defKey: "ctr" })}${th("Position moy.", "pos")}${th("Pages actives", "active", { defKey: "pagesActives" })}<th scope="col">Clics par semaine</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click${ui.secOpen === r.s.key ? " selected" : ""}" data-k="${esc(r.s.key)}"><td><b>${esc(r.s.label)}</b></td>
      <td class="num">${fmt(r.cur.clicks)}</td>${R.sum.cmp ? `<td class="num">${r.cmp.clicks ? pctDelta(r.cur.clicks, r.cmp.clicks, { cmp: cl }) : r.cur.clicks ? '<span class="badge info">nouveau</span>' : '<span class="light">-</span>'}</td>` : ""}
      <td class="num">${r.share == null ? "-" : fmt1(r.share) + " %"}</td>
      <td class="num">${fmt(r.cur.impr)}${R.sum.cmp && r.cmp.impr ? `<div class="mt-2">${pctDelta(r.cur.impr, r.cmp.impr, { cmp: cl })}</div>` : ""}</td>
      <td class="num">${r.cur.ctr == null ? "-" : fmt1(r.cur.ctr) + " %"}</td>
      <td class="num">${fmt1(r.cur.pos)}${R.sum.cmp && r.cmp.pos != null && r.cur.pos != null ? `<div class="mt-2">${placesDelta(+(r.cmp.pos - r.cur.pos).toFixed(1), r.cmp.pos, r.cur.pos)}</div>` : ""}</td>
      <td class="num">${r.active == null ? "-" : fmt(r.active)}${r.activeRef != null ? `<div class="mt-2">${countDelta(r.active - r.activeRef)}</div>` : ""}</td>
      <td>${sparkline(week(r.s), C.ink, { w: 80 })}</td></tr>`).join("")}
    </tbody></table></div></div>
    <div id="sec-detail"></div>`;
  $$("#sec-group button").forEach(b => b.onclick = () => { ui.secGroup = b.dataset.g; ui.secOpen = null; renderFolders(); syncUrl(); });
  sortable($("t-sec"), ui.secSort, s => { ui.secSort = s; renderFolders(); }, ["label", "pos"]);
  rowNav($("t-sec"), "tr[data-k]", tr => {
    ui.secOpen = ui.secOpen === tr.dataset.k ? null : tr.dataset.k; renderFolders(); syncUrl();
    if (ui.secOpen) setTimeout(() => $("sec-detail") && $("sec-detail").scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  });
  const open = rows.find(r => r.s.key === ui.secOpen);
  if (open) renderSectionDetail(open, D, R, ref);
}

function renderSectionDetail(row, D, R, ref) {
  const P = app.P;
  const s = row.s, sm = s.summary, cur = row.cur, cmp = row.cmp;
  const w = (D.windows || {})["28"], refW = w && w[ref];
  const metric = ui.secMetric, idx = { clicks: 2, impr: 3, pos: 1 }[metric];
  const cl = cmpLabel();
  const sub = (a, b) => R.sum.cmp ? pctDelta(a, b, { cmp: cl }) : "";
  const nb = ui.secBrand !== "all" && sm && sm.queries_nonbrand;
  const pg = sm && sm.pages, q = sm && (nb ? sm.queries_nonbrand : sm.queries);
  const refLabel = ref === "n1" ? "N-1" : "période précédente";
  const dsp = j => areaSpark(R.sum.dates.map(d => { const x = s.map.get(d); return x ? x[j] : 0; }), C.palette[0]);
  const refText = w && refW ? `28 jours du ${fmtDateY(w.cur[0])} au ${fmtDateY(w.cur[1])}, comparés au ${fmtDateY(refW[0])} au ${fmtDateY(refW[1])}` : "";
  let rx = null; try { rx = s.rx ? new RegExp(s.rx) : null; } catch {}
  const tracked = rx ? P.keywords.filter(k => k.page !== "*" && rx.test(k.page)) : [];
  const list = (title, items, kind, mode, key, extra = "") => {
    const isPage = kind === "page";
    const head = mode === "gone" ? `<th class="num">Clics avant</th><th class="num">Position avant</th>` : mode === "new" ? `<th class="num">Clics</th><th class="num">Impr.</th><th class="num">Position</th>`
      : `<th class="num">Clics</th><th class="num">Écart</th><th class="num">Position</th>`;
    const pgd = page(items || [], key, 10);
    const body = pgd.items.length ? pgd.items.map(r => {
      const first = isPage ? `<td style="max-width:280px">${urlLink(r[0], { max: 40, strip: P.market_path || "" })}</td>` : `<td class="wrap-cell" style="min-width:0">${esc(r[0])}</td>`;
      if (mode === "gone") return `<tr>${first}<td class="num">${fmt(r[4])}</td><td class="num">${fmt1(r[6])}</td></tr>`;
      if (mode === "new") return `<tr>${first}<td class="num">${fmt(r[1])}</td><td class="num">${fmt(r[2])}</td><td class="num">${fmt1(r[3])}</td></tr>`;
      return `<tr>${first}<td class="num">${fmt(r[1])}</td><td class="num">${countDelta(r[1] - r[4], `${fmt(r[4])} → ${fmt(r[1])} clics`)}</td><td class="num">${fmt1(r[3])}${r[6] != null && r[3] != null ? `<div class="mt-2">${placesDelta(+(r[6] - r[3]).toFixed(1), r[6], r[3])}</div>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="4" class="empty-note" style="padding:14px 16px">Rien sur la période.</td></tr>`;
    return `<div class="card"><div class="card-head"><h2>${title}</h2><span class="hint">${extra}</span></div><div class="table-wrap"><table class="sec-list"><thead><tr><th>${isPage ? "Page" : "Mot-clé"}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>${pgd.more}</div>`;
  };
  const distRow = (lbl, a, b, color) => `<div class="row" style="padding:7px 0;border-bottom:1px solid var(--surface-2);font-size:13px"><span class="sw" style="background:${color}"></span>${lbl}<span class="spacer"></span><b>${fmt(a)}</b>${b != null ? countDelta(a - b, `${fmt(b)} sur la période de comparaison`) : ""}</div>`;
  $("sec-detail").innerHTML = viewBar(`<h1>${esc(s.label)}</h1><button class="btn ghost sm" id="sec-close">${ICON.close}Fermer</button>`,
      tracked.length ? `<a class="btn secondary sm" href="${hrefFor(P.name, "mots-cles", { q: s.rx })}">${plural(tracked.length, "mot-clé suivi", "mots-clés suivis")} dans ce dossier</a>` : "")
    + `<div class="kpi-grid">
      ${stat("Clics", fmt(cur.clicks), sub(cur.clicks, cmp && cmp.clicks), "", dsp(2))}
      ${stat("Impressions", fmt(cur.impr), sub(cur.impr, cmp && cmp.impr), "", dsp(3))}
      ${stat("Taux de clic", cur.ctr == null ? "-" : fmt1(cur.ctr) + "<small> %</small>", R.sum.cmp && cmp && cmp.ctr != null && cur.ctr != null ? ptsDelta(cur.ctr - cmp.ctr) : "", "ctr")}
      ${stat("Position moyenne", fmt1(cur.pos), R.sum.cmp && cmp && cmp.pos != null && cur.pos != null ? placesDelta(+(cmp.pos - cur.pos).toFixed(1), cmp.pos, cur.pos) : "")}
      ${stat("Pages actives", pg ? fmt(pg.active) : "-", pg && pg[ref] ? countDelta(pg.active - pg[ref].active, `vs ${refLabel}`) : "", "pagesActives")}
    </div>
    <div class="card mb-4"><div class="card-head"><h2>Par jour</h2>
      <div class="seg" id="sec-metric" role="group" aria-label="Mesure">${[["clicks", "Clics"], ["impr", "Impressions"], ["pos", "Position"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${metric === v}" class="${metric === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
      <div class="card-body"><div class="legend mb-3">${legendShort(R)}</div>
      <div class="chart-box"><canvas id="c-sec"></canvas></div><div id="marks-sec"></div></div></div>
    ${sm && pg && pg[ref] ? `<div class="view-bar"><div class="left"><div class="seg" id="sec-ref" role="group" aria-label="Comparaison des tops"><button type="button" data-r="n1" aria-pressed="${ref === "n1"}" class="${ref === "n1" ? "active" : ""}">vs N-1</button><button type="button" data-r="prev" aria-pressed="${ref === "prev"}" class="${ref === "prev" ? "active" : ""}">vs période précédente</button></div>
        <span class="ref-note">${refText}, recalculés chaque lundi</span></div></div>
      <div class="grid-eq">
        ${list("Pages en hausse", pg[ref].win, "page", "delta", "pw")}
        ${list("Pages en baisse", pg[ref].lose, "page", "delta", "pl")}
        ${list("Pages apparues", pg[ref].new, "page", "new", "pn", `${fmt(pg[ref].n_new)} pages, ${fmt(pg[ref].new_clicks)} clics`)}
        ${list("Pages disparues", pg[ref].gone, "page", "gone", "pg", `${fmt(pg[ref].n_gone)} pages, ${fmt(pg[ref].gone_clicks)} clics avant`)}
      </div>
      ${sm.queries_nonbrand ? `<div class="view-bar"><div class="seg" id="sec-brand" role="group" aria-label="Mots-clés"><button type="button" data-b="nonbrand" aria-pressed="${!!nb}" class="${nb ? "active" : ""}">Mots-clés hors marque</button><button type="button" data-b="all" aria-pressed="${!nb}" class="${nb ? "" : "active"}">Tous les mots-clés</button></div></div>` : ""}
      ${q && q[ref] ? `<div class="grid-eq">
        ${list("Mots-clés en hausse", q[ref].win, "q", "delta", "qw")}
        ${list("Mots-clés en baisse", q[ref].lose, "q", "delta", "ql")}
        ${list("Nouveaux mots-clés", q[ref].new, "q", "new", "qn", `${fmt(q[ref].n_new)} mots-clés, ${fmt(q[ref].new_clicks)} clics`)}
        ${list("Mots-clés perdus", q[ref].gone, "q", "gone", "qg", `${fmt(q[ref].n_gone)} mots-clés, ${fmt(q[ref].gone_clicks)} clics avant`)}
      </div>
      <div class="grid-eq">
        <div class="card"><div class="card-head"><h2>Répartition des mots-clés${nb ? " hors marque" : ""}</h2><span class="hint def" tabindex="0" data-tip="${esc(DEF.repartition)}">${fmt(q.count)} mots-clés, écart vs ${refLabel}</span></div><div class="card-body">
          ${DIST.slice(0, 4).map((b, n) => distRow(b.name, q.dist[n], q[ref].dist[n], C.dist[n])).join("")}</div></div>
        <div class="card"><div class="card-head"><h2>Concentration</h2></div><div class="card-body">
          <div class="row" style="padding:7px 0;border-bottom:1px solid var(--surface-2);font-size:13px">Pages actives sur 28 jours<span class="spacer"></span><b>${fmt(pg.active)}</b></div>
          <div class="row" style="padding:7px 0;font-size:13px">Part des clics faite par les 10 premières pages<span class="spacer"></span><b>${pg.top10_share == null ? "-" : fmt1(pg.top10_share) + " %"}</b></div></div></div>
      </div>` : ""}` : `<div class="card">${empty("Comparaisons en préparation", "Les tops pages et mots-clés de ce dossier arrivent au prochain calcul du lundi.", ICON.folder)}</div>`}`;
  $("sec-close").onclick = () => { ui.secOpen = null; renderFolders(); syncUrl(); };
  $$("#sec-metric button").forEach(b => b.onclick = () => { ui.secMetric = b.dataset.v; renderSectionDetail(row, D, R, ref); });
  $$("#sec-brand button").forEach(b => b.onclick = () => { ui.secBrand = b.dataset.b; store.set("secBrand", ui.secBrand); renderSectionDetail(row, D, R, ref); });
  $$("#sec-ref button").forEach(b => b.onclick = () => { ui.secRef = b.dataset.r; renderFolders(); });
  bindMore($("sec-detail"), () => renderSectionDetail(row, D, R, ref));
  const pts = ds_ => ds_.map(d => s.map.get(d) || null);
  const tb = bucket(pts(R.dates), R.dates);
  const ds = [lineDs(`${fmtDate(R.from)} au ${fmtDate(R.to)}`, tb.pts.map(p => p && p[idx]), C.ink, { fresh: tb.fresh, fill: metric !== "pos" })];
  if (R.cmp) { const tc = bucket(pts(R.cmp.dates), R.cmp.dates); ds.push(lineDs(`${fmtDateY(R.cmp.from)} au ${fmtDateY(R.cmp.to)}`, tb.labels.map((_, n) => tc.pts[n] ? tc.pts[n][idx] : null), C.cmp, { dash: [4, 4], width: 1.5 })); }
  const mk = marksFor(tb.ranges);
  chart("c-sec", { type: "line", data: { labels: tb.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 16 } },
      scales: { y: metric === "pos" ? posScale(ds.flatMap(d => d.data)) : linScale(), x: xScale(tb.labels, tb.weekly) },
      plugins: { legend: { display: false }, marks: { items: mk.items }, freshZone: { fresh: tb.fresh },
        tooltip: tooltip({ title: c => chartLabel(tb.labels[c[0].dataIndex], tb.weekly), label: c => ` ${c.dataset.label} : ${metric === "pos" ? fmt1(c.parsed.y) : fmt(c.parsed.y)}` }) } } });
  $("marks-sec").innerHTML = mk.html;
}

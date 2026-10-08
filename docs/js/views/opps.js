// Opportunités : mots-clés suivis à pousser, requêtes à ajouter au suivi, courbe de taux de clic du client.
import { app, ui } from "@/state.js";
import { DEF } from "@/defs.js";
import { $, $$, esc, fmt, fmt1, fmtDateL, issue, plural } from "@/util.js";
import { ranges, kstats, targetOf } from "@/data.js";
import { chart, linScale, tooltip, C } from "@/charts.js";
import { ICON, tip, info, viewBar, empty, posCell, statusTag, targetLabel, urlLink, page, bindMore, rowNav, sortable, th } from "@/ui.js";
import { openDrawer } from "@/drawer.js";

const FLAGS = { top: ["Parmi les 40 requêtes qui font le plus de clics", ""], striking: ["Position 4 à 20 et au moins 100 impressions : à portée du top 3", "warn"], nouvelle: ["Moins de 10 % de ces impressions sur la période précédente : demande nouvelle", "info"] };
let sugSort = { key: "potential", dir: -1 };

export function renderOpps() {
  const P = app.P, R = ranges(), strip = P.market_path || "";
  const kws = P.keywords.map(k => ({ ...k, st: kstats(k, R) })).filter(k => k.st.potential).sort((a, b) => b.st.potential - a.st.potential);
  const totalGain = kws.reduce((s, k) => s + k.st.potential, 0);
  const sugAll = P.suggestions.filter(s => ui.sug === "all" || s.flags.includes(ui.sug));
  const sv = { query: s => s.query, pos: s => s.pos ?? 999, clicks: s => s.clicks, impr: s => s.impr, potential: s => s.potential ?? -1 }[sugSort.key];
  const sug = sugAll.slice().sort((a, b) => { const x = sv(a), y = sv(b); return (x < y ? -1 : x > y ? 1 : 0) * sugSort.dir; });
  const kp = page(kws, "opk", 15), sp = page(sug, "ops", 25);
  const bulk = () => issue("mot-cle.yml", { projet: P.name, mots_cles: P.suggestions.filter(s => ui.sugSel.has(s.query)).map(s => `${s.query} | ${s.page || ""}`).join("\n"), title: `Mots-clés : ${ui.sugSel.size} suggestions` });
  const counts = { all: P.suggestions.length, top: 0, striking: 0, nouvelle: 0 };
  P.suggestions.forEach(s => s.flags.forEach(f => counts[f] = (counts[f] || 0) + 1));

  $("view").innerHTML = `<div class="section-title first"><h2>Mots-clés suivis à pousser ${info("aGagner")}</h2>${kws.length ? `<span class="badge ok" ${tip("Si chaque page atteint son objectif")}>+${fmt(totalGain)} clics / mois</span>` : ""}</div>
    <div class="card"><div class="table-wrap"><table id="t-push">
      <thead><tr><th>Mot-clé</th><th>Page</th><th class="num">Position</th><th class="num def" data-tip="${esc(DEF.objectif)}">Objectif</th><th class="num def" data-tip="${esc(DEF.demande)}">Impr. / mois</th><th class="num def" data-tip="${esc(DEF.aGagner)}">À gagner / mois</th></tr></thead><tbody>
      ${kp.items.map(k => `<tr class="click" data-i="${k.i}"><td><span class="kw"><span class="k">${esc(k.keyword)}</span>${statusTag(k.status)}</span></td><td style="max-width:260px">${urlLink(k.page, { max: 34, strip })}</td><td class="num">${posCell(k.st)}</td><td class="num">${targetLabel(targetOf(k, k.st.pos))}${k.target ? "" : ' <span class="light">auto</span>'}</td><td class="num">${fmt(k.st.demand)}</td><td class="num"><b>+${fmt(k.st.potential)}</b></td></tr>`).join("")
        || `<tr><td colspan="6">${empty("Pas de potentiel calculable", "Les mots-clés suivis sont déjà à leur objectif, ou la courbe de taux de clic du client n'est pas encore disponible.", ICON.target)}</td></tr>`}
      </tbody></table></div>${kp.more}</div>
    <div class="section-title"><h2>Requêtes à suivre <i class="info" tabindex="0" data-tip="Requêtes hors marque des 28 derniers jours, pas encore suivies.">i</i></h2></div>
    <div class="card">
      <div class="toolbar"><div class="seg" id="sug-f" role="group" aria-label="Filtrer">${[["all", "Toutes"], ["top", "Font déjà des clics"], ["striking", "À portée du top 3"], ["nouvelle", "Nouvelles"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${ui.sug === v}" class="${ui.sug === v ? "active" : ""}">${l} · ${counts[v] || 0}</button>`).join("")}</div>
        <span class="spacer"></span><a class="btn sm ${ui.sugSel.size ? "" : "disabled"}" id="bulk" target="_blank" rel="noopener" href="${ui.sugSel.size ? bulk() : "#"}" aria-disabled="${!ui.sugSel.size}">${ICON.plus}Suivre la sélection (${ui.sugSel.size})</a></div>
      <div class="table-wrap"><table id="t-sug"><thead><tr><th style="width:34px"><input type="checkbox" id="sug-all" aria-label="Tout cocher sur cette page"></th>${th("Requête", "query", { cls: "" })}<th>Page qui ressort</th>${th("Position moy.", "pos")}${th("Clics", "clicks")}${th("Impressions", "impr")}${th("À gagner / mois", "potential", { defKey: "aGagner" })}<th>Pourquoi</th><th><span class="sr-only">Suivre</span></th></tr></thead><tbody>
      ${sp.items.map(s => `<tr><td><input type="checkbox" data-q="${esc(s.query)}" ${ui.sugSel.has(s.query) ? "checked" : ""} aria-label="Sélectionner ${esc(s.query)}"></td><td><b>${esc(s.query)}</b></td><td style="max-width:240px">${urlLink(s.page, { max: 30, strip })}</td><td class="num">${fmt1(s.pos)}</td><td class="num">${fmt(s.clicks)}</td><td class="num">${fmt(s.impr)}</td>
        <td class="num">${s.potential ? "+" + fmt(s.potential) : '<span class="light">-</span>'}</td>
        <td><span class="row" style="gap:4px;flex-wrap:nowrap">${s.flags.map(f => `<span class="badge ${FLAGS[f][1]}" ${tip(FLAGS[f][0])}>${{ top: "Clics", striking: "À portée", nouvelle: "Nouvelle" }[f]}</span>`).join("")}</span></td>
        <td><a class="btn ghost icon sm" target="_blank" rel="noopener" href="${issue("mot-cle.yml", { projet: P.name, mots_cles: `${s.query} | ${s.page || ""}`, title: "Mots-clés : " + s.query })}" aria-label="Suivre ${esc(s.query)}" ${tip("Suivre cette requête (formulaire GitHub)")}>${ICON.plus}</a></td></tr>`).join("")
        || `<tr><td colspan="9">${empty("Aucune suggestion", "Rien de neuf à suivre avec ce filtre.", ICON.search)}</td></tr>`}
      </tbody></table></div>${sp.more}
    </div>
    <details class="fold" id="ctr-fold"><summary>Taux de clic du client par position</summary><div class="card"><div class="card-body"><p class="hint mb-3">Mesuré sur les mots-clés suivis du client, 90 jours. C'est cette courbe qui sert au calcul des clics à gagner.</p><div class="chart-box sm"><canvas id="c-ctr"></canvas></div></div></div></details>`;

  rowNav($("t-push"), "tr[data-i]", tr => openDrawer(+tr.dataset.i));
  $$("#sug-f button").forEach(b => b.onclick = () => { ui.sug = b.dataset.v; ui.more.ops = 25; renderOpps(); });
  const sync = () => { const a = $("bulk"); a.innerHTML = `${ICON.plus}Suivre la sélection (${ui.sugSel.size})`; a.classList.toggle("disabled", !ui.sugSel.size); a.href = ui.sugSel.size ? bulk() : "#"; };
  $$("[data-q]").forEach(cb => cb.onchange = () => { cb.checked ? ui.sugSel.add(cb.dataset.q) : ui.sugSel.delete(cb.dataset.q); sync(); });
  $("sug-all").onchange = e => { $$("[data-q]").forEach(cb => { cb.checked = e.target.checked; e.target.checked ? ui.sugSel.add(cb.dataset.q) : ui.sugSel.delete(cb.dataset.q); }); sync(); };
  $("bulk").onclick = e => { if (!ui.sugSel.size) e.preventDefault(); };
  sortable($("t-sug"), sugSort, s => { sugSort = s; renderOpps(); }, ["query", "pos"]);
  bindMore($("view"), renderOpps);
  $("ctr-fold").addEventListener("toggle", e => {
    if (e.target.open && P.ctr_curve) chart("c-ctr", { type: "bar", data: { labels: P.ctr_curve.map((_, i) => i + 1), datasets: [{ data: P.ctr_curve.map(v => v * 100), backgroundColor: C.palette[0], borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "bottom", maxBarThickness: 28 }] },
      options: { maintainAspectRatio: false, scales: { y: linScale(v => v + " %"), x: { grid: { display: false }, ticks: { color: C.text }, title: { display: true, text: "Position", color: C.text } } },
        plugins: { legend: { display: false }, tooltip: tooltip({ title: c => "Position " + c[0].label, label: c => ` Taux de clic : ${fmt1(c.parsed.y)} %` }) } } });
  });
}

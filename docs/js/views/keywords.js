// Mots-clés : indicateurs, vue d'ensemble repliable, tableau des mots-clés suivis, courbes des lignes cochées, vue par page.
import { app, ui, store, COLS, defaultCols, syncUrl } from "@/state.js";
import { DEF, STATUS, DIST, MIN_IMPR_DAY } from "@/defs.js";
import { $, $$, esc, fmt, fmt1, fmtDate, fmtDateL, fmtDateY, shift, issue, plural, mean, debounce, fold, path, pct } from "@/util.js";
import { ranges, kstats, posAt, visibilityAt, trackedClicks, cmpLabel, periodBase, bucket, targetOf } from "@/data.js";
import { chart, lineDs, posScale, linScale, xScale, tooltip, marksFor, C, PALETTE, MAX_SEL, label as chartLabel } from "@/charts.js";
import { ICON, tip, info, stat, areaSpark, viewBar, btnLink, empty, sparkline, placesDelta, pctDelta, ptsDelta, countDelta, posCell, statusTag, targetLabel,
  urlLink, menuToggle, sortable, th, rowNav, toast } from "@/ui.js";
import { openDrawer } from "@/drawer.js";

// ---------------------------------------------------------------- sélection des courbes (couleur fixe par mot-clé coché, jamais recyclée)
function selection() { const P = app.P; if (!ui.sel[P.name]) ui.sel[P.name] = new Map(); return ui.sel[P.name]; }
export const colorOf = k => { const s = selection(); return s.has(k.i) ? PALETTE()[s.get(k.i)] : C.cmp; };
function toggleSel(i) {
  const sel = selection();
  if (sel.has(i)) sel.delete(i);
  else if (sel.size < MAX_SEL) { const used = new Set(sel.values()); sel.set(i, [...Array(MAX_SEL).keys()].find(s => !used.has(s))); ui.chartOpen = true; store.set("chartOpen", "1"); }
  renderKeywords();
}

function matcher(q) {
  if (!q) return null;
  try { return new RegExp(q, "i"); } catch { const l = fold(q); return { test: s => fold(s).includes(l) }; }
}
const alertSev = () => { const m = new Map(); app.P.alerts.forEach(a => { if (a.i != null && (!m.has(a.i) || a.severity === "critique")) m.set(a.i, a.severity); }); return m; };
function filteredKws(kws) {
  const m = matcher(ui.query), al = alertSev();
  return kws.filter(k => (!m || m.test(k.keyword) || m.test(k.page) || k.variants.some(v => m.test(v)))
    && (!ui.tags.size || k.tags.some(t => ui.tags.has(t)))
    && (!ui.statuses.size || ui.statuses.has(k.status || ""))
    && (!ui.alertsOnly || al.has(k.i)));
}

export function renderKeywords() {
  const P = app.P;
  if (!P) return;
  const R = ranges();
  const all = P.keywords.map(k => ({ ...k, st: kstats(k, R) }));
  const kws = filteredKws(all);
  const mode = ui.kwMode;
  const filtered = kws.length !== all.length;

  // Indicateurs sur l'ensemble filtré
  const now = kws.filter(k => k.st.pos != null);
  const pairs = R.cmp ? kws.map(k => [k.st.pos, (posAt(k.map, R.cmp.to) || [])[1]]).filter(([a, b]) => a != null && b != null) : [];
  const avg = mean(now.map(k => k.st.pos));
  const dAvg = pairs.length ? mean(pairs.map(p => p[1])) - mean(pairs.map(p => p[0])) : null;
  const cmpPos = R.cmp ? kws.map(k => (posAt(k.map, R.cmp.to) || [])[1]).filter(v => v != null) : [];
  const t3 = now.filter(k => k.st.pos <= 3).length, t10 = now.filter(k => k.st.pos <= 10).length;
  const c3 = R.cmp ? cmpPos.filter(v => v <= 3).length : null, c10 = R.cmp ? cmpPos.filter(v => v <= 10).length : null;
  const clicks = trackedClicks(kws, R.sum.dates), cClicks = R.sum.cmp ? trackedClicks(kws, R.sum.cmp.dates) : null;
  const freshClicks = ui.fresh ? trackedClicks(kws, R.sum.freshDates) : 0;
  const vis = visibilityAt(kws, R.to), cVis = R.cmp ? visibilityAt(kws, R.cmp.to) : null;
  const cl = cmpLabel(), cd = R.cmp ? fmtDateY(R.cmp.to) : "";
  const sub = x => R.cmp ? x : "";
  const prov = P.last_date === R.to && P.last_date !== P.last_final;
  const SP = kpiSparks(kws, R);

  $("view").innerHTML = viewBar(`<div class="seg" id="kw-mode" role="group" aria-label="Affichage"><button type="button" data-m="kw" aria-pressed="${mode === "kw"}" class="${mode === "kw" ? "active" : ""}">Par mot-clé</button><button type="button" data-m="page" aria-pressed="${mode === "page"}" class="${mode === "page" ? "active" : ""}">Par page</button></div>
      <i class="info" tabindex="0" data-tip="${esc(`Positions au ${fmtDateL(R.to)}${prov ? " (provisoire)" : ""}${R.cmp ? `, comparées au ${cd}` : ""}.\nClics du ${fmtDate(R.sum.from)} au ${fmtDate(R.sum.to)}, jours définitifs.`)}">i</i>${filtered ? `<span class="badge outline">${kws.length} sur ${all.length}</span>` : ""}`)
    + `<div class="kpi-grid">
      ${stat("Position moyenne", fmt1(avg), sub(placesDelta(dAvg != null ? +dAvg.toFixed(1) : null, pairs.length ? mean(pairs.map(p => p[1])) : null, pairs.length ? mean(pairs.map(p => p[0])) : null, "sur les mots-clés positionnés aux deux dates")), "posMoy", SP.pos)}
      ${stat("Top 3", `${t3}<small> / ${kws.length}</small>`, sub(countDelta(c3 == null ? null : t3 - c3, `${c3} au ${cd}`)), "top", SP.t3)}
      ${stat("Top 10", `${t10}<small> / ${kws.length}</small>`, sub(countDelta(c10 == null ? null : t10 - c10, `${c10} au ${cd}`)), "top", SP.t10)}
      ${stat("Clics", fmt(clicks), (R.sum.cmp ? pctDelta(clicks, cClicks, { cmp: cl }) : ""), "clicsSuivis", SP.clicks, `Du ${fmtDate(R.sum.from)} au ${fmtDate(R.sum.to)}, jours définitifs${freshClicks ? ` (+ ${fmt(freshClicks)} sur les jours provisoires)` : ""}`)}
      ${stat("Visibilité", vis == null ? "-" : fmt1(vis) + "<small> %</small>", sub(ptsDelta(vis != null && cVis != null ? vis - cVis : null, cVis != null ? `${fmt1(cVis)} % au ${cd}` : "")), "visibilite", SP.vis)}
    </div>${mode === "kw" ? `<details class="card card-fold" id="ov" ${ui.ovOpen ? "open" : ""}><summary><h2>Vue d'ensemble</h2><span class="hint" id="ov-hint"></span></summary><div class="card-body" id="ov-body"></div></details>` : ""}<div id="kw-body"></div>`;
  $$("#kw-mode button").forEach(b => b.onclick = () => { ui.kwMode = b.dataset.m; renderKeywords(); });
  if (mode === "page") { renderByPage(); syncUrl(); return; }
  renderByKeyword(all, kws, R);
  $("ov").addEventListener("toggle", e => { ui.ovOpen = e.target.open; store.set("ovOpen2", ui.ovOpen ? "1" : "0"); if (ui.ovOpen) renderOverview(kws, R); });
  renderOverview(kws, R);
  syncUrl();
}

// Courbes des cartes d'indicateurs : jour par jour (semaine par semaine au-delà de 3 mois), clics sur jours définitifs
function kpiSparks(kws, R) {
  const P = app.P, step = R.dates.length > 92 ? 7 : 1, n = R.dates.length;
  const ds = R.dates.filter((_, i) => (n - 1 - i) % step === 0);
  const posD = ds.map(d => { const v = kws.map(k => posAt(k.map, d)).filter(Boolean).map(x => x[1]); return v.length ? mean(v) : null; });
  const cnt = lim => ds.map(d => kws.filter(k => { const x = posAt(k.map, d); return x && x[1] <= lim; }).length);
  const days = R.dates.filter(d => d <= P.last_final);
  const perDay = days.map(d => kws.reduce((s, k) => s + ((k.map.get(d) || [])[2] || 0), 0));
  const clicks = step === 1 ? perDay : perDay.reduce((o, v, i) => { const w = Math.floor((perDay.length - 1 - i) / 7); o[w] = (o[w] || 0) + v; return o; }, []).reverse();
  const c = C.palette[0];
  return { pos: areaSpark(posD, c, { invert: true }), t3: areaSpark(cnt(3), c), t10: areaSpark(cnt(10), c), clicks: areaSpark(clicks, c), vis: areaSpark(ds.map(d => visibilityAt(kws, d)), c) };
}

// ---------------------------------------------------------------- tableau
function renderByKeyword(all, kws, R) {
  const P = app.P;
  const views = store.json("views:" + P.name, []);
  const tagCount = {}; P.keywords.forEach(k => k.tags.forEach(t => tagCount[t] = (tagCount[t] || 0) + 1));
  const tags = Object.keys(tagCount).sort();
  const statuses = Object.keys(STATUS).filter(s => P.keywords.some(k => k.status === s));
  const nAlert = alertSev().size;
  const sel = selection();
  const anyFilter = ui.tags.size || ui.statuses.size || ui.query || ui.alertsOnly;
  const nFilters = ui.tags.size + ui.statuses.size + (ui.alertsOnly ? 1 : 0);
  const showChips = ui.chipsOpen || nFilters > 0;
  $("kw-body").innerHTML = `
    <div class="card">
      <div class="toolbar">
        <label class="search">${ICON.search}<input id="q" placeholder="Filtrer : mot-clé ou URL (regex)" value="${esc(ui.query)}" aria-label="Filtrer les mots-clés"><span class="kbd" ${tip("Raccourci : /")}>/</span></label>
        <select id="views" class="ctl sm" aria-label="Vues enregistrées" ${tip("Vues enregistrées : filtres, colonnes et tri (dans ce navigateur)")}><option value="">Vue par défaut</option>${views.map((v, n) => `<option value="${n}" ${ui.view === String(n) ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
          <option value="__save">Enregistrer la vue actuelle…</option>${ui.view !== "" && views[+ui.view] ? '<option value="__del">Supprimer cette vue</option>' : ""}</select>
        ${tags.length || statuses.length || nAlert ? `<button class="btn ${nFilters ? "secondary" : "ghost"} sm" id="f-toggle" aria-expanded="${showChips}">Filtres${nFilters ? ` <span class="count new">${nFilters}</span>` : ""}</button>` : ""}
        <span class="spacer"></span>
        <div class="menu-wrap"><button class="btn ghost sm" id="cols-btn">Colonnes</button>
          <div class="menu" role="menu">${COLS.map(c => `<label><input type="checkbox" data-col="${c.id}" ${ui.cols.has(c.id) ? "checked" : ""}> ${c.id === "dcmp" ? "Comparaison (" + (cmpLabel() || "aucune") + ")" : c.label}${(c.id === "status" || c.id === "target") && !P.keywords.some(k => k[c.id]) ? ' <span class="light">(aucune donnée)</span>' : ""}</label>`).join("")}
            <hr><button class="mi" id="cols-reset">Colonnes par défaut</button></div></div>
        <button class="btn ghost icon sm" id="csv" ${tip("Exporter les lignes filtrées en CSV")} aria-label="Exporter en CSV">${ICON.download}</button>
      </div>
      ${(tags.length || statuses.length || nAlert) && showChips ? `<div class="filterbar chips" id="chips">
        ${nAlert ? `<button class="chip ${ui.alertsOnly ? "on" : ""}" aria-pressed="${ui.alertsOnly}" data-al="1"><span class="sev-dot attention"></span>Avec alerte <span class="n">${nAlert}</span></button>` : ""}
        ${statuses.length ? `<span class="chip-l">Statut</span>${statuses.map(s => `<button class="chip ${ui.statuses.has(s) ? "on" : ""}" aria-pressed="${ui.statuses.has(s)}" data-s="${esc(s)}">${STATUS[s]}</button>`).join("")}` : ""}
        ${tags.length ? `<span class="chip-l">Tags</span>${tags.map(t => `<button class="chip ${ui.tags.has(t) ? "on" : ""}" aria-pressed="${ui.tags.has(t)}" data-t="${esc(t)}">${esc(t)} <span class="n">${tagCount[t]}</span></button>`).join("")}` : ""}
        ${anyFilter ? '<button class="link-btn" id="clear">Effacer les filtres</button>' : ""}</div>` : ""}
      <div class="table-wrap"><table id="t-kw"><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
      <span id="t-count" hidden></span>
    </div>
    <details class="card card-fold" id="chart-fold" style="margin-top:14px" ${ui.chartOpen ? "open" : ""}>
      <summary><h2>Courbes des mots-clés cochés</h2><span class="hint">${sel.size ? plural(sel.size, "mot-clé", "mots-clés") + ` sur ${MAX_SEL} maximum` : "coche la case de gauche des lignes à comparer"}</span></summary>
      <div class="card-body">
        <div class="row mb-3"><div class="seg" id="metric" role="group" aria-label="Mesure">${[["position", "Position"], ["clicks", "Clics"], ["impressions", "Impressions"]].map(([m, l]) => `<button type="button" data-m="${m}" aria-pressed="${ui.metric === m}" class="${ui.metric === m ? "active" : ""}">${l}</button>`).join("")}</div>
          <div class="legend" id="legend"></div></div>
        <div class="chart-box"><canvas id="c-main"></canvas></div><div id="marks-main"></div></div>
    </details>`;

  const quick = debounce(() => { renderKwTable(all, R); syncUrl(); }, 120);
  $("q").oninput = e => { ui.query = e.target.value.trim(); ui.view = ""; quick(); };
  $("q").onchange = () => renderKeywords();
  $("q").onkeydown = e => { if (e.key === "Escape" && e.target.value) { e.stopPropagation(); ui.query = ""; renderKeywords(); } };
  $("csv").onclick = () => exportCsv(filteredKws(all), R);
  if ($("f-toggle")) $("f-toggle").onclick = () => { ui.chipsOpen = !showChips; if (!ui.chipsOpen) { ui.tags.clear(); ui.statuses.clear(); ui.alertsOnly = false; } renderKeywords(); };
  menuToggle("cols-btn");
  $$("[data-col]").forEach(cb => cb.onchange = () => { cb.checked ? ui.cols.add(cb.dataset.col) : ui.cols.delete(cb.dataset.col); store.put("cols3", [...ui.cols]); renderKwTable(all, R); });
  $("cols-reset").onclick = () => { ui.cols = new Set(defaultCols()); store.put("cols3", [...ui.cols]); renderKeywords(); };
  $("views").onchange = e => {
    if (e.target.value === "__save") return $("v-save").click();
    if (e.target.value === "__del") return $("v-del").click();
    ui.view = e.target.value;
    const v = views[+ui.view];
    if (ui.view === "" || !v) { ui.query = ""; ui.tags.clear(); ui.statuses.clear(); ui.alertsOnly = false; }
    else { ui.query = v.q || ""; ui.tags = new Set(v.tags || []); ui.statuses = new Set(v.statuses || []); ui.alertsOnly = !!v.alerts; if (v.cols) { ui.cols = new Set(v.cols); } if (v.sort) ui.sort = v.sort; }
    renderKeywords();
  };
  const vs = document.createElement("button"), vd = document.createElement("button");
  vs.id = "v-save"; vd.id = "v-del"; vs.hidden = vd.hidden = true; $("kw-body").append(vs, vd);
  $("v-save").onclick = () => {
    const name = prompt("Nom de la vue (ex. Outerwear à travailler)");
    if (!name) return renderKeywords();
    views.push({ name, q: ui.query, tags: [...ui.tags], statuses: [...ui.statuses], alerts: ui.alertsOnly, cols: [...ui.cols], sort: ui.sort });
    store.put("views:" + P.name, views); ui.view = String(views.length - 1); renderKeywords(); toast("Vue enregistrée");
  };
  if ($("v-del")) $("v-del").onclick = () => { views.splice(+ui.view, 1); store.put("views:" + P.name, views); ui.view = ""; renderKeywords(); };
  $$("#chips [data-t]").forEach(b => b.onclick = () => { const t = b.dataset.t; ui.tags.has(t) ? ui.tags.delete(t) : ui.tags.add(t); ui.view = ""; renderKeywords(); });
  $$("#chips [data-s]").forEach(b => b.onclick = () => { const s = b.dataset.s; ui.statuses.has(s) ? ui.statuses.delete(s) : ui.statuses.add(s); ui.view = ""; renderKeywords(); });
  $$("#chips [data-al]").forEach(b => b.onclick = () => { ui.alertsOnly = !ui.alertsOnly; ui.view = ""; renderKeywords(); });
  if ($("clear")) $("clear").onclick = () => { ui.tags.clear(); ui.statuses.clear(); ui.query = ""; ui.alertsOnly = false; ui.view = ""; renderKeywords(); };
  $("chart-fold").addEventListener("toggle", e => { ui.chartOpen = e.target.open; store.set("chartOpen", ui.chartOpen ? "1" : "0"); if (ui.chartOpen) drawMainChart(R); });
  $$("#metric button").forEach(b => b.onclick = () => { ui.metric = b.dataset.m; renderKeywords(); });
  renderKwTable(all, R);
  if (ui.chartOpen) drawMainChart(R);
}

function renderKwTable(all, R) {
  const P = app.P;
  const empty_ = { status: !P.keywords.some(k => k.status), target: !P.keywords.some(k => k.target) };
  const Cn = id => ui.cols.has(id) && !empty_[id];
  const cl = cmpLabel();
  const strip = P.market_path || "";
  const al = alertSev();
  $("thead").innerHTML = `<tr><th style="width:34px" scope="col"><span class="sr-only">Courbe</span></th>${th("Mot-clé", "keyword", { cls: "kw-cell" })}
    ${Cn("page") ? th("Page suivie", "page", { cls: "col-page" }) : ""}
    ${th("Position", "pos", { defKey: "position", sub: fmtDate(R.to) })}
    ${Cn("dcmp") && R.cmp ? th(cl, "dcmp", { defKey: "dcmp", sub: "vs " + fmtDate(R.cmp.to) }) : ""}${Cn("d7") ? th("7 j", "d7", { defKey: "d7", sub: "vs " + fmtDate(shift(R.to, -7)) }) : ""}${Cn("d28") ? th("28 j", "d28", { defKey: "d28", sub: "vs " + fmtDate(shift(R.to, -28)) }) : ""}
    ${Cn("best") ? th("Meilleure", "best", { defKey: "best" }) : ""}${Cn("demand") ? th("Impr. / mois", "demand", { defKey: "demande" }) : ""}
    ${Cn("clicks") ? th("Clics", "clicks", { defKey: "clicsSuivis" }) : ""}${Cn("impr") ? th("Impressions", "impr") : ""}${Cn("ctr") ? th("Taux de clic", "ctr", { defKey: "ctr" }) : ""}
    ${Cn("potential") ? th("À gagner", "potential", { defKey: "aGagner", sub: "clics / mois" }) : ""}
    ${Cn("status") ? th("Statut", "status", { cls: "" }) : ""}${Cn("target") ? th("Objectif", "target", { defKey: "objectif" }) : ""}
    ${Cn("trend") ? `<th scope="col" class="trend-cell" data-tip="Position jour par jour sur la période (haut = mieux)">Tendance</th>` : ""}</tr>`;
  const sv = { keyword: k => k.keyword, page: k => k.page, pos: k => k.st.pos ?? 999, dcmp: k => k.st.dcmp ?? -999, d7: k => k.st.d7 ?? -999, d28: k => k.st.d28 ?? -999,
    best: k => k.st.best ?? 999, demand: k => k.st.demand, clicks: k => k.st.clicks, impr: k => k.st.impr, ctr: k => k.st.ctr ?? -1,
    potential: k => k.st.potential ?? -1, status: k => Object.keys(STATUS).indexOf(k.status ?? "") + 1 || 9, target: k => k.target ?? 999 }[ui.sort.key] || (k => k.st.demand);
  const sorted = filteredKws(all).sort((a, b) => { const x = sv(a), y = sv(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.sort.dir; });
  // Les mots-clés sans aucune position sur la période vont en bas
  const withPos = sorted.filter(k => k.st.pos != null), noPos = sorted.filter(k => k.st.pos == null);
  ui.order = withPos.concat(noPos).map(k => k.i);
  const sel = selection();
  const span = 20;
  const row = k => {
    const st = k.st, on = sel.has(k.i), col = on ? PALETTE()[sel.get(k.i)] : null;
    const pick = `<button class="pick ${on ? "on" : ""}" data-pick="${k.i}" ${!on && sel.size >= MAX_SEL ? "disabled" : ""} style="${on ? `background:${col}` : ""}" aria-pressed="${on}" aria-label="Courbe de ${esc(k.keyword)}" ${tip(on ? "Retirer des courbes" : "Ajouter aux courbes (8 au maximum)")}></button>`;
    const reached = k.target && st.pos != null && st.pos <= k.target;
    const altTag = Cn("url") && st.alt ? `<span class="alt-flag"><span class="badge warn" ${tip(`Le ${fmtDate(R.to)}, ${path(st.alt[0])} a reçu ${fmt(st.alt[1])} impressions (position ${fmt1(st.alt[2])}) contre ${fmt(st.alt[3])} pour la page suivie`)}>Autre page : ${esc(strip ? path(st.alt[0]).replace(strip, "/") : path(st.alt[0]))}</span></span>` : "";
    const sev = al.get(k.i);
    const tg = Cn("tags") && k.tags.length ? `<span class="kw-tags">${k.tags.slice(0, 2).map(t => `<span class="tag">${esc(t)}</span>`).join("")}${k.tags.length > 2 ? `<span class="tag" ${tip(k.tags.join(", "))}>+${k.tags.length - 2}</span>` : ""}</span>` : "";
    return `<tr class="click ${k.i === ui.openKw ? "selected" : ""}" data-i="${k.i}">
      <td>${pick}</td>
      <td class="kw-cell"><span class="kw"><span class="k" ${tip([k.keyword, Cn("page") ? "" : path(k.page), k.variants.length ? "Variantes : " + k.variants.join(", ") : "", st.alt && !Cn("page") ? `Le ${fmtDate(R.to)}, autre page en tête : ${path(st.alt[0])}` : ""].filter(Boolean).join("\n"))}>${esc(k.keyword)}</span>${st.alt && !Cn("url") ? `<span class="alt-ico" ${tip(`Le ${fmtDate(R.to)}, autre page en tête : ${path(st.alt[0])}`)}>${ICON.swap}</span>` : ""}${sev ? `<span class="sev-dot ${sev}" role="img" aria-label="Alerte" ${tip(sev === "critique" ? "Alerte urgente ouverte" : "Alerte à surveiller ouverte")}></span>` : ""}${tg}</span></td>
      ${Cn("page") ? `<td class="page-cell col-page">${urlLink(k.page, { max: 34, strip })}${altTag}</td>` : ""}
      <td class="num">${posCell(st)}</td>
      ${Cn("dcmp") && R.cmp ? `<td class="num">${placesDelta(st.dcmp, st.pc, st.pos, `du ${fmtDate(R.cmp.to)} au ${fmtDate(R.to)}`)}</td>` : ""}
      ${Cn("d7") ? `<td class="num">${placesDelta(st.d7, st.p7, st.pos, `du ${fmtDate(shift(R.to, -7))} au ${fmtDate(R.to)}`)}</td>` : ""}${Cn("d28") ? `<td class="num">${placesDelta(st.d28, st.p28, st.pos, `du ${fmtDate(shift(R.to, -28))} au ${fmtDate(R.to)}`)}</td>` : ""}
      ${Cn("best") ? `<td class="num">${fmt1(st.best)}</td>` : ""}${Cn("demand") ? `<td class="num">${fmt(st.demand)}</td>` : ""}
      ${Cn("clicks") ? `<td class="num">${fmt(st.clicks)}</td>` : ""}${Cn("impr") ? `<td class="num">${fmt(st.impr)}</td>` : ""}${Cn("ctr") ? `<td class="num">${st.ctr == null ? "-" : fmt1(st.ctr) + " %"}</td>` : ""}
      ${Cn("potential") ? `<td class="num">${st.potential ? "+" + fmt(st.potential) : '<span class="light">-</span>'}</td>` : ""}
      ${Cn("status") ? `<td>${statusTag(k.status) || '<span class="light">-</span>'}</td>` : ""}
      ${Cn("target") ? `<td class="num">${k.target ? `<span class="${reached ? "badge ok" : "muted"}" ${tip(reached ? "Objectif atteint" : "")}>${targetLabel(k.target)}</span>` : '<span class="light">-</span>'}</td>` : ""}
      ${Cn("trend") ? `<td class="trend-cell">${sparkline(st.pts.map(p => p ? p[1] : null), on ? col : C.site, { invert: true })}</td>` : ""}</tr>`;
  };
  $("tbody").innerHTML = withPos.map(row).join("")
    + (noPos.length ? `<tr class="group-row"><td colspan="${span}">Sans impression sur la période · ${noPos.length}</td></tr>` + noPos.map(row).join("") : "")
    || `<tr><td colspan="${span}">${empty("Aucun mot-clé ne correspond", "Change le filtre ou efface-le pour revoir tous les mots-clés.", ICON.search, '<button class="btn secondary sm" id="clear2">Effacer les filtres</button>')}</td></tr>`;
  if ($("clear2")) $("clear2").onclick = () => { ui.tags.clear(); ui.statuses.clear(); ui.query = ""; ui.alertsOnly = false; renderKeywords(); };
  rowNav($("tbody"), "tr[data-i]", tr => openDrawer(+tr.dataset.i));
  $$("#tbody [data-pick]").forEach(b => b.onclick = e => { e.stopPropagation(); toggleSel(+b.dataset.pick); });
  const wrap = $("t-kw").closest(".table-wrap");
  wrap.classList.remove("sticky");
  requestAnimationFrame(() => wrap.classList.toggle("sticky", wrap.scrollWidth <= wrap.clientWidth + 1 && innerWidth > 860));
  $("t-count").textContent = `${plural(sorted.length, "mot-clé", "mots-clés")} sur ${all.length}`;
  sortable($("t-kw"), ui.sort, s => { ui.sort = s; store.put("sort", s); renderKwTable(all, R); }, ["keyword", "page", "pos", "best", "target", "status"]);
}

function drawMainChart(R) {
  const P = app.P, dates = R.dates, sel = selection();
  const on = P.keywords.filter(k => sel.has(k.i)).sort((a, b) => sel.get(a.i) - sel.get(b.i));
  $("legend").innerHTML = on.length ? on.map(k => `<button class="lg" data-i="${k.i}" ${tip("Retirer des courbes")}><span class="sw round" style="background:${colorOf(k)}"></span>${esc(k.keyword)}<span class="x">×</span></button>`).join("")
    : '<span class="hint">Coche la case de gauche des lignes du tableau pour tracer leurs courbes, 8 au maximum.</span>';
  $$("#legend button").forEach(b => b.onclick = () => toggleSel(+b.dataset.i));
  const val = p => p ? (ui.metric === "position" ? p[1] : ui.metric === "clicks" ? p[2] : p[3]) : null;
  const series = on.map(k => ({ k, b: bucket(dates.map(d => k.map.get(d) || null), dates) }));
  const base = series[0] ? series[0].b : bucket(dates.map(() => null), dates);
  const mk = marksFor(base.ranges);
  const ds = series.map(({ k, b }) => lineDs(k.keyword, b.pts.map(val), colorOf(k), { fresh: b.fresh }));
  chart("c-main", { type: "line", data: { labels: base.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 16 } },
      scales: { y: ui.metric === "position" ? posScale(ds.flatMap(d => d.data)) : linScale(), x: xScale(base.labels, base.weekly) },
      plugins: { legend: { display: false }, marks: { items: mk.items }, freshZone: { fresh: base.fresh },
        tooltip: tooltip({ title: c => chartLabel(base.labels[c[0].dataIndex], base.weekly), label: c => ` ${c.dataset.label} : ${ui.metric === "position" ? fmt1(c.parsed.y) : fmt(c.parsed.y)}` }) } } });
  $("marks-main").innerHTML = mk.html;
}

// ---------------------------------------------------------------- vue d'ensemble
function ovRows(kws, refD) {
  return kws.map(k => { const a = posAt(k.map, refD), b = k.st.cur; return { k, p0: a && a[1], p1: b && b[1], d: a && b ? +(a[1] - b[1]).toFixed(1) : null }; });
}
function globalSeries(kws, dates, metric) {
  const P = app.P;
  const day = d => {
    if (metric === "pos") { const v = kws.map(k => posAt(k.map, d)).filter(Boolean).map(x => x[1]); return v.length ? mean(v) : null; }
    if (metric === "vis") return visibilityAt(kws, d);
    let c = 0, any = false; kws.forEach(k => { const x = k.map.get(d); if (x) { c += x[2]; any = true; } }); return any ? c : null;
  };
  const vals = dates.map(day);
  if (dates.length <= 92) return { labels: dates, ranges: dates.map(d => [d, d]), vals, fresh: dates.map(d => d > P.last_final), weekly: false };
  const labels = [], rgs = [], out = [], fresh = [];
  for (let end = dates.length; end > 0; end -= 7) {
    const a = Math.max(0, end - 7), chunk = vals.slice(a, end).filter(v => v != null);
    labels.unshift(dates[a]); rgs.unshift([dates[a], dates[end - 1]]); fresh.unshift(dates[end - 1] > P.last_final);
    out.unshift(chunk.length ? (metric === "clicks" ? chunk.reduce((s, v) => s + v, 0) : mean(chunk)) : null);
  }
  return { labels, ranges: rgs, vals: out, fresh, weekly: true };
}
function ovData(kws, R) {
  const refD = periodBase(R);
  const rows = ovRows(kws, refD), valid = rows.filter(r => r.d != null);
  const ups = valid.filter(r => r.d >= 0.5).sort((a, b) => b.d - a.d), downs = valid.filter(r => r.d <= -0.5).sort((a, b) => a.d - b.d);
  const cross = lim => ({ in: rows.filter(r => r.p1 != null && r.p1 <= lim && (r.p0 == null || r.p0 > lim)), out: rows.filter(r => r.p0 != null && r.p0 <= lim && (r.p1 == null || r.p1 > lim)) });
  return { refD, rows, ups, downs, c3: cross(3), c10: cross(10) };
}

function renderOverview(kws, R) {
  if (!$("ov-hint")) return;
  const { refD, rows, ups, downs, c3, c10 } = ovData(kws, R);
  const span = `${fmtDate(refD)} → ${fmtDate(R.to)}`;
  $("ov-hint").innerHTML = `<span class="ov-sum" ${tip(`Sur la période, ${span} : ${ups.length} mots-clés gagnent au moins une demi-place, ${downs.length} en perdent`)}>${ups.length || downs.length ? `<b class="up">▲ ${ups.length}</b> <b class="down">▼ ${downs.length}</b>` : '<span class="light">aucun mouvement</span>'}</span>`
    + `<span class="ov-sum" ${tip(`Sur la période : ${c3.in.length} entrent dans le top 3, ${c3.out.length} en sortent`)}>Top 3 ${c3.in.length || c3.out.length ? `<b class="up">+${c3.in.length}</b> <b class="down">−${c3.out.length}</b>` : '<span class="light">stable</span>'}</span>`;
  if (!ui.ovOpen || !$("ov-body")) return;
  const moveList = (list, emptyTxt) => list.length ? `<div class="ov-list">${list.slice(0, 5).map(r => `<div class="ov-li" data-i="${r.k.i}" tabindex="0" role="button" ${tip(`${r.k.keyword} · ${fmt(r.k.st.demand)} impressions sur 28 jours`)}><span class="k">${esc(r.k.keyword)}</span><span class="p">${fmt1(r.p0)} → <b>${fmt1(r.p1)}</b></span>${placesDelta(r.d)}</div>`).join("")}</div>${list.length > 5 ? `<div class="ov-more">et ${list.length - 5} autre${list.length > 6 ? "s" : ""} dans le tableau</div>` : ""}` : `<p class="empty-note">${emptyTxt}</p>`;
  const chips = (list, cls) => list.length ? list.map(r => `<button class="kchip ${cls}" data-i="${r.k.i}" ${tip(`${r.k.keyword} : ${r.p0 == null ? "absent" : fmt1(r.p0)} → ${r.p1 == null ? "absent" : fmt1(r.p1)}`)}>${esc(r.k.keyword)}</button>`).join("") : '<span class="light">aucun</span>';
  const tags = [...new Set(kws.flatMap(k => k.tags))];
  const byTag = tags.map(tg => {
    const rs = rows.filter(r => r.k.tags.includes(tg)), ks = rs.map(r => r.k);
    const now = rs.filter(r => r.p1 != null).map(r => r.p1), pr = rs.filter(r => r.d != null);
    const clicks = trackedClicks(ks, R.sum.dates), cc = R.sum.cmp ? trackedClicks(ks, R.sum.cmp.dates) : null;
    return { tg, n: ks.length, pos: mean(now), d: pr.length ? mean(pr.map(r => r.p0)) - mean(pr.map(r => r.p1)) : null, top3: now.filter(v => v <= 3).length, clicks, cc };
  }).sort((a, b) => b.clicks - a.clicks);
  const cs = [["pos", "Position moyenne"], ["vis", "Visibilité"], ["clicks", "Clics"]];
  $("ov-body").innerHTML = `
    <div class="ov-charts">
      <div class="ov-card"><div class="ov-head"><div class="seg" id="ov-chart" role="group" aria-label="Courbe">${cs.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${ui.ovChart === v}" class="${ui.ovChart === v ? "active" : ""}">${l}</button>`).join("")}</div><div class="legend" id="ov-legend"></div></div>
        <div class="chart-box"><canvas id="c-ov"></canvas></div><div id="ov-marks"></div></div>
      <div class="ov-card"><div class="ov-head"><h3>Répartition des positions</h3><div class="legend" id="ov-legend-dist"></div></div><div class="chart-box"><canvas id="c-ov-dist"></canvas></div></div>
    </div>
    <div class="grid-3">
      <div class="ov-card"><h3>Hausses <span class="count ok">${ups.length}</span></h3>${moveList(ups, "Aucune hausse d'au moins une demi-place.")}</div>
      <div class="ov-card"><h3>Baisses <span class="count ko">${downs.length}</span></h3>${moveList(downs, "Aucune baisse d'au moins une demi-place.")}</div>
      <div class="ov-card"><h3>Top 3 et top 10</h3>
        <div class="io"><div class="l">Entrent top 3</div><div>${chips(c3.in, "up")}</div></div>
        <div class="io"><div class="l">Sortent du top 3</div><div>${chips(c3.out, "down")}</div></div>
        <div class="io"><div class="l">Entrent top 10</div><div>${chips(c10.in, "up")}</div></div>
        <div class="io"><div class="l">Sortent du top 10</div><div>${chips(c10.out, "down")}</div></div></div>
    </div>
    ${byTag.length ? `<div class="ov-card mt-3"><h3>Par tag <span class="hint">cliquer filtre le tableau</span></h3><div class="table-wrap"><table class="mini" id="t-tags"><thead><tr><th>Tag</th><th class="num def" data-tip="${esc(DEF.posMoy)}">Position moy.</th><th class="num" data-tip="Sur la période, ${span}">Évolution</th><th class="num">Top 3</th><th class="num">Clics</th>${R.sum.cmp ? `<th class="num">${cmpLabel()}</th>` : ""}</tr></thead><tbody>
      ${byTag.map(x => `<tr class="click" data-tag="${esc(x.tg)}"><td><span class="tag">${esc(x.tg)}</span> <span class="light">${x.n}</span></td><td class="num">${fmt1(x.pos)}</td><td class="num">${placesDelta(x.d != null ? +x.d.toFixed(1) : null)}</td><td class="num">${x.top3} / ${x.n}</td><td class="num">${fmt(x.clicks)}</td>${R.sum.cmp ? `<td class="num">${pctDelta(x.clicks, x.cc, { cmp: cmpLabel() })}</td>` : ""}</tr>`).join("")}
      </tbody></table></div></div>` : ""}`;
  $$("#ov-body [data-i]").forEach(el => { el.onclick = () => openDrawer(+el.dataset.i); el.onkeydown = e => { if (e.key === "Enter") openDrawer(+el.dataset.i); }; });
  rowNav($("ov-body"), "tr[data-tag]", tr => { ui.tags = new Set([tr.dataset.tag]); ui.view = ""; renderKeywords(); $("t-kw").scrollIntoView({ behavior: "smooth", block: "start" }); });
  $$("#ov-chart button").forEach(b => b.onclick = () => { ui.ovChart = b.dataset.v; store.set("ovChart", ui.ovChart); renderOverview(kws, R); });
  drawOverviewChart(kws, R);
  drawOverviewDist(kws, R);
}

function drawOverviewDist(kws, R) {
  const per = kws.map(k => bucket(R.dates.map(d => k.map.get(d) || null), R.dates));
  const base = per[0] || bucket(R.dates.map(() => null), R.dates);
  const ds = DIST.map((b, n) => ({ label: b.name, data: base.labels.map((_, i) => per.filter(x => b.test(x.pts[i] ? x.pts[i][1] : null)).length),
    backgroundColor: C.dist[n], borderColor: C.surface, borderWidth: { top: 1 }, borderRadius: 2, maxBarThickness: 22, stack: "s" }));
  $("ov-legend-dist").innerHTML = DIST.map((b, n) => `<span class="lg"><span class="sw" style="background:${C.dist[n]}"></span>${b.name}</span>`).join("");
  chart("c-ov-dist", { type: "bar", data: { labels: base.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 16 } },
      scales: { y: { ...linScale(), stacked: true, ticks: { precision: 0, color: C.text } }, x: { ...xScale(base.labels, base.weekly), stacked: true } },
      plugins: { legend: { display: false }, marks: { items: marksFor(base.ranges).items }, freshZone: { fresh: base.fresh },
        tooltip: tooltip({ title: c => chartLabel(base.labels[c[0].dataIndex], base.weekly), label: c => ` ${c.dataset.label} : ${c.parsed.y}` }) } } });
}

function drawOverviewChart(kws, R) {
  const m = ui.ovChart;
  const cur = globalSeries(kws, R.dates, m);
  const ds = [lineDs(`du ${fmtDate(R.from)} au ${fmtDate(R.to)}`, cur.vals, C.ink, { fresh: cur.fresh, fill: m === "clicks" })];
  if (R.cmp) { const c = globalSeries(kws, R.cmp.dates, m); ds.push(lineDs(`du ${fmtDateY(R.cmp.from)} au ${fmtDateY(R.cmp.to)}`, cur.labels.map((_, n) => c.vals[n] ?? null), C.cmp, { dash: [4, 4], width: 1.5 })); }
  $("ov-legend").innerHTML = `<span class="lg" ${tip(`${fmtDate(R.from)} au ${fmtDate(R.to)}`)}><span class="line-sw" style="border-color:${C.ink}"></span>Période</span>${R.cmp ? `<span class="lg" ${tip(`${fmtDateY(R.cmp.from)} au ${fmtDateY(R.cmp.to)}`)}><span class="line-sw dash" style="border-color:${C.cmp}"></span>${cmpLabel().replace("vs ", "")}</span>` : ""}`;
  const mk = marksFor(cur.ranges);
  const f = v => m === "pos" ? fmt1(v) : m === "vis" ? fmt1(v) + " %" : fmt(v);
  chart("c-ov", { type: "line", data: { labels: cur.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 16 } },
      scales: { y: m === "pos" ? posScale(ds.flatMap(d => d.data)) : linScale(m === "vis" ? v => v + " %" : null), x: xScale(cur.labels, cur.weekly) },
      plugins: { legend: { display: false }, marks: { items: mk.items }, freshZone: { fresh: cur.fresh },
        tooltip: tooltip({ title: c => chartLabel(cur.labels[c[0].dataIndex], cur.weekly), label: c => ` ${c.dataset.label} : ${f(c.parsed.y)}` }) } } });
  $("ov-marks").innerHTML = mk.html;
}

// ---------------------------------------------------------------- export CSV
function exportCsv(kws, R) {
  const P = app.P;
  const head = ["mot-cle", "variantes", "tags", "statut", "objectif", "page", "position", "date_position", "evolution_comparaison", "evolution_7j", "evolution_28j",
    "meilleure_position", "autre_page_en_tete", "impressions_28j", "clics", "impressions", "taux_de_clic", "clics_a_gagner_mois"];
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = v => v == null ? "" : String(v).replace(".", ",");
  const lines = [head.join(";")].concat(kws.map(k => { const s = k.st; return [cell(k.keyword), cell(k.variants.join(", ")), cell(k.tags.join(", ")), cell(k.status || ""), num(k.target), cell(k.page),
    num(s.pos), s.cur ? s.cur[0] : "", num(s.dcmp), num(s.d7), num(s.d28), num(s.best), cell(s.alt ? s.alt[0] : ""), s.demand,
    s.clicks, s.impr, num(s.ctr != null ? +s.ctr.toFixed(2) : null), s.potential ?? ""].join(";"); }));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${P.name}-${P.market}-mots-cles-${R.to}.csv`;
  a.click();
  toast(`${plural(kws.length, "ligne exportée", "lignes exportées")}`);
}

// ---------------------------------------------------------------- vue par page
function renderByPage() {
  const P = app.P;
  const pages = {};
  P.keywords.filter(k => k.page !== "*").forEach(k => (pages[k.page] = pages[k.page] || []).push(k));
  const recheck = (list = []) => issue("inspection.yml", { projet: P.name, pages: list.join("\n"), title: `Indexation : ${P.label}${list.length === 1 ? " " + path(list[0]) : ""}` });
  const cards = Object.entries(pages).map(([url, kws]) => {
    const insp = P.inspection.current[url] || {};
    const pq = P.page_queries[url] || {};
    const prev = new Map((pq.prev || []).map(r => [r[0], r]));
    const tracked = new Set(kws.flatMap(k => [k.keyword, ...k.variants]));
    const cur = pq.cur || [];
    const tc = cur.reduce((a, r) => a + r[1], 0);
    const canon = insp.googleCanonical && insp.userCanonical && insp.googleCanonical.replace(/\/$/, "") !== insp.userCanonical.replace(/\/$/, "");
    const hist = (P.inspection.history || []).filter(h => h.url === url).slice(-3).reverse();
    return `<details class="card card-fold"><summary>
        <span class="badge ${insp.verdict === "PASS" ? "ok" : insp.verdict ? "ko" : ""} dotted">${insp.verdict === "PASS" ? "Indexée" : esc(insp.coverageState || "Non vérifiée")}</span>
        ${canon ? '<span class="badge warn">Autre canonique retenue</span>' : ""}
        <b style="min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(path(url))}</b><span class="light" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${kws.map(k => esc(k.keyword)).join(", ")}</span>
        <span class="muted nowrap">${fmt(tc)} clics sur 28 j</span></summary>
      <div class="card-body">
        <div class="insp mb-3">${urlLink(url, { max: 80 })}
          <span class="badge outline">Dernier passage de Google : ${insp.lastCrawlTime ? fmtDate(insp.lastCrawlTime.slice(0, 10)) : "-"}</span>
          <span class="badge outline">${insp.checked ? "Vérifiée le " + fmtDate(insp.checked) : "Jamais vérifiée"}</span>
          ${canon ? `<span class="badge warn">Canonique retenue : ${esc(path(insp.googleCanonical))}</span>` : ""}
          <a class="btn secondary sm" href="${recheck([url])}" target="_blank" rel="noopener">${ICON.sync}Revérifier</a></div>
        ${hist.length ? `<div class="note-box mb-3">${hist.map(h => `${fmtDate(h.date)} : ${esc(h.field)} passe de « ${esc(h.old)} » à « ${esc(h.new)} »`).join("<br>")}</div>` : ""}
        <div class="box"><div class="table-wrap"><table><thead><tr><th>Requête, 28 j <span class="th-sub">en gras : mots-clés suivis</span></th><th class="num">Clics</th><th class="num">Impressions</th><th class="num">Position moy.</th><th class="num">vs 28 j préc.</th></tr></thead><tbody>
        ${cur.slice(0, 30).map(r => { const p = prev.get(r[0]); return `<tr ${tracked.has(r[0]) ? 'style="font-weight:600"' : ""}><td>${esc(r[0])}</td>
          <td class="num">${fmt(r[1])}</td><td class="num">${fmt(r[2])}</td><td class="num">${fmt1(r[3])}</td><td class="num">${p ? placesDelta(+(p[3] - r[3]).toFixed(1), p[3], r[3]) : '<span class="badge info">nouvelle</span>'}</td></tr>`; }).join("") || `<tr><td colspan="5" class="empty-note" style="padding:14px">Pas de donnée sur 28 jours.</td></tr>`}
        </tbody></table></div></div></div></details>`;
  }).join("");
  $("kw-body").innerHTML = cards ? viewBar(`<span class="ref-note">${plural(Object.keys(pages).length, "page suivie", "pages suivies")}. L'indexation est vérifiée à l'ajout d'une page, puis à la demande.</span>`, `<a class="btn secondary sm" href="${recheck()}" target="_blank" rel="noopener">${ICON.sync}Vérifier toutes les pages</a>`) + cards
    : `<div class="card">${empty("Aucune page suivie", "Les mots-clés de ce projet sont suivis au niveau du site, sans page attitrée.", ICON.folder)}</div>`;
}

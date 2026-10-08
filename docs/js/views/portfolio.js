// Portefeuille : le check du matin. Alertes de tous les projets, puis un projet par ligne.
import { app, ui, store } from "@/state.js";
import { DEF, TYPES } from "@/defs.js";
import { $, $$, esc, fmt, fmt1, fmtDate, issue, plural, ndays, today, path } from "@/util.js";

const host = p => p.property.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
import { alertKey, newKeys, markSeen, syncState, prefetch } from "@/data.js";
import { isRankingUpdate, C } from "@/charts.js";
import { ICON, tip, info, stat, viewBar, btnLink, empty, sparkline, areaSpark, alertIcon, pctDelta, placesDelta, sevBadge, newBadge, sortable, th, rowNav, toast, alertFact } from "@/ui.js";
import { myProjects, nAlerts } from "@/chrome.js";

const SEV_L = { critique: "Urgent", attention: "À surveiller", info: "Info" };
const alertHref = (p, a) => a.i != null ? `#/${p.name}/mots-cles?kw=${a.i}` : `#/${p.name}/a-traiter`;

export function renderPortfolio() {
  const list = myProjects();
  const tag = ui.fresh ? "last" : "final";
  const welcomed = store.get("welcomed") === "1";

  // Alertes de tous les projets
  let feed = [];
  list.forEach(p => { const nk = newKeys(p.name, p.alert_list || []); (p.alert_list || []).forEach(a => feed.push({ p, a, isNew: nk.has(alertKey(a)) })); });
  const nNew = feed.filter(x => x.isNew).length, nUrg = feed.filter(x => x.a.severity === "critique").length;
  feed.sort((x, y) => (y.isNew - x.isNew) || ((x.a.severity === "critique" ? 0 : 1) - (y.a.severity === "critique" ? 0 : 1)) || ((y.a.impact || 0) - (x.a.impact || 0)));
  const ff = ui.feedFilter;
  const shown = feed.filter(x => ff === "new" ? x.isNew : ff === "urgent" ? x.a.severity === "critique" : true);
  const lim = ui.more.feed || 8;

  // Indicateurs globaux
  const clicks = list.reduce((s, p) => s + (p.nonbrand_clicks || 0), 0);
  const n1 = list.reduce((s, p) => s + (p.nonbrand_clicks && p.nonbrand_vs_n1 != null ? p.nonbrand_clicks / (1 + p.nonbrand_vs_n1 / 100) : p.nonbrand_clicks || 0), 0);
  const t10 = list.reduce((s, p) => s + (p["top10_" + tag] || 0), 0), nk = list.reduce((s, p) => s + p.n_keywords, 0);
  const bad = list.filter(p => syncState(p).kind !== "ok").length;

  // Tableau des projets
  const val = p => ({ name: p.label.toLowerCase(), alerts: p.alerts.critique * 1000 + p.alerts.attention, clicks: p.nonbrand_clicks || 0, n1: p.nonbrand_vs_n1 ?? -1e9,
    pos: p["pos_" + tag] ?? 999, top10: (p["top10_" + tag] || 0) / (p.n_keywords || 1), moves: (p.moves_up || 0) - (p.moves_down || 0), date: p.last_date || "" }[ui.pSort.key]);
  const rows = list.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.pSort.dir; });
  const multiOwner = new Set(app.IDX.projects.map(p => p.owner).filter(Boolean)).size > 1;
  const alertsCell = p => {
    const nw = newKeys(p.name, p.alert_list || []).size;
    return `<div class="alert-cell">${p.alerts.critique ? `<a class="badge ko dotted" href="#/${p.name}/a-traiter">${p.alerts.critique} urgente${p.alerts.critique > 1 ? "s" : ""}</a>` : ""}${p.alerts.attention ? `<a class="badge warn dotted" href="#/${p.name}/a-traiter">${p.alerts.attention} à surveiller</a>` : ""}${nw ? `<a class="badge new" href="#/${p.name}/a-traiter">${nw} nouvelle${nw > 1 ? "s" : ""}</a>` : ""}${!nAlerts(p) ? '<span class="badge ok">Rien à signaler</span>' : ""}</div>`;
  };
  const dateCell = p => { const st = syncState(p); return st.kind === "ok" ? `<span class="muted">${fmtDate(p.last_date)}</span>` : `<span class="badge ko" ${tip(st.kind === "ko" ? "Synchro en échec" : `Rien de nouveau depuis ${st.late} jours`)}>${fmtDate(p.last_date)}</span>`; };
  const posDelta = p => { const pos = p["pos_" + tag], prev = p["pos_" + tag + "_prev"]; return placesDelta(pos != null && prev != null ? +(prev - pos).toFixed(1) : null, prev, pos, "sur 28 jours"); };
  const movesCell = p => `<span class="row" style="gap:4px;flex-wrap:nowrap">${p.moves_up ? `<span class="delta up" ${tip(plural(p.moves_up, "mot-clé gagne", "mots-clés gagnent") + " au moins une demi-place en 7 jours")}>▲ ${p.moves_up}</span>` : ""}${p.moves_down ? `<span class="delta down" ${tip(plural(p.moves_down, "mot-clé perd", "mots-clés perdent") + " au moins une demi-place en 7 jours")}>▼ ${p.moves_down}</span>` : ""}${!p.moves_up && !p.moves_down ? '<span class="light">stable</span>' : ""}</span>`;

  const pview = store.get("pView") || "cards";
  const card = p => {
    const st = syncState(p), nw = newKeys(p.name, p.alert_list || []).size, t10p = p["top10_" + tag], pct10 = p.n_keywords ? (t10p || 0) / p.n_keywords * 100 : 0;
    const status = st.kind !== "ok" ? `<span class="badge ko dotted">${st.kind === "ko" ? "Synchro en échec" : "En retard"}</span>`
      : p.alerts.critique ? `<span class="badge ko dotted" data-go="#/${p.name}/a-traiter">${p.alerts.critique} urgente${p.alerts.critique > 1 ? "s" : ""}</span>`
      : p.alerts.attention ? `<span class="badge warn dotted" data-go="#/${p.name}/a-traiter">${p.alerts.attention} à surveiller</span>` : `<span class="badge ok dotted">Rien à signaler</span>`;
    const n1 = p.nonbrand_vs_n1;
    return `<a class="card pcard2" href="#/${p.name}" data-p="${esc(p.name)}">
      <div class="top"><span class="avatar lg">${esc(p.label[0].toUpperCase())}</span><span class="t" ${tip(`${host(p)} · ${p.market_label || "Tous pays"}\nDonnées au ${fmtDate(p.last_date)}`)}><b>${esc(p.label)}</b></span>
        <span class="row" style="gap:4px;justify-content:flex-end">${status}${nw ? `<span class="badge new" data-go="#/${p.name}/a-traiter">${nw} nouv.</span>` : ""}</span></div>
      <div class="big"><span class="n" ${tip("Clics hors marque, 28 derniers jours définitifs")}>${fmt(p.nonbrand_clicks)}</span>${n1 == null ? "" : `<span class="delta ${n1 > 0.5 ? "up" : n1 < -0.5 ? "down" : "flat"}" ${tip("Clics hors marque des 28 derniers jours définitifs contre les mêmes jours un an plus tôt")}>${n1 > 0.5 ? "▲" : n1 < -0.5 ? "▼" : ""} ${fmt(Math.abs(n1))} %</span>`}</div>
      ${p.spark ? areaSpark(p.spark, st.kind !== "ok" ? C.cmp : C.palette[0], { cls: "kspark", h: 46, tipText: "Clics hors marque par semaine, 13 semaines" }) : ""}
      <div class="foot">
        <div><div class="l">Position moy.</div><div class="v">${fmt1(p["pos_" + tag])} ${posDelta(p)}</div></div>
        <div><div class="l">Top 10</div><div class="v">${t10p ?? "-"}<span class="light">/ ${p.n_keywords}</span></div><div class="bar10"><div style="width:${pct10.toFixed(0)}%"></div></div></div>
        <div><div class="l">7 jours</div><div class="v">${movesCell(p)}</div></div></div></a>`;
  };

  $("view").innerHTML = (welcomed ? "" : `<div class="card welcome" id="welcome"><div><h2>Bienvenue dans Positions</h2><ol>
      <li><b>Chaque matin</b>, commence ici : le bloc « À traiter » réunit les alertes de tous tes projets, les nouvelles en premier.</li>
      <li><b>Ouvre un projet</b> pour la position du jour de chaque mot-clé, le trafic du site, l'effet de tes actions et le rapport du mois.</li>
      <li><b><span class="kbd">⌘K</span> ou <span class="kbd">Ctrl K</span></b> mène partout, <span class="kbd">?</span> liste les raccourcis. Chaque chiffre a sa définition au survol, et le guide explique tout le reste.</li></ol></div>
      <div class="row" style="align-items:flex-start"><a class="btn secondary sm" href="#/guide">Lire le guide</a><button class="btn ghost sm" id="welcome-x">Masquer</button></div></div>`)
    + `<div class="page-title"><div><h1 ${tip(`${plural(list.length, "projet", "projets")}, données jusqu'au ${fmtDate(list.map(p => p.last_date).filter(Boolean).sort().pop())}.\nCalculé le ${new Date(app.IDX.generated_at).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`)}>${ui.who ? `Projets de ${esc(ui.who)}` : "Portefeuille"}</h1></div>
        <div class="row">${btnLink(issue("projet.yml", { title: "Projet : " }), "Nouveau projet")}</div></div>`
    + `<div class="kpi-grid">
      ${stat("Alertes ouvertes", fmt(feed.length), `${nUrg ? `<span class="badge ko">${nUrg} urgente${nUrg > 1 ? "s" : ""}</span>` : ""}${nNew ? `<span class="badge new">${nNew} nouvelle${nNew > 1 ? "s" : ""}</span>` : ""}`)}
      ${stat("Clics hors marque, 28 j", fmt(clicks), pctDelta(clicks, Math.round(n1), { cmp: "vs N-1" }), "horsMarque", areaSpark(Array.from({ length: 13 }, (_, i) => list.reduce((t, p) => t + ((p.spark || [])[i] || 0), 0)), C.palette[0], { tipText: "Clics hors marque par semaine, 13 semaines, tous projets" }))}
      ${stat("Mots-clés dans le top 10", `${fmt(t10)}<small> / ${fmt(nk)}</small>`, "", "top", "", `${nk ? fmt(t10 / nk * 100) : 0} % des mots-clés suivis`)}
    </div>
    <div class="grid-2"><div class="card" id="feed-card">
      <div class="card-head ruled"><h2>${ICON.bell}À traiter, tous projets</h2>
        <div class="row"><div class="seg" role="group" aria-label="Filtrer les alertes">${[["all", `Toutes · ${feed.length}`], ["new", `Nouvelles · ${nNew}`], ["urgent", `Urgentes · ${nUrg}`]].map(([v, l]) => `<button type="button" data-f="${v}" aria-pressed="${ff === v}" class="${ff === v ? "active" : ""}">${l}</button>`).join("")}</div>
        ${nNew ? '<button class="btn ghost sm" id="seen-all">Tout marquer comme vu</button>' : ""}</div></div>
      <div class="feed">${shown.slice(0, lim).map(({ p, a, isNew }) => `<a class="feed-it" href="${alertHref(p, a)}" data-p="${esc(p.name)}" ${tip(`${SEV_L[a.severity] || ""} · ${TYPES[a.type] || a.type}\n${a.keyword ? "" : a.page ? path(a.page) + "\n" : ""}${alertFact(a)}\nConstaté le ${fmtDate(a.date)}`)}>
          ${alertIcon(a)}
          <span class="t"><span class="row" style="gap:8px;flex-wrap:nowrap"><b class="ell">${esc(a.keyword || TYPES[a.type] || a.type)}</b>${isNew ? newBadge() : ""}</span></span>
          <span class="r"><span class="pchip"><span class="avatar xs">${esc(p.label[0])}</span>${esc(p.label)}</span>${a.impact ? `<b ${tip(DEF.enJeu)}>${fmt(a.impact)}</b>` : '<span class="light">-</span>'}</span></a>`).join("")
        || `<div style="padding:8px 20px 4px">${empty(ff === "new" ? "Aucune nouvelle alerte" : "Rien à signaler", ff === "new" ? "Toutes les alertes ouvertes ont déjà été vues." : "Aucune alerte ouverte sur tes projets.", ICON.check)}</div>`}</div>
      ${shown.length > lim ? `<div class="more-row"><button class="btn secondary sm" id="feed-more">Voir les ${fmt(shown.length - lim)} autres</button></div>` : ""}
    </div>${updatesCard()}</div>
    <div class="section-title"><h2>Projets</h2><div class="seg" id="p-view" role="group" aria-label="Affichage des projets">${[["cards", "Cartes"], ["table", "Tableau"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${pview === v}" class="${pview === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
    ${pview === "cards" ? `<div class="pgrid">${rows.map(card).join("") || `<div class="card">${empty("Aucun projet", "", ICON.folder)}</div>`}</div>` : `<div class="card mb-4">
      <div class="table-wrap ptable"><table id="t-port"><thead><tr>
        ${th("Projet", "name", { cls: "" })}${multiOwner ? '<th scope="col">Consultant</th>' : ""}${th("À traiter", "alerts", { cls: "" })}
        ${th("Clics hors marque", "clicks", { defKey: "horsMarque", sub: "28 j, tendance 13 sem." })}${th("vs N-1", "n1", { defKey: "n1" })}
        ${th("Position moy.", "pos", { defKey: "posMoy", sub: "et 28 j" })}${th("Top 10", "top10", { defKey: "top" })}${th("7 j", "moves", { cls: "", defKey: "d7", sub: "hausses, baisses" })}${th("Données au", "date", { cls: "" })}</tr></thead>
        <tbody>${rows.map(p => `<tr class="click" data-p="${esc(p.name)}">
          <td><div class="proj"><span class="avatar">${esc(p.label[0].toUpperCase())}<span class="hd ${syncState(p).kind !== "ok" ? "ko" : p.alerts.critique ? "ko" : p.alerts.attention ? "warn" : "ok"}"></span></span><span class="t"><b>${esc(p.label)}</b><small>${esc(p.property)} · ${esc(p.market_label || "Tous pays")}</small></span></div></td>
          ${multiOwner ? `<td class="muted">${esc(p.owner || "-")}</td>` : ""}
          <td>${alertsCell(p)}</td>
          <td class="num"><span class="row" style="justify-content:flex-end;flex-wrap:nowrap;gap:10px">${p.spark ? sparkline(p.spark, C.ink, { w: 64, h: 20 }) : ""}<span>${fmt(p.nonbrand_clicks)}</span></span></td>
          <td class="num">${p.nonbrand_vs_n1 == null ? '<span class="light">-</span>' : `<span class="delta ${p.nonbrand_vs_n1 > 0.5 ? "up" : p.nonbrand_vs_n1 < -0.5 ? "down" : "flat"}">${p.nonbrand_vs_n1 > 0.5 ? "▲" : p.nonbrand_vs_n1 < -0.5 ? "▼" : ""} ${fmt(Math.abs(p.nonbrand_vs_n1))} %</span>`}</td>
          <td class="num"><span class="row" style="justify-content:flex-end;flex-wrap:nowrap">${fmt1(p["pos_" + tag])} ${posDelta(p)}</span></td>
          <td class="num">${p["top10_" + tag] ?? "-"}<span class="light"> / ${p.n_keywords}</span></td>
          <td>${movesCell(p)}</td>
          <td>${dateCell(p)}</td></tr>`).join("") || `<tr><td colspan="9">${empty("Aucun projet" + (ui.who ? " pour ce consultant" : ""), "", ICON.folder)}</td></tr>`}</tbody></table></div>
      <div class="pcards">${rows.map(p => `<a class="pcard" href="#/${p.name}"><div class="proj"><span class="avatar">${esc(p.label[0].toUpperCase())}</span><span class="t"><b>${esc(p.label)}</b><small>${esc(p.market_label || "Tous pays")} · données au ${fmtDate(p.last_date)}</small></span></div>
          <div>${p.spark ? sparkline(p.spark, C.ink, { w: 64, h: 20 }) : ""}</div>
          <div class="stats-line">${alertsCell(p)}<span>${fmt(p.nonbrand_clicks)} clics hors marque ${p.nonbrand_vs_n1 != null ? `(${p.nonbrand_vs_n1 > 0 ? "+" : ""}${fmt(p.nonbrand_vs_n1)} % vs N-1)` : ""}</span><span>Position moy. ${fmt1(p["pos_" + tag])}</span><span>Top 10 : ${p["top10_" + tag] ?? "-"} / ${p.n_keywords}</span></div></a>`).join("")}</div>
    </div>`}`;

  if ($("welcome-x")) $("welcome-x").onclick = () => { store.set("welcomed", "1"); $("welcome").remove(); };
  $$("#feed-card [data-f]").forEach(b => b.onclick = () => { ui.feedFilter = b.dataset.f; ui.more.feed = 8; renderPortfolio(); });
  if ($("feed-more")) $("feed-more").onclick = () => { ui.more.feed = lim + 20; renderPortfolio(); };
  if ($("seen-all")) $("seen-all").onclick = () => { list.forEach(p => markSeen(p.name, p.alert_list || [])); toast("Alertes marquées comme vues"); app.render(); };
  $$("#feed-card .feed-it").forEach(a => a.onmouseenter = () => prefetch(a.dataset.p));
  if ($("t-port")) rowNav($("t-port"), "tr[data-p]", tr => { location.hash = "#/" + tr.dataset.p; });
  $$("#p-view button").forEach(b => b.onclick = () => { store.set("pView", b.dataset.v); renderPortfolio(); });
  $$(".pcard2").forEach(a => a.onmouseenter = () => prefetch(a.dataset.p));
  $$(".pcard2 [data-go]").forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); location.hash = b.dataset.go; });
  $$("#t-port tr[data-p]").forEach(tr => tr.onmouseenter = () => prefetch(tr.dataset.p));
  if ($("t-port")) sortable($("t-port"), ui.pSort, s => { ui.pSort = s; store.put("pSort", s); renderPortfolio(); }, ["name", "pos", "date"]);
}

export function updatesCard() {
  const ups = (app.IDX.google_updates || []).filter(isRankingUpdate).slice(-5).reverse();
  return `<div class="card"><div class="card-head"><h2>Mises à jour Google <i class="info" tabindex="0" data-tip="Mises à jour de classement uniquement. Elles apparaissent en repère G sur les courbes.">i</i></h2></div>
    <div class="card-body">${ups.map(u => `<div class="upd"><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a><span class="light">${fmtDate(u.begin)}${u.end ? "" : " · en cours"}</span></div>`).join("") || '<div class="empty-note">Aucune.</div>'}</div></div>`;
}

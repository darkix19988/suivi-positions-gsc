// À traiter : alertes et mouvements sur 7 jours, toujours au dernier jour définitif.
import { app, ui, store } from "@/state.js";
import { DEF, TYPES, SEV, MIN_IMPR_DAY } from "@/defs.js";
import { $, $$, esc, fmt, fmt1, fmtDate, fmtDateL, shift, issue, plural, tidyText, GH, path } from "@/util.js";
import { alertKey, newKeys, markSeen, projectMeta } from "@/data.js";
import { C } from "@/charts.js";
import { ICON, tip, info, empty, sparkline, placesDelta, sevBadge, newBadge, urlLink, rowNav, alertFact, alertIcon } from "@/ui.js";
import { openDrawer } from "@/drawer.js";
import { updatesCard } from "@/views/portfolio.js";

const fact = alertFact;

export function renderToday() {
  const P = app.P, lf = P.last_final;
  const meta = projectMeta(P.name);
  const nk = newKeys(P.name, P.alerts);
  if (!meta || meta.market === P.market) markSeen(P.name, P.alerts);
  const alerts = P.alerts.slice().sort((x, y) => (nk.has(alertKey(y)) - nk.has(alertKey(x))));
  const moves = P.moves.map(m => ({ ...m, k: P.kwById.get(m.i) })).filter(m => m.k);
  const ups = moves.filter(x => x.d >= 0.5).sort((a, b) => b.d - a.d), downs = moves.filter(x => x.d <= -0.5).sort((a, b) => a.d - b.d);
  const measuring = P.actions.filter(a => a.days_after >= 0 && a.days_after < 28);

  const spark = a => {
    const k = a.i != null && P.kwById.get(a.i); if (!k) return "";
    const vals = []; for (let n = 20; n >= 0; n--) { const x = k.map.get(shift(P.last_date, -n)); vals.push(x ? x[1] : null); }
    return `<span ${tip("Position jour par jour, 21 derniers jours (haut = mieux)")}>${sparkline(vals, a.severity === "critique" ? C.palette[7] : C.palette[3], { w: 96, h: 26, invert: true })}</span>`;
  };
  const card = a => {
    const isNew = nk.has(alertKey(a));
    const title = a.keyword || TYPES[a.type] || a.type;
    const k = a.i != null && P.kwById.get(a.i), last = k && k.s.length ? k.s[k.s.length - 1] : null;
    const detail = [`${SEV[a.severity] || ""} · ${TYPES[a.type] || a.type}`, a.page && a.page !== "*" ? path(a.page) : "", `Constaté le ${fmtDate(a.date)}`,
      last && last[0] > a.date && last[1] != null ? `Depuis : ${fmt1(last[1])} le ${fmtDate(last[0])}${last[4] ? " (provisoire)" : ""}` : ""].filter(Boolean).join("\n");
    return `<div class="card alert ${isNew ? "" : "seen"} ${a.i != null ? "click" : ""}" ${a.i != null ? `data-open="${a.i}" tabindex="0" role="button"` : ""}><span class="bar ${a.severity}"></span>
      <div class="alert-main"><span ${tip(detail)}>${alertIcon(a)}</span>
        <div style="min-width:0"><div class="head"><h3>${esc(title)}</h3>${isNew ? newBadge() : ""}</div><div class="fact">${esc(fact(a))}</div></div></div>
      <div class="side">${spark(a)}${a.impact ? `<div class="stake" ${tip(DEF.enJeu)}>${fmt(a.impact)}<small>clics / mois</small></div>` : ""}
        ${a.type === "synchro" ? `<a class="btn ghost sm" href="${GH}/actions/workflows/daily.yml" target="_blank" rel="noopener">Synchros</a>` : ""}
        ${a.page && a.page !== "*" && a.type !== "synchro" ? `<a class="btn ghost icon sm" href="${issue("action.yml", { projet: P.name, page: a.page, title: "Action : " })}" target="_blank" rel="noopener" data-stop ${tip("Consigner l'action menée")} aria-label="Consigner une action">${ICON.pen}</a>` : ""}</div></div>`;
  };
  const moveRow = x => `<tr class="click" data-i="${x.k.i}"><td><span class="kw"><span class="k">${esc(x.k.keyword)}</span></span></td><td class="num muted">${fmt1(x.p0)} → <b style="color:var(--text)">${fmt1(x.p1)}</b></td><td class="num">${placesDelta(x.d, x.p0, x.p1, `du ${fmtDate(shift(lf, -7))} au ${fmtDate(lf)}`)}</td></tr>`;
  const movesCard = (title, list, cls, emptyTxt) => `<div class="card"><div class="card-head"><h2>${title} <span class="count ${cls}">${list.length}</span></h2></div>
    <div class="table-wrap"><table><tbody>${list.slice(0, 8).map(moveRow).join("") || `<tr><td class="empty-note" style="padding:14px 16px">${emptyTxt}</td></tr>`}</tbody></table></div>
    ${list.length > 8 ? `<div class="card-foot"><span>et ${list.length - 8} autre${list.length > 9 ? "s" : ""}</span><a href="#/${P.name}/mots-cles" data-sort7="${cls === "ok" ? -1 : 1}">Voir dans le tableau</a></div>` : ""}</div>`;
  const evs = P.events.filter(e => e.date >= shift(lf, -30) && (e.severity !== "info" || e.type === "hausse")).slice(0, 80);
  const byDay = {};
  evs.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const nNew = alerts.filter(a => nk.has(alertKey(a))).length;

  $("view").innerHTML = `
    <div class="section-title first"><h2>Alertes ${alerts.length ? `<span class="count ${alerts.some(a => a.severity === "critique") ? "ko" : "warn"}">${alerts.length}</span>` : ""}${nNew ? `<span class="badge new">${nNew} nouvelle${nNew > 1 ? "s" : ""}</span>` : ""}</h2>
      <i class="info" tabindex="0" data-tip="${esc(`Au ${fmtDateL(lf)}, dernier jour définitif.\n${DEF.d7}`)}">i</i></div>
    <div class="list">${alerts.map(card).join("") || `<div class="card">${empty("Rien à signaler", "Aucun mot-clé suivi n'a reculé de façon significative sur 7 jours, et les pages suivies sont indexées.", ICON.check)}</div>`}</div>
    <div class="section-title"><h2>Mouvements sur 7 jours <i class="info" tabindex="0" data-tip="Du ${fmtDate(shift(lf, -7))} au ${fmtDate(lf)}, au moins ${MIN_IMPR_DAY} impressions chacun des deux jours.">i</i></h2></div>
    <div class="grid-eq">${movesCard("Hausses", ups, "ok", "Aucune hausse d'au moins une demi-place.")}${movesCard("Baisses", downs, "ko", "Aucune baisse d'au moins une demi-place.")}</div>
    ${measuring.length ? `<div class="section-title"><h2>Actions en cours de mesure</h2><a href="#/${P.name}/actions">Voir le journal</a></div>
      <div class="list">${measuring.map(a => `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><div class="row"><span class="badge outline">${esc(a.type || "autre")}</span><b>${esc(a.title)}</b><span class="light">${fmtDateL(a.date)}</span></div><span class="light">${a.days_after} / 28 jours</span></div>
        <div class="progress mt-2"><div style="width:${Math.round(Math.min(a.days_after, 28) / 28 * 100)}%"></div></div></div>`).join("")}</div>` : ""}
    <details class="fold" id="hist"><summary>Historique des 30 derniers jours (${plural(evs.length, "événement", "événements")})</summary><div class="grid-2">
      <div class="card"><div class="card-body">${Object.keys(byDay).sort().reverse().map(d => `<div class="feed-day">${fmtDateL(d)}</div>` + byDay[d].map(e =>
        `<div class="feed-row">${sevBadge(e.severity)}<span>${e.i != null ? `<span class="k" data-i="${e.i}" tabindex="0" role="button">${esc(e.keyword)}</span>` : urlLink(e.page || "*")}</span><span class="muted">${esc(tidyText(e.text))}</span></div>`).join("")).join("") || '<div class="empty-note">Aucun événement.</div>'}</div></div>
      ${updatesCard()}</div></details>`;

  $$("[data-open]").forEach(el => { el.onclick = e => { if (!e.target.closest("[data-stop], a")) openDrawer(+el.dataset.open); }; el.onkeydown = e => { if (e.key === "Enter" && e.target === el) openDrawer(+el.dataset.open); }; });
  $$("#hist [data-i]").forEach(el => { el.onclick = () => openDrawer(+el.dataset.i); el.onkeydown = e => { if (e.key === "Enter") openDrawer(+el.dataset.i); }; });
  rowNav($("view"), "tr[data-i]", tr => openDrawer(+tr.dataset.i));
  $$("[data-sort7]").forEach(a => a.onclick = () => { ui.sort = { key: "d7", dir: +a.dataset.sort7 }; store.put("sort", ui.sort); });
}

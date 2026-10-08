// Actions : journal des optimisations et preuve de leur effet (avant / après corrigé d'un groupe témoin).
import { app, ui, store } from "@/state.js";
import { DEF } from "@/defs.js";
import { $, $$, esc, fmt, fmt1, fmtDate, fmtDateL, shift, calDates, issue, plural, copyText } from "@/util.js";
import { chart, lineDs, posScale, linScale, xScale, tooltip, C, downloadChart, label as chartLabel } from "@/charts.js";
import { ICON, tip, info, viewBar, btnLink, empty, urlLink, toast } from "@/ui.js";
import { openDrawer } from "@/drawer.js";

const TECH_AUTHORS = new Set(["analytics-ds", "github-actions", "github-actions[bot]"]);

// Verdict en clair, reprenable tel quel pour le client
function sentence(a, kws) {
  const im = a.impact, adj = im && im.clicks_month_adjusted;
  if (!im || im.pos_before == null || im.pos_after == null) return "";
  const who = kws.length === 1 ? `« ${kws[0]} »` : `les ${kws.length} mots-clés suivis de la page`;
  const ctrl = im.control_ratio ? Math.round((im.control_ratio - 1) * 100) : null;
  const better = im.pos_after < im.pos_before;
  const verb = kws.length === 1 ? (better ? "est passé" : "a reculé") : (better ? "sont passés" : "ont reculé");
  return `Depuis la mise en ligne le ${fmtDateL(a.date)}, ${who} ${verb} de la position ${fmt1(im.pos_before)} à ${fmt1(im.pos_after)} en moyenne`
    + (adj != null ? `, et la page ${adj >= 0 ? "gagne" : "perd"} environ ${fmt(Math.abs(adj))} clics par mois une fois retirée la tendance des mots-clés non touchés${ctrl != null ? ` (${ctrl >= 0 ? "+" : "−"}${Math.abs(ctrl)} % sur la même période)` : ""}.` : ".");
}

export function renderActions() {
  const P = app.P;
  const kwName = i => (P.kwById.get(i) || {}).keyword;
  const measured = P.actions.filter(a => a.impact && a.impact.clicks_month_adjusted != null);
  const total = measured.reduce((s, a) => s + a.impact.clicks_month_adjusted, 0);
  const running = P.actions.filter(a => a.days_after >= 0 && a.days_after < 28 && a.keywords && a.keywords.length);
  const metricTabs = `<div class="seg" id="act-metric" role="group" aria-label="Mesure du graphique">${[["position", "Position"], ["clicks", "Clics"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${ui.actMetric === v}" class="${ui.actMetric === v ? "active" : ""}">${l}</button>`).join("")}</div>`;
  const pill = adj => adj == null ? "" : adj > 0 ? `<span class="delta up" ${tip(DEF.impact)}>▲ +${fmt(adj)} clics / mois</span>` : adj < 0 ? `<span class="delta down" ${tip(DEF.impact)}>▼ −${fmt(Math.abs(adj))} clics / mois</span>` : `<span class="delta flat" ${tip(DEF.impact)}>Pas d'effet mesurable</span>`;

  const cards = P.actions.map(a => {
    const im = a.impact, adj = im && im.clicks_month_adjusted;
    const kws = (a.keywords || []).map(kwName).filter(Boolean);
    const s = sentence(a, kws);
    const measuring = a.days_after >= 0 && a.days_after < 28 && kws.length;
    return `<article class="card act" id="act-${a.id}">
      <div class="act-head"><div class="act-title">
          <h3><span class="badge outline">${esc(a.type || "autre")}</span>${esc(a.title || "Action")}</h3>
          <div class="meta"><span>${fmtDateL(a.date)}</span>${a.page ? urlLink(a.page, { max: 52 }) : ""}${a.author && !TECH_AUTHORS.has(a.author) ? `<span>par ${esc(a.author)}</span>` : ""}
          ${kws.length ? `<span>Mesuré sur : ${a.keywords.filter(i => kwName(i)).map(i => `<span class="k" data-i="${i}" tabindex="0" role="button">${esc(kwName(i))}</span>`).join(", ")}</span>` : ""}</div></div>
        <div class="row">${pill(adj)}${measuring ? `<span class="badge info" ${tip(`${a.days_after} / 28 jours${a.days_after < 7 ? ", premier résultat à 7 jours" : ", résultat provisoire"}`)}>Mesure ${a.days_after} / 28 j</span>` : ""}</div></div>
      ${a.description ? `<p class="act-desc">${esc(a.description)}</p>` : ""}
      ${s ? `<div class="act-sentence"><span>${esc(s)}</span><button class="btn ghost sm" data-copy="${a.id}" ${tip("Copier la phrase pour un mail ou une slide")}>${ICON.copy}Copier</button></div>` : ""}
      ${measuring ? `<div class="progress mt-3"><div style="width:${Math.round(Math.min(a.days_after, 28) / 28 * 100)}%"></div></div>` : ""}
      ${!im && a.reason ? `<div class="note-box mt-3">${esc(a.reason)}</div>` : ""}
      ${kws.length ? `<div class="act-chart"><canvas id="act-c-${a.id}"></canvas></div>` : ""}
      ${im ? `<div class="impact">
        <div><div class="l">Position moyenne, avant → après</div><div class="v">${fmt1(im.pos_before)} → ${fmt1(im.pos_after)}</div></div>
        <div><div class="l">Clics par jour, avant → après</div><div class="v">${fmt1(im.clicks_day_before)} → ${fmt1(im.clicks_day_after)}</div></div>
        <div><div class="l">Impressions par jour, avant → après</div><div class="v">${fmt(im.impr_day_before)} → ${fmt(im.impr_day_after)}</div></div></div>
        <div class="row mt-3" style="justify-content:space-between"><i class="info" tabindex="0" data-tip="${esc(`Mesuré sur ${im.window_after} jours après la mise en ligne${im.window_after < 28 ? " (définitif à 28 jours)" : ""}, comparé aux 28 jours d'avant. Groupe témoin : ${plural(im.control_size || 0, "mot-clé", "mots-clés")}.`)}">i</i>
          ${kws.length ? `<button class="btn ghost sm" data-png="${a.id}">${ICON.download}Télécharger le graphique</button>` : ""}</div>` : ""}
    </article>`;
  }).join("");

  $("view").innerHTML = viewBar(`<span class="act-sum"><b>${plural(P.actions.length, "action", "actions")}</b>${measured.length ? ` · ${measured.length} mesurée${measured.length > 1 ? "s" : ""} · effet cumulé ${pill(total)}` : ""}${running.length ? ` · ${running.length} en cours de mesure` : ""}</span>${P.actions.length ? metricTabs : ""}`)
    + `<div class="list">${cards || `<div class="card">${empty("Aucune action consignée", "Consigne chaque optimisation dès sa mise en ligne : son effet est mesuré automatiquement à 7 puis 28 jours. Astuce : un clic sur la courbe d'un mot-clé (panneau de détail) ouvre le formulaire à la bonne date.", ICON.pen, btnLink(issue("action.yml", { projet: P.name, title: "Action : " }), "Ajouter une action", "btn secondary"))}</div>`}</div>
    <details class="fold"><summary>Méthode de mesure</summary><div class="explain">28 jours avant la mise en ligne contre 28 jours après (7 minimum), sur les mots-clés suivis de la page, en position moyenne et en clics, sur données définitives. La tendance des mots-clés non touchés (groupe témoin) est retirée, puis le résultat est ramené à un mois. Sur le graphique : la zone jaune est la période après la mise en ligne, les pointillés sont les moyennes avant et après. L'action apparaît aussi en repère « A » sur les autres courbes.</div></details>`;
  $$(".act [data-i]").forEach(el => { el.onclick = () => openDrawer(+el.dataset.i); el.onkeydown = e => { if (e.key === "Enter") openDrawer(+el.dataset.i); }; });
  $$("#act-metric button").forEach(b => b.onclick = () => { ui.actMetric = b.dataset.v; store.set("actMetric", ui.actMetric); renderActions(); });
  $$("[data-copy]").forEach(b => b.onclick = async () => { const a = P.actions.find(x => String(x.id) === b.dataset.copy); if (await copyText(sentence(a, (a.keywords || []).map(kwName).filter(Boolean)))) toast("Verdict copié"); });
  $$("[data-png]").forEach(b => b.onclick = () => { const a = P.actions.find(x => String(x.id) === b.dataset.png); downloadChart(`act-c-${a.id}`, `${P.name}-action-${a.date}.png`); });
  P.actions.forEach(drawActionChart);
}

// 28 jours avant, jusqu'à 28 jours après, sur les mots-clés suivis de la page
function drawActionChart(a) {
  const P = app.P;
  if (!$(`act-c-${a.id}`) || !a.keywords || !a.keywords.length) return;
  const ks = P.keywords.filter(k => a.keywords.includes(k.i));
  const end = [shift(a.date, 28), P.last_date].sort()[0];
  const dates = calDates(shift(a.date, -28), end < a.date ? a.date : end);
  const pos = ui.actMetric === "position";
  const vals = dates.map(d => {
    const pts = ks.map(k => k.map.get(d)).filter(Boolean);
    if (!pts.length) return null;
    if (!pos) return pts.reduce((s, p) => s + p[2], 0);
    const i = pts.reduce((s, p) => s + p[3], 0);
    return i ? pts.reduce((s, p) => s + p[1] * p[3], 0) / i : null;
  });
  const fresh = dates.map(d => d > P.last_final);
  const idx = dates.indexOf(a.date), im = a.impact;
  const before = im ? (pos ? im.pos_before : im.clicks_day_before) : null, after = im ? (pos ? im.pos_after : im.clicks_day_after) : null;
  chart(`act-c-${a.id}`, { type: "line", data: { labels: dates, datasets: [lineDs(pos ? "Position" : "Clics", vals, C.ink, { fresh })] },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 20 } },
      scales: { y: pos ? posScale(vals) : linScale(), x: xScale(dates) },
      plugins: { legend: { display: false }, freshZone: { fresh },
        beforeAfter: { idx: idx >= 0 ? idx : null, label: `Mise en ligne, ${fmtDate(a.date)}`, before, after,
          beforeText: before != null ? `moy. avant ${fmt1(before)}` : "", afterText: after != null ? `moy. après ${fmt1(after)}` : "" },
        tooltip: tooltip({ title: c => chartLabel(dates[c[0].dataIndex]), label: c => ` ${pos ? "Position" : "Clics"} : ${pos ? fmt1(c.parsed.y) : fmt(c.parsed.y)}` }) } } });
}

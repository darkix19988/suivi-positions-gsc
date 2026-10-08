// Rapport mensuel : figé sur son mois, données définitives, textes modifiables, imprimable en PDF (toujours en thème clair).
import { app, ui, store, syncUrl } from "@/state.js";
import { $, $$, esc, fmt, fmt1, fmtDate, fmtDateL, fmtMonth, fmtMonthS, monthDates, lastDay, shiftMonth, shift, pct, plural, today, copyText, tidyText, BRAND, CFG } from "@/util.js";
import { posAt, segSum, trackedClicks } from "@/data.js";
import { chart, linScale, tooltip, isRankingUpdate } from "@/charts.js";
import { ICON, menuToggle, placesDelta, pctDelta, sevBadge, urlLink, toast, tip } from "@/ui.js";

const BLOCKS = [["synthese", "Synthèse"], ["chiffres", "Chiffres clés"], ["trafic", "Trafic 13 mois"], ["motscles", "Mots-clés suivis"],
  ["actions", "Actions"], ["vigilance", "Points de vigilance"], ["suite", "Prochaines étapes"]];
const LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M1.55607e-05 58.0954C1.60267e-05 52.6106 4.4208 48.1475 9.90547 48.1065C21.3582 48.0209 30.4387 48.0052 42.0095 48.0022C42.8693 48.002 43.7267 47.8913 44.5577 47.6708C44.5986 47.66 44.6395 47.6491 44.6804 47.6383C49.0177 46.4866 52.0055 42.5438 52.0049 38.0563L52.0013 10.0013C52.0006 4.47793 56.478 4.52739e-07 62.0013 9.5002e-07L90 3.47081e-06C95.5229 3.96805e-06 100 4.47716 100 10L100 42C100 47.5229 95.5229 52 90 52L58.2002 52L57.1548 52.0887C51.9782 52.5278 48 56.8577 48 62.0529L48 90C48 95.5228 43.5229 100 38 100L10 100C4.47716 100 1.23809e-05 95.5228 1.28501e-05 90L1.55607e-05 58.0954Z"/></svg>';
const sign = x => x == null || !isFinite(x) ? "-" : (x > 0 ? "+" : x < 0 ? "−" : "") + fmt(Math.abs(x)) + " %";
// Évolution lisible : en % au-delà de 20 clics de base, en écart absolu sinon
const evo = (cur, ref) => ref == null ? "-" : ref < 20 ? `${cur - ref >= 0 ? "+" : "−"}${fmt(Math.abs(cur - ref))} clics` : sign(pct(cur, ref));

export function renderReport() {
  const P = app.P, lf = P.last_final;
  const finals = P.dates.filter(d => d <= lf);
  const months = [...new Set(finals.map(d => d.slice(0, 7)))].sort().reverse();
  const complete = m => finals.includes(lastDay(m));
  if (!ui.month || !months.includes(ui.month)) ui.month = months.find(complete) || months[0];
  const m = ui.month, pm = shiftMonth(m, -1), nm = shiftMonth(m, -12);
  const md = monthDates(m).filter(d => d <= lf), pmd = monthDates(pm), nmd = monthDates(nm);
  const end = md[md.length - 1], pend = lastDay(pm), nend = lastDay(nm);
  const blocks = new Set(store.json("reportBlocks:" + P.name, BLOCKS.map(b => b[0])));
  const saveKey = `report:${P.name}:${P.market}:${m}`;
  const saved = store.json(saveKey, {});
  const nb = segSum("nonbrand", md), nbp = segSum("nonbrand", pmd), nb1 = segSum("nonbrand", nmd);
  const cl = trackedClicks(P.keywords, md), clp = trackedClicks(P.keywords, pmd), cl1 = trackedClicks(P.keywords, nmd);
  const rows = P.keywords.map(k => {
    const c = posAt(k.map, end), p = posAt(k.map, pend), n = posAt(k.map, nend);
    const sum = (ds, j) => ds.reduce((a, d) => a + ((k.map.get(d) || [])[j] || 0), 0);
    return { k, c: c && c[1], p: p && p[1], n: n && n[1], d: c && p ? +(p[1] - c[1]).toFixed(1) : null, clicks: sum(md, 2), pclicks: sum(pmd, 2), impr: sum(md, 3) };
  });
  const withPos = rows.filter(x => x.c != null), prevPos = rows.filter(x => x.p != null);
  const avg = withPos.length ? withPos.reduce((a, x) => a + x.c, 0) / withPos.length : null;
  const avgP = prevPos.length ? prevPos.reduce((a, x) => a + x.p, 0) / prevPos.length : null;
  const top3 = withPos.filter(x => x.c <= 3).length, top10 = withPos.filter(x => x.c <= 10).length;
  const top3p = prevPos.filter(x => x.p <= 3).length, top10p = prevPos.filter(x => x.p <= 10).length;
  const ranked = rows.filter(x => x.d != null && x.impr >= 100);
  const best = ranked.slice().sort((a, b) => b.d - a.d)[0], worst = ranked.slice().sort((a, b) => a.d - b.d)[0];
  const mStart = m + "-01", mEnd = lastDay(m);
  // Actions mises en ligne dans le mois, plus celles dont la mesure (28 jours) couvre le mois
  const acts = P.actions.filter(a => a.date && (a.date.slice(0, 7) === m || (a.date < mStart && shift(a.date, 28) >= mStart)));
  const launched = acts.filter(a => a.date.slice(0, 7) === m);
  const partial = !complete(m);
  const ups = (app.IDX.google_updates || []).filter(u => isRankingUpdate(u) && u.begin.slice(0, 7) === m);
  const seen = new Set();
  const vig = P.events.filter(e => e.date.slice(0, 7) === m && e.severity !== "info").filter(e => { const id = (e.keyword || e.page) + "|" + e.type; if (seen.has(id)) return false; seen.add(id); return true; })
    .sort((a, b) => (a.severity === "critique" ? 0 : 1) - (b.severity === "critique" ? 0 : 1) || b.date.localeCompare(a.date));

  // Synthèse construite uniquement à partir des chiffres (modifiable)
  const s = [];
  s.push(`En ${fmtMonth(m)}${partial ? ` (données jusqu'au ${fmtDateL(end)})` : ""}, le site a généré ${fmt(nb.clicks)} clics hors marque depuis Google${nb1.clicks ? `, ${sign(pct(nb.clicks, nb1.clicks))} par rapport à ${fmtMonth(nm)}` : ""}${nbp.clicks ? ` et ${sign(pct(nb.clicks, nbp.clicks))} par rapport à ${fmtMonth(pm)}` : ""}.`);
  s.push(`Au ${fmtDateL(end)}, ${top3} des ${rows.length} mots-clés suivis sont dans le top 3 (${top3p} fin ${fmtMonth(pm).split(" ")[0]}) et ${top10} dans le top 10, pour une position moyenne de ${fmt1(avg)}${avgP != null ? ` contre ${fmt1(avgP)} un mois plus tôt` : ""}.`);
  if (best && best.d > 0.2) s.push(`Plus forte progression : « ${best.k.keyword} », de la position ${fmt1(best.p)} à ${fmt1(best.c)}.`);
  if (worst && worst.d < -0.2) s.push(`Plus fort recul : « ${worst.k.keyword} », de ${fmt1(worst.p)} à ${fmt1(worst.c)}.`);
  s.push(launched.length ? `${plural(launched.length, "action SEO mise en ligne", "actions SEO mises en ligne")} ce mois-ci.` : "Aucune action SEO mise en ligne ce mois-ci.");
  const effects = acts.filter(a => a.impact && a.impact.clicks_month_adjusted != null && a.impact.clicks_month_adjusted !== 0);
  if (effects.length) s.push(`Effet mesuré des actions : ${effects.map(a => `« ${a.title} » ${a.impact.clicks_month_adjusted > 0 ? "+" : "−"}${fmt(Math.abs(a.impact.clicks_month_adjusted))} clics par mois`).join(", ")}.`);
  if (ups.length) s.push(`Google a déployé ${ups.map(u => `la « ${u.title} » (${fmtDateL(u.begin)})`).join(" et ")}.`);
  const lede = saved.lede ?? s.join(" ");

  const last13 = []; for (let i = 12; i >= 0; i--) last13.push(shiftMonth(m, -i));
  let num = 0;
  const sec = (id, title, body) => blocks.has(id) ? `<section><div class="section-head"><h2>${title}</h2><span class="section-num">${String(++num).padStart(2, "0")}</span></div>${body}</section>` : "";
  const heroCmp = (a, b) => `<div class="cmp">${a} · ${b}</div>`;

  $("view").innerHTML = `
    <div class="view-bar no-print"><div class="left">
      <select id="month" class="ctl sm" aria-label="Mois du rapport">${months.map(x => `<option value="${x}" ${x === m ? "selected" : ""}>${fmtMonth(x)}${complete(x) ? "" : " (en cours)"}</option>`).join("")}</select>
      <div class="menu-wrap"><button class="btn secondary sm" id="blocks-btn">Blocs</button><div class="menu menu-l">${BLOCKS.map(([id, l]) => `<label><input type="checkbox" data-b="${id}" ${blocks.has(id) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
      <button class="btn ghost sm" id="r-copy" ${tip("Copier la synthèse pour un mail")}>${ICON.copy}Copier la synthèse</button>
      <button class="btn ghost sm" id="r-reset" ${saved.lede == null && saved.next == null ? "hidden" : ""}>Rétablir le texte automatique</button>
      <i class="info" tabindex="0" data-tip="La synthèse et les prochaines étapes se modifient directement dans le rapport (gardées dans ce navigateur).">i</i></div>
      <div class="right"><button class="btn" id="r-print">${ICON.print}Imprimer ou PDF</button></div></div>
    ${partial ? `<div class="note-box warn no-print mb-4">Mois en cours : le rapport s'arrête au ${fmtDateL(end)}, dernier jour définitif.</div>` : ""}
    <div class="report">
      <div class="report-head"><div class="logo">${CFG.logo ? `<img src="${esc(CFG.logo)}" alt="" width="22" height="22">` : LOGO}${esc(BRAND)}</div>
        <div class="meta"><div><strong>Client</strong> ${esc(P.label)}</div><div><strong>Période</strong> ${fmtMonth(m)}${partial ? ` (au ${fmtDate(end)})` : ""}</div>${P.market !== "all" ? `<div><strong>Pays</strong> ${esc(P.market_label)}</div>` : ""}${P.owner ? `<div><strong>Consultant</strong> ${esc(P.owner)}</div>` : ""}<div><strong>Source</strong> Google Search Console</div></div></div>
      <h1>Rapport SEO · ${fmtMonth(m)}</h1>
      ${blocks.has("synthese") ? `<p class="lede editable" contenteditable="true" id="r-lede" spellcheck="true">${esc(lede)}</p>` : ""}
      ${blocks.has("chiffres") ? `<div class="hero">
        <div><div class="n">${fmt(nb.clicks)}</div><div class="lbl">Clics hors marque (site)</div>${heroCmp(`${nb1.clicks ? sign(pct(nb.clicks, nb1.clicks)) : "-"} vs N-1`, `${nbp.clicks ? sign(pct(nb.clicks, nbp.clicks)) : "-"} vs M-1`)}</div>
        <div><div class="n">${fmt(cl)}</div><div class="lbl">Clics des mots-clés suivis</div>${heroCmp(`${evo(cl, cl1)} vs N-1`, `${evo(cl, clp)} vs M-1`)}</div>
        <div><div class="n">${top3} / ${top10}</div><div class="lbl">Top 3 / top 10 au ${fmtDate(end)}</div>${heroCmp(`${top3 - top3p >= 0 ? "+" : "−"}${Math.abs(top3 - top3p)} / ${top10 - top10p >= 0 ? "+" : "−"}${Math.abs(top10 - top10p)} vs M-1`, `sur ${rows.length} suivis`)}</div>
        <div><div class="n">${fmt1(avg)}</div><div class="lbl">Position moyenne au ${fmtDate(end)}</div>${heroCmp(`${fmt1(avgP)} au ${fmtDate(pend)}`, avg != null && avgP != null ? (avgP - avg >= 0 ? `gagne ${fmt1(avgP - avg)} place${avgP - avg >= 2 ? "s" : ""}` : `perd ${fmt1(avg - avgP)} place${avg - avgP >= 2 ? "s" : ""}`) : "")}</div>
      </div>` : ""}
      ${sec("trafic", "Trafic hors marque, 13 derniers mois", '<div class="chart-box sm"><canvas id="r-months"></canvas></div><div class="legend mt-2"><span class="lg"><span class="sw" style="background:#101010"></span>Mois du rapport</span><span class="lg"><span class="sw" style="background:#9A9A9A"></span>Mois précédents</span><span class="lg"><span class="sw" style="background:#DADADA"></span>Même mois, un an plus tôt</span></div>')}
      ${sec("motscles", "Mots-clés suivis", `<div class="box"><div class="table-wrap"><table><thead><tr><th>Mot-clé</th><th class="num">Position au ${fmtDate(end)}</th><th class="num">au ${fmtDate(pend)}</th><th class="num">Évolution</th><th class="num">N-1</th><th class="num">Clics</th><th class="num">vs M-1</th></tr></thead><tbody>
        ${rows.slice().sort((a, b) => b.clicks - a.clicks).map(x => `<tr><td><b>${esc(x.k.keyword)}</b></td><td class="num">${fmt1(x.c)}</td><td class="num">${fmt1(x.p)}</td><td class="num">${placesDelta(x.d, x.p, x.c)}</td><td class="num">${fmt1(x.n)}</td><td class="num">${fmt(x.clicks)}</td><td class="num">${pctDelta(x.clicks, x.pclicks, { cmp: "vs M-1", unit: "" })}</td></tr>`).join("")}
        </tbody></table></div></div>`)}
      ${sec("actions", "Actions", acts.length ? `<div class="box"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Action</th><th>Page</th><th class="num">Position moy. avant → après</th><th class="num">Effet</th></tr></thead><tbody>
          ${acts.map(a => `<tr><td>${fmtDate(a.date)}${a.date.slice(0, 7) !== m ? '<div class="light">effet ce mois</div>' : ""}</td><td class="wrap-cell"><b>${esc(a.title)}</b><div class="light">${esc(a.type || "")}</div></td><td style="max-width:220px">${a.page ? urlLink(a.page, { max: 30 }) : ""}</td>
          <td class="num">${a.impact ? fmt1(a.impact.pos_before) + " → " + fmt1(a.impact.pos_after) : "-"}</td><td class="num wrap-cell" style="min-width:120px">${a.impact && a.impact.clicks_month_adjusted != null ? (a.impact.clicks_month_adjusted > 0 ? "+" : a.impact.clicks_month_adjusted < 0 ? "−" : "") + fmt(Math.abs(a.impact.clicks_month_adjusted)) + " clics / mois" : esc(a.reason || "-")}</td></tr>`).join("")}</tbody></table></div></div>`
          : '<p class="muted">Aucune action mise en ligne ou en cours d\'effet ce mois-ci.</p>')}
      ${sec("vigilance", "Points de vigilance du mois", vig.length ? vig.slice(0, 12).map(e => `<div class="feed-row">${sevBadge(e.severity)}<span class="light">${fmtDate(e.date)}</span><b>${esc(e.keyword || tidyText(e.page) || "")}</b><span class="muted">${esc(tidyText(e.text))}</span></div>`).join("") : '<p class="muted">Aucune alerte ce mois-ci.</p>')}
      ${sec("suite", "Prochaines étapes", `<div class="editable next" contenteditable="true" id="r-next" data-placeholder="Écris ici les prochaines étapes.">${esc(saved.next || "")}</div>`)}
      <div class="footer"><div>${esc(BRAND)} · Rapport SEO · ${esc(P.label)}</div><div>${fmtDateL(today())}</div></div>
    </div>`;
  $("month").onchange = e => { ui.month = e.target.value; renderReport(); syncUrl(); };
  menuToggle("blocks-btn");
  $$("[data-b]").forEach(cb => cb.onchange = () => { cb.checked ? blocks.add(cb.dataset.b) : blocks.delete(cb.dataset.b); store.put("reportBlocks:" + P.name, [...blocks]); renderReport(); });
  const persist = () => { const cur = store.json(saveKey, {}); if ($("r-lede")) cur.lede = $("r-lede").innerText.trim(); if ($("r-next")) cur.next = $("r-next").innerText.trim(); store.put(saveKey, cur); $("r-reset").hidden = false; };
  ["r-lede", "r-next"].forEach(id => { if ($(id)) $(id).oninput = persist; });
  $("r-reset").onclick = () => { store.del(saveKey); renderReport(); };
  $("r-copy").onclick = async () => { if (await copyText(($("r-lede") ? $("r-lede").innerText.trim() : lede))) toast("Synthèse copiée"); };
  $("r-print").onclick = () => window.print();
  if (blocks.has("trafic")) {
    const cur = last13.map(x => segSum("nonbrand", monthDates(x).filter(d => d <= lf)).clicks), prev = last13.map(x => segSum("nonbrand", monthDates(shiftMonth(x, -12))).clicks);
    chart("r-months", { type: "bar", data: { labels: last13, datasets: [
        { label: "Un an plus tôt", data: prev, backgroundColor: "#DADADA", borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "bottom", maxBarThickness: 16, categoryPercentage: 0.7, barPercentage: 0.9 },
        { label: "Clics hors marque", data: cur, backgroundColor: last13.map(x => x === m ? "#101010" : "#9A9A9A"), borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "bottom", maxBarThickness: 16, categoryPercentage: 0.7, barPercentage: 0.9 }] },
      options: { maintainAspectRatio: false, animation: false, scales: { y: { ...linScale(), grid: { color: "#F0F0EF" }, ticks: { color: "#6B6B6B", callback: v => fmt(v) } }, x: { grid: { display: false }, ticks: { color: "#6B6B6B", callback: (v, i) => fmtMonthS(last13[i]) } } },
        plugins: { legend: { display: false }, tooltip: { ...tooltip({ title: c => fmtMonth(last13[c[0].dataIndex]), label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y)}` }), backgroundColor: "#fff", titleColor: "#101010", bodyColor: "#101010", borderColor: "#E8E8E8" } } } });
  }
}

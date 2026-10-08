// Panneau de détail d'un mot-clé : dialogue accessible, navigation ← →, lien partageable.
import { app, ui, syncUrl } from "@/state.js";
import { DEF, SEV, TYPES, STATUS } from "@/defs.js";
import { $, $$, esc, fmt, fmt1, fmtDate, norm, issue, path, copyText, shift, tidyText } from "@/util.js";
import { ranges, kstats, cmpLabel, bucket } from "@/data.js";
import { chart, lineDs, posScale, linScale, xScale, tooltip, marksFor, C, PALETTE, destroyCharts, label as chartLabel } from "@/charts.js";
import { ICON, tip, info, placesDelta, posCell, statusTag, targetLabel, urlLink, sevBadge, toast, alertIcon, alertFact } from "@/ui.js";
import { colorOf } from "@/views/keywords.js";

let opener = null;
export const drawerOpen = () => $("app").classList.contains("drawer-open");

function order() {
  const P = app.P;
  const o = (ui.order && ui.order.length && ui.order.every(i => P.kwById.has(i))) ? ui.order : P.keywords.map(k => k.i);
  return o;
}

export function openDrawer(i, { silent = false } = {}) {
  const P = app.P;
  if (!P) return;
  const k = P.kwById.get(i);
  if (!k) return;
  if (!drawerOpen()) opener = document.activeElement;
  ui.openKw = i;
  const R = ranges();
  const st = kstats(k, R);
  const c0 = colorOf(k);
  const color = c0 === C.cmp || !c0 ? PALETTE()[0] : c0;
  const al = P.alerts.filter(a => a.i === i);
  const insp = P.inspection && P.inspection.current[k.page];
  const others = (k.pages || []).filter(p => !p.tracked && p.share >= 5);
  const cl = cmpLabel();
  const o = order(), pos = o.indexOf(i), prev = o[pos - 1], next = o[pos + 1];
  const when = d => `du ${fmtDate(d)} au ${fmtDate(R.to)}`;
  const canonOk = insp && !(insp.googleCanonical && norm(insp.googleCanonical) !== norm(insp.userCanonical));

  // Infos secondaires au survol
  const about = [k.status ? "Statut : " + (STATUS[k.status] || k.status) : "", k.target ? "Objectif : " + targetLabel(k.target) : "", k.tags.length ? "Tags : " + k.tags.join(", ") : "",
    k.variants.length ? "Variantes : " + k.variants.join(", ") : "", k.note ? "Note : " + k.note : ""].filter(Boolean).join("\n");
  const posTip = [`Position au ${fmtDate(R.to)}${st.exact ? "" : " (dernière connue)"}`, `28 j : ${st.d28 == null ? "-" : (st.d28 > 0 ? "gagne " : st.d28 < 0 ? "perd " : "") + fmt1(Math.abs(st.d28))}`,
    `Meilleure : ${fmt1(st.best)}`, `Clics : ${fmt(st.clicks)} (du ${fmtDate(R.sum.from)} au ${fmtDate(R.sum.to)})`, `Impressions sur 28 j : ${fmt(st.demand)}`].join("\n");
  // Signaux : une ligne chacun, le détail au survol
  const sig = (icon, sev, text, detail, right = "") => `<div class="sig" ${tip(detail)}><span class="aico ${sev}">${ICON[icon]}</span><span class="ell">${text}</span>${right ? `<b class="r">${right}</b>` : ""}</div>`;
  const sigs = [
    ...al.map(a => `<div class="sig" ${tip(`${SEV[a.severity]} · ${TYPES[a.type] || a.type}\n${tidyText(a.text)}`)}>${alertIcon(a)}<span class="ell">${esc(alertFact(a))}</span>${a.impact ? `<b class="r" ${tip(DEF.enJeu)}>${fmt(a.impact)} clics / mois</b>` : ""}</div>`),
    al.some(x => x.type === "page") ? "" : st.alt ? sig("swap", "attention", `Autre page en tête : ${esc(path(st.alt[0]))}`, `Le ${fmtDate(R.to)}, ${path(st.alt[0])} a reçu ${fmt(st.alt[1])} impressions (position ${fmt1(st.alt[2])}) contre ${fmt(st.alt[3])} pour la page suivie.`)
      : others.length ? sig("swap", "info", `${others.length === 1 ? "Une autre page capte" : others.length + " autres pages captent"} des impressions`, others.map(p => `${path(p.page)} : ${fmt1(p.share)} %`).join("\n") + "\n(28 jours)") : "",
    insp && insp.verdict && insp.verdict !== "PASS" ? sig("file", "critique", `Non indexée : ${esc(insp.coverageState || insp.verdict)}`, `Vérifiée le ${fmtDate(insp.checked)}`) : "",
    insp && !canonOk ? sig("file", "attention", `Canonique retenue : ${esc(path(insp.googleCanonical))}`, `Vérifiée le ${fmtDate(insp.checked)}`) : ""].filter(Boolean);
  const h4 = (t, extra = "") => `<h4><span>${t}</span>${extra}</h4>`;

  $("drawer").innerHTML = `
    <div class="drawer-head"><div style="min-width:0;flex:1">
      <h3 id="drawer-title">${esc(k.keyword)}${about ? ` <i class="info" tabindex="0" data-tip="${esc(about)}">i</i>` : ""}</h3>
      <div class="mt-2">${urlLink(k.page, { max: 56 })}</div></div>
      <div class="tools">
        <button class="btn ghost icon sm" id="d-prev" ${prev == null ? "disabled" : ""} aria-label="Mot-clé précédent" ${tip("Mot-clé précédent (←)")}>${ICON.left}</button>
        <button class="btn ghost icon sm" id="d-next" ${next == null ? "disabled" : ""} aria-label="Mot-clé suivant" ${tip("Mot-clé suivant (→)")}>${ICON.right}</button>
        ${k.page !== "*" ? `<a class="btn ghost icon sm" href="${issue("action.yml", { projet: P.name, page: k.page, title: "Action : " })}" target="_blank" rel="noopener" aria-label="Consigner une action" ${tip("Consigner une action sur cette page")}>${ICON.pen}</a>` : ""}
        <button class="btn ghost icon sm" id="d-link" aria-label="Copier le lien" ${tip("Copier le lien de ce mot-clé")}>${ICON.link}</button>
        <button class="btn ghost icon sm" id="d-close" aria-label="Fermer" ${tip("Fermer (Échap)")}>${ICON.close}</button></div></div>
    <div class="drawer-body">
      ${sigs.length ? `<div class="sigs">${sigs.join("")}</div>` : ""}
      <div class="mini-kpis">
        <div ${tip(posTip)}><div class="l">Position</div><div class="v">${posCell(st)}</div></div>
        <div><div class="l">7 j</div><div class="v">${placesDelta(st.d7, st.p7, st.pos, when(shift(R.to, -7)))}</div></div>
        <div><div class="l">${R.cmp ? cl.replace("vs ", "") : "Comparaison"}</div><div class="v">${R.cmp ? placesDelta(st.dcmp, st.pc, st.pos, `du ${fmtDate(R.cmp.to)} au ${fmtDate(R.to)}`) : '<span class="light">-</span>'}</div></div>
        <div ${tip(DEF.aGagner)}><div class="l">À gagner / mois</div><div class="v">${st.potential ? "+" + fmt(st.potential) : '<span class="light">-</span>'}</div></div>
      </div>
      ${h4("Position", `<span class="legend" style="text-transform:none;letter-spacing:0;font-weight:400"><span class="lg" ${tip("Page suivie")}><span class="line-sw" style="border-color:${color}"></span>Page</span><span class="lg" ${tip(DEF.positionSite)}><span class="line-sw" style="border-color:${C.site};border-top-width:1.5px"></span>Site</span>${R.cmp ? `<span class="lg" ${tip(`${fmtDate(R.cmp.from)} au ${fmtDate(R.cmp.to)}`)}><span class="line-sw dash" style="border-color:${color}99"></span>${cl.replace("vs ", "")}</span>` : ""}${k.page !== "*" ? `<i class="info" tabindex="0" data-tip="Clic sur la courbe : consigner une action à cette date.">i</i>` : ""}</span>`)}
      <div class="chart-box"><canvas id="d-pos"></canvas></div><div id="d-marks"></div>
      ${h4("Impressions")}
      <div class="chart-box" style="height:110px"><canvas id="d-impr"></canvas></div>
      <details class="fold mt-4" id="d-more"><summary>Détails : pages, variantes, indexation, historique</summary><div>
      ${k.pages && k.pages.length ? `${h4("Qui se positionne", `<span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400">part des impressions</span>`)}<div class="box"><div class="table-wrap"><table><thead><tr><th>Page du site</th><th class="num">28 j</th><th class="num">7 j</th><th class="num">Pos. moy.</th><th class="num">Clics</th></tr></thead><tbody>
        ${k.pages.map(p => `<tr><td>${urlLink(p.page, { max: 36 })}${p.tracked ? ' <span class="badge info">suivie</span>' : ""}</td><td class="num">${fmt1(p.share)} %</td><td class="num">${fmt1(p.share7)} %</td><td class="num">${fmt1(p.pos)}</td><td class="num">${fmt(p.clicks)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${k.variants_detail && k.variants_detail.length > 1 ? `${h4("Variantes", info("variantes"))}<div class="box"><div class="table-wrap"><table><thead><tr><th>Requête</th><th class="num">Pos. moy.</th><th class="num">Clics</th><th class="num">Impressions</th></tr></thead><tbody>
        ${k.variants_detail.map(v => `<tr><td>${esc(v.query)}</td><td class="num">${fmt1(v.pos)}</td><td class="num">${fmt(v.clicks)}</td><td class="num">${fmt(v.impr)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${k.page !== "*" ? `${h4("Indexation", `<a class="btn ghost sm" href="${issue("inspection.yml", { projet: P.name, pages: k.page, title: `Indexation : ${P.label} ${path(k.page)}` })}" target="_blank" rel="noopener">${ICON.sync}Revérifier</a>`)}
        ${insp ? `<div class="insp"><span class="badge ${insp.verdict === "PASS" ? "ok" : "ko"} dotted" ${tip(`Dernier passage de Google : ${insp.lastCrawlTime ? fmtDate(insp.lastCrawlTime.slice(0, 10)) : "-"}\nVérifiée le ${insp.checked ? fmtDate(insp.checked) : "-"}`)}>${insp.verdict === "PASS" ? "Indexée" : esc(insp.coverageState || insp.verdict)}</span>
          <span class="badge ${canonOk ? "ok" : "warn"}">${canonOk ? "Canonique respectée" : "Autre canonique"}</span></div>` : '<p class="empty-note">Pas encore vérifiée.</p>'}` : ""}
      ${k.splits ? `<div class="grid-eq" style="margin:0">${["device", "country"].map(dim => k.splits[dim] && k.splits[dim].length ? `<div>${h4(dim === "device" ? "Appareils" : "Pays")}<div class="box"><table><tbody>
          ${k.splits[dim].slice(0, 5).map(x => `<tr><td>${esc(dim === "device" ? ({ MOBILE: "Mobile", DESKTOP: "Ordinateur", TABLET: "Tablette" }[x.key] || x.key) : x.key.toUpperCase())}</td><td class="num">pos. ${fmt1(x.pos)}</td><td class="num">${fmt(x.clicks)} clics</td></tr>`).join("")}</tbody></table></div></div>` : "").join("")}</div>` : ""}
      ${h4("Jour par jour", `<span class="hint" style="text-transform:none;letter-spacing:0;font-weight:400">60 jours</span>`)}
      <div class="box"><div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Position</th><th class="num">Site</th><th class="num">Clics</th><th class="num">Impr.</th><th>Page en tête</th></tr></thead><tbody>
        ${k.s.slice(-60).reverse().map(p => { const s = k.smap.get(p[0]), a = k.alt[p[0]]; return `<tr><td>${fmtDate(p[0])}${p[4] ? '<span class="fresh-tag">provisoire</span>' : ""}</td><td class="num">${fmt1(p[1])}</td><td class="num">${fmt1(s && s[1])}</td><td class="num">${fmt(p[2])}</td><td class="num">${fmt(p[3])}</td><td>${a ? `<span class="badge warn trunc" ${tip(path(a[0]))}>${esc(path(a[0]))}</span>` : '<span class="light">suivie</span>'}</td></tr>`; }).join("")}</tbody></table></div></div>
      </div></details>
    </div>`;

  $("d-close").onclick = () => closeDrawer();
  $("d-prev").onclick = () => prev != null && openDrawer(prev);
  $("d-next").onclick = () => next != null && openDrawer(next);
  $("d-link").onclick = async () => { syncUrl(); if (await copyText(location.href)) toast("Lien du mot-clé copié"); };

  destroyCharts("d-");
  const pts = d => R.dates.map(x => d.get(x) || null);
  const b = bucket(pts(k.map), R.dates), bs = bucket(pts(k.smap), R.dates);
  const mk = marksFor(b.ranges, { page: k.page });
  const ds = [lineDs("Page suivie", b.pts.map(p => p && p[1]), color, { fresh: b.fresh }),
    lineDs("Site", bs.pts.map(p => p && p[1]), C.site, { width: 1.5, fresh: b.fresh })];
  if (R.cmp) {
    const bc = bucket(R.cmp.dates.map(x => k.map.get(x) || null), R.cmp.dates);
    ds.push(lineDs(cl.replace("vs ", ""), b.labels.map((_, n) => bc.pts[n] ? bc.pts[n][1] : null), color + "99", { dash: [4, 4], width: 1.5 }));
  }
  chart("d-pos", { type: "line", data: { labels: b.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 16 } },
      scales: { y: posScale(ds.flatMap(d => d.data)), x: xScale(b.labels, b.weekly) },
      onHover: (e, els, ch) => { ch.canvas.style.cursor = k.page !== "*" ? "copy" : "default"; },
      onClick: (e, els, ch) => {
        if (k.page === "*") return;
        const n = Math.max(0, Math.min(b.ranges.length - 1, Math.round(ch.scales.x.getValueForPixel(e.x))));
        window.open(issue("action.yml", { projet: P.name, page: k.page, date: b.ranges[n][0], title: "Action : " }), "_blank", "noopener");
      },
      plugins: { legend: { display: false }, marks: { items: mk.items }, freshZone: { fresh: b.fresh },
        tooltip: tooltip({ title: c => chartLabel(b.labels[c[0].dataIndex], b.weekly), label: c => ` ${c.dataset.label} : ${fmt1(c.parsed.y)}` }) } } });
  $("d-marks").innerHTML = mk.html;
  chart("d-impr", { type: "bar", data: { labels: b.labels, datasets: [
      { label: "Impressions", data: b.pts.map(p => p && p[3]), backgroundColor: b.fresh.map(f => f ? color + "55" : color), borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "bottom", maxBarThickness: 16 }] },
    options: { maintainAspectRatio: false, scales: { y: linScale(), x: xScale(b.labels, b.weekly) },
      plugins: { legend: { display: false }, freshZone: { fresh: b.fresh },
        tooltip: tooltip({ title: c => chartLabel(b.labels[c[0].dataIndex], b.weekly) + (b.fresh[c[0].dataIndex] ? " (provisoire)" : ""), label: c => { const p = b.pts[c.dataIndex]; return p ? [` Impressions : ${fmt(p[3])}`, ` Clics : ${fmt(p[2])}`] : ""; } }) } } });

  const app_ = $("app");
  app_.classList.add("drawer-open");
  $("drawer").setAttribute("aria-hidden", "false");
  $$("#tbody tr").forEach(tr => tr.classList.toggle("selected", +tr.dataset.i === i));
  $("drawer").onkeydown = onKey;
  // Focus sur le panneau lui-même (lecteurs d'écran, Tab, flèches) sans ouvrir d'info-bulle
  $("drawer").tabIndex = -1;
  if (!silent || document.activeElement === document.body || !$("drawer").contains(document.activeElement)) $("drawer").focus({ preventScroll: true });
  $("drawer").querySelector(".drawer-body").scrollTop = 0;
  syncUrl();
}

function onKey(e) {
  if (e.key === "ArrowLeft" && !e.target.closest("input, select, textarea")) { e.preventDefault(); $("d-prev").click(); }
  else if (e.key === "ArrowRight" && !e.target.closest("input, select, textarea")) { e.preventDefault(); $("d-next").click(); }
  else if (e.key === "Tab") {
    // Focus piégé dans le panneau
    const f = $$('#drawer a[href], #drawer button:not([disabled]), #drawer summary, #drawer [tabindex="0"]').filter(el => el.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

export function closeDrawer(quiet = false) {
  const was = drawerOpen();
  $("app").classList.remove("drawer-open");
  $("drawer").setAttribute("aria-hidden", "true");
  destroyCharts("d-");
  ui.openKw = null;
  $$("#tbody tr.selected").forEach(tr => tr.classList.remove("selected"));
  if (was && !quiet) { syncUrl(); if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true }); }
  opener = null;
}

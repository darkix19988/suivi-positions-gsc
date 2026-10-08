// Composants d'interface : fonctions qui renvoient du HTML, plus quelques comportements globaux (info-bulles, menus, toasts).
import { ui, store } from "@/state.js";
import { DEF, SEV, STATUS } from "@/defs.js";
import { NA, esc, fmt, fmt1, fmtDate, fmtSigned, path, $, $$, pct, tidyText, humanError } from "@/util.js";

const svg = (d, extra = "") => `<svg class="i${extra}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICON = {
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  download: svg('<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  left: svg('<path d="m15 6-6 6 6 6"/>'),
  right: svg('<path d="m9 6 6 6-6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  check: svg('<path d="m5 12 5 5L20 7"/>'),
  alert: svg('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.01"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  pen: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  sync: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>'),
  chart: svg('<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>'),
  print: svg('<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
  sparkle: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', " sm"),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', " sm"),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', " sm"),
  hash: svg('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  split: svg('<path d="M6 4v6a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6V4"/><path d="M12 16v4M3 7l3-3 3 3M15 7l3-3 3 3"/>'),
  down2: svg('<path d="M3 7l7 7 4-4 7 7"/><path d="M15 17h6v-6"/>'),
  up2: svg('<path d="M3 17l7-7 4 4 7-7"/><path d="M15 7h6v6"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.6M6.6 6.6C4.2 8.2 3 12 3 12s4 6 9 6a9.6 9.6 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  swap: svg('<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>'),
  inbox: svg('<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v6H3v-6Z"/>'),
};

// ---------------------------------------------------------------- info-bulles maison (survol et focus clavier)
export const tip = text => text ? `data-tip="${esc(text)}"` : "";
export const info = key => `<i class="info" tabindex="0" role="note" aria-label="${esc(DEF[key] || key)}" data-tip="${esc(DEF[key] || key)}">i</i>`;
export const def = (label, key) => `<span class="def" tabindex="0" data-tip="${esc(DEF[key] || key)}">${label}</span>`;

export function initTooltips() {
  const t = $("tip");
  let cur = null;
  const show = el => {
    const text = el.getAttribute("data-tip"); if (!text) return;
    cur = el; t.textContent = text; t.classList.add("on");
    const r = el.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    t.style.left = x + "px"; t.style.top = y + "px";
  };
  const hide = () => { cur = null; t.classList.remove("on"); };
  document.addEventListener("mouseover", e => { const el = e.target.closest("[data-tip]"); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
  document.addEventListener("focusin", e => { const el = e.target.closest("[data-tip]"); if (el && e.target.matches(":focus-visible")) show(el); }); // clavier seulement
  document.addEventListener("focusout", hide);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("click", hide);
}

// ---------------------------------------------------------------- notifications
export function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast"; el.innerHTML = ICON.check + esc(msg);
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------------------------------------------------------------- variations
const arrow = d => d > 0 ? "▲" : "▼";
// Gain ou perte de places : positif = gain. tip optionnel « 3,0 → 3,7 »
export function placesDelta(d, from = null, to = null, when = "") {
  if (d == null || !isFinite(d)) return `<span class="delta na">${NA}</span>`;
  const t = from != null && to != null ? `${fmt1(from)} → ${fmt1(to)} : ${Math.abs(d) < 0.05 ? "stable" : (d > 0 ? "gagne " : "perd ") + fmt1(Math.abs(d)) + (Math.abs(d) >= 2 ? " places" : " place")}${when ? "\n" + when : ""}` : "";
  if (Math.abs(d) < 0.05) return `<span class="delta flat" ${tip(t)}>=</span>`;
  return `<span class="delta ${d > 0 ? "up" : "down"}" ${tip(t)}>${arrow(d)} ${fmt1(Math.abs(d))}</span>`;
}
// Variation en % ; sous minBase, l'écart absolu (un % sur 3 clics ne veut rien dire)
export function pctDelta(cur, ref, { minBase = 20, unit = "", cmp = "" } = {}) {
  if (cur == null || ref == null) return `<span class="delta na">${NA}</span>`;
  const t = `${fmt(cur)} contre ${fmt(ref)}${cmp ? " " + cmp.replace(/^vs /, "") : ""}`;
  if (ref < minBase) {
    const d = cur - ref;
    if (!d) return `<span class="delta flat" ${tip(t)}>=</span>`;
    return `<span class="delta ${d > 0 ? "up" : "down"}" ${tip(t)}>${fmtSigned(d)}${unit ? " " + unit : ""}</span>`;
  }
  const p = pct(cur, ref);
  if (Math.abs(p) < 0.5) return `<span class="delta flat" ${tip(t)}>=</span>`;
  return `<span class="delta ${p > 0 ? "up" : "down"}" ${tip(t)}>${arrow(p)} ${fmt(Math.abs(p))} %</span>`;
}
export function ptsDelta(d, t = "") {
  if (d == null || !isFinite(d)) return `<span class="delta na">${NA}</span>`;
  if (Math.abs(d) < 0.05) return `<span class="delta flat" ${tip(t)}>=</span>`;
  return `<span class="delta ${d > 0 ? "up" : "down"}" ${tip(t)}>${arrow(d)} ${fmt1(Math.abs(d))} pt</span>`;
}
export const countDelta = (d, t = "") => d == null ? `<span class="delta na">${NA}</span>` : d === 0 ? `<span class="delta flat" ${tip(t)}>=</span>`
  : `<span class="delta ${d > 0 ? "up" : "down"}" ${tip(t)}>${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}</span>`;
// Variation d'un nombre où « moins » est bon (ex. pages en échec) : non utilisé pour les positions, déjà inversées en amont

// ---------------------------------------------------------------- étiquettes
export const sevBadge = s => `<span class="badge ${s === "critique" ? "ko" : s === "attention" ? "warn" : "info"} dotted">${SEV[s] || esc(s)}</span>`;
export const statusTag = s => s ? `<span class="st st-${s.replace(/\W+/g, "")}">${STATUS[s] || esc(s)}</span>` : "";
export const targetLabel = t => t == null ? NA : t <= 1 ? "1re place" : t === 3 ? "Top 3" : t === 10 ? "Top 10" : "≤ " + fmt(t);
// Fait chiffré d'une alerte, sans répéter son type (déjà dans l'étiquette)
export function alertFact(a) {
  if (a.type === "synchro") return humanError(a.text);
  let t = tidyText(a.text);
  if (a.type === "top3" || a.type === "top10") t = t.replace(/^Sort du top \d+\s*:\s*/, "");
  if (a.type === "indexation") t = t.replace(/^Page non indexée\s*:\s*/, "");
  if (a.type === "page") { const m = t.match(/:\s*(\/\S*)/); if (m) t = "Autre page en tête : " + m[1]; }
  if (a.type === "impressions") t = t.replace(/\s*sur 7 jours\s*/, " ");
  if (a.type === "canonical") t = t.replace(/^Google retient une autre canonique\s*:\s*/, "Canonique retenue : ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export const newBadge = () => `<span class="badge new" ${tip(DEF.nouvelle)}>Nouvelle</span>`;

export const posCell = st => st.pos == null ? `<span class="light">${NA}</span>`
  : `<span class="pos chip ${st.exact ? (st.pos <= 3 ? "top3" : st.pos <= 10 ? "top10" : "far") : "stale"}" ${tip(st.exact ? (st.pos <= 3 ? "Dans le top 3" : st.pos <= 10 ? "Dans le top 10" : "Au-delà du top 10") : `Pas d'impression ce jour-là : dernière position connue, le ${fmtDate(st.cur[0])}`)}>${fmt1(st.pos)}</span>`;

// Chemin court : préfixe du marché retiré, coupe au milieu pour garder la fin (la partie qui distingue les pages)
export function shortPath(u, max = 38, strip = "") {
  let p = path(u), pre = "";
  if (strip && p.startsWith(strip) && p.length > strip.length) { p = "/" + p.slice(strip.length).replace(/^\//, ""); pre = "…"; }
  if (p.length <= max) return { pre, p };
  const segs = p.split("/").filter(Boolean), last = segs[segs.length - 1] || "";
  // Trop long : premier dossier, puis le dernier segment (la fin éventuelle est coupée par le CSS)
  let out = segs.length > 1 ? `/${segs[0]}/…/${last}` : p;
  if (out.length > max) out = (segs.length > 1 ? "…/" : "/") + last;
  return { pre, p: out };
}
export function urlLink(u, { max = 38, strip = "", cls = "url" } = {}) {
  if (!u || u === "*") return `<span class="${cls}"><span class="p">Toutes pages</span></span>`;
  const s = shortPath(u, max, strip);
  return `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener" data-stop data-tip="${esc(u)}">${s.pre ? `<span class="pre">${s.pre}</span>` : ""}<span class="p">${esc(s.p)}</span>${ICON.ext}</a>`;
}

// ---------------------------------------------------------------- petits blocs
export const stat = (lbl, val, sub, key, spark = "", valTip = "") => `<div class="stat"><span class="lbl${key ? " def" : ""}" ${key ? `tabindex="0" data-tip="${esc(DEF[key] || key)}"` : ""}>${lbl}</span>
  <div class="val" ${valTip ? `data-tip="${esc(valTip)}"` : ""}>${val}</div>${sub ? `<div class="sub">${sub}</div>` : ""}${spark}</div>`;

// Courbe en aire pleine largeur (cartes d'indicateurs, cartes projet). invert : la valeur basse est en haut (positions)
let gid = 0;
export function areaSpark(vals, color, { invert = false, h = 40, cls = "kspark", tipText = "" } = {}) {
  const pts = vals.map((v, i) => [i, v]).filter(p => p[1] != null && isFinite(p[1]));
  if (pts.length < 2) return "";
  const ys = pts.map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1, n = vals.length - 1 || 1;
  const X = i => (i / n * 100).toFixed(2), Y = v => ((invert ? (v - lo) / span : 1 - (v - lo) / span) * (h - 6) + 3).toFixed(2);
  const line = pts.map((p, k) => (k ? "L" : "M") + X(p[0]) + " " + Y(p[1])).join("");
  const area = line + `L${X(pts[pts.length - 1][0])} ${h}L${X(pts[0][0])} ${h}Z`;
  const id = "g" + (++gid);
  return `<svg class="${cls}" viewBox="0 0 100 ${h}" preserveAspectRatio="none" aria-hidden="true" ${tipText ? `data-tip="${esc(tipText)}"` : ""}><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/><path class="l" d="${line}" stroke="${color}"/></svg>`;
}

// Icône d'une alerte selon son type
const A_ICON = { baisse: "down2", top3: "down2", top10: "down2", impressions: "down2", disparue: "eyeOff", page: "swap", indexation: "file", canonical: "file", synchro: "sync", hausse: "up2" };
export const alertIcon = a => `<span class="aico ${a.severity}" aria-hidden="true">${ICON[A_ICON[a.type] || "alert"]}</span>`;
export const viewBar = (left, right = "") => `<div class="view-bar"><div class="left">${left}</div><div class="right">${right}</div></div>`;
export const btnLink = (href, lbl, cls = "btn", icon = ICON.plus) => `<a class="${cls}" href="${href}" target="_blank" rel="noopener">${icon}${lbl}</a>`;
export const empty = (title, text = "", icon = ICON.inbox, action = "") => `<div class="empty"><div class="ico">${icon}</div><b>${title}</b>${text ? `<p>${text}</p>` : ""}${action}</div>`;
export const skeleton = () => `<div class="skel-page" aria-busy="true" aria-label="Chargement">
  <div class="row"><div class="skel" style="width:220px;height:30px"></div><div class="spacer"></div><div class="skel" style="width:160px;height:30px"></div></div>
  <div class="skel" style="height:86px;border-radius:16px"></div>
  <div class="skel" style="height:54px;border-radius:16px"></div>
  <div class="card" style="padding:16px">${Array.from({ length: 8 }, () => '<div class="skel skel-line" style="margin:12px 0"></div>').join("")}</div></div>`;

export function sparkline(vals, color, { w = 72, h = 22, invert = false, dot = true } = {}) {
  const ok = vals.filter(v => v != null);
  if (ok.length < 2) return `<span class="light">${NA}</span>`;
  const lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
  let d = "", pen = false, lx = 0, ly = 0;
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const x = (i / (vals.length - 1)) * (w - 6) + 3, yy = (invert ? (v - lo) / span : 1 - (v - lo) / span) * (h - 6) + 3;
    d += (pen ? "L" : "M") + x.toFixed(1) + " " + yy.toFixed(1); pen = true; lx = x; ly = yy;
  });
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>${dot ? `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2" fill="${color}"/>` : ""}</svg>`;
}

// ---------------------------------------------------------------- menus, tri, pagination
export function closeMenus() { $$(".menu-wrap.open").forEach(m => { m.classList.remove("open"); const b = m.querySelector("[aria-expanded]"); if (b) b.setAttribute("aria-expanded", "false"); }); }
export function menuToggle(btnId) {
  const b = $(btnId); if (!b) return;
  b.setAttribute("aria-haspopup", "true"); b.setAttribute("aria-expanded", "false");
  b.onclick = e => { e.stopPropagation(); const w = b.closest(".menu-wrap"), was = w.classList.contains("open"); closeMenus(); w.classList.toggle("open", !was); b.setAttribute("aria-expanded", String(!was)); };
}

// En-têtes triables : state = { key, dir }, asc = clés triées croissant au premier clic
export function sortable(root, state, onChange, asc = []) {
  $$("th[data-sort]", root).forEach(th => {
    const on = th.dataset.sort === state.key;
    th.classList.toggle("sorted", on);
    th.setAttribute("aria-sort", on ? (state.dir > 0 ? "ascending" : "descending") : "none");
    th.tabIndex = 0;
    const ar = th.querySelector(".arrow"); if (ar) ar.textContent = on ? (state.dir > 0 ? "↑" : "↓") : "↕";
    const go = e => {
      if (e.target.closest(".info")) return;
      const k = th.dataset.sort;
      const next = state.key === k ? { key: k, dir: -state.dir } : { key: k, dir: asc.includes(k) ? 1 : -1 };
      onChange(next);
    };
    th.onclick = go;
    th.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e); } };
  });
}
export const th = (lbl, key, { cls = "num", defKey = "", sub = "", sortKey = key } = {}) => {
  const t = [sub, defKey ? DEF[defKey] || defKey : ""].filter(Boolean).join("\n");
  return `<th class="${cls}${defKey ? " def" : ""}" ${sortKey ? `data-sort="${sortKey}"` : ""} ${t ? `data-tip="${esc(t)}"` : ""} scope="col">${lbl}${sortKey ? '<span class="arrow">↕</span>' : ""}</th>`;
};

// Pagination « Afficher plus » : ui.more[key] = nombre de lignes affichées
export function page(list, key, step = 25) {
  const n = ui.more[key] || step;
  return { items: list.slice(0, n), more: list.length > n ? `<div class="more-row"><button class="btn secondary sm" data-more="${key}" data-step="${step}">Afficher ${Math.min(step, list.length - n)} de plus · ${fmt(list.length - n)} restantes</button></div>` : "" };
}
export function bindMore(root, rerender) {
  $$("[data-more]", root).forEach(b => b.onclick = () => { const k = b.dataset.more; ui.more[k] = (ui.more[k] || +b.dataset.step) + +b.dataset.step; rerender(); });
}

// Lignes cliquables atteignables au clavier (Entrée ou Espace)
export function rowNav(root, sel, fn) {
  $$(sel, root).forEach(tr => {
    tr.tabIndex = 0;
    tr.onclick = e => { if (e.target.closest("a, button, input, [data-stop]")) return; fn(tr, e); };
    tr.onkeydown = e => { if ((e.key === "Enter" || e.key === " ") && e.target === tr) { e.preventDefault(); fn(tr, e); } };
  });
}

export const seenTheme = () => store.get("theme") || "light";

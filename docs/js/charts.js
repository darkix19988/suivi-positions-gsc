// Graphiques (Chart.js 4.4.1) : couleurs lues dans les tokens CSS, zone des jours provisoires, ligne de survol, repères G et A.
import { app } from "@/state.js";
import { fmtDate, fmt, fmt1, esc, norm, $ } from "@/util.js";

export const charts = {};
window.charts = charts; // inspection et vérifications

export const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const C = {};
export function readTheme() {
  ["ink", "cmp", "site", "grid", "axis", "text", "bar", "bar-soft", "fresh"].forEach(k => C[k] = cssVar("--chart-" + k));
  C.palette = [1, 2, 3, 4, 5, 6, 7, 8].map(n => cssVar("--chart-" + n));
  C.dist = [1, 2, 3, 4, 5].map(n => cssVar("--dist-" + n));
  C.surface = cssVar("--surface"); C.border = cssVar("--border"); C.text = cssVar("--text");
  if (window.Chart) {
    Chart.defaults.font.family = "Inter, -apple-system, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = C.text;
    Chart.defaults.animation.duration = 250;
  }
}
export const PALETTE = () => C.palette;
export const MAX_SEL = 8;

export const isRankingUpdate = u => (u.service ? u.service === "Ranking" : /update/i.test(u.title)) && !/discover/i.test(u.title);
export const label = (d, weekly) => (weekly ? "sem. du " : "") + fmtDate(d);

let registered = false;
function register() {
  if (registered || !window.Chart) return;
  registered = true;
  // Jours provisoires : zone grisée et libellé
  Chart.register({
    id: "freshZone",
    beforeDatasetsDraw(chart, args, o) {
      const f = o && o.fresh;
      if (!f || !f.some(Boolean)) return;
      const first = f.indexOf(true), { ctx, chartArea: a, scales: { x } } = chart;
      const step = f.length > 1 ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0)) : 20;
      const x0 = Math.max(a.left, x.getPixelForValue(first) - step / 2);
      ctx.save();
      ctx.fillStyle = C.fresh; ctx.fillRect(x0, a.top, a.right - x0, a.bottom - a.top);
      ctx.fillStyle = C.text; ctx.globalAlpha = 0.62; ctx.font = "500 12px Inter, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      if (a.right - x0 > 70) ctx.fillText("provisoire", a.right - 4, a.top + 2);
      ctx.restore();
    },
  });
  // Ligne verticale au survol
  Chart.register({
    id: "crosshair",
    afterDatasetsDraw(chart) {
      const t = chart.tooltip;
      if (!t || !t.getActiveElements || !t.getActiveElements().length || chart.config.type !== "line") return;
      const x = t.getActiveElements()[0].element.x, { ctx, chartArea: a } = chart;
      ctx.save(); ctx.strokeStyle = C.axis; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
    },
  });
  // Repères verticaux : mises à jour Google (G) et actions SEO (A)
  Chart.register({
    id: "marks",
    afterDatasetsDraw(chart, args, opts) {
      const items = opts && opts.items || [];
      if (!items.length) return;
      const { ctx, chartArea: a, scales: { x } } = chart;
      ctx.save();
      items.forEach(m => {
        const px = x.getPixelForValue(m.idx);
        if (px < a.left - 1 || px > a.right + 1) return;
        ctx.strokeStyle = m.kind === "a" ? C.ink : "#8A8A8A"; ctx.globalAlpha = 0.55;
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, a.top + 14); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.fillStyle = m.kind === "a" ? C.ink : "#7A7A7A";
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px - 8, a.top - 2, 16, 16, 4) : ctx.rect(px - 8, a.top - 2, 16, 16); ctx.fill();
        ctx.fillStyle = m.kind === "a" ? C.surface : "#FFFFFF"; ctx.font = "700 12px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(m.kind === "a" ? "A" : "G", px, a.top + 6.5);
      });
      ctx.restore();
    },
  });
  // Avant / après d'une action : période après la mise en ligne ombrée, moyennes avant et après en pointillés
  Chart.register({
    id: "beforeAfter",
    beforeDatasetsDraw(chart, args, o) {
      if (!o || o.idx == null) return;
      const { ctx, chartArea: a, scales: { x } } = chart, px = x.getPixelForValue(o.idx);
      ctx.save(); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--measure"); ctx.fillRect(px, a.top, a.right - px, a.bottom - a.top); ctx.restore();
    },
    afterDatasetsDraw(chart, args, o) {
      if (!o || o.idx == null) return;
      const { ctx, chartArea: a, scales: { x, y } } = chart, px = x.getPixelForValue(o.idx);
      ctx.save();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
      ctx.font = "600 12px Inter, sans-serif"; ctx.fillStyle = C.ink; ctx.textBaseline = "top"; ctx.textAlign = "left";
      ctx.fillText(o.label || "Mise en ligne", px + 6, a.top + 2);
      const seg = (v, x0, x1, txt) => {
        if (v == null) return;
        const py = y.getPixelForValue(v);
        if (py < a.top || py > a.bottom) return;
        ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.55; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 0.85; ctx.font = "500 12px Inter, sans-serif"; ctx.fillStyle = C.ink;
        // Libellé sous la ligne quand elle est trop près du haut (sinon il chevauche « Mise en ligne »)
        const below = py - a.top < 34;
        ctx.textAlign = "right"; ctx.textBaseline = below ? "top" : "bottom"; ctx.fillText(txt, x1 - 4, below ? py + 4 : py - 3); ctx.globalAlpha = 1;
      };
      seg(o.before, a.left, px, o.beforeText);
      seg(o.after, px, a.right, o.afterText);
      ctx.restore();
    },
  });
}

export function tooltip(cb) {
  return { backgroundColor: C.surface, titleColor: C.text, bodyColor: C.text, borderColor: C.border, borderWidth: 1, padding: 10, boxPadding: 5,
    usePointStyle: true, titleFont: { weight: "600" }, callbacks: cb };
}

// Aire dégradée sous une courbe (couleur hexadécimale #RRGGBB)
const gradient = color => ctx => {
  const { chart: ch } = ctx, a = ch.chartArea;
  if (!a) return "transparent";
  const g = ch.ctx.createLinearGradient(0, a.top, 0, a.bottom);
  g.addColorStop(0, color + "2E"); g.addColorStop(1, color + "00");
  return g;
};
export function lineDs(lbl, values, color, { fresh = [], dash = null, width = 2, fill = false } = {}) {
  return { label: lbl, data: values, borderColor: color, backgroundColor: fill ? gradient(color) : color, pointBackgroundColor: color, borderWidth: width, borderDash: dash || undefined,
    pointRadius: values.length > 45 ? 0 : 2.5, pointHoverRadius: 5, pointBorderColor: C.surface, pointBorderWidth: 2, tension: 0.3, spanGaps: false, fill: fill ? "origin" : false,
    segment: { borderDash: ctx => dash || (fresh[ctx.p1DataIndex] ? [5, 4] : undefined) } };
}

// Axe des positions : inversé (1 en haut), graduations entières régulières
export function posScale(vals) {
  const v = vals.filter(x => x != null);
  const max = Math.max(3, ...v);
  const span = max - 1, step = span <= 8 ? 1 : span <= 16 ? 2 : span <= 40 ? 5 : span <= 80 ? 10 : 20;
  const top = Math.ceil((max + (step > 1 ? step * 0.2 : 0.5)) / step) * step;
  return { reverse: true, min: 1, max: Math.max(top, step === 1 ? Math.ceil(max) + 1 : step), grid: { color: C.grid }, border: { display: false },
    ticks: { color: C.text, precision: 0 },
    afterBuildTicks: ax => { const t = [{ value: 1 }]; for (let n = step; n <= ax.max; n += step) if (n > 1) t.push({ value: n }); ax.ticks = t; } };
}
export const linScale = (fmtTick = null) => ({ beginAtZero: true, grid: { color: C.grid }, border: { display: false },
  ticks: { color: C.text, callback: fmtTick || (v => fmt(v)) } });
export const xScale = (labels, weekly = false) => ({ grid: { display: false }, border: { color: C.axis },
  ticks: { color: C.text, maxTicksLimit: 8, maxRotation: 0, autoSkip: true, callback: (v, i) => labels ? label(labels[i], weekly) : v } });

export function chart(id, cfg) {
  register();
  if (charts[id]) charts[id].destroy();
  const el = $(id);
  if (!el || !window.Chart) return null;
  const s = summarize(cfg);
  if (s) { el.setAttribute("role", "img"); el.setAttribute("aria-label", s); }
  charts[id] = new Chart(el, cfg);
  return charts[id];
}
export function destroyCharts(prefix = "") {
  Object.keys(charts).forEach(k => { if (k.startsWith(prefix)) { charts[k].destroy(); delete charts[k]; } });
}

// Résumé texte d'un graphique pour les lecteurs d'écran : dernier point de chaque série
function summarize(cfg) {
  try {
    const ds = cfg.data.datasets.filter(d => d.label);
    return ds.map(d => { const v = [...d.data].reverse().find(x => x != null); return v == null ? "" : `${d.label} : ${typeof v === "number" ? fmt1(v) : v}`; }).filter(Boolean).join(" ; ");
  } catch { return ""; }
}

// Téléchargement d'un graphique en PNG, sur fond de la carte
export function downloadChart(id, filename) {
  const c = charts[id]; if (!c) return;
  const src = c.canvas, out = document.createElement("canvas");
  out.width = src.width; out.height = src.height;
  const ctx = out.getContext("2d"); ctx.fillStyle = C.surface || "#fff"; ctx.fillRect(0, 0, out.width, out.height); ctx.drawImage(src, 0, 0);
  const a = document.createElement("a"); a.href = out.toDataURL("image/png"); a.download = filename; a.click();
}

// Repères G (mises à jour Google « Ranking ») et A (actions) qui tombent dans les tranches du graphique
export function marksFor(ranges, opts = {}) {
  const P = app.P, items = [], legend = [];
  const find = d => ranges.findIndex(r => r[0] <= d && d <= r[1]);
  (app.IDX.google_updates || []).filter(isRankingUpdate).forEach(u => { const idx = find(u.begin); if (idx >= 0) {
    items.push({ idx, kind: "g" }); legend.push(`<span><span class="mk g">G</span>${fmtDate(u.begin)} · <a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a></span>`); } });
  if (P && opts.actions !== false) (P.actions || []).filter(a => !opts.page || norm(a.page) === norm(opts.page)).forEach(a => {
    const idx = find(a.date); if (idx >= 0) { items.push({ idx, kind: "a" }); legend.push(`<span><span class="mk a">A</span>${fmtDate(a.date)} · ${esc(a.title)}</span>`); }
  });
  return { items, html: legend.length ? `<div class="marks">${legend.join("")}</div>` : "" };
}

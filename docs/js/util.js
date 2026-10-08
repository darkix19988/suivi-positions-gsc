// Outils sans état : formatage fr-FR, dates, URL, texte.

export const NA = "-";
// Réglages de l'instance (docs/config.js) : repo des formulaires, adresse des données, marque blanche.
// Seul fichier à adapter pour un autre hébergeur ou une autre marque.
export const CFG = window.APP_CONFIG || {};
export const REPO = CFG.repo || "darkix19988/suivi-positions-gsc";
export const DATA = (CFG.dataBase || "data/").replace(/\/?$/, "/");
export const BRAND = CFG.brand || "datashake";
export const PRODUCT = CFG.product || "Positions";
export const GH = "https://github.com/" + REPO;

const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmt = n => n == null || !isFinite(n) ? NA : nf0.format(Math.round(n));
export const fmt1 = n => n == null || !isFinite(n) ? NA : nf1.format(n);
export const fmtPct = (n, signed = false) => n == null || !isFinite(n) ? NA : (signed && n > 0 ? "+" : n < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(n))) + " %";
export const fmtSigned = n => n == null || !isFinite(n) ? NA : (n > 0 ? "+" : n < 0 ? "−" : "") + nf0.format(Math.abs(Math.round(n)));
export const pct = (a, b) => b ? (a - b) / b * 100 : null;
export const plural = (n, one, many) => `${fmt(n)} ${Math.abs(n) > 1 ? many : one}`;

const D = d => new Date(d + "T12:00:00");
export const fmtDate = d => d ? D(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : NA;
export const fmtDateL = d => d ? D(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : NA;
export const fmtDateY = d => d ? D(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : NA;
export const fmtDayL = d => d ? D(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : NA;
export const fmtMonth = m => new Date(m + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
export const fmtMonthS = m => new Date(m + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
export const today = () => new Date().toISOString().slice(0, 10);
export const shift = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const ndays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const calDates = (a, b) => { const out = []; for (let d = a; d <= b; d = shift(d, 1)) out.push(d); return out; };
export const monthDates = m => { const out = []; let d = m + "-01"; while (d.slice(0, 7) === m) { out.push(d); d = shift(d, 1); } return out; };
export const lastDay = m => monthDates(m).pop();
export const shiftMonth = (m, n) => { const t = new Date(m + "-01T00:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 7); };
// « depuis 3 jours », « hier »
export const ago = d => { const n = ndays(d, today()); return n <= 0 ? "aujourd'hui" : n === 1 ? "hier" : `il y a ${n} jours`; };

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const norm = u => (u || "").replace(/\/$/, "");
export const $ = id => document.getElementById(id);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const issue = (template, params) => `${GH}/issues/new?template=${template}&` + new URLSearchParams(params).toString();
export const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

// Chemin d'une URL (sans domaine)
export const path = u => { if (!u || u === "*") return "Toutes pages"; try { const x = new URL(u); return decodeURIComponent(x.pathname + x.search); } catch { return u; } };

// Chemin court : on retire un préfixe commun (dossier du marché, /blogs/conseils-experts/…) affiché en gris clair
export function splitPath(u, prefix = "") {
  const p = path(u);
  if (prefix && p.startsWith(prefix) && p.length > prefix.length) return { pre: "…/", rest: p.slice(prefix.length) };
  return { pre: "", rest: p };
}
// Préfixe commun d'une liste de chemins, coupé au dernier « / » (au moins 2 niveaux pour valoir le coup)
export function commonPrefix(urls) {
  const ps = urls.filter(u => u && u !== "*").map(path);
  if (ps.length < 2) return "";
  let pre = ps[0];
  for (const p of ps) { let i = 0; while (i < pre.length && i < p.length && pre[i] === p[i]) i++; pre = pre.slice(0, i); if (!pre) return ""; }
  pre = pre.slice(0, pre.lastIndexOf("/") + 1);
  return (pre.match(/\//g) || []).length >= 3 ? pre : "";
}

// Texte d'alerte venu du calcul : URL complètes réduites au chemin, dates ISO en français
export const tidyText = t => String(t || "")
  .replace(/https?:\/\/[^\s)«»"]+/g, u => path(u))
  .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_, d) => fmtDate(d));

// Erreur de synchro brute (JSON de l'API) traduite en phrase
export function humanError(e) {
  const s = String(e || "");
  const code = (s.match(/\b(4\d\d|5\d\d)\b/) || [])[1];
  if (/invalid_grant|refresh token|401/i.test(s)) return "connexion Google expirée, il faut reconnecter le compte";
  if (code === "403" || /permission/i.test(s)) return "accès refusé par la Search Console (le compte n'a plus les droits sur la propriété)";
  if (code === "429" || /quota/i.test(s)) return "quota de la Search Console dépassé, nouvel essai à la prochaine synchro";
  if (code && code[0] === "5") return "erreur temporaire de la Search Console, nouvel essai à la prochaine synchro";
  if (/timed? ?out|délai/i.test(s)) return "la Search Console n'a pas répondu à temps";
  return s.length > 90 ? s.slice(0, 90) + "…" : s || "erreur inconnue";
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch { const a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} a.remove(); return ok; }
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

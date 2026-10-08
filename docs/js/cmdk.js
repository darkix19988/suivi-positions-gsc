// Recherche rapide (⌘K / Ctrl K) : projets, onglets, mots-clés, pages suivies et commandes. Plus l'aide des raccourcis (?).
import { app, ui, store, VIEWS, saveRange, syncUrl } from "@/state.js";
import { $, esc, fold, path, copyText, isMac, issue } from "@/util.js";
import { ICON, toast } from "@/ui.js";
import { openDrawer } from "@/drawer.js";

let items = [], idx = 0, lastFocus = null;
export const cmdkOpen = () => !$("cmdk").hidden;

function commands() {
  const P = app.P, c = [];
  const set = (fn, msg) => () => { fn(); if (msg) toast(msg); app.rerender(); };
  if (P) {
    [["7", "7 jours"], ["28", "28 jours"], ["90", "90 jours"], ["365", "12 mois"], ["0", "Tout l'historique"]].forEach(([v, l]) =>
      c.push({ group: "Commandes", label: `Période : ${l}`, run: set(() => { ui.range = { preset: v }; saveRange(); }) }));
    [["n1", "année précédente"], ["prev", "période précédente"], ["none", "aucune"]].forEach(([v, l]) =>
      c.push({ group: "Commandes", label: `Comparaison : ${l}`, run: set(() => { ui.cmp = { mode: v }; saveRange(); }) }));
    c.push({ group: "Commandes", label: ui.fresh ? "Exclure les jours provisoires" : "Inclure les jours provisoires", run: set(() => { ui.fresh = !ui.fresh; store.set("fresh", ui.fresh ? "1" : "0"); }) });
    c.push({ group: "Commandes", label: "Copier le lien de cette vue", run: async () => { syncUrl(); if (await copyText(location.href)) toast("Lien de la vue copié"); } });
    c.push({ group: "Commandes", label: "Ajouter une action", hint: "formulaire GitHub", run: () => window.open(issue("action.yml", { projet: P.name, title: "Action : " }), "_blank", "noopener") });
    c.push({ group: "Commandes", label: "Suivre des mots-clés", hint: "formulaire GitHub", run: () => window.open(issue("mot-cle.yml", { projet: P.name, title: "Mots-clés : " }), "_blank", "noopener") });
  }
  c.push({ group: "Commandes", label: "Thème clair", run: () => import("@/chrome.js").then(m => m.setTheme("light")) });
  c.push({ group: "Commandes", label: "Thème sombre", run: () => import("@/chrome.js").then(m => m.setTheme("dark")) });
  c.push({ group: "Commandes", label: "Thème du système", run: () => import("@/chrome.js").then(m => m.setTheme("system")) });
  c.push({ group: "Commandes", label: "Réduire ou déplier le menu", hint: "m", run: () => import("@/chrome.js").then(m => m.toggleRail()) });
  c.push({ group: "Commandes", label: "Raccourcis clavier", hint: "?", run: openKeys });
  return c;
}

function build(scope) {
  const { IDX, P } = app, out = [];
  if (scope !== "projets") {
    out.push({ group: "Navigation", label: "Portefeuille", hint: "0", go: "#/" }, { group: "Navigation", label: "Guide d'utilisation", go: "#/guide" });
  }
  IDX.projects.forEach(p => out.push({ group: "Projets", label: p.label, hint: p.property, go: `#/${p.name}`, icon: `<span class="avatar">${esc(p.label[0])}</span>` }));
  if (scope === "projets") return out;
  if (P) VIEWS.forEach(([v, l], n) => out.push({ group: P.label, label: l, hint: String(n + 1), go: `#/${P.name}/${v}` }));
  commands().forEach(c => out.push(c));
  if (P) P.keywords.filter(k => k.page !== "*").forEach(k => out.push({ group: "Pages suivies · " + P.label, label: path(k.page), hint: k.keyword, kw: k.i, site: P.name }));
  IDX.projects.slice().sort((a, b) => (P && b.name === P.name) - (P && a.name === P.name)).forEach(p => (p.kw || []).forEach(([i, kw]) =>
    out.push({ group: "Mots-clés · " + p.label, label: kw, kw: i, site: p.name, hint: P && P.name === p.name ? path((P.kwById.get(i) || {}).page) : "" })));
  return out;
}

let scopeNow = "";
export function openCmdk(scope = "") {
  lastFocus = document.activeElement;
  scopeNow = scope;
  const box = $("cmdk");
  box.hidden = false;
  box.innerHTML = `<div class="cmdk-box" role="dialog" aria-modal="true" aria-label="Recherche rapide">
    <div class="cmdk-in">${ICON.search}<input id="cmdk-q" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list"
      placeholder="${scope === "projets" ? "Aller au projet…" : "Projet, onglet, mot-clé, page ou commande"}" autocomplete="off" spellcheck="false"></div>
    <div class="cmdk-list" id="cmdk-list" role="listbox"></div>
    <div class="cmdk-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> naviguer</span><span><span class="kbd">Entrée</span> ouvrir</span><span><span class="kbd">Échap</span> fermer</span><span><span class="kbd">${isMac ? "⌘" : "Ctrl"} K</span> ouvrir de partout</span></div></div>`;
  box.onclick = e => { if (e.target === box) closeCmdk(); };
  const q = $("cmdk-q");
  q.oninput = render;
  q.onkeydown = e => {
    if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); paint(); }
    else if (e.key === "Enter" && items[idx]) { e.preventDefault(); go(items[idx]); }
    else if (e.key === "Tab") e.preventDefault();
  };
  render();
  q.focus();
}
export function closeCmdk() {
  const box = $("cmdk");
  if (!box || box.hidden) return;
  box.hidden = true; box.innerHTML = "";
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
function render() {
  const q = fold($("cmdk-q").value.trim());
  const all = build(scopeNow);
  const words = q.split(/\s+/).filter(Boolean);
  items = (words.length ? all.filter(it => { const s = fold(it.label + " " + (it.hint || "") + " " + it.group); return words.every(w => s.includes(w)); })
    : all.filter(it => !/^Mots-clés|^Pages suivies|^Commandes/.test(it.group))).slice(0, 60);
  idx = 0;
  paint();
}
function paint() {
  let g = null;
  $("cmdk-list").innerHTML = items.map((it, n) => {
    const head = it.group !== g ? `<div class="cmdk-g" role="presentation">${esc(it.group)}</div>` : "";
    g = it.group;
    return head + `<div class="cmdk-it ${n === idx ? "on" : ""}" id="ck-${n}" role="option" aria-selected="${n === idx}" data-n="${n}"><span class="l">${it.icon || ""}<span>${esc(it.label)}</span></span>${it.hint ? `<span class="light">${esc(it.hint)}</span>` : ""}</div>`;
  }).join("") || '<div class="empty-note" style="padding:14px">Aucun résultat. Essaie un nom de projet, un mot-clé ou « période ».</div>';
  $("cmdk-q").setAttribute("aria-activedescendant", items.length ? "ck-" + idx : "");
  $("cmdk-list").querySelectorAll("[data-n]").forEach(el => { el.onclick = () => go(items[+el.dataset.n]); el.onmousemove = () => { if (idx !== +el.dataset.n) { idx = +el.dataset.n; paint(); } }; });
  const on = $("cmdk-list").querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
}
function go(it) {
  lastFocus = null;
  closeCmdk();
  if (it.run) return it.run();
  if (it.kw != null) {
    const target = `#/${it.site}/mots-cles`;
    if (app.P && app.P.name === it.site && app.route.view === "mots-cles") openDrawer(it.kw);
    else location.hash = `${target}?kw=${it.kw}`;
  } else location.hash = it.go;
}

// ---------------------------------------------------------------- aide des raccourcis
export function openKeys() {
  lastFocus = document.activeElement;
  const box = $("cmdk");
  const K = (...k) => k.map(x => `<span class="kbd">${x}</span>`).join("");
  box.hidden = false;
  box.innerHTML = `<div class="cmdk-box" role="dialog" aria-modal="true" aria-labelledby="keys-t">
    <div class="card-head ruled"><h2 id="keys-t">Raccourcis clavier</h2><button class="btn ghost icon sm" id="keys-x" aria-label="Fermer">${ICON.close}</button></div>
    <dl class="keys">
      <dt>${K(isMac ? "⌘" : "Ctrl", "K")}</dt><dd>Recherche rapide : projet, onglet, mot-clé, page, commande</dd>
      <dt>${K("/")}</dt><dd>Filtrer le tableau des mots-clés</dd>
      <dt>${K("1")} à ${K("7")}</dt><dd>Onglets du projet (Mots-clés, Trafic, Actions, Opportunités, Cannibalisation, Rapport, À traiter)</dd>
      <dt>${K("0")}</dt><dd>Portefeuille</dd>
      <dt>${K("[")} ${K("]")}</dt><dd>Projet précédent ou suivant, même onglet</dd>
      <dt>${K("←")} ${K("→")}</dt><dd>Dans le panneau de détail : mot-clé précédent ou suivant du tableau</dd>
      <dt>${K("m")}</dt><dd>Réduire ou déplier le menu</dd>
      <dt>${K("Échap")}</dt><dd>Fermer le panneau, la recherche ou un menu</dd>
      <dt>${K("?")}</dt><dd>Cette aide</dd>
    </dl></div>`;
  box.onclick = e => { if (e.target === box) closeCmdk(); };
  $("keys-x").onclick = closeCmdk;
  $("keys-x").focus();
}

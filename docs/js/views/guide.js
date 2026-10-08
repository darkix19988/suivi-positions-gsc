// Guide d'utilisation : prise en main, lecture de l'écran, règles de calcul, lexique (généré depuis les définitions des info-bulles).
import { app } from "@/state.js";
import { DEF, GLOSSARY, MIN_IMPR_DAY } from "@/defs.js";
import { $, $$, esc, GH, isMac } from "@/util.js";
import { ICON, viewBar, placesDelta, pctDelta, sevBadge, newBadge, statusTag } from "@/ui.js";

export function renderGuide() {
  const first = app.IDX.projects[0] ? app.IDX.projects[0].name : "";
  const K = (...k) => k.map(x => `<span class="kbd">${x}</span>`).join(" ");
  const cmd = isMac ? "⌘" : "Ctrl";
  const sections = [
    ["matin", "Le check du matin"], ["onglets", "Les onglets"], ["ecran", "Lire l'écran"], ["position", "La position"], ["barre", "Période et comparaison"],
    ["tableau", "Le tableau des mots-clés"], ["saisir", "Saisir"], ["rapport", "Le rapport"], ["clavier", "Raccourcis"], ["lexique", "Lexique"], ["limites", "Limites"], ["nouveautes", "Nouveautés"]];
  $("view").innerHTML = `<div class="guide">
    ${viewBar("<h1>Guide d'utilisation</h1>")}
    <div class="toc">${sections.map(([id, l]) => `<button class="chip" data-go="${id}">${l}</button>`).join("")}</div>

    <div class="card" id="g-matin"><h2>Le check du matin, en 2 minutes</h2><ol>
      <li><b>Portefeuille</b> : le bloc « À traiter, tous projets » liste les alertes ouvertes de tous tes projets, <b>les nouvelles en premier</b> (pastille ${newBadge()}). Le filtre « Nouvelles » montre seulement ce qui est apparu depuis ta dernière visite.</li>
      <li>Clique une alerte : le projet s'ouvre directement sur le mot-clé concerné, avec sa courbe et la page en tête.</li>
      <li>Regarde la colonne <b>Données au</b> : en rouge, la synchro du projet a un problème (le bandeau du projet dit lequel).</li>
      <li>Pour un projet précis, l'onglet <b>À traiter</b> (touche ${K("7")}) donne les alertes avec le dernier point connu, une mini-courbe de 21 jours et les mouvements de la semaine.</li>
      <li>Une alerte traitée ? Consigne l'action menée (bouton « Action ») : son effet sera mesuré automatiquement.</li>
    </ol></div>

    <div class="card" id="g-onglets"><h2>Les onglets</h2><div class="qa">
      <a href="#/${first}/mots-cles"><b>1 · Mots-clés</b><span>L'onglet d'arrivée : position du jour de chaque mot-clé suivi, vue d'ensemble repliable (hausses, baisses, entrées et sorties du top, par tag). « Par page » : indexation et requêtes de chaque page suivie.</span></a>
      <a href="#/${first}/trafic"><b>2 · Trafic du site</b><span>Données globales du site, jamais mélangées aux mots-clés suivis : clics hors marque, marque, total, impressions. « Par dossier » : le trafic de chaque dossier, ses pages et mots-clés gagnés ou perdus.</span></a>
      <a href="#/${first}/actions"><b>3 · Actions</b><span>Journal des optimisations et leur effet mesuré, avec un graphique avant / après et un verdict prêt à copier pour le client.</span></a>
      <a href="#/${first}/opportunites"><b>4 · Opportunités</b><span>Mots-clés suivis à pousser (clics à gagner) et requêtes à ajouter au suivi.</span></a>
      <a href="#/${first}/cannibalisation"><b>5 · Cannibalisation</b><span>Requêtes partagées entre plusieurs pages, paires de pages en concurrence avec une piste d'action, mots-clés suivis qui changent de page.</span></a>
      <a href="#/${first}/rapport"><b>6 · Rapport</b><span>Rapport mensuel figé sur son mois, synthèse modifiable, imprimable en PDF.</span></a>
      <a href="#/${first}/a-traiter"><b>7 · À traiter</b><span>Alertes et mouvements sur 7 jours, au dernier jour définitif.</span></a>
    </div></div>

    <div class="card" id="g-ecran"><h2>Lire l'écran</h2><div class="legend-grid">
      <div>${placesDelta(1.2)} ${placesDelta(-0.7)}</div><div>Variation de <b>position</b> en places. <b>Vert = gain de places</b> (la position baisse en chiffre, c'est une bonne nouvelle), rouge = recul. Au survol : position avant → après et dates.</div>
      <div>${pctDelta(1200, 1000)} ${pctDelta(800, 1000)}</div><div>Variation en % (clics, impressions). Sous 20 de base, l'écart est donné en valeur absolue (« +12 ») : un pourcentage sur 3 clics ne veut rien dire.</div>
      <div><span class="pos top3">2,1</span> <span class="pos">5,4</span> <span class="pos stale">8,0</span></div><div>Position du jour : en bleu dans le top 3, en gris quand le mot-clé n'a pas eu d'impression ce jour-là (dernière position connue dans les 7 jours).</div>
      <div>${sevBadge("critique")} ${sevBadge("attention")}</div><div>Gravité d'une alerte. Urgent : sortie du top 10, page disparue, page non indexée, synchro en échec. À surveiller : recul, sortie du top 3, baisse d'impressions, autre page en tête, canonique non respectée.</div>
      <div>${newBadge()}</div><div>${esc(DEF.nouvelle)}</div>
      <div><span class="sev-dot critique"></span> <span class="sev-dot attention"></span></div><div>Point à côté d'un mot-clé : une alerte est ouverte (rouge urgente, jaune à surveiller). Le filtre « Avec alerte » les isole.</div>
      <div><span class="badge outline">+2</span></div><div>${esc(DEF.variantes)}</div>
      <div><span class="badge warn">Autre page : /c/…</span></div><div>Ce jour-là, une autre page du site a reçu plus d'impressions que la page suivie sur ce mot-clé.</div>
      <div>${statusTag("à travailler")} ${statusTag("en cours")} ${statusTag("acquis")}</div><div>Statut saisi dans le suivi.</div>
      <div><span class="light">Top 3</span> <span class="light">auto</span></div><div>${esc(DEF.objectif)}</div>
      <div><span class="sw fresh"></span> <span class="line-sw dash" style="border-color:var(--text-light)"></span></div><div>Zone grisée et pointillés : jours provisoires, incomplets. Ils ne comptent jamais dans les cumuls de clics.</div>
      <div><span class="mk g">G</span> <span class="mk a">A</span></div><div>Repères sur les courbes : G = mise à jour de classement Google, A = action SEO consignée.</div>
      <div><span class="pick on" style="background:var(--chart-1);display:inline-grid"></span></div><div>Case de gauche du tableau : ajoute le mot-clé aux courbes comparées sous le tableau (8 au maximum, une couleur fixe par mot-clé).</div>
    </div></div>

    <div class="card" id="g-position"><h2>La position</h2><ul>
      <li><b>Une seule définition</b> : la position Google de la page suivie <b>un jour donné</b>, le jour de référence. Par défaut c'est le dernier jour disponible dans la Search Console ; décocher « Jours provisoires » prend le dernier jour consolidé.</li>
      <li>Sans impression ce jour-là, la dernière position connue dans les 7 jours précédents est reprise et affichée en gris.</li>
      <li><b>7 j</b> et <b>28 j</b> comparent la position du jour à celle de 7 et 28 jours plus tôt. La colonne de comparaison compare au dernier jour de la période de comparaison.</li>
      <li>Les <b>mouvements de la semaine</b> et les <b>alertes</b> utilisent exactement la variation 7 j, au dernier jour définitif, avec au moins ${MIN_IMPR_DAY} impressions chacun des deux jours.</li>
      <li>Les tableaux « Qui se positionne », les variantes, les suggestions et la mesure des actions donnent des <b>positions moyennes</b> sur une durée : elles sont libellées « Position moy. ».</li>
    </ul></div>

    <div class="card" id="g-barre"><h2>Période et comparaison</h2><ul>
      <li><b>Pays</b> : tout l'outil se recalcule pour le pays choisi (positions, alertes, trafic, suggestions, rapport). « Tous pays » reste disponible.</li>
      <li><b>Période</b> : 7 j, 28 j, 90 j, 12 mois, Tout ou Dates. Elle fixe le jour de référence (sa fin), les courbes et les mouvements de la vue d'ensemble.</li>
      <li><b>Cumuls sur jours définitifs</b> : les clics et impressions additionnés sont toujours calculés sur des jours complets, sur une période de même longueur, arrêtée au dernier jour définitif. Les jours provisoires sont donnés à part (« + 512 provisoires »). On compare ainsi des jours complets à des jours complets.</li>
      <li><b>Comparaison</b> : année précédente (par défaut, mêmes jours de la semaine), période précédente, dates au choix, ou aucune.</li>
      <li><b>Lien partageable</b> : l'adresse de la page garde la période, la comparaison, le pays, les filtres, le mot-clé ouvert et le dossier ouvert. Le bouton ${ICON.link} de la barre du haut la copie.</li>
    </ul></div>

    <div class="card" id="g-tableau"><h2>Le tableau des mots-clés</h2><ul>
      <li>Le filtre (touche ${K("/")}) accepte du texte ou une <b>regex</b> sur le mot-clé, ses variantes et l'URL (ex. <code>^jean|jeans</code>, <code>/c/costumes</code>). Les indicateurs du haut se recalculent sur les mots-clés filtrés.</li>
      <li><b>Avec alerte</b>, <b>Statut</b> et <b>Tags</b> se filtrent en un clic. <b>Colonnes</b> choisit ce qui s'affiche. <b>Enregistrer la vue</b> garde filtres, colonnes et tri sous un nom (dans ton navigateur).</li>
      <li>Les mots-clés sans aucune impression sur la période sont regroupés en bas.</li>
      <li>Cliquer une ligne ouvre le détail ; dans le détail, ${K("←")} ${K("→")} passent au mot-clé précédent ou suivant du tableau, et un clic sur la courbe ouvre le formulaire d'action à cette date.</li>
      <li>Les chemins de page sont raccourcis (dossier du pays retiré, milieu coupé) : l'adresse complète s'affiche au survol.</li>
    </ul></div>

    <div class="card" id="g-saisir"><h2>Saisir</h2><ol>
      <li><b>Suivre des mots-clés</b> : un mot-clé par ligne, suivi si besoin de « | URL » pour fixer la page (ex. <code>jean homme | https://www.celio.com/fr-fr/c/jeans</code>). Statut, objectif et tags s'appliquent à toute la liste. Depuis Opportunités, cocher des requêtes puis « Suivre la sélection » pré-remplit la liste.</li>
      <li><b>Ajouter une action</b> dès qu'une optimisation est en ligne : son effet est mesuré à 7 puis 28 jours.</li>
      <li><b>Vérifier l'indexation</b> : automatique à l'ajout d'une page, puis à la demande (« Revérifier » dans le détail d'un mot-clé, « Vérifier toutes les pages » dans Mots-clés, Par page).</li>
      <li><b>Nouveau projet</b> : propriété Search Console, regex de marque et pays suivis. Les 20 requêtes hors marque qui font le plus de clics sont ajoutées.</li>
      <li>Les formulaires passent par GitHub (compte collaborateur du repo). Compter 2 à 3 minutes avant de voir le résultat.</li>
    </ol></div>

    <div class="card" id="g-rapport"><h2>Le rapport</h2><ul>
      <li>Il est <b>figé sur son mois</b> : positions au dernier jour du mois, comparées à la fin du mois précédent et à N-1, alertes survenues pendant le mois.</li>
      <li>Le bloc Actions reprend les actions mises en ligne dans le mois <b>et celles dont l'effet se mesure ce mois-là</b>.</li>
      <li>La synthèse et les prochaines étapes se modifient directement dans la page (gardées dans ton navigateur) ; « Copier la synthèse » la met dans le presse-papiers pour un mail. « Blocs » choisit les sections imprimées. Le rapport s'imprime toujours en thème clair.</li>
    </ul></div>

    <div class="card" id="g-clavier"><h2>Raccourcis clavier</h2><dl>
      <dt>${K(cmd, "K")}</dt><dd>Recherche rapide : projet, onglet, mot-clé, page suivie ou commande (période, comparaison, thème, copier le lien).</dd>
      <dt>${K("/")}</dt><dd>Filtrer le tableau des mots-clés.</dd>
      <dt>${K("1")} à ${K("7")}</dt><dd>Onglets du projet. ${K("0")} : portefeuille.</dd>
      <dt>${K("[")} ${K("]")}</dt><dd>Projet précédent ou suivant, en restant sur le même onglet.</dd>
      <dt>${K("←")} ${K("→")}</dt><dd>Dans le panneau de détail : mot-clé précédent ou suivant.</dd>
      <dt>${K("m")}</dt><dd>Réduire ou déplier le menu de gauche.</dd>
      <dt>${K("?")}</dt><dd>Aide des raccourcis.</dd>
    </dl></div>

    <div class="card" id="g-lexique"><h2>Lexique</h2><dl>${GLOSSARY.map(([t, k]) => `<dt>${t}</dt><dd>${esc(DEF[k])}</dd>`).join("")}</dl></div>

    <div class="card" id="g-limites"><h2>Limites</h2><ul>
      <li>La Search Console donne une position par jour, moyennée sur toutes les recherches de la journée : sur un mot-clé peu recherché, elle varie beaucoup d'un jour à l'autre.</li>
      <li>Un mot-clé sans impression n'a pas de position : l'outil ne voit pas au-delà de ce que la Search Console a affiché.</li>
      <li>Pas de volume de recherche ni de relevé de SERP : l'outil n'utilise que la Search Console.</li>
      <li>Vues enregistrées, alertes vues, textes du rapport et préférences sont gardés dans ton navigateur.</li>
    </ul><p class="mt-3">Documentation technique : <a href="${GH}#readme" target="_blank" rel="noopener">README du repo</a>.</p></div>

    <div class="card" id="g-nouveautes"><h2>Nouveautés</h2>
      <h3>Octobre 2026 · nouvelle interface</h3><ul>
        <li>Portefeuille : alertes de tous les projets en un bloc, nouvelles alertes signalées, tableau triable avec tendance sur 13 semaines.</li>
        <li>Cumuls de clics toujours sur jours définitifs, jours provisoires en zone grisée sur toutes les courbes.</li>
        <li>Adresse partageable (période, filtres, mot-clé ouvert), recherche ${K(cmd, "K")} avec commandes, raccourcis clavier, thème sombre, menu réductible.</li>
        <li>Tableau des mots-clés plus dense, chemins lisibles, explication au survol de chaque variation, filtre « Avec alerte ».</li>
        <li>Actions : verdict à copier et graphique à télécharger. Rapport : actions en cours d'effet, impression sans pages blanches.</li>
      </ul></div>
  </div>`;
  $$("[data-go]").forEach(b => b.onclick = () => $("g-" + b.dataset.go).scrollIntoView({ behavior: "smooth", block: "start" }));
}

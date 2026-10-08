// Vocabulaire de l'outil : libellés, définitions des info-bulles, lexique du guide. Une notion = un terme, partout.

export const MIN_IMPR_DAY = 20; // identique à tracker.py : seuil des mouvements et des alertes

export const SEV = { critique: "Urgent", attention: "À surveiller", info: "Info" };
export const TYPES = { baisse: "Recul", top3: "Sortie du top 3", top10: "Sortie du top 10", hausse: "Progression", disparue: "Page disparue",
  impressions: "Baisse d'impressions", page: "Autre page en tête", indexation: "Page non indexée", canonical: "Canonique non respectée",
  synchro: "Synchro", inspection: "Indexation" };
export const STATUS = { "à travailler": "À travailler", "en cours": "En cours", "acquis": "Acquis" };
export const DIST = [
  { name: "Top 3", test: p => p != null && p <= 3, v: "--dist-1" }, { name: "4 à 10", test: p => p > 3 && p <= 10, v: "--dist-2" },
  { name: "11 à 20", test: p => p > 10 && p <= 20, v: "--dist-3" }, { name: "Au-delà de 20", test: p => p > 20, v: "--dist-4" },
  { name: "Sans donnée", test: p => p == null, v: "--dist-5" }];

export const DEF = {
  position: "Position Google de la page suivie le jour de référence : le dernier jour disponible, ou le dernier jour définitif si les jours provisoires sont exclus. Sans impression ce jour-là, la dernière position connue dans les 7 jours précédents est reprise (en gris).",
  posMoy: "Moyenne des positions des mots-clés au jour de référence. La variation compare au dernier jour de la période de comparaison, sur les mots-clés qui ont une position aux deux dates.",
  d7: "Position du jour de référence contre position 7 jours plus tôt. C'est la même variation qui alimente les mouvements de la semaine et les alertes (avec au moins 20 impressions chacun des deux jours).",
  d28: "Position du jour de référence contre position 28 jours plus tôt.",
  dcmp: "Position du jour de référence contre position au dernier jour de la période de comparaison.",
  best: "Meilleure position journalière sur la période affichée.",
  url: "Page du site qui a reçu le plus d'impressions sur le mot-clé le jour de référence, quand ce n'est pas la page suivie.",
  demande: "Impressions du site sur le mot-clé, toutes pages, sur les 28 jours qui finissent au jour de référence. C'est la demande réellement vue dans la Search Console, faute de volume de recherche.",
  positionSite: "Position du site toutes pages confondues. Si elle diffère de la page suivie, une autre page du site se positionne aussi.",
  top: "Nombre de mots-clés dont la page est dans le top 3 ou le top 10 au jour de référence.",
  clicsSuivis: "Clics apportés par les mots-clés suivis, sur leur page suivie uniquement, sur les jours définitifs de la période.",
  visibilite: "Clics captés au jour de référence par rapport à ce que le site obtiendrait en 1re position sur tous ses mots-clés suivis, pondérés par leurs impressions sur 28 jours. 100 % = tout en 1re position.",
  aGagner: "Clics supplémentaires par mois si la page atteint son objectif (ou, sans objectif, le top 3, ou la 1re place si elle y est déjà), calculés avec le taux de clic réel du client à chaque position.",
  objectif: "Position visée pour le mot-clé, saisie dans le suivi. Elle sert au calcul des clics à gagner. « auto » : pas d'objectif saisi, l'outil vise le top 3 (ou la 1re place si la page y est déjà).",
  horsMarque: "Clics Google sur toutes les requêtes qui ne contiennent pas le nom de la marque (fautes de frappe comprises).",
  marque: "Clics Google sur les requêtes qui contiennent le nom de la marque.",
  anonymes: "Requêtes trop rares que Google masque dans le détail : leurs clics comptent dans le total mais ni en marque ni en hors marque.",
  marcheDossier: "Quand on filtre à la fois sur un pays et sur un dossier d'URL, la Search Console retire les requêtes masquées : le total complet du dossier dans ce pays n'existe pas. Les chiffres de ce marché sont donc ceux des requêtes connues.",
  dossiersConnus: "Dans un marché pays, la Search Console ne donne pas de total complet par page : les dossiers additionnent les requêtes connues. En « Tous pays », ils comptent tous les clics.",
  tronque: "Jours où la Search Console a atteint sa limite de 50 000 lignes exposées : l'outil les redemande pays par pays, mais une partie de la longue traîne peut manquer.",
  n1: "Même période, un an plus tôt (décalée de 364 jours pour comparer les mêmes jours de la semaine).",
  provisoire: "Les 2 à 3 derniers jours de la Search Console ne sont pas consolidés : ils sont incomplets et réécrits à la synchro suivante. Ils apparaissent dans une zone grisée sur les courbes et ne comptent jamais dans les cumuls de clics, pour comparer des jours complets à des jours complets.",
  cumuls: "Cumuls calculés sur les jours définitifs uniquement, sur une période de même longueur que celle choisie. Les jours provisoires, incomplets, sont donnés à part.",
  dossier: "Pages regroupées par premier dossier de l'URL, détecté automatiquement : après le dossier du pays déclaré ou le préfixe de langue (fr-fr, es-es…). Un dossier compte à partir de 5 pages vues dans la Search Console ou de 1 % des clics. Les pages sans dossier sont dans « Pages de premier niveau », chaque sous-domaine à part, les petits dossiers dans « Autres pages ».",
  pagesActives: "Pages du dossier qui ont eu au moins une impression sur les 28 jours des tops (recalculés chaque lundi, dates affichées dans le détail du dossier). L'écart compare à N-1 ou à la période précédente.",
  part: "Part des clics du marché faite par le dossier sur la période.",
  repartition: "Mots-clés du dossier avec au moins 10 impressions sur 28 jours, par position moyenne. L'écart compare au même calcul sur la période de comparaison.",
  cannib: "Requêtes hors marque (28 derniers jours) dont au moins deux pages du site font chacune 20 % des impressions ou plus, dans le top 30, avec au moins 100 impressions. C'est une cannibalisation probable : la Search Console ne dit pas si les pages apparaissent ensemble dans la même page de résultats (double présence, souvent positive) ou à tour de rôle (vraie concurrence).",
  cannibDemande: "Impressions de la requête sur 28 jours, toutes pages du site.",
  cannibDemandePart: "Part des impressions hors marque du site qui va à des requêtes cannibalisées, sur les 28 mêmes jours.",
  cannibPiste: "Piste indicative selon le type des deux pages. C'est l'intention de la requête qui tranche : à vérifier avant d'agir.",
  cannibPerte: "Impressions qui ne vont pas à la page principale (celle qui en fait le plus) : c'est la part de la demande dispersée. Les tableaux sont triés sur cette colonne.",
  alternance: "Page qui fait le plus d'impressions sur le mot-clé, jour par jour (jours avec au moins 5 impressions). Un mot-clé apparaît ici quand la page en tête change au moins 3 fois en 28 jours : Google hésite entre plusieurs pages.",
  impact: "Clics par jour après l'action moins clics par jour avant, corrigés de la tendance des mots-clés non travaillés (groupe témoin), ramenés à un mois.",
  enJeu: "Clics par mois perdus si le recul se confirme, calculés avec le taux de clic réel du client à chaque position.",
  nouvelle: "Alerte apparue depuis ta dernière visite sur cet écran (mémorisé dans ton navigateur).",
  variantes: "Requêtes proches regroupées avec le mot-clé (pluriel, accents, ordre des mots) : leurs impressions et clics s'additionnent.",
  ctr: "Taux de clic : clics divisés par impressions.",
};

// Lexique du guide, dans l'ordre de lecture
export const GLOSSARY = [
  ["Position", "position"], ["Position moyenne", "posMoy"], ["7 j, 28 j, comparaison", "d7"], ["Meilleure", "best"], ["Impr. / mois", "demande"],
  ["Clics (mots-clés suivis)", "clicsSuivis"], ["Visibilité", "visibilite"], ["À gagner / mois", "aGagner"], ["Objectif", "objectif"], ["Clics en jeu", "enJeu"],
  ["Hors marque", "horsMarque"], ["Marque", "marque"], ["Requêtes masquées", "anonymes"], ["N-1", "n1"], ["Jours provisoires", "provisoire"], ["Cumuls", "cumuls"],
  ["Variantes", "variantes"], ["Autre page en tête", "url"], ["Taux de clic", "ctr"],
  ["Dossier", "dossier"], ["Part", "part"], ["Pages actives", "pagesActives"], ["Répartition d'un dossier", "repartition"],
  ["Cannibalisation", "cannib"], ["Impressions dispersées", "cannibPerte"], ["Mots-clés instables", "alternance"],
  ["Effet d'une action", "impact"], ["Nouvelle alerte", "nouvelle"]];

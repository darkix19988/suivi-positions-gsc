# Suivi de positions GSC

Outil de suivi et de reporting SEO à partir de la Google Search Console, version BigQuery. La Search Console est collectée dans BigQuery (16 mois puis chaque jour), les calculs lourds tournent en SQL, et un site statique est publié à partir des résultats : https://darkix19988.github.io/suivi-positions-gsc/

GitHub garde le code et la configuration (`config/`), BigQuery garde toutes les données, le site statique (`dist/`) se publie sur n'importe quel hébergeur (GitHub Pages aujourd'hui, Cloudflare Pages ou Vercel demain).

## Ce que fait le dashboard

- **Une seule définition de la position** : la position Google de la page suivie un jour donné, le jour de référence (dernier jour disponible, ou dernier jour consolidé si l'on décoche « Jours provisoires »). Sans impression ce jour-là, la dernière position connue dans les 7 jours est reprise et affichée en gris.
- **Barre du haut** : pays (déclarés par projet), période en boutons cliquables (7 j, 28 j, 90 j, 12 mois, Tout, Dates), comparaison (année précédente par défaut, période précédente, dates au choix, aucune), jours provisoires inclus ou non, recherche rapide ⌘K / Ctrl+K (projets, onglets, mots-clés).
- **Portefeuille** : un projet par ligne (alertes, clics hors marque 28 j et N-1, position moyenne, top 10).
- **Ordre des onglets** : Mots-clés (onglet d'arrivée d'un projet), Trafic du site, Actions, Opportunités, Cannibalisation, Rapport, et À traiter tout à droite (`#/<projet>/a-traiter`).
- **À traiter** : alertes et mouvements sur 7 jours, au dernier jour définitif. Chaque alerte rappelle le dernier point connu depuis (souvent provisoire), pour voir si le recul est confirmé ou rattrapé. Alertes et mouvements utilisent la même variation (jour J contre J-7, 20 impressions minimum chacun des deux jours).
- **Mots-clés** : bande d'indicateurs, puis section « Vue d'ensemble » repliée par défaut (son titre résume hausses, baisses, entrées et sorties du top 3) (plus fortes hausses et baisses, entrées et sorties du top 3 et du top 10, évolution de la position moyenne, de la visibilité, des clics ou de la répartition avec la période de comparaison, tableau par tag). Ses mouvements (hausses, baisses, entrées et sorties) sont mesurés sur la période choisie : position la veille du premier jour contre position du dernier jour. Puis le tableau (en-tête collant, dates de chaque variation sous les en-têtes) (position du jour, variation vs comparaison, 7 j, 28 j, meilleure position, URL du jour, impressions sur 28 j, clics, clics à gagner, statut, objectif, tendance), filtre texte ou regex, filtres statut et tags, choix des colonnes, vues enregistrées, export CSV. Indicateurs recalculés sur les mots-clés filtrés. Graphique replié : répartition des positions dans le temps, ou courbes des mots-clés cochés. Vue « Par page » : indexation et requêtes de chaque page suivie.
- **Détail d'un mot-clé** : position du jour et variations, courbe page suivie, site et période de comparaison, URL du jour, pages qui captent le mot-clé, variantes, indexation, appareils et pays, historique jour par jour avec la page en tête.
- **Trafic du site** : clics hors marque, marque, total, impressions, contre la période de comparaison, par jour et par mois. Sous-vue **Par dossier** : le trafic de chaque dossier du site, détecté automatiquement (tableau triable, clics, part, impressions, CTR, position moyenne, pages actives), et par dossier sa courbe, ses pages en hausse, en baisse, apparues et disparues, ses mots-clés (hors marque ou tous) en hausse, en baisse, nouveaux et perdus, la répartition de ses mots-clés par position et sa concentration. Découpage par langue en plus quand le site a des préfixes de langue.
- **Actions** : journal des actions SEO avec mesure d'impact avant/après corrigée par un groupe témoin. Chaque action a son graphique avant / après annoté (mise en ligne, période mesurée en jaune, moyennes avant et après), un verdict en clair et une barre de progression pendant la mesure ; bilan cumulé en haut de l'onglet. Un clic sur la courbe d'un mot-clé (panneau de détail) ouvre le formulaire d'action pré-rempli à cette date. Le formulaire refuse une date dans le futur ou de plus de 16 mois.
- **Opportunités** : clics à gagner des mots-clés suivis (vers leur objectif), suggestions de requêtes à suivre, sélection multiple pour les ajouter en une fois.
- **Cannibalisation** : requêtes hors marque dont les impressions se partagent entre plusieurs pages (au moins deux pages à 20 % des impressions ou plus, dans le top 30, 100 impressions minimum sur 28 jours), par requête ou par paire de pages avec une piste d'action, et mots-clés suivis dont la page en tête change souvent. Calculée dans BigQuery sur toutes les requêtes, sans limite de lignes.
- **Rapport** : rapport mensuel figé sur son mois (positions au dernier jour du mois, alertes du mois), synthèse et prochaines étapes modifiables, blocs au choix, impression PDF.
- **Repères** sur les courbes : G = mise à jour de classement Google, A = action SEO.

## Indexation

L'état d'indexation (inspection d'URL) est vérifié automatiquement la première fois qu'une page est suivie, puis à la demande : bouton « Revérifier » dans le détail d'un mot-clé, « Vérifier toutes les pages » dans Mots-clés > Par page (formulaire `inspection.yml`), ou `python scripts/tracker.py inspect <projet> [--pages-file liste.txt]`. Une inspection prend environ 6 à 7 secondes par page, d'où l'abandon de la vérification quotidienne.

## Synchro et publication

Un seul workflow, `.github/workflows/sync.yml` : collecte GSC → BigQuery, calcul du dashboard depuis BigQuery, puis publication du site statique sur GitHub Pages (source « GitHub Actions »). Aucune donnée n'est commitée.

- **Planifié** : 23h17 UTC, puis rattrapage à 5h17 UTC ignoré si la synchro du soir a réussi (la file de GitHub retarde souvent les tâches planifiées de plusieurs heures).
- **Push** : une modification de `config/` ne collecte que les projets touchés (`tracker.py changed`), une modification du code ou du front recalcule et republie sans appel GSC.
- **Manuel** : `gh workflow run sync.yml -R darkix19988/suivi-positions-gsc -f mode=sync -f site=bathroomgraffiti -f days=10` (`mode=build` pour recalculer seulement).
- **Formulaires** : `issues.yml` écrit dans `config/` puis lance `sync.yml` sur le projet concerné.

`scripts/publish.py` prépare `dist/` : front + données, fichiers versionnés par leur contenu (plus d'incrément manuel de `?v=`), règles de cache pour Cloudflare Pages (`_headers`) et Vercel (`vercel.json`). Pour changer d'hébergeur : publier `dist/` ailleurs (`wrangler pages deploy dist`, `vercel deploy dist --prod`). Pour servir les données depuis une autre adresse (bucket, CDN) : `dataBase` dans `docs/config.js`. Le front lit `data/manifest.json` (jamais mis en cache), puis les autres fichiers avec la version du manifest : un fichier n'est retéléchargé que s'il a changé.

## Saisir depuis le dashboard

Les boutons « Ajouter une action », « Suivre un mot-clé » et « Nouveau projet » ouvrent un formulaire GitHub (issue). À l'envoi, le workflow `issues.yml` vérifie que l'auteur est collaborateur du repo, écrit dans `config/`, recalcule ou relance la synchro, commente l'issue puis la ferme. Il faut un compte GitHub collaborateur du repo (réglé dans `docs/config.js`).

Le formulaire « Suivre des mots-clés » accepte une liste (un mot-clé par ligne, « mot-clé | URL » pour fixer la page) ; tags, statut et objectif s'appliquent à toute la liste.

On peut aussi éditer directement les fichiers :

- `config/sites.yaml` : les projets (propriété GSC, compte Google, référent, regex de marque, pays suivis).
- `config/keywords/<projet>.yaml` : les mots-clés, leur page, leurs variantes, tags, statut (`à travailler`, `en cours`, `acquis`), objectif de position (`target`) et note.
- `config/actions/<projet>.yaml` : le journal des actions.

Un nouveau mot-clé, un nouveau projet ou un nouveau pays déclenche automatiquement la récupération de 16 mois d'historique. Un nouveau projet est pré-rempli avec ses 20 premières requêtes hors marque par clics.

## Connecter la Search Console

L'outil lit la GSC avec les droits d'un compte Google @datashake.fr, via OAuth (scope lecture seule de la Search Console). Aucun utilisateur ni compte de service n'est ajouté sur les propriétés clients (l'agence n'en a pas le droit). BigQuery a sa propre identité, sans aucun accès à la GSC (voir « Architecture BigQuery »).

- App OAuth : client « Application de bureau » du projet Google Cloud `ds-suivi-positions-gsc` (organisation datashake.fr, écran de consentement Interne, donc réservé aux comptes @datashake.fr et sans validation Google).
- Compte principal (`default`) : theo@datashake.fr. Seules les propriétés où le compte est déclaré sont accessibles.
- Secrets GitHub : `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REFRESH_TOKEN`, plus `GSC_REFRESH_TOKEN_<COMPTE>` par compte supplémentaire.

Pour connecter un compte (le sien, pour suivre ses propres clients) :

```bash
pip install -r requirements.txt
python scripts/oauth_login.py chemin/vers/client_secret.json --label pierre --env-file chemin/vers/.claude/secrets/.env
```

Le navigateur s'ouvre, on se connecte, le script liste les propriétés accessibles et pose le secret `GSC_REFRESH_TOKEN_PIERRE`. Ensuite :

1. ajouter la ligne `GSC_REFRESH_TOKEN_PIERRE: ${{ secrets.GSC_REFRESH_TOKEN_PIERRE }}` dans les blocs `env` de `.github/workflows/sync.yml` et `issues.yml` (GitHub bloque les workflows qui reçoivent tous les secrets d'un coup, chaque secret doit donc être nommé) ;
2. déclarer `account: pierre` sur les projets de ce compte dans `config/sites.yaml`.

Sans `--label`, le script remplace le compte principal.

Compte hors organisation datashake.fr (ex. analytics@upearly.fr) : l'app interne le refuse (« org_internal »). On réutilise alors le jeton d'une autre app OAuth déjà autorisée pour ce compte, en posant trois secrets `GSC_CLIENT_ID_<COMPTE>`, `GSC_CLIENT_SECRET_<COMPTE>` et `GSC_REFRESH_TOKEN_<COMPTE>`, déclarés tous les trois dans les blocs `env` des workflows. Sans `GSC_CLIENT_ID_<COMPTE>`, c'est l'app interne qui est utilisée.

## Digest Slack (optionnel)

Avec un secret `SLACK_WEBHOOK_URL` (webhook entrant Slack), la synchro du matin poste les nouvelles alertes, et le lundi un récap de tous les projets. Sans ce secret, l'étape ne fait rien.

## Dossiers du site

Détection automatique, par marché, à chaque calcul : on lit l'hôte (chaque sous-domaine est une section à part, www et sans www fusionnés), puis on retire le dossier du pays déclaré (`path`) ou le préfixe de langue détecté (`fr-fr`, `es-es`…, retenu seulement si plusieurs codes de langue sont bien présents ou s'ils couvrent au moins 30 % des pages), puis on prend le premier segment. Un segment devient un dossier à partir de 5 pages vues dans la GSC ou de 1 % des clics, 15 dossiers au plus ; les pages sans dossier vont dans « Pages de premier niveau », le reste dans « Autres pages ». Un dossier déjà détecté est conservé. Chaque section porte une regex RE2, appliquée dans BigQuery.

Tout est calculé en SQL, sans appel GSC : courbes quotidiennes (`section_daily`, mise à jour sur les jours réécrits, tout l'historique quand les dossiers changent) et comparaisons sur 28 jours contre la période précédente et N-1 (pages et mots-clés gagnants, perdants, apparus, disparus, répartition des positions), recalculées à chaque synchro.

En « tous pays », les dossiers comptent tous les clics (table `raw_pages`, requêtes masquées comprises). Dans un marché pays, la GSC ne donne pas de total complet par page et par pays : les dossiers y sont la somme des requêtes connues (voir « Données que la GSC ne montre pas »).

## Architecture BigQuery

Projet Google Cloud `BQ_PROJECT` (défaut `ds-suivi-positions-gsc`), dataset `BQ_DATASET` (défaut `gsc`), région `BQ_LOCATION` (défaut `EU`). Tables communes à tous les projets (colonne `site`), partitionnées par jour (filtre de date obligatoire), rangées par site :

| Table | Grain | Source |
|---|---|---|
| `raw_queries` | site × jour × pays × page × requête | GSC, export complet jour par jour (requêtes connues) |
| `raw_pages` | site × jour × page | GSC, totaux complets par page, tous pays |
| `raw_totals` | site × jour × pays | GSC, totaux complets du site par pays |
| `kw_site` | site × marché × jour × requête | GSC, position « site » des mots-clés suivis (agrégée par propriété) |
| `segments` | site × marché × jour × segment | GSC, marque et hors marque (et total d'un marché limité à un dossier) |
| `tracked_daily` | site × jour × pays × requête × page | calculée : lignes des mots-clés suivis, mise à jour sur les seuls jours réécrits |
| `section_daily` | site × marché × dossier × jour | calculée : courbes des dossiers |
| `state` | site × clé | état de l'outil (statut, indexation, dossiers détectés, historiques déjà récupérés) |
| `runs` | une ligne par synchro et par étape | durée, appels GSC, requêtes et octets facturés, erreurs |

- **Collecte** (`scripts/gsc.py`) : un appel par jour pour le détail (en parallèle), par tranches de 30 jours pour les totaux. Premier passage : 16 mois ; ensuite les 10 derniers jours et les jours manquants. Un jour qui atteint la limite de lignes exposées par la GSC (50 000) est redemandé pays par pays, et noté.
- **Écriture** (`scripts/bq.py`) : tout part dans une table tampon (chargements gratuits, par paquets de 200 000 lignes, mémoire bornée quelle que soit la taille du site), puis une transaction par table remplace exactement les périmètres collectés (site, marché, requête, dates), pour tous les projets d'un coup. Un projet en erreur ne touche à rien.
- **Calcul** (`scripts/sql.py`) : chaque lecture couvre tous les projets et tous les marchés en une requête ; les requêtes indépendantes tournent en parallèle. Le reste (alertes, impact des actions, courbe de CTR, visibilité) tourne en Python sur les séries des mots-clés suivis, déjà réduites par BigQuery.
- **Identité** : compte de service `suivi-positions-bq` (droits BigQuery sur le dataset `gsc` uniquement, aucun accès à la Search Console), utilisé par GitHub Actions sans clé grâce à Workload Identity Federation (pool `github`, limité au repo). En local : jeton OAuth dédié `BQ_REFRESH_TOKEN`.
- **Garde-fous de coût** : plafond par requête `BQ_MAX_GB` (5 Go par défaut), plafond du projet à 50 Gio de requêtes par jour (quota `QueryUsagePerDay`), budget avec alertes sur le compte de facturation.
- **Suivi** : `SELECT * FROM gsc.runs ORDER BY started_at DESC` donne la durée, les appels GSC et le coût de chaque synchro.

## Pays

Chaque projet peut déclarer ses pays dans `config/sites.yaml` (`countries: [fra, bel]` ou forme longue `{code: fra, label: France, path: /fr-fr/}`). Le détail est collecté une fois pour tous les pays ; les marchés en sont des filtres (pays, dossier d'URL), calculés dans BigQuery. `path` limite en plus les totaux du site, la position « site » des mots-clés et les suggestions aux URL qui contiennent ce dossier. Le premier pays déclaré est celui affiché par défaut et celui du portefeuille et du digest Slack.

## Données et calculs

- Toutes les données sont dans BigQuery (voir « Architecture BigQuery »), conservées au-delà des 16 mois de la GSC.
- `docs/data/` : fichiers du dashboard, recalculés à chaque synchro, jamais enregistrés dans le repo. `index.json` (portefeuille), `<projet>[.<pays>].json` (tout le calculé d'un marché), `<projet>[.<pays>].sections.json` (dossiers, chargé à la demande), `manifest.json` (version des données).
- Position : celle du jour (point quotidien de la GSC). Variations : jour J contre J-7, J-28 ou dernier jour de la période de comparaison.
- Alertes et mouvements : variation J contre J-7 au dernier jour définitif, 20 impressions minimum chacun des deux jours. Recul : 1 place si top 3, 2 si top 10, 3 sinon. Sortie du top 3 ou du top 10 : recul d'au moins 1 place. Les règles sont évaluées sur tout l'historique : le rapport d'un mois passé reprend les alertes de ce mois.
- Courbe de CTR : calculée par position sur les mots-clés suivis du client (90 jours), sans courbe générique.
- Clics à gagner : impressions du site sur 28 jours × (CTR à l'objectif − CTR à la position du jour). Objectif saisi, sinon top 3, ou 1re place si déjà dans le top 3.
- Indice de visibilité : clics potentiels captés au jour de référence / clics potentiels en 1re position, pondérés par les impressions sur 28 jours.
- Impact d'une action : 28 jours avant contre 28 jours après (7 minimum), en position moyenne et en clics, corrigé par la tendance des mots-clés non travaillés.

## Données que la GSC ne montre pas

La Search Console retire certaines données selon la façon dont on l'interroge (règles vérifiées le 2026-10-07 sur Bathroom Graffiti, voir `scripts/gsc.py`). Rien n'est perdu sans être mesuré : chaque fichier de marché porte un bloc `data_quality`, pas encore affiché dans le dashboard.

| Ce qui manque | Où | Ce que l'outil garde |
|---|---|---|
| Requêtes masquées par Google (environ 42 % des clics sur Bathroom Graffiti, 17 % sur Celio) | tout le détail par requête | les totaux complets (`raw_totals`, `raw_pages`) et la part masquée (`hidden_clicks_share`) |
| Total complet d'un marché limité à un dossier d'URL (pays + page) | marchés avec `path` (ex. Celio France `/fr-fr/`) | le total des requêtes connues, le total complet du pays (`country_clicks`) et `market_totals: named_only` |
| Total complet par page dans un pays | dossiers d'un marché pays | la somme des requêtes connues, `page_totals: named_only` |
| Lignes au-delà de 50 000 par jour | très gros sites | redemande pays par pays, jours concernés listés dans `truncated_days` |

## Lancer en local

```bash
pip install -r requirements.txt
export GSC_CLIENT_ID=… GSC_CLIENT_SECRET=… GSC_REFRESH_TOKEN=…        # Search Console
export BQ_REFRESH_TOKEN=… BQ_PROJECT=ds-suivi-positions-gsc           # BigQuery (ou identifiants Google par défaut)
python scripts/tracker.py sync --days 10      # collecte + calcul
python scripts/tracker.py build               # calcul seul, sans appel GSC
python scripts/publish.py && python -m http.server 8765 -d dist
```

`TRACKER_TODAY=AAAA-MM-JJ` fige le jour de référence (comparer deux versions du calcul), `CONFIG_DIR` et `OUT_DIR` pointent vers une autre configuration ou un autre dossier de sortie (tests de charge).

## Limites

- La GSC donne une position par jour, moyennée sur toutes les recherches de la journée : sur un mot-clé peu recherché, elle varie beaucoup d'un jour à l'autre.
- Un jour sans impression n'a pas de donnée : la courbe s'interrompt, la position du jour reprend la dernière connue (7 jours au plus).
- Les 2 à 3 derniers jours sont provisoires et réécrits aux runs suivants.
- Une part des clics vient de requêtes anonymisées par Google, invisibles dans le détail (la part est affichée sous le trafic, voir « Données que la GSC ne montre pas »).
- Pas de volume de recherche ni de relevé de SERP : l'outil n'utilise que la Search Console. La colonne « Impr./mois » donne la demande vue par la GSC.
- Les vues enregistrées, les colonnes choisies et les textes modifiés du rapport sont gardés dans le navigateur de chaque consultant.
- Le contrôle du contenu des pages (catalogue, title) n'est pas possible depuis GitHub Actions sur les sites protégés contre les robots (Celio renvoie 403).

## Confidentialité

Le repo et la page GitHub Pages sont publics (phase de test). Pour passer en production : repo privé et dashboard derrière une authentification (Cloudflare Pages + Cloudflare Access par exemple).

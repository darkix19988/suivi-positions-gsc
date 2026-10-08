"""Calculs dans BigQuery. Chaque fonction couvre tous les projets et tous leurs marchés en une requête (un job), et ne
renvoie que des résultats déjà agrégés. Les marchés arrivent en paramètre JSON : site, code, pays (vide = tous pays),
dossier d'URL, regex de marque.

Périmètre d'un marché :
- pays : `country` ; dossier d'URL : la page contient le dossier (comme le filtre « page contient » de la GSC) ;
- totaux par page complets (requêtes masquées comprises) : seulement en « tous pays » sans dossier (table raw_pages),
  la GSC ne les donne pas pays par pays (voir gsc.py) ; ailleurs, somme des requêtes connues (raw_queries).
"""

import json
from collections import defaultdict

import bq

M = """m AS (SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.market') market, JSON_VALUE(x,'$.country') country,
              JSON_VALUE(x,'$.path') path, JSON_VALUE(x,'$.brand') brand, DATE(JSON_VALUE(x,'$.since')) since
       FROM UNNEST(JSON_QUERY_ARRAY(@j_markets)) x)"""
IN_MARKET = "(m.country IS NULL OR {a}.country = m.country) AND (m.path IS NULL OR STRPOS({a}.page, m.path) > 0)"
PAT = """pat AS (SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.market') market, JSON_VALUE(x,'$.grouping') grp,
                CAST(JSON_VALUE(x,'$.ord') AS INT64) ord, JSON_VALUE(x,'$.section') section, JSON_VALUE(x,'$.rx') rx
         FROM UNNEST(JSON_QUERY_ARRAY(@j_patterns)) x WHERE JSON_VALUE(x,'$.rx') IS NOT NULL),
grp AS (SELECT DISTINCT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.market') market, JSON_VALUE(x,'$.grouping') grp
         FROM UNNEST(JSON_QUERY_ARRAY(@j_patterns)) x)"""
CLS = """cls AS (SELECT d.site, d.market, g.grp, d.page,
                IFNULL(ARRAY_AGG(pt.section IGNORE NULLS ORDER BY pt.ord LIMIT 1)[SAFE_OFFSET(0)], 'autres') section
         FROM pages_distinct d JOIN grp g ON g.site = d.site AND g.market = d.market
         LEFT JOIN pat pt ON pt.site = d.site AND pt.market = d.market AND pt.grp = g.grp AND REGEXP_CONTAINS(d.page, pt.rx)
         GROUP BY 1, 2, 3, 4)"""


def markets_json(markets):
    return bq.js(markets)


def pos(p):
    return round(p, 1) if p is not None else None


# ---------------------------------------------------------------- séries (mots-clés suivis, site, segments)

def tracked(markets, wanted, qp_start):
    """Lignes jour × requête × page des mots-clés suivis, par marché : la page suivie (tout l'historique) et, sur 90 jours,
    toutes les pages qui reçoivent au moins 2 impressions dans le périmètre du marché (changement de page)."""
    return bq.submit(f"""WITH {M},
        w AS (SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.query') query, JSON_VALUE(x,'$.page') page
              FROM UNNEST(JSON_QUERY_ARRAY(@j_wanted)) x),
        agg AS (SELECT m.site, m.market, t.date, t.query, t.page, SUM(t.clicks) c, SUM(t.impressions) i,
                       SAFE_DIVIDE(SUM(t.position * t.impressions), SUM(t.impressions)) p,
                       LOGICAL_AND(m.path IS NULL OR STRPOS(t.page, m.path) > 0) in_scope
                FROM {bq.T('tracked_daily')} t JOIN m ON t.site = m.site AND (m.country IS NULL OR t.country = m.country)
                WHERE t.date >= @epoch AND t.site IN UNNEST(@sites) GROUP BY 1, 2, 3, 4, 5)
        SELECT a.site, a.market, a.date, a.query, a.page, a.c, a.i, a.p, w.site IS NOT NULL AS wanted,
               a.date >= @qp_start AND a.in_scope AND a.i >= 2 AS competing
        FROM agg a LEFT JOIN w ON w.site = a.site AND w.query = a.query AND w.page = a.page
        WHERE w.site IS NOT NULL OR (a.date >= @qp_start AND a.in_scope AND a.i >= 2)""",
        {"j_markets": markets_json(markets), "j_wanted": bq.js(wanted), "epoch": bq.EPOCH, "qp_start": qp_start,
         "sites": sorted({m["site"] for m in markets})})


def series(markets):
    """Position « site » des mots-clés suivis, segments marque / hors marque, et total du marché : complet (raw_totals)
    pour un marché sans dossier d'URL, sinon la valeur GSC du dossier (requêtes connues uniquement)."""
    return bq.submit(f"""WITH {M}
        SELECT site, market, 'kw' AS kind, date, query AS k, clicks c, impressions i, position p
        FROM {bq.T('kw_site')} WHERE date >= @epoch AND site IN UNNEST(@sites)
        UNION ALL
        SELECT site, market, segment, date, CAST(NULL AS STRING), clicks, impressions, position
        FROM {bq.T('segments')} WHERE date >= @epoch AND site IN UNNEST(@sites)
        UNION ALL
        SELECT m.site, m.market, 'total', r.date, CAST(NULL AS STRING), SUM(r.clicks), SUM(r.impressions),
               SAFE_DIVIDE(SUM(r.position * r.impressions), SUM(r.impressions))
        FROM {bq.T('raw_totals')} r JOIN m ON r.site = m.site AND (m.country IS NULL OR r.country = m.country) AND m.path IS NULL
        WHERE r.date >= @epoch AND r.site IN UNNEST(@sites) GROUP BY 1, 2, 3, 4""",
        {"j_markets": markets_json(markets), "epoch": bq.EPOCH, "sites": sorted({m["site"] for m in markets})})


# ---------------------------------------------------------------- fenêtres de 28 jours (une seule lecture de raw_queries)

def windows(markets, pages, wanted, c_start, p_start, end, limits):
    """Une lecture des 56 derniers jours de raw_queries pour tous les projets, quatre résultats :
    - page_queries : requêtes de chaque page suivie, 28 j et 28 j précédents (60 premières par impressions) ;
    - suggestions : requêtes hors marque du marché (28 j, meilleure page, impressions des 28 j précédents) ;
    - cannib : requêtes hors marque partagées par au moins 2 pages fortes (cannibalisation) ;
    - country : répartition par pays des couples suivis (marché « tous pays »)."""
    return bq.submit(f"""WITH {M},
        pg AS (SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.page') page FROM UNNEST(JSON_QUERY_ARRAY(@j_pages)) x),
        w AS (SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.query') query, JSON_VALUE(x,'$.page') page
              FROM UNNEST(JSON_QUERY_ARRAY(@j_wanted)) x),
        base AS (SELECT m.site, m.market, m.country IS NULL AS all_countries, r.country, r.date >= @c_start AS cur, r.page, r.query,
                        r.clicks, r.impressions, r.position, (m.path IS NULL OR STRPOS(r.page, m.path) > 0) AS in_path,
                        REGEXP_CONTAINS(r.query, m.brand) AS is_brand
                 FROM {bq.T('raw_queries')} r JOIN m ON r.site = m.site AND (m.country IS NULL OR r.country = m.country)
                 WHERE r.date BETWEEN @p_start AND @end AND r.site IN UNNEST(@sites)),
        pq AS (SELECT b.site, b.market, IF(b.cur, 'cur', 'prev') win, b.page, b.query, SUM(b.clicks) c, SUM(b.impressions) i,
                      SAFE_DIVIDE(SUM(b.position * b.impressions), SUM(b.impressions)) p
               FROM base b JOIN pg ON pg.site = b.site AND pg.page = b.page GROUP BY 1, 2, 3, 4, 5
               QUALIFY ROW_NUMBER() OVER (PARTITION BY site, market, win, page ORDER BY i DESC, query) <= @pq_max),
        nb AS (SELECT site, market, query, page, SUM(IF(cur, clicks, 0)) c, SUM(IF(cur, impressions, 0)) i,
                      SUM(IF(cur, position * impressions, 0)) pw, SUM(IF(cur, 0, impressions)) prev_i
               FROM base WHERE in_path AND NOT is_brand GROUP BY 1, 2, 3, 4),
        sg AS (SELECT site, market, query, SUM(c) c, SUM(i) i, SAFE_DIVIDE(SUM(pw), SUM(i)) p, SUM(prev_i) prev,
                      ARRAY_AGG(IF(i > 0, page, NULL) IGNORE NULLS ORDER BY i DESC, page LIMIT 1)[SAFE_OFFSET(0)] best
               FROM nb GROUP BY 1, 2, 3 HAVING i > 0
               QUALIFY ROW_NUMBER() OVER (PARTITION BY site, market ORDER BY i DESC, query) <= @sg_max),
        cp AS (SELECT site, market, query, page, c, i, ROUND(SAFE_DIVIDE(pw, i), 1) p, SUM(i) OVER (PARTITION BY site, market, query) tot
               FROM nb WHERE i > 0),
        cn AS (SELECT site, market, query, ANY_VALUE(tot) tot_q, SUM(c) cl, ANY_VALUE(tot) - MAX(i) grav,
                      ARRAY_AGG(STRUCT(page, c, i, p) ORDER BY i DESC, page LIMIT 4) pages
               FROM cp WHERE tot >= @cn_min GROUP BY 1, 2, 3
               HAVING COUNTIF(i >= @cn_share * tot AND p <= @cn_pos) >= 2
               QUALIFY ROW_NUMBER() OVER (PARTITION BY site, market ORDER BY grav DESC, query) <= @cn_max),
        ct AS (SELECT b.site, b.market, b.query, b.page, b.country, SUM(b.clicks) c, SUM(b.impressions) i,
                      SAFE_DIVIDE(SUM(b.position * b.impressions), SUM(b.impressions)) p
               FROM base b JOIN w ON w.site = b.site AND w.query = b.query AND w.page = b.page
               WHERE b.all_countries AND b.cur GROUP BY 1, 2, 3, 4, 5)
        SELECT 'pq' kind, site, market, TO_JSON_STRING(STRUCT(win, page, query, c, i, p)) j FROM pq
        UNION ALL SELECT 'sg', site, market, TO_JSON_STRING(STRUCT(query, c, i, p, best, prev)) FROM sg
        UNION ALL SELECT 'cn', site, market, TO_JSON_STRING(STRUCT(query, tot_q AS tot, cl, grav, pages)) FROM cn
        UNION ALL SELECT 'ct', site, market, TO_JSON_STRING(STRUCT(query, page, country, c, i, p)) FROM ct""",
        {"j_markets": markets_json(markets), "j_pages": bq.js(pages), "j_wanted": bq.js(wanted), "c_start": c_start,
         "p_start": p_start, "end": end, "sites": sorted({m["site"] for m in markets}), **limits})


# ---------------------------------------------------------------- dossiers du site

def _pages_src(key_p, key_q, where_p, where_q):
    """Pages d'un marché : complètes (raw_pages) en tous pays sans dossier d'URL, sinon requêtes connues (raw_queries).
    key_* : expression de regroupement (fenêtre ou jour) ; where_* : filtre de dates."""
    return f"""SELECT m.site, m.market, {key_p} AS win, p.page, SUM(p.clicks) c, SUM(p.impressions) i,
                      SUM(p.position * p.impressions) pw
               FROM {bq.T('raw_pages')} p JOIN m ON p.site = m.site AND m.country IS NULL AND m.path IS NULL
               WHERE p.site IN UNNEST(@sites) AND {where_p} GROUP BY 1, 2, 3, 4
               UNION ALL
               SELECT m.site, m.market, {key_q}, q.page, SUM(q.clicks), SUM(q.impressions), SUM(q.position * q.impressions)
               FROM {bq.T('raw_queries')} q JOIN m ON q.site = m.site AND NOT (m.country IS NULL AND m.path IS NULL)
                    AND {IN_MARKET.format(a='q')}
               WHERE q.site IN UNNEST(@sites) AND {where_q} GROUP BY 1, 2, 3, 4"""


WIN = "CASE WHEN {a}.date BETWEEN @ca AND @cb THEN 'cur' WHEN {a}.date BETWEEN @pa AND @pb THEN 'prev' ELSE 'n1' END"
WIN_DATES = "({a}.date BETWEEN @ca AND @cb OR {a}.date BETWEEN @pa AND @pb OR {a}.date BETWEEN @na AND @nb)"


def _win_src():
    return _pages_src(WIN.format(a="p"), WIN.format(a="q"), WIN_DATES.format(a="p"), WIN_DATES.format(a="q"))


def win_params(win):
    return {"ca": win["cur"][0], "cb": win["cur"][1], "pa": win["prev"][0], "pb": win["prev"][1], "na": win["n1"][0], "nb": win["n1"][1]}


def page_snaps(markets, win):
    """Pages de chaque marché sur les trois fenêtres (période, période précédente, N-1) : sert à détecter les dossiers."""
    src = _win_src()
    return bq.submit(f"WITH {M} SELECT site, market, win, page, c, i, SAFE_DIVIDE(pw, i) p FROM ({src})",
                     {"j_markets": markets_json(markets), "sites": sorted({m["site"] for m in markets}), **win_params(win)})


def section_daily(markets, patterns):
    """Recalcule section_daily depuis la date `since` de chaque marché (derniers jours, ou tout l'historique quand les
    dossiers ont changé). Un seul script pour tous les projets."""
    src = _pages_src("p.date", "q.date", "p.date >= @min_since AND p.date >= m.since", "q.date >= @min_since AND q.date >= m.since")
    since = min(m["since"] for m in markets)
    return bq.query(f"""BEGIN TRANSACTION;
        DELETE FROM {bq.T('section_daily')} t WHERE t.date >= @min_since AND t.site IN UNNEST(@sites)
          AND EXISTS (SELECT 1 FROM (SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.market') market, DATE(JSON_VALUE(x,'$.since')) since
                                     FROM UNNEST(JSON_QUERY_ARRAY(@j_markets)) x) s
                      WHERE s.site = t.site AND s.market = t.market AND t.date >= s.since);
        INSERT INTO {bq.T('section_daily')} (site, market, grp, section, date, clicks, impressions, position)
        WITH {M}, {PAT},
          src AS ({src}),
          pages_distinct AS (SELECT DISTINCT site, market, page FROM src),
          {CLS}
        SELECT s.site, s.market, c.grp, c.section, s.win, SUM(s.c), SUM(s.i), SAFE_DIVIDE(SUM(s.pw), SUM(s.i))
        FROM src s JOIN cls c ON c.site = s.site AND c.market = s.market AND c.page = s.page
        GROUP BY 1, 2, 3, 4, 5 HAVING SUM(s.i) > 0;
        COMMIT TRANSACTION;""",
        {"j_markets": markets_json(markets), "j_patterns": bq.js(patterns), "sites": sorted({m["site"] for m in markets}),
         "min_since": since}, max_bytes=20 * 1024 ** 3)


def section_series(sites):
    return bq.submit(f"""SELECT site, market, grp, section, date, clicks c, impressions i, position p
                         FROM {bq.T('section_daily')} WHERE date >= @epoch AND site IN UNNEST(@sites)""",
                     {"epoch": bq.EPOCH, "sites": sorted(sites)})


def section_summary(markets, patterns, win, top, min_impr):
    """Comparaisons de chaque dossier sur 28 jours (vs période précédente et vs N-1) : pages et requêtes (toutes, hors
    marque) gagnantes, perdantes, apparues, disparues, effectifs, clics, répartition des positions. Tout est calculé
    dans BigQuery ; seules les listes (20 lignes) reviennent."""
    src = _win_src()
    item = "STRUCT(k, cc, ci, cp, rc, ri, rp)"
    return bq.submit(f"""WITH {M}, {PAT},
        psrc AS ({src}),
        qsrc AS (SELECT m.site, m.market, {WIN.format(a='q')} win, q.page, q.query, SUM(q.clicks) c, SUM(q.impressions) i,
                        SUM(q.position * q.impressions) pw, ANY_VALUE(REGEXP_CONTAINS(q.query, m.brand)) is_brand
                 FROM {bq.T('raw_queries')} q JOIN m ON q.site = m.site AND {IN_MARKET.format(a='q')}
                 WHERE q.site IN UNNEST(@sites) AND {WIN_DATES.format(a='q')} GROUP BY 1, 2, 3, 4, 5),
        pages_distinct AS (SELECT DISTINCT site, market, page FROM psrc UNION DISTINCT SELECT DISTINCT site, market, page FROM qsrc),
        {CLS},
        items AS (SELECT c.site, c.market, c.grp, c.section, 'pages' kind, p.page k, p.win, p.c, p.i, ROUND(SAFE_DIVIDE(p.pw, p.i), 1) p
                  FROM psrc p JOIN cls c ON c.site = p.site AND c.market = p.market AND c.page = p.page
                  UNION ALL
                  SELECT c.site, c.market, c.grp, c.section, kind, q.query, q.win, SUM(q.c), SUM(q.i), ROUND(SAFE_DIVIDE(SUM(q.pw), SUM(q.i)), 1)
                  FROM qsrc q JOIN cls c ON c.site = q.site AND c.market = q.market AND c.page = q.page,
                       UNNEST(IF(q.is_brand, ['queries'], ['queries', 'queries_nonbrand'])) kind
                  GROUP BY 1, 2, 3, 4, 5, 6, 7),
        wide AS (SELECT site, market, grp, section, kind, k,
                        MAX(IF(win = 'cur', c, NULL)) cc, MAX(IF(win = 'cur', i, NULL)) ci, MAX(IF(win = 'cur', p, NULL)) cp,
                        MAX(IF(win = 'prev', c, NULL)) pc, MAX(IF(win = 'prev', i, NULL)) pi, MAX(IF(win = 'prev', p, NULL)) pp,
                        MAX(IF(win = 'n1', c, NULL)) nc, MAX(IF(win = 'n1', i, NULL)) ni, MAX(IF(win = 'n1', p, NULL)) np
                 FROM items GROUP BY 1, 2, 3, 4, 5, 6),
        cmp AS (SELECT site, market, grp, section, kind, ref, k, cc IS NOT NULL in_cur, IF(ref = 'prev', pc, nc) IS NOT NULL in_ref,
                       IFNULL(cc, 0) cc, IFNULL(ci, 0) ci, cp,
                       IFNULL(IF(ref = 'prev', pc, nc), 0) rc, IFNULL(IF(ref = 'prev', pi, ni), 0) ri, IF(ref = 'prev', pp, np) rp
                FROM wide, UNNEST(['prev', 'n1']) ref),
        topc AS (SELECT site, market, grp, section, kind, SUM(c) top10 FROM (
                   SELECT site, market, grp, section, kind, cc c FROM cmp WHERE ref = 'prev' AND in_cur
                   QUALIFY ROW_NUMBER() OVER (PARTITION BY site, market, grp, section, kind ORDER BY cc DESC) <= 10) GROUP BY 1, 2, 3, 4, 5)
        SELECT c.site, c.market, c.grp, c.section, c.kind, c.ref, TO_JSON_STRING(STRUCT(
          COUNTIF(in_cur) AS active, SUM(IF(in_cur, cc, 0)) AS clicks, ANY_VALUE(t.top10) AS top10,
          COUNTIF(in_ref) AS ref_active, SUM(IF(in_ref, rc, 0)) AS ref_clicks,
          [COUNTIF(in_cur AND ci >= @min_impr AND cp <= 3), COUNTIF(in_cur AND ci >= @min_impr AND cp > 3 AND cp <= 10),
           COUNTIF(in_cur AND ci >= @min_impr AND cp > 10 AND cp <= 20), COUNTIF(in_cur AND ci >= @min_impr AND cp > 20)] AS dist,
          [COUNTIF(in_ref AND ri >= @min_impr AND rp <= 3), COUNTIF(in_ref AND ri >= @min_impr AND rp > 3 AND rp <= 10),
           COUNTIF(in_ref AND ri >= @min_impr AND rp > 10 AND rp <= 20), COUNTIF(in_ref AND ri >= @min_impr AND rp > 20)] AS ref_dist,
          ARRAY_AGG(IF(in_cur AND in_ref AND cc > rc, {item}, NULL) IGNORE NULLS ORDER BY cc - rc DESC, k LIMIT @top) AS `win`,
          ARRAY_AGG(IF(in_cur AND in_ref AND cc < rc, {item}, NULL) IGNORE NULLS ORDER BY cc - rc, k LIMIT @top) AS `lose`,
          ARRAY_AGG(IF(in_cur AND NOT in_ref, {item}, NULL) IGNORE NULLS ORDER BY cc DESC, ci DESC, k LIMIT @top) AS `new`,
          ARRAY_AGG(IF(in_ref AND NOT in_cur, {item}, NULL) IGNORE NULLS ORDER BY rc DESC, ri DESC, k LIMIT @top) AS `gone`,
          COUNTIF(in_cur AND NOT in_ref) AS n_new, COUNTIF(in_ref AND NOT in_cur) AS n_gone,
          SUM(IF(in_cur AND NOT in_ref, cc, 0)) AS new_clicks, SUM(IF(in_ref AND NOT in_cur, rc, 0)) AS gone_clicks)) j
        FROM cmp c LEFT JOIN topc t USING (site, market, grp, section, kind)
        GROUP BY 1, 2, 3, 4, 5, 6""",
        {"j_markets": markets_json(markets), "j_patterns": bq.js(patterns), "sites": sorted({m["site"] for m in markets}),
         "top": top, "min_impr": min_impr, **win_params(win)})


def coverage(markets, a, b):
    """Part des données visibles par marché sur la fenêtre [a, b] (28 derniers jours définitifs) : clics et impressions
    complets du pays (raw_totals), clics des requêtes connues dans le périmètre du marché (raw_queries) et, pour un marché
    sans dossier d'URL, clics complets par page (raw_pages en tous pays)."""
    return bq.submit(f"""WITH {M},
        tot AS (SELECT m.site, m.market, SUM(r.clicks) c, SUM(r.impressions) i FROM {bq.T('raw_totals')} r
                JOIN m ON r.site = m.site AND (m.country IS NULL OR r.country = m.country)
                WHERE r.date BETWEEN @a AND @b AND r.site IN UNNEST(@sites) GROUP BY 1, 2),
        named AS (SELECT m.site, m.market, SUM(q.clicks) c, SUM(q.impressions) i, COUNT(DISTINCT q.query) n FROM {bq.T('raw_queries')} q
                  JOIN m ON q.site = m.site AND {IN_MARKET.format(a='q')}
                  WHERE q.date BETWEEN @a AND @b AND q.site IN UNNEST(@sites) GROUP BY 1, 2)
        SELECT m.site, m.market, m.path IS NOT NULL has_path, tot.c tot_c, tot.i tot_i, named.c named_c, named.i named_i, named.n named_q
        FROM m LEFT JOIN tot USING (site, market) LEFT JOIN named USING (site, market)""",
        {"j_markets": markets_json(markets), "a": a, "b": b, "sites": sorted({m["site"] for m in markets})})


def rows_json(job):
    out = defaultdict(list)
    for r in bq.wait(job):
        out[(r["kind"], r["site"], r["market"])].append(json.loads(r["j"]))
    return out

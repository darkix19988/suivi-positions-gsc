"""Stockage BigQuery : tables communes à tous les projets (colonne `site`), état de l'outil et journal des synchros.

Dataset BQ_DATASET (défaut « gsc ») du projet BQ_PROJECT, région BQ_LOCATION (défaut EU). Tables brutes, alimentées par
l'API Search Console, partitionnées par jour (filtre de date obligatoire) et rangées par site :

  raw_queries    site × jour × pays × page × requête   détail des requêtes connues (sans les requêtes masquées par Google)
  raw_pages      site × jour × page                    totaux complets par page, tous pays (requêtes masquées comprises)
  raw_totals     site × jour × pays                    totaux complets du site par pays (agrégés par propriété)
  kw_site        site × marché × jour × requête        position « site » des mots-clés suivis (agrégée par propriété)
  segments       site × marché × jour × segment        marque, hors marque (et total d'un marché limité à un dossier d'URL)

Tables calculées dans BigQuery :

  tracked_daily  site × jour × pays × requête × page   lignes des mots-clés suivis, mises à jour sur les seuls jours réécrits
  section_daily  site × marché × regroupement (grp) × dossier × jour

État et suivi : `state` (clé / valeur JSON par site), `runs` (durée, appels GSC, octets facturés, erreurs de chaque synchro).

Écriture : chaque synchro charge tout ce qu'elle a collecté dans une table tampon (chargements CSV, gratuits), puis une seule
requête remplace, table par table, exactement les périmètres collectés (site, marché, requête, dates). Les lectures passent
par des requêtes paramétrées qui couvrent tous les projets et tous les marchés d'un coup.

Identité : compte de service `suivi-positions-bq` (aucun accès GSC) via Workload Identity Federation dans GitHub Actions
(Application Default Credentials), ou en local un jeton OAuth dédié BQ_REFRESH_TOKEN (+ BQ_CLIENT_ID / BQ_CLIENT_SECRET).
"""

import csv
import io
import json
import os
import tempfile
import threading
import time
import uuid
from datetime import date, datetime, timezone

DATASET = os.environ.get("BQ_DATASET") or "gsc"
LOCATION = os.environ.get("BQ_LOCATION") or "EU"
MAX_BYTES = int(float(os.environ.get("BQ_MAX_GB") or 5) * 1024 ** 3)   # garde-fou par requête (plafond du projet : 50 Gio par jour)
FLUSH_ROWS = 200_000          # lignes gardées en mémoire avant envoi dans la table tampon
EPOCH = date(2000, 1, 1)      # borne basse des lectures « tout l'historique » (le filtre de date est obligatoire)

_client, _lock = None, threading.Lock()
usage = {"jobs": 0, "bytes_billed": 0, "bytes_processed": 0}


def project():
    return os.environ.get("BQ_PROJECT") or "ds-suivi-positions-gsc"


def client():
    global _client
    with _lock:
        if _client:
            return _client
        from google.cloud import bigquery
        if os.environ.get("BQ_REFRESH_TOKEN"):
            from google.oauth2.credentials import Credentials
            e = os.environ
            creds = Credentials(None, refresh_token=e["BQ_REFRESH_TOKEN"],
                                client_id=e.get("BQ_CLIENT_ID") or e.get("GSC_CLIENT_ID"),
                                client_secret=e.get("BQ_CLIENT_SECRET") or e.get("GSC_CLIENT_SECRET"),
                                token_uri="https://oauth2.googleapis.com/token")
        else:
            import google.auth
            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/bigquery"])
        _client = bigquery.Client(project=project(), credentials=creds, location=LOCATION)
        return _client


def T(name):
    return f"`{project()}.{DATASET}.{name}`"


# ---------------------------------------------------------------- schéma

_S, _I, _F, _D, _TS = "STRING", "INT64", "FLOAT64", "DATE", "TIMESTAMP"
METRICS = [("clicks", _I), ("impressions", _I), ("position", _F)]
TABLES = {
    "raw_queries": ([("site", _S), ("date", _D), ("country", _S), ("page", _S), ("query", _S)] + METRICS, ["site", "country", "query", "page"]),
    "raw_pages": ([("site", _S), ("date", _D), ("page", _S)] + METRICS, ["site", "page"]),
    "raw_totals": ([("site", _S), ("date", _D), ("country", _S)] + METRICS, ["site", "country"]),
    "kw_site": ([("site", _S), ("market", _S), ("date", _D), ("query", _S)] + METRICS, ["site", "market", "query"]),
    "segments": ([("site", _S), ("market", _S), ("date", _D), ("segment", _S)] + METRICS, ["site", "market", "segment"]),
    "tracked_daily": ([("site", _S), ("date", _D), ("country", _S), ("query", _S), ("page", _S)] + METRICS, ["site", "query", "country", "page"]),
    "section_daily": ([("site", _S), ("market", _S), ("grp", _S), ("section", _S), ("date", _D)] + METRICS, ["site", "market", "grp", "section"]),
}
STAGE_COLS = [("tbl", _S), ("site", _S), ("date", _D), ("market", _S), ("country", _S), ("page", _S), ("query", _S), ("segment", _S)] + METRICS
RAW = ("raw_queries", "raw_pages", "raw_totals", "kw_site", "segments")


def ensure_schema():
    """Crée le dataset et les tables manquantes (sans expiration : l'historique est conservé au-delà de 16 mois)."""
    from google.cloud import bigquery as b
    c = client()
    ds = c.create_dataset(f"{project()}.{DATASET}", exists_ok=True)
    if ds.default_table_expiration_ms or ds.default_partition_expiration_ms:
        ds.default_table_expiration_ms = ds.default_partition_expiration_ms = None
        c.update_dataset(ds, ["default_table_expiration_ms", "default_partition_expiration_ms"])
    existing = {t.table_id for t in c.list_tables(ds)}
    for name, (cols, cluster) in TABLES.items():
        if name in existing:
            continue
        t = b.Table(f"{project()}.{DATASET}.{name}", schema=[b.SchemaField(n, ty) for n, ty in cols])
        t.time_partitioning = b.TimePartitioning(field="date")
        t.require_partition_filter = True
        t.clustering_fields = cluster
        c.create_table(t)
        print(f"BigQuery : table {name} créée")
    if "state" not in existing:
        t = b.Table(f"{project()}.{DATASET}.state", schema=[b.SchemaField("site", _S), b.SchemaField("key", _S),
                                                             b.SchemaField("value", _S), b.SchemaField("updated_at", _TS)])
        t.clustering_fields = ["site", "key"]
        c.create_table(t)
    if "runs" not in existing:
        t = b.Table(f"{project()}.{DATASET}.runs", schema=[b.SchemaField(n, ty) for n, ty in [
            ("run_id", _S), ("started_at", _TS), ("seconds", _F), ("site", _S), ("step", _S), ("ok", "BOOL"),
            ("gsc_calls", _I), ("gsc_rows", _I), ("bq_jobs", _I), ("bq_bytes_billed", _I), ("detail", _S)]])
        t.time_partitioning = b.TimePartitioning(field="started_at")
        c.create_table(t)


# ---------------------------------------------------------------- requêtes

def _param(k, v):
    from google.cloud import bigquery as b
    if isinstance(v, (list, tuple, set)):
        v = list(v)
        kind = "DATE" if v and isinstance(v[0], date) else "INT64" if v and isinstance(v[0], int) else "STRING"
        return b.ArrayQueryParameter(k, kind, v)
    if isinstance(v, (dict,)) or (isinstance(v, str) and k.startswith("j_")):
        return b.ScalarQueryParameter(k, "STRING", v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
    kind = "BOOL" if isinstance(v, bool) else "STRING" if isinstance(v, str) else "DATE" if isinstance(v, date) else \
        "FLOAT64" if isinstance(v, float) else "INT64"
    return b.ScalarQueryParameter(k, kind, v)


def submit(sql, params=None, max_bytes=None):
    """Lance une requête sans attendre (les lectures indépendantes tournent en parallèle dans BigQuery)."""
    from google.cloud import bigquery as b
    cfg = b.QueryJobConfig(maximum_bytes_billed=max_bytes or MAX_BYTES,
                           query_parameters=[_param(k, v) for k, v in (params or {}).items()])
    return client().query(sql, job_config=cfg)


def wait(job):
    for attempt in range(4):
        try:
            rows = list(job.result())
            break
        except (ConnectionError, OSError) as e:   # coupure réseau pendant l'attente : le job continue côté BigQuery
            if attempt == 3:
                raise
            print(f"  BigQuery : attente interrompue ({type(e).__name__}), reprise")
            time.sleep(2 ** attempt * 5)
    with _lock:
        usage["jobs"] += 1
        usage["bytes_billed"] += job.total_bytes_billed or 0
        usage["bytes_processed"] += job.total_bytes_processed or 0
    return rows


def query(sql, params=None, max_bytes=None):
    return wait(submit(sql, params, max_bytes))


def js(rows):
    """Liste de dictionnaires passée en paramètre JSON (lue dans le SQL avec JSON_QUERY_ARRAY / JSON_VALUE)."""
    def conv(v):
        return str(v) if isinstance(v, date) else v
    return json.dumps([{k: conv(v) for k, v in r.items()} for r in rows], ensure_ascii=False)


# ---------------------------------------------------------------- écriture : table tampon puis remplacement des périmètres

class Stage:
    """Collecte d'une synchro. Les lignes s'accumulent par paquets dans une table tampon (chargements CSV) ; `commit`
    remplace ensuite, en une requête pour tous les projets, chaque périmètre déclaré par `scope`."""

    def __init__(self):
        self.name = f"_stage_{datetime.now(timezone.utc):%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:6]}"
        self.buf, self.scopes, self.n = [], [], 0
        self.lock = threading.Lock()
        self.created = False

    def _create(self):
        from google.cloud import bigquery as b
        t = b.Table(f"{project()}.{DATASET}.{self.name}", schema=[b.SchemaField(n, ty) for n, ty in STAGE_COLS])
        t.expires = datetime.fromtimestamp(time.time() + 2 * 86400, timezone.utc)
        client().create_table(t, exists_ok=True)
        self.created = True

    def add(self, tbl, site, rows):
        """rows : tuples (date, market, country, page, query, segment, clicks, impressions, position)."""
        flush = None
        with self.lock:
            self.buf.extend((tbl, site) + tuple(r) for r in rows)
            self.n += len(rows)
            if len(self.buf) >= FLUSH_ROWS:
                flush, self.buf = self.buf, []
        if flush:
            self._load(flush)

    def scope(self, tbl, site, a, b, market=None, query=None):
        with self.lock:
            self.scopes.append({"tbl": tbl, "site": site, "a": str(a), "b": str(b), "market": market, "query": query})

    def _load(self, rows):
        from google.cloud import bigquery as b
        with self.lock:
            if not self.created:
                self._create()
        with tempfile.TemporaryFile("w+b") as fh:
            w = io.TextIOWrapper(fh, encoding="utf-8", newline="")
            cw = csv.writer(w)
            for r in rows:
                cw.writerow(["" if v is None else v for v in r])
            w.flush()
            w.detach()
            fh.seek(0)
            cfg = b.LoadJobConfig(source_format=b.SourceFormat.CSV, write_disposition="WRITE_APPEND", allow_quoted_newlines=True,
                                  schema=[b.SchemaField(n, ty) for n, ty in STAGE_COLS])
            for attempt in range(6):   # coupure réseau ou erreur passagère : on renvoie le même paquet
                try:
                    fh.seek(0)
                    client().load_table_from_file(fh, f"{project()}.{DATASET}.{self.name}", job_config=cfg).result()
                    break
                except Exception as e:
                    if attempt == 5:
                        raise
                    print(f"  BigQuery : envoi d'un paquet en échec ({type(e).__name__}), nouvel essai")
                    time.sleep(2 ** attempt * 5)

    def commit(self, tracked, tracked_new):
        """Remplace les périmètres collectés, puis met à jour tracked_daily (jours réécrits + historique complet des
        mots-clés nouvellement suivis). tracked / tracked_new : [{site, query}]."""
        with self.lock:
            rest, self.buf = self.buf, []
        if rest:
            self._load(rest)
        if not self.scopes:
            self.drop()
            return
        if not self.created:
            self._create()
        st = f"`{project()}.{DATASET}.{self.name}`"
        scripts, sql = [], []
        params = {"j_scopes": js(self.scopes), "j_tracked": js(tracked), "j_new": js(tracked_new), "epoch": EPOCH}
        scopes_cte = """(SELECT JSON_VALUE(s,'$.tbl') tbl, JSON_VALUE(s,'$.site') site, DATE(JSON_VALUE(s,'$.a')) a,
                         DATE(JSON_VALUE(s,'$.b')) b, JSON_VALUE(s,'$.market') market, JSON_VALUE(s,'$.query') query
                         FROM UNNEST(JSON_QUERY_ARRAY(@j_scopes)) s)"""
        for i, tbl in enumerate(RAW):
            sc = [s for s in self.scopes if s["tbl"] == tbl]
            if not sc:
                continue
            cols = [n for n, _ in TABLES[tbl][0]]
            params[f"a{i}"] = min(date.fromisoformat(s["a"]) for s in sc)
            params[f"b{i}"] = max(date.fromisoformat(s["b"]) for s in sc)
            params[f"s{i}"] = sorted({s["site"] for s in sc})
            cond = "s.site = t.site AND t.date BETWEEN s.a AND s.b"
            cond += " AND (s.market IS NULL OR s.market = t.market)" if "market" in cols else ""
            cond += " AND (s.query IS NULL OR s.query = t.query)" if "query" in cols and tbl == "kw_site" else ""
            scripts.append([f"""DELETE FROM {T(tbl)} t WHERE t.date BETWEEN @a{i} AND @b{i} AND t.site IN UNNEST(@s{i})
                           AND EXISTS (SELECT 1 FROM {scopes_cte} s WHERE s.tbl = '{tbl}' AND {cond});""", f"""INSERT INTO {T(tbl)} ({', '.join(cols)}) SELECT {', '.join('t.' + c for c in cols)} FROM {st} t
                           WHERE t.tbl = '{tbl}' AND EXISTS (SELECT 1 FROM {scopes_cte} s WHERE s.tbl = '{tbl}' AND {cond});"""])
        rq = [s for s in self.scopes if s["tbl"] == "raw_queries"]
        cols = "site, date, country, query, page, clicks, impressions, position"
        tracked_cte = "(SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.query') query FROM UNNEST(JSON_QUERY_ARRAY(@j_tracked)) x)"
        new_cte = "(SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.query') query FROM UNNEST(JSON_QUERY_ARRAY(@j_new)) x)"
        sites = sorted({x["site"] for x in tracked} | {s["site"] for s in rq})
        params["tsites"] = sites
        # Mots-clés retirés du suivi ou nouvellement suivis : leur historique est effacé puis (pour les nouveaux) recalculé
        sql.append(f"""DELETE FROM {T('tracked_daily')} t WHERE t.date >= @epoch AND t.site IN UNNEST(@tsites)
                       AND (NOT EXISTS (SELECT 1 FROM {tracked_cte} k WHERE k.site = t.site AND k.query = t.query)
                            OR EXISTS (SELECT 1 FROM {new_cte} k WHERE k.site = t.site AND k.query = t.query));""")
        if rq:
            params["ra"] = min(date.fromisoformat(s["a"]) for s in rq)
            params["rb"] = max(date.fromisoformat(s["b"]) for s in rq)
            params["rs"] = sorted({s["site"] for s in rq})
            sql.append(f"""DELETE FROM {T('tracked_daily')} t WHERE t.date BETWEEN @ra AND @rb AND t.site IN UNNEST(@rs)
                           AND EXISTS (SELECT 1 FROM {scopes_cte} s WHERE s.tbl = 'raw_queries' AND s.site = t.site AND t.date BETWEEN s.a AND s.b)
                           AND NOT EXISTS (SELECT 1 FROM {new_cte} k WHERE k.site = t.site AND k.query = t.query);""")
            sql.append(f"""INSERT INTO {T('tracked_daily')} ({cols})
                           SELECT r.site, r.date, r.country, r.query, r.page, r.clicks, r.impressions, r.position FROM {T('raw_queries')} r
                           JOIN {tracked_cte} k ON k.site = r.site AND k.query = r.query
                           WHERE r.date BETWEEN @ra AND @rb AND r.site IN UNNEST(@rs)
                           AND EXISTS (SELECT 1 FROM {scopes_cte} s WHERE s.tbl = 'raw_queries' AND s.site = r.site AND r.date BETWEEN s.a AND s.b)
                           AND NOT EXISTS (SELECT 1 FROM {new_cte} n WHERE n.site = r.site AND n.query = r.query);""")
        if tracked_new:
            params["ns"] = sorted({x["site"] for x in tracked_new})
            params["nq"] = sorted({x["query"] for x in tracked_new})
            sql.append(f"""INSERT INTO {T('tracked_daily')} ({cols})
                           SELECT r.site, r.date, r.country, r.query, r.page, r.clicks, r.impressions, r.position FROM {T('raw_queries')} r
                           JOIN {new_cte} k ON k.site = r.site AND k.query = r.query
                           WHERE r.date >= @epoch AND r.site IN UNNEST(@ns) AND r.query IN UNNEST(@nq);""")
        # Une transaction par table, toutes en parallèle (tables indépendantes) ; tracked_daily, qui lit raw_queries, suit
        # raw_queries dans la même transaction
        from concurrent.futures import ThreadPoolExecutor
        for stmts in scripts:
            if "raw_queries" in stmts[0]:
                stmts += sql
                break
        else:
            scripts.append(sql)
        run = lambda stmts: query("BEGIN TRANSACTION;\n" + "\n".join(stmts) + "\nCOMMIT TRANSACTION;", params, max_bytes=20 * 1024 ** 3)
        with ThreadPoolExecutor(max_workers=len(scripts)) as ex:
            list(ex.map(run, scripts))
        self.drop()

    def drop(self):
        if self.created:
            client().delete_table(f"{project()}.{DATASET}.{self.name}", not_found_ok=True)
            self.created = False


# ---------------------------------------------------------------- état (clé / valeur JSON)

def state_get(sites=None):
    """{(site, clé): valeur} ; site '' = global."""
    sql = f"SELECT site, key, value FROM {T('state')}" + (" WHERE site IN UNNEST(@s)" if sites else "")
    return {(r["site"], r["key"]): json.loads(r["value"]) for r in query(sql, {"s": list(sites)} if sites else None)}


def state_put(items):
    """items : {(site, clé): valeur}. Un seul MERGE, quelle que soit la quantité."""
    if not items:
        return
    rows = [{"site": s, "key": k, "value": json.dumps(v, ensure_ascii=False, separators=(",", ":"))} for (s, k), v in items.items()]
    query(f"""MERGE {T('state')} t
              USING (SELECT JSON_VALUE(x,'$.site') site, JSON_VALUE(x,'$.key') key, JSON_VALUE(x,'$.value') value
                     FROM UNNEST(JSON_QUERY_ARRAY(@j_rows)) x) s
              ON t.site = s.site AND t.key = s.key
              WHEN MATCHED THEN UPDATE SET value = s.value, updated_at = CURRENT_TIMESTAMP()
              WHEN NOT MATCHED THEN INSERT (site, key, value, updated_at) VALUES (s.site, s.key, s.value, CURRENT_TIMESTAMP())""",
          {"j_rows": json.dumps(rows, ensure_ascii=False)})


def log_runs(rows):
    """Journal des synchros (une ligne par projet et par étape)."""
    if not rows:
        return
    from google.cloud import bigquery as b
    client().load_table_from_json(rows, f"{project()}.{DATASET}.runs",
                                  job_config=b.LoadJobConfig(write_disposition="WRITE_APPEND")).result()

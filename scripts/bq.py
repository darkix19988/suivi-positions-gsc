"""Stockage BigQuery du détail Search Console, et calculs des dossiers en SQL.

Deux tables par projet, dans le dataset BQ_DATASET (défaut « gsc ») du projet Google Cloud BQ_PROJECT :
  pages_<projet>    jour × page × pays            totaux justes (requêtes masquées comprises)
  queries_<projet>  jour × page × requête × pays  détail des mots-clés (sans les requêtes masquées par Google)

Tables partitionnées par jour et rangées par pays puis page : un calcul ne lit que les jours dont il a besoin.
Premier passage : 16 mois chargés d'un coup. Ensuite : les derniers jours (dont les jours provisoires) sont réécrits
partition par partition, sans requête de modification (DML).

Authentification : le même jeton OAuth que la Search Console, demandé avec le scope BigQuery
(scripts/oauth_login.py). Variables : BQ_PROJECT (obligatoire pour activer BigQuery), BQ_DATASET, BQ_LOCATION (défaut EU).
"""

import os
import time
from collections import defaultdict
from datetime import date, timedelta

DATASET = os.environ.get("BQ_DATASET") or "gsc"
LOCATION = os.environ.get("BQ_LOCATION") or "EU"
MAX_BYTES = 20 * 1024 ** 3      # garde-fou : une requête qui lirait plus de 20 Go est refusée au lieu d'être facturée
CHUNK_DAYS = 7                  # appels GSC du premier passage par tranches de 7 jours (limite de lignes par jour)

_clients = {}
T = None                        # module tracker, posé par tracker.py (secrets, token, gsc, constantes)


def enabled():
    return bool(os.environ.get("BQ_PROJECT"))


def client(account):
    if account in _clients:
        return _clients[account]
    from google.cloud import bigquery
    s = T.secrets()
    suffix = "" if account == "default" else "_" + account.upper().replace("-", "_")
    from google.oauth2.credentials import Credentials
    creds = Credentials(None, refresh_token=s.get("GSC_REFRESH_TOKEN" + suffix),
                        client_id=s.get("GSC_CLIENT_ID" + suffix) or s.get("GSC_CLIENT_ID"),
                        client_secret=s.get("GSC_CLIENT_SECRET" + suffix) or s.get("GSC_CLIENT_SECRET"),
                        token_uri="https://oauth2.googleapis.com/token")
    c = bigquery.Client(project=os.environ["BQ_PROJECT"], credentials=creds, location=LOCATION)
    ds = c.create_dataset(f"{c.project}.{DATASET}", exists_ok=True)
    # Un dataset créé avant l'activation de la facturation garde l'expiration du bac à sable (60 jours) : on la retire,
    # sinon BigQuery efface tout ce qui a plus de 60 jours
    if ds.default_table_expiration_ms or ds.default_partition_expiration_ms:
        ds.default_table_expiration_ms = ds.default_partition_expiration_ms = None
        c.update_dataset(ds, ["default_table_expiration_ms", "default_partition_expiration_ms"])
    _clients[account] = c
    return c


def table(c, kind, name):
    return f"{c.project}.{DATASET}.{kind}_{name}"


def schema(kind):
    from google.cloud import bigquery as b
    f = [b.SchemaField("date", "DATE"), b.SchemaField("country", "STRING"), b.SchemaField("page", "STRING")]
    if kind == "queries":
        f.append(b.SchemaField("query", "STRING"))
    return f + [b.SchemaField("clicks", "INT64"), b.SchemaField("impressions", "INT64"), b.SchemaField("position", "FLOAT64")]


def load(c, kind, name, rows, partition=None):
    """Remplace la table entière (premier passage) ou une seule partition (jour) par les lignes données."""
    from google.cloud import bigquery as b
    cfg = b.LoadJobConfig(schema=schema(kind), write_disposition="WRITE_TRUNCATE",
                          source_format=b.SourceFormat.NEWLINE_DELIMITED_JSON,
                          time_partitioning=b.TimePartitioning(field="date"), clustering_fields=["country", "page"])
    dest = table(c, kind, name) + (f"${partition.replace('-', '')}" if partition else "")
    c.load_table_from_json(rows, dest, job_config=cfg).result()
    t = c.get_table(table(c, kind, name))
    if t.time_partitioning.expiration_ms or t.expires:  # même raison : pas d'expiration héritée du bac à sable
        t.time_partitioning.expiration_ms, t.expires = None, None
        c.update_table(t, ["time_partitioning", "expires"])


def query(c, sql, params=()):
    from google.cloud import bigquery as b
    cfg = b.QueryJobConfig(maximum_bytes_billed=MAX_BYTES, query_parameters=[
        b.ScalarQueryParameter(k, "STRING" if isinstance(v, str) else "DATE" if isinstance(v, date) else "INT64", v)
        for k, v in params])
    return list(c.query(sql, job_config=cfg).result())


def known_days(c, name):
    try:
        rows = query(c, f"SELECT MIN(date) a, MAX(date) b, COUNT(DISTINCT date) n FROM `{table(c, 'pages', name)}`")
        return rows[0]["a"], rows[0]["b"], rows[0]["n"]
    except Exception as e:  # table absente : premier passage
        if "Not found" in str(e):
            return None, None, 0
        raise


def raw_fetch(s, days, today):
    """Collecte GSC vers BigQuery : 16 mois au premier passage, puis les `days` derniers jours (et les jours manquants)."""
    t = T
    name, prop, acc = s["name"], s["property"], s["account"]
    c, tok = client(acc), t.token(acc)
    end = today - timedelta(days=1)
    first, last, n = known_days(c, name)
    t0 = time.time()

    def grab(kind, a, b):
        dims = ["date", "page", "country"] + (["query"] if kind == "queries" else [])
        out = []
        for r in t.gsc(tok, prop, a, b, dims):
            k = dict(zip(dims, r["keys"]))
            out.append({**k, "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "position": round(r["position"], 2)})
        return out

    if not n:
        start = today - timedelta(days=t.BACKFILL_DAYS)
        for kind in ("pages", "queries"):
            rows, a = [], start
            while a <= end:
                b = min(end, a + timedelta(days=CHUNK_DAYS - 1))
                rows += grab(kind, a, b)
                a = b + timedelta(days=1)
            load(c, kind, name, rows)
            print(f"[{name}] BigQuery {kind} : {len(rows)} lignes chargées ({start} → {end})")
    else:
        start = min(today - timedelta(days=days), last + timedelta(days=1))
        for kind in ("pages", "queries"):
            per = defaultdict(list)
            for r in grab(kind, start, end):
                per[r["date"]].append(r)
            for d in sorted(per):
                load(c, kind, name, per[d], partition=d)
            print(f"[{name}] BigQuery {kind} : {sum(map(len, per.values()))} lignes réécrites sur {len(per)} jours ({start} → {end})")
    print(f"[{name}] BigQuery collecte : {time.time() - t0:.0f} s")


def scope_sql(m):
    """Filtre SQL d'un marché : pays GSC et dossier d'URL déclaré."""
    parts, params = [], []
    if m["code"] != "all":
        parts.append("country = @country"); params.append(("country", m["code"]))
    if m.get("path"):
        parts.append("STRPOS(page, @mpath) > 0"); params.append(("mpath", m["path"]))
    return (" AND " + " AND ".join(parts)) if parts else "", params


def case_sql(secs):
    """CASE qui range chaque page dans sa section, avec les regex des sections (RE2, comme le filtre GSC)."""
    whens, params = [], []
    for i, x in enumerate(s for s in secs if s.get("rx")):
        whens.append(f"WHEN REGEXP_CONTAINS(page, @rx{i}) THEN @key{i}")
        params += [(f"rx{i}", x["rx"]), (f"key{i}", x["key"])]
    return "CASE " + " ".join(whens) + " ELSE 'autres' END", params


def windows_sql(win):
    """Étiquette de période (cur, prev, n1) d'un jour, à partir des fenêtres de comparaison."""
    cases, params = [], []
    for lbl, (a, b) in win.items():
        cases.append(f"WHEN date BETWEEN @{lbl}_a AND @{lbl}_b THEN '{lbl}'")
        params += [(f"{lbl}_a", a), (f"{lbl}_b", b)]
    return "CASE " + " ".join(cases) + " END", params


def page_snaps(c, name, m, win):
    sc, sp = scope_sql(m)
    w, wp = windows_sql(win)
    lo = min(a for a, _ in win.values())
    rows = query(c, f"""SELECT {w} AS win, page, SUM(clicks) c, SUM(impressions) i,
                          SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) p
                        FROM `{table(c, 'pages', name)}` WHERE date >= @lo{sc} GROUP BY win, page HAVING win IS NOT NULL""",
                 [("lo", lo)] + sp + wp)
    snaps = {lbl: {} for lbl in win}
    for r in rows:
        snaps[r["win"]][r["page"]] = [int(r["c"]), int(r["i"]), round(r["p"], 1) if r["p"] is not None else None]
    return snaps


def section_series(c, name, m, secs, lf):
    """Clics, impressions et position de chaque section, jour par jour, sur tout l'historique."""
    sc, sp = scope_sql(m)
    cs, cp = case_sql(secs)
    rows = query(c, f"""SELECT date, {cs} AS section, SUM(clicks) c, SUM(impressions) i,
                          SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) p
                        FROM `{table(c, 'pages', name)}` WHERE TRUE{sc} GROUP BY date, section""", sp + cp)
    return [{"date": str(r["date"]), "section": r["section"], "clicks": int(r["c"]), "impressions": int(r["i"]),
             "position": round(r["p"], 1) if r["p"] is not None else "", "data_state": "final" if r["date"] <= lf else "fresh"}
            for r in rows if r["i"]]


def section_queries(c, name, m, secs, win):
    """Requêtes de chaque section sur chaque fenêtre de comparaison : {fenêtre: {section: {requête: [clics, impr, pos]}}}."""
    sc, sp = scope_sql(m)
    cs, cp = case_sql(secs)
    w, wp = windows_sql(win)
    lo = min(a for a, _ in win.values())
    rows = query(c, f"""SELECT {w} AS win, {cs} AS section, query, SUM(clicks) c, SUM(impressions) i,
                          SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) p
                        FROM `{table(c, 'queries', name)}` WHERE date >= @lo{sc}
                        GROUP BY win, section, query HAVING win IS NOT NULL""", [("lo", lo)] + sp + cp + wp)
    out = {lbl: defaultdict(dict) for lbl in win}
    for r in rows:
        out[r["win"]][r["section"]][r["query"]] = [int(r["c"]), int(r["i"]), round(r["p"], 1) if r["p"] is not None else None]
    return out

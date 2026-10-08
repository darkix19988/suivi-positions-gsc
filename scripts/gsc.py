"""Client Search Console : jetons OAuth par compte, appels avec nouvelles tentatives, pagination, filtres découpés en lots,
exports complets jour par jour en parallèle (avec détection et contournement de la limite de lignes par jour).

Règles de la GSC vérifiées (2026-10-07, voir memory.md) :
- `page` combiné à `country` ou `device` (dimension ou filtre) : les requêtes masquées par Google disparaissent des totaux ;
- un filtre ou une dimension `page` seule : tous les clics, mais impressions et position comptées page par page ;
- sans `page` : agrégation par propriété (une impression par résultat de recherche, position du meilleur résultat).
"""

import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import quote

import requests

API = "https://searchconsole.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query"
INSPECT_API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
PAGE_ROWS = 25000           # maximum de lignes par appel
DAY_CAP = 50000             # maximum de lignes qu'un appel peut exposer pour un jour (au-delà, Google tronque)
QUERY_CHUNK = 30            # requêtes par filtre regex
RX_MAX = 1500               # longueur max d'une regex de pages (au-delà, avec une regex de requêtes, erreur 500 de la GSC)
WORKERS = int(os.environ.get("GSC_WORKERS") or 6)

_tokens, _lock = {}, threading.Lock()
calls = {"n": 0, "rows": 0, "seconds": 0.0}   # compteur de la synchro (journal des runs)


def secrets():
    s = dict(os.environ)
    if os.environ.get("SECRETS_JSON"):
        s.update({k: v for k, v in json.loads(os.environ["SECRETS_JSON"]).items() if v})
    return s


def account_suffix(account):
    return "" if account == "default" else "_" + re.sub(r"\W", "_", account).upper()


def token(account):
    """Jeton d'accès GSC d'un compte (GSC_REFRESH_TOKEN[_<COMPTE>]). Un compte hors organisation datashake.fr passe par une
    autre app OAuth : GSC_CLIENT_ID_<COMPTE> et GSC_CLIENT_SECRET_<COMPTE>, sinon l'app interne commune."""
    with _lock:
        hit = _tokens.get(account)
        if hit and hit[1] > time.time() + 120:
            return hit[0]
        from google.oauth2.credentials import Credentials
        import google.auth.transport.requests as gat
        s, sfx = secrets(), account_suffix(account)
        refresh = s.get("GSC_REFRESH_TOKEN" + sfx)
        client_id = s.get("GSC_CLIENT_ID" + sfx) or s.get("GSC_CLIENT_ID")
        client_secret = s.get("GSC_CLIENT_SECRET" + sfx) or s.get("GSC_CLIENT_SECRET")
        if not refresh or not client_id:
            raise RuntimeError(f"pas de jeton OAuth pour le compte « {account} » (secret GSC_REFRESH_TOKEN{sfx})")
        c = Credentials(None, refresh_token=refresh, client_id=client_id, client_secret=client_secret,
                        token_uri="https://oauth2.googleapis.com/token")
        c.refresh(gat.Request())
        _tokens[account] = (c.token, time.time() + 3000)
        return c.token


def post(url, account, body):
    t0 = time.time()
    for attempt in range(6):
        try:
            r = requests.post(url, json=body, headers={"Authorization": f"Bearer {token(account)}"}, timeout=180)
        except (requests.Timeout, requests.ConnectionError) as e:
            if attempt == 5:
                raise
            print(f"  GSC lente ({type(e).__name__}), nouvel essai")
            time.sleep(2 ** attempt * 3)
            continue
        if r.status_code in (429, 500, 503):
            time.sleep(2 ** attempt * 3)
            continue
        if r.status_code != 200:
            raise RuntimeError(f"{r.status_code} {r.text[:300]}")
        out = r.json()
        with _lock:
            calls["n"] += 1
            calls["rows"] += len(out.get("rows", []))
            calls["seconds"] += time.time() - t0
        return out
    raise RuntimeError(f"{r.status_code} après 6 essais")


def f(dim, op, expr):
    return {"dimension": dim, "operator": op, "expression": expr}


def query(account, prop, start, end, dims, filters=(), max_rows=None, aggregation=None):
    """Appel Search Analytics paginé. Renvoie les lignes brutes de l'API (keys, clicks, impressions, ctr, position)."""
    body = {"startDate": str(start), "endDate": str(end), "type": "web", "dataState": "all", "dimensions": list(dims)}
    if filters:
        body["dimensionFilterGroups"] = [{"filters": list(filters)}]
    if aggregation:
        body["aggregationType"] = aggregation
    rows, start_row = [], 0
    while True:
        limit = PAGE_ROWS if max_rows is None else min(PAGE_ROWS, max_rows - len(rows))
        batch = post(API.format(quote(prop, safe="")), account, {**body, "rowLimit": limit, "startRow": start_row}).get("rows", [])
        rows += batch
        if len(batch) < limit or (max_rows and len(rows) >= max_rows):
            return rows
        start_row += limit


def rx_exact(values):
    return "^(" + "|".join(re.escape(v) for v in sorted(values)) + ")$"


def rx_chunks(values, limit=RX_MAX):
    """Découpe une liste de valeurs en lots dont la regex exacte reste sous `limit` caractères."""
    out, cur = [], []
    for v in sorted(values):
        if cur and len(rx_exact(cur + [v])) > limit:
            out.append(cur)
            cur = []
        cur.append(v)
    return out + ([cur] if cur else [])


def query_lots(account, prop, start, end, dims, queries, filters=(), pages=None):
    """Appel filtré sur une liste de requêtes (et éventuellement de pages), découpées en lots disjoints pour rester sous la
    taille de filtre que la GSC accepte, puis concaténées."""
    qs, rows = sorted(queries), []
    pchunks = rx_chunks(pages) if pages else [None]
    for i in range(0, len(qs), QUERY_CHUNK):
        for pc in pchunks:
            flt = [f("query", "includingRegex", rx_exact(qs[i:i + QUERY_CHUNK]))]
            flt += [f("page", "includingRegex", rx_exact(pc))] if pc else []
            rows += query(account, prop, start, end, dims, flt + list(filters))
    return rows


def days(a, b):
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


def export_day(account, prop, d, countries_hint=()):
    """Détail complet d'un jour : pays × page × requête. Si le jour atteint la limite de lignes exposées par Google,
    il est redemandé pays par pays (chaque appel a sa propre limite). Renvoie (lignes, info de troncature ou None)."""
    dims = ["date", "country", "page", "query"]
    rows = query(account, prop, d, d, dims)
    if len(rows) < DAY_CAP:
        return rows, None
    countries = list(countries_hint) or sorted({r["keys"][1] for r in rows})
    out, capped = [], []
    for c in countries:
        part = query(account, prop, d, d, dims, [f("country", "equals", c)])
        if len(part) >= DAY_CAP:
            capped.append(c)
        out += part
    seen = set(countries)
    out += [r for r in rows if r["keys"][1] not in seen]   # pays absents de la liste : on garde la version d'origine
    return out, {"date": str(d), "rows_first_call": len(rows), "rows": len(out), "countries_still_capped": capped}


def parallel(fn, items, workers=WORKERS):
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(fn, items))


def inspect(account, prop, url):
    return post(INSPECT_API, account, {"inspectionUrl": url, "siteUrl": prop, "languageCode": "fr-FR"})

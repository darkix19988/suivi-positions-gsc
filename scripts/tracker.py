"""Suivi de positions GSC, version BigQuery.

Commandes :
  python scripts/tracker.py sync [--days 10] [--site a,b] [--skip-if-fresh 12]   collecte GSC → BigQuery, puis calcul du dashboard
  python scripts/tracker.py build                                                calcul du dashboard depuis BigQuery (aucun appel GSC)
  python scripts/tracker.py inspect <site> [--pages-file f]                      vérifie l'indexation des pages suivies
  python scripts/tracker.py seed <site> [--n 20]                                 pré-remplit les mots-clés d'un nouveau projet
  python scripts/tracker.py notify                                               digest Slack (si SLACK_WEBHOOK_URL est défini)
  python scripts/tracker.py changed <sha>                                        projets dont la config a changé depuis <sha>
  python scripts/tracker.py migrate                                              reprise de l'ancien état de data/ (une fois)

Architecture : GitHub garde le code et la configuration (config/), BigQuery garde toutes les données (bq.py) et porte les
calculs lourds (sql.py), la GSC n'est appelée que pour ce qu'elle seule sait donner (gsc.py). Le calcul écrit les fichiers
statiques du dashboard dans docs/data/ (OUT), publiables sur n'importe quel hébergeur.

Authentification : GSC_CLIENT_ID + GSC_CLIENT_SECRET + GSC_REFRESH_TOKEN[_<COMPTE>] pour la Search Console (un jeton par
compte Google, déclaré par `account:` dans config/sites.yaml) ; BigQuery par sa propre identité (voir bq.py).
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
import yaml

import bq
import gsc
import sql

ROOT = Path(__file__).resolve().parent.parent
CONF = Path(os.environ.get("CONFIG_DIR") or ROOT / "config")   # CONFIG_DIR : autre configuration (tests de charge)
OUT = Path(os.environ.get("OUT_DIR") or ROOT / "docs" / "data")
GOOGLE_STATUS = "https://status.search.google.com/incidents.json"

FINAL_AFTER_DAYS = 3        # en dessous, la donnée GSC est provisoire et peut encore bouger
BACKFILL_DAYS = 480         # ~16 mois, le maximum conservé par la GSC
QUERY_PAGES_DAYS = 90       # historique des pages concurrentes (changement de page)
SECTION_REFRESH_DAYS = 16   # jours de dossiers recalculés à chaque passage (fenêtre de réécriture + marge)
SITE_LEVEL = "*"
ALL = "all"                 # marché « tous pays »
MIN_IMPR_DAY = 20           # impressions minimales d'un jour pour qu'une variation de position compte (alertes, mouvements)
LOOKBACK = 7                # sans impression le jour J, on reprend la dernière position connue dans les 7 jours
PROJECT_WORKERS = int(os.environ.get("PROJECT_WORKERS") or 3)
BUILD_BATCH = int(os.environ.get("BUILD_BATCH") or 12)   # projets calculés ensemble (une requête BigQuery par besoin et par lot)

# Dossiers du site (Trafic > Par dossier)
SEC_MIN_PAGES = 5           # un premier segment d'URL devient un dossier à partir de 5 pages vues dans la GSC...
SEC_MIN_SHARE = 0.01        # ... ou de 1 % des clics du marché
SEC_MAX = 15                # au-delà, les plus petits rejoignent « Autres pages » (un dossier déjà détecté le reste)
SEC_TOP = 20                # longueur des listes (gagnantes, perdantes, apparues, disparues)
SEC_MIN_IMPR = 10           # impressions minimales d'une requête pour la répartition des positions
LANGS = set("fr en es pt nl de it pl ro cs sk hu el sv da fi no nb ru uk tr ar he ja zh ko id th vi bg hr sl lt lv et ca eu lb".split())
LOCALE = re.compile(r"^([a-z]{2})(?:[-_][a-z]{2})?$", re.I)
GROUPINGS = {"dossier": "Par dossier", "langue": "Par langue"}

# Opportunités et cannibalisation (calculées dans BigQuery, sans limite de lignes)
LIMITS = {"pq_max": 60,      # requêtes gardées par page suivie et par période
          "sg_max": 3000,    # requêtes hors marque candidates aux suggestions
          "cn_min": 100,     # demande minimale d'une requête sur 28 jours pour la cannibalisation
          "cn_share": 0.2,   # part des impressions à partir de laquelle une page compte comme concurrente
          "cn_pos": 30,      # une page au-delà de la 30e position ne concurrence pas vraiment
          "cn_max": 500}     # requêtes cannibalisées gardées par marché

COUNTRIES = {"fra": "France", "bel": "Belgique", "che": "Suisse", "lux": "Luxembourg", "can": "Canada", "mco": "Monaco",
             "esp": "Espagne", "ita": "Italie", "deu": "Allemagne", "gbr": "Royaume-Uni", "usa": "États-Unis",
             "nld": "Pays-Bas", "prt": "Portugal", "aut": "Autriche", "irl": "Irlande", "pol": "Pologne", "mar": "Maroc"}
STATUSES = ("à travailler", "en cours", "acquis")


# ---------------------------------------------------------------- configuration

def load_yaml(p, default=None):
    if not p.exists():
        return default
    with open(p, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or default


def load_sites():
    sites = load_yaml(CONF / "sites.yaml", {}).get("sites", [])
    for s in sites:
        s.setdefault("account", "default")
        s["keywords"] = (load_yaml(CONF / "keywords" / f"{s['name']}.yaml", {}) or {}).get("keywords") or []
        s["actions"] = (load_yaml(CONF / "actions" / f"{s['name']}.yaml", {}) or {}).get("actions") or []
        for k in s["keywords"]:
            k["keyword"] = str(k["keyword"])
            k["page"] = k.get("page") or SITE_LEVEL
            k["variants"] = [str(v) for v in (k.get("variants") or []) if v]
            k["tags"] = [str(t) for t in (k.get("tags") or [])]
            k["queries"] = [k["keyword"]] + k["variants"]
            st = str(k.get("status") or "").strip().lower()
            k["status"] = st if st in STATUSES else None
            try:
                k["target"] = float(k["target"]) if k.get("target") not in (None, "") else None
            except (TypeError, ValueError):
                k["target"] = None
    return sites


def markets(s):
    """Marchés d'un projet : « tous pays » puis les pays déclarés (code ISO 3 lettres, libellé et dossier d'URL optionnels)."""
    out = [{"code": ALL, "label": "Tous pays", "path": None}]
    for c in s.get("countries") or []:
        c = {"code": c} if isinstance(c, str) else dict(c)
        code = str(c["code"]).strip().lower()
        out.append({"code": code, "label": c.get("label") or COUNTRIES.get(code, code.upper()), "path": c.get("path") or None})
    return out


def default_market(s):
    ms = markets(s)
    return ms[1]["code"] if len(ms) > 1 else ALL


def suffix(code):
    return "" if code == ALL else "." + code


def brand_rx(s):
    return "(?i)(" + (s.get("brand_regex") or "^$") + ")"


def tracked_queries(s):
    return sorted({q for k in s["keywords"] for q in k["queries"]})


def tracked_pages(s):
    return sorted({k["page"] for k in s["keywords"] if k["page"] != SITE_LEVEL})


def wanted(s):
    return sorted({(q, k["page"]) for k in s["keywords"] if k["page"] != SITE_LEVEL for q in k["queries"]})


def today_utc():
    """Jour de référence ; TRACKER_TODAY (AAAA-MM-JJ) le fige pour comparer deux versions du calcul."""
    t = os.environ.get("TRACKER_TODAY")
    return date.fromisoformat(t) if t else datetime.now(timezone.utc).date()


def windows_for(today):
    end = today - timedelta(days=1)
    lf = today - timedelta(days=FINAL_AFTER_DAYS)
    c_start = end - timedelta(days=27)
    p_end = c_start - timedelta(days=1)
    p_start = p_end - timedelta(days=27)
    a = lf - timedelta(days=27)
    sec = {"cur": [a, lf], "prev": [a - timedelta(days=28), a - timedelta(days=1)], "n1": [a - timedelta(days=364), lf - timedelta(days=364)]}
    return {"today": today, "end": end, "lf": lf, "c_start": c_start, "p_start": p_start, "p_end": p_end,
            "qp_start": today - timedelta(days=QUERY_PAGES_DAYS), "sec": sec, "cov": [a, lf]}


def market_rows(sites):
    """Marchés de tous les projets, au format attendu par sql.py."""
    return [{"site": s["name"], "market": m["code"], "country": None if m["code"] == ALL else m["code"], "path": m.get("path"),
             "brand": brand_rx(s)} for s in sites for m in markets(s)]


def write_json(p, obj, compact=True):
    p.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(obj, ensure_ascii=False, indent=1)
    p.write_text(txt, encoding="utf-8")


def read_json(p, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def norm_url(u):
    return u.rstrip("/") if u and u != SITE_LEVEL else u


def path_of(u):
    return urlparse(u).path or u


# ---------------------------------------------------------------- collecte GSC → BigQuery

def scope_filters(m):
    geo = [gsc.f("country", "equals", m["code"])] if m["code"] != ALL else []
    return geo, geo + ([gsc.f("page", "contains", m["path"])] if m.get("path") else [])


def ingest(s, days, today, stage, state):
    """Collecte d'un projet. Les lignes partent dans la table tampon au fil de l'eau ; les périmètres à remplacer ne sont
    déclarés qu'une fois tout réussi (un projet en erreur ne touche donc à rien dans les tables)."""
    name, prop, acc = s["name"], s["property"], s["account"]
    W = windows_for(today)
    end, t0 = W["end"], time.time()
    upd, scopes = {}, []
    raw_last = state.get((name, "raw_last"))
    ra = min(today - timedelta(days=days), date.fromisoformat(raw_last) + timedelta(days=1)) if raw_last else today - timedelta(days=BACKFILL_DAYS)
    ra = max(ra, today - timedelta(days=BACKFILL_DAYS))
    first = not raw_last
    print(f"[{name}] collecte du {ra} au {end}{' (premier passage, 16 mois)' if first else ''}")

    # 1. Détail complet : jour × pays × page × requête, un appel par jour, en parallèle
    def one_day(d):
        rows, info = gsc.export_day(acc, prop, d)
        stage.add("raw_queries", name, [(k[0], None, k[1], k[2], k[3], None, int(r["clicks"]), int(r["impressions"]), r["position"])
                                        for r in rows for k in (r["keys"],)])
        return len(rows), info
    res = gsc.parallel(one_day, gsc.days(ra, end))
    n_q = sum(n for n, _ in res)
    trunc = [i for _, i in res if i]
    scopes.append(("raw_queries", ra, end, None, None))

    # 2. Totaux complets par page (tous pays) et par pays, par tranches de 30 jours en parallèle
    chunks = []
    a = ra
    while a <= end:
        chunks.append((a, min(end, a + timedelta(days=29))))
        a += timedelta(days=30)

    def pages_chunk(ch):
        rows = gsc.query(acc, prop, ch[0], ch[1], ["date", "page"])
        stage.add("raw_pages", name, [(r["keys"][0], None, None, r["keys"][1], None, None, int(r["clicks"]), int(r["impressions"]), r["position"])
                                      for r in rows])
        per_day = defaultdict(int)
        for r in rows:
            per_day[r["keys"][0]] += 1
        return [d for d, n in per_day.items() if n >= gsc.DAY_CAP]

    def totals_chunk(ch):
        rows = gsc.query(acc, prop, ch[0], ch[1], ["date", "country"])
        stage.add("raw_totals", name, [(r["keys"][0], None, r["keys"][1], None, None, None, int(r["clicks"]), int(r["impressions"]), r["position"])
                                       for r in rows])
        return len(rows)
    capped_pages = [d for lst in gsc.parallel(pages_chunk, chunks) for d in lst]
    gsc.parallel(totals_chunk, chunks)
    scopes += [("raw_pages", ra, end, None, None), ("raw_totals", ra, end, None, None)]

    # 3. Ce que seule la GSC sait donner, par marché : position « site » des mots-clés suivis (agrégée par propriété),
    #    marque / hors marque, total d'un marché limité à un dossier d'URL, répartition par appareil
    queries, pages = tracked_queries(s), tracked_pages(s)
    done = set(state.get((name, "kw_done")) or [])
    brand = brand_rx(s)
    full = today - timedelta(days=BACKFILL_DAYS)
    for m in markets(s):
        mk = m["code"]
        sfx = "" if mk == ALL else "|" + mk
        geo, scope = scope_filters(m)
        new_q = [q for q in queries if f"{q}|*{sfx}" not in done]
        old_q = [q for q in queries if q not in new_q]
        kw = []
        if old_q:
            kw += gsc.query_lots(acc, prop, ra, end, ["date", "query"], old_q, scope)
            scopes.append(("kw_site", ra, end, mk, None))
        if new_q:
            kw += gsc.query_lots(acc, prop, full, end, ["date", "query"], new_q, scope)
            scopes += [("kw_site", full, end, mk, q) for q in new_q]
        stage.add("kw_site", name, [(r["keys"][0], mk, None, None, r["keys"][1], None, int(r["clicks"]), int(r["impressions"]), r["position"])
                                    for r in kw])
        sa = ra if f"__site__{sfx}" in done else full
        segs = [("brand", [gsc.f("query", "includingRegex", brand)]), ("nonbrand", [gsc.f("query", "excludingRegex", brand)])]
        if m.get("path"):
            segs.append(("total", []))   # total d'un dossier : la GSC ne le donne que sans les requêtes masquées (pays + page)
        for seg, flt in segs:
            stage.add("segments", name, [(r["keys"][0], mk, None, None, None, seg, int(r["clicks"]), int(r["impressions"]), r["position"])
                                         for r in gsc.query(acc, prop, sa, end, ["date"], flt + scope)])
        scopes.append(("segments", sa, end, mk, None))
        if queries and pages:
            rows = gsc.query_lots(acc, prop, W["c_start"], end, ["query", "page", "device"], queries, geo, pages=pages)
            upd[(name, f"device|{mk}")] = [[*r["keys"], int(r["clicks"]), int(r["impressions"]), round(r["position"], 1)] for r in rows]
        done |= {f"{q}|*{sfx}" for q in queries} | {f"__site__{sfx}"}

    insp = inspect_pages(s, pages, state.get((name, "inspection")), only_new=True)
    if insp is not None:
        upd[(name, "inspection")] = insp
    if trunc or capped_pages:
        old = state.get((name, "truncation")) or []
        upd[(name, "truncation")] = (old + trunc + [{"date": d, "table": "raw_pages", "rows": gsc.DAY_CAP} for d in capped_pages])[-200:]
    upd.update({(name, "raw_last"): str(end), (name, "last_ra"): str(ra), (name, "kw_done"): sorted(done)})
    for tbl, a, b, mk, q in scopes:
        stage.scope(tbl, name, a, b, mk, q)
    print(f"[{name}] collecte terminée en {time.time() - t0:.0f} s : {n_q} lignes requêtes"
          + (f", {len(trunc)} jour(s) à la limite de lignes de la GSC" if trunc else ""))
    return upd


def inspect_pages(s, pages, store, only_new=False, tracked=None):
    """Inspection d'URL (état d'indexation, canonique). only_new : seulement les pages jamais vérifiées.
    tracked : toutes les pages suivies du projet (l'état des pages qui ne sont plus suivies est retiré).
    Renvoie le nouvel état, ou None si rien n'a changé."""
    store = store or {"current": {}, "history": []}
    today = str(today_utc())
    fields = ["verdict", "coverageState", "indexingState", "robotsTxtState", "pageFetchState", "googleCanonical", "userCanonical"]
    todo = [u for u in pages if not only_new or u not in store["current"]]
    keep = set(tracked if tracked is not None else pages)
    if not todo and set(store["current"]) <= keep:
        return None
    if todo:
        print(f"  [{s['name']}] inspection de {len(todo)} page(s)")
    done = []
    for url in todo:
        try:
            r = gsc.inspect(s["account"], s["property"], url)
        except Exception as e:
            print(f"  inspection {url} : {e}")
            continue
        res = r.get("inspectionResult", {}).get("indexStatusResult", {})
        cur = {k: res.get(k) for k in fields + ["lastCrawlTime", "crawledAs"]}
        cur["checked"] = today
        old = store["current"].get(url)
        if old:
            for k in fields:
                if old.get(k) != cur.get(k):
                    store["history"].append({"date": today, "url": url, "field": k, "old": old.get(k), "new": cur.get(k)})
        store["current"][url] = cur
        done.append((url, cur))
    store["current"] = {u: v for u, v in store["current"].items() if u in keep}
    store["history"] = store["history"][-500:]
    store["_done"] = [[u, c] for u, c in done]
    return store


def google_updates(known):
    known = {u["id"]: u for u in (known or [])}
    try:
        for i in requests.get(GOOGLE_STATUS, timeout=30).json():
            uri = (i.get("uri") or "").lstrip("/")
            known[i["id"]] = {"id": i["id"], "begin": (i.get("begin") or "")[:10], "end": (i.get("end") or "")[:10],
                              "title": i.get("external_desc") or "", "service": i.get("service_name") or "",
                              "url": f"https://status.search.google.com/{uri}"}
    except Exception as e:
        print(f"mises à jour Google : {e}")
    return sorted(known.values(), key=lambda u: u["begin"])


def sync(days, only=None, skip_if_fresh=None):
    """Collecte de tous les projets en parallèle, une seule écriture BigQuery, puis calcul du dashboard."""
    t0, run_id = time.time(), uuid.uuid4().hex[:12]
    started = datetime.now(timezone.utc)
    bq.ensure_schema()
    state = bq.state_get()
    last = state.get(("", "last_sync"))
    if skip_if_fresh and last and not only and (started - datetime.fromisoformat(last)).total_seconds() < skip_if_fresh * 3600:
        print(f"Synchro déjà faite le {last} (moins de {skip_if_fresh} h) : rien à faire.")
        return False
    today = today_utc()
    sites = [s for s in load_sites() if not only or s["name"] in only]
    stage = bq.Stage()
    upd, runs = {}, []

    def run(s):
        t = time.time()
        st = dict(state.get((s["name"], "status")) or {})
        st["last_run"] = started.isoformat(timespec="minutes")
        try:
            u = ingest(s, days, today, stage, state)
            st.update({"ok": True, "error": None, "last_data_date": u[(s["name"], "raw_last")], "last_success": st["last_run"]})
            return s, u, st, None, time.time() - t
        except Exception as e:
            print(f"[{s['name']}] ERREUR : {e}")
            st.update({"ok": False, "error": str(e)[:300]})
            return s, {}, st, e, time.time() - t

    with ThreadPoolExecutor(max_workers=PROJECT_WORKERS) as ex:
        results = list(ex.map(run, sites))
    ok = [s for s, _, _, e, _ in results if e is None]
    for s, u, st, e, sec in results:
        upd.update(u)
        upd[(s["name"], "status")] = st
        runs.append({"run_id": run_id, "started_at": started.isoformat(), "seconds": round(sec, 1), "site": s["name"], "step": "collecte",
                     "ok": e is None, "detail": str(e)[:500] if e else None})
    tracked = [{"site": s["name"], "query": q} for s in ok for q in tracked_queries(s)]
    tracked_new = [x for x in tracked if x["query"] not in set(state.get((x["site"], "tracked")) or [])]
    t1 = time.time()
    stage.commit(tracked, tracked_new)
    print(f"BigQuery : {stage.n} lignes écrites ({time.time() - t1:.0f} s)")
    for s in ok:
        upd[(s["name"], "tracked")] = tracked_queries(s)
    upd[("", "google_updates")] = google_updates(state.get(("", "google_updates")))
    upd[("", "last_sync")] = started.isoformat(timespec="seconds")
    for k, v in upd.items():
        if isinstance(v, dict) and "_done" in v:
            v.pop("_done")
    bq.state_put(upd)
    runs.append({"run_id": run_id, "started_at": started.isoformat(), "seconds": round(time.time() - t0, 1), "site": None,
                 "step": "synchro", "ok": len(ok) == len(sites), "gsc_calls": gsc.calls["n"], "gsc_rows": gsc.calls["rows"],
                 "bq_jobs": bq.usage["jobs"], "bq_bytes_billed": bq.usage["bytes_billed"],
                 "detail": f"{len(ok)}/{len(sites)} projets, {stage.n} lignes"})
    print(f"Synchro : {len(ok)}/{len(sites)} projets, {gsc.calls['n']} appels GSC ({gsc.calls['seconds']:.0f} s d'API), "
          f"{time.time() - t0:.0f} s")
    build(run_id=run_id, runs=runs, fresh=True)
    return True


# ---------------------------------------------------------------- calcul du dashboard (lectures BigQuery)

def build(run_id=None, runs=None, fresh=False):
    """fresh : des données viennent d'être collectées (sinon les courbes des dossiers ne sont recalculées que si les
    dossiers ont changé)."""
    t0 = time.time()
    run_id = run_id or uuid.uuid4().hex[:12]
    runs = runs or []
    b0, j0 = bq.usage["bytes_billed"], bq.usage["jobs"]
    sites = load_sites()
    if not sites:
        print("Aucun projet dans config/sites.yaml")
        return
    W = windows_for(today_utc())
    state = bq.state_get()
    generated = datetime.now(timezone.utc).isoformat(timespec="minutes")
    index = {"generated_at": generated, "google_updates": state.get(("", "google_updates")) or [], "projects": []}
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    upd = {}
    # Projets traités par lots : chaque requête BigQuery couvre un lot (taille et coût bornés quel que soit le portefeuille)
    for i in range(0, len(sites), BUILD_BATCH):
        projects, u = build_batch(sites[i:i + BUILD_BATCH], W, state, generated, fresh)
        index["projects"] += projects
        upd.update(u)
    write_json(OUT / "index.json", index)
    version = hashlib.sha1(b"".join(f.read_bytes() for f in sorted(OUT.glob("*.json")))).hexdigest()[:12]
    write_json(OUT / "manifest.json", {"version": version, "generated_at": generated})
    runs.append({"run_id": run_id, "started_at": datetime.now(timezone.utc).isoformat(), "seconds": round(time.time() - t0, 1),
                 "site": None, "step": "calcul", "ok": True, "bq_jobs": bq.usage["jobs"] - j0, "bq_bytes_billed": bq.usage["bytes_billed"] - b0,
                 "detail": f"{len(sites)} projets, version {version}"})
    def log():
        try:
            bq.log_runs(runs)
        except Exception as e:  # le journal ne doit jamais bloquer la publication
            print(f"journal des synchros : {e}")
    with ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(lambda f: f(), [lambda: bq.state_put(upd), log]))
    print(f"Calcul : {len(sites)} projets en {time.time() - t0:.0f} s, {(bq.usage['bytes_billed'] - b0) / 1e6:.0f} Mo facturés "
          f"(BigQuery, {bq.usage['jobs'] - j0} requêtes)")


def build_batch(sites, W, state, generated, fresh):
    """Calcul d'un lot de projets : lectures BigQuery (une requête par besoin pour tout le lot), puis fichiers du dashboard.
    Renvoie les lignes du portefeuille et les mises à jour d'état."""
    lf_s = str(W["lf"])
    mrows = market_rows(sites)
    want = [{"site": s["name"], "query": q, "page": p} for s in sites for q, p in wanted(s)]
    tpages = [{"site": s["name"], "page": p} for s in sites for p in tracked_pages(s)]

    # Lectures indépendantes lancées ensemble (envoi en parallèle) : elles tournent en même temps dans BigQuery
    with ThreadPoolExecutor(max_workers=5) as ex:
        j_tr, j_se, j_wi, j_sn, j_cv = ex.map(lambda f: f(), [
            lambda: sql.tracked(mrows, want, W["qp_start"]), lambda: sql.series(mrows),
            lambda: sql.windows(mrows, tpages, want, W["c_start"], W["p_start"], W["end"], LIMITS, W["cov"]),
            lambda: sql.page_snaps(mrows, W["sec"]), lambda: sql.coverage(mrows, *W["cov"])])

    # Dossiers : détection sur les pages vues (3 fenêtres), puis courbes et comparaisons dans BigQuery
    snaps = defaultdict(lambda: defaultdict(float))
    for r in bq.wait(j_sn):
        snaps[(r["site"], r["market"])][r["page"]] += r["c"] or 0
    patterns, sec_meta = [], {}
    for s in sites:
        last_ra = state.get((s["name"], "last_ra"))
        for m in markets(s):
            key = (s["name"], f"sections|{m['code']}")
            old = state.get(key) or {}
            groupings, info = detect_sections(snaps.get((s["name"], m["code"]), {}), m, old.get("groupings") or {})
            sig = {g: [(x["key"], x.get("rx")) for x in v] for g, v in groupings.items()}
            old_sig = {g: [(x["key"], x.get("rx")) for x in v] for g, v in (old.get("groupings") or {}).items()}
            since = W["today"] - timedelta(days=SECTION_REFRESH_DAYS)
            if last_ra:
                since = min(since, date.fromisoformat(last_ra))
            if json.dumps(sig) != json.dumps(old_sig) or not old.get("series"):
                since = bq.EPOCH
            elif not fresh:
                since = None   # rien de collecté depuis le dernier calcul : courbes des dossiers déjà à jour
            sec_meta[key] = {"groupings": groupings, **info, "series": True}
            if groupings:
                patterns += [{"site": s["name"], "market": m["code"], "grouping": g, "ord": i, "section": x["key"], "rx": x.get("rx")}
                             for g, secs in groupings.items() for i, x in enumerate(secs)]
            for x in mrows:
                if x["site"] == s["name"] and x["market"] == m["code"]:
                    x["since"] = str(since) if since else None
    sec_markets = [x for x in mrows if any(p["site"] == x["site"] and p["market"] == x["market"] for p in patterns)]
    # Comparaisons des dossiers (lisent les tables brutes) lancées tout de suite, en parallèle de la mise à jour des courbes
    j_su = sql.section_summary(sec_markets, patterns, W["sec"], SEC_TOP, SEC_MIN_IMPR) if sec_markets else None
    to_refresh = [x for x in sec_markets if x.get("since")]
    if to_refresh:
        t1 = time.time()
        sql.section_daily(to_refresh, [p for p in patterns if any(p["site"] == x["site"] and p["market"] == x["market"] for x in to_refresh)])
        print(f"BigQuery : courbes des dossiers mises à jour ({time.time() - t1:.0f} s)")
    j_ss = sql.section_series({s["name"] for s in sites})

    # Résultats
    pos_rows, qp_rows, kw_rows, site_rows = (defaultdict(list) for _ in range(4))
    for r in bq.wait(j_tr):
        k, d = (r["site"], r["market"]), str(r["date"])
        p = round(r["p"], 1) if r["p"] is not None else None
        if r["wanted"]:
            pos_rows[k].append({"date": d, "keyword": r["query"], "page": r["page"], "position": p, "clicks": r["c"],
                                "impressions": r["i"], "data_state": "final" if d <= lf_s else "fresh"})
        if r["competing"]:
            qp_rows[k].append({"date": d, "query": r["query"], "page": r["page"], "position": p, "clicks": r["c"], "impressions": r["i"]})
    for r in bq.wait(j_se):
        k, d = (r["site"], r["market"]), str(r["date"])
        row = {"date": d, "position": round(r["p"], 1) if r["p"] is not None else 0, "clicks": r["c"], "impressions": r["i"],
               "data_state": "final" if d <= lf_s else "fresh"}
        if r["kind"] == "kw":
            kw_rows[k].append({**row, "query": r["k"]})
        else:
            site_rows[k].append({**row, "segment": r["kind"]})
    # Ordre stable (le SQL ne garantit pas l'ordre des lignes) : même tri que les anciens CSV, pour départager les égalités
    for d in pos_rows.values():
        d.sort(key=lambda r: (r["keyword"], r["page"], r["date"]))
    for d in qp_rows.values():
        d.sort(key=lambda r: (r["query"], r["date"], r["page"]))
    for d in kw_rows.values():
        d.sort(key=lambda r: (r["query"], r["date"]))
    for d in site_rows.values():
        d.sort(key=lambda r: (r["segment"], r["date"]))
    win = sql.rows_json(j_wi)
    cov = {(r["site"], r["market"]): dict(r) for r in bq.wait(j_cv)}
    for (kind, site, mk), lst in win.items():
        if kind == "cv" and (site, mk) in cov:
            cov[(site, mk)].update({"named_c": lst[0]["c"], "named_i": lst[0]["i"], "named_q": lst[0]["n"]})
    sec_series = defaultdict(lambda: defaultdict(list))
    for r in bq.wait(j_ss):
        d = str(r["date"])
        sec_series[(r["site"], r["market"])][(r["grp"], r["section"])].append(
            [d, round(r["p"], 1) if r["p"] is not None else 0, r["c"], r["i"], 0 if d <= lf_s else 1])
    sec_sum = defaultdict(dict)
    if j_su:
        for r in bq.wait(j_su):
            sec_sum[(r["site"], r["market"])][(r["grp"], r["section"], r["kind"], r["ref"])] = json.loads(r["j"])

    projects = []
    for s in sites:
        name = s["name"]
        ms, dm = markets(s), default_market(s)
        insp = state.get((name, "inspection")) or {"current": {}, "history": []}
        st = state.get((name, "status")) or {}
        for m in ms:
            k = (name, m["code"])
            extras = {"period": [str(W["c_start"]), str(W["end"])], "prev_period": [str(W["p_start"]), str(W["p_end"])],
                      "splits": {"device": state.get((name, f"device|{m['code']}")) or []}}
            if m["code"] == ALL:
                extras["splits"]["country"] = [[x["query"], x["page"], x["country"], x["c"], x["i"], round(x["p"], 1)]
                                               for x in sorted(win.get(("ct", name, m["code"]), []),
                                                               key=lambda x: (-x["c"], -x["i"], x["query"], x["page"], x["country"]))]
            pq = defaultdict(lambda: defaultdict(list))
            for x in sorted(win.get(("pq", name, m["code"]), []), key=lambda x: (-x["i"], x["query"])):
                pq[x["page"]][x["win"]].append([x["query"], x["c"], x["i"], round(x["p"], 1)])
            extras["page_queries"] = {p: dict(v) for p, v in pq.items()}
            extras["queries"] = [[x["query"], x["c"], x["i"], round(x["p"], 1) if x["p"] is not None else None, x["best"], x["prev"]]
                                 for x in sorted(win.get(("sg", name, m["code"]), []), key=lambda x: (-x["i"], x["query"]))]
            extras["cannib"] = [[x["query"], x["tot"], x["cl"], x["grav"], [[y["page"], y["c"], y["i"], y["p"]] for y in x["pages"]]]
                                for x in sorted(win.get(("cn", name, m["code"]), []), key=lambda x: (-x["grav"], x["query"]))]
            p = build_project(s, m, ms, dm, pos_rows[k], kw_rows[k], qp_rows[k], site_rows[k], extras, insp, st, generated)
            p["data_quality"] = data_quality(m, cov.get(k), state.get((name, "truncation")), W)
            if m.get("path"):
                p["anonymized_share"] = None   # total du dossier sans les requêtes masquées : la part masquée n'est pas mesurable
            write_json(OUT / f"{name}{suffix(m['code'])}.json", p)
            meta = sec_meta.get((name, f"sections|{m['code']}"))
            if meta and meta.get("groupings"):
                write_json(OUT / f"{name}{suffix(m['code'])}.sections.json",
                           sections_payload(m, meta, sec_series.get(k, {}), sec_sum.get(k, {}), W, generated))
            if m["code"] == dm:
                projects.append(summary(p))
            print(f"[{name}/{m['code']}] {len(p['keywords'])} mots-clés, {len(p['alerts'])} alertes, {len(p['events'])} événements, "
                  f"{len(p['actions'])} actions, {len(p['cannib'])} requêtes cannibalisées")
    return projects, sec_meta


def data_quality(m, cov, truncation, W):
    """Ce que la GSC ne montre pas pour ce marché (non affiché pour l'instant, conservé pour le dashboard) :
    - requêtes masquées : présentes dans les totaux, absentes du détail par requête ;
    - marché limité à un dossier d'URL : la GSC ne donne pas de total complet pays + page ;
    - dossiers d'un marché pays : sommes des requêtes connues (pas de total complet page × pays) ;
    - jours où la GSC a atteint sa limite de lignes exposées."""
    cov = cov or {}
    tc, nc = cov.get("tot_c") or 0, cov.get("named_c") or 0
    out = {"window": [str(x) for x in W["cov"]], "country_clicks": tc, "country_impressions": cov.get("tot_i") or 0,
           "named_clicks": nc, "named_impressions": cov.get("named_i") or 0, "named_queries": cov.get("named_q") or 0,
           "market_totals": "named_only" if m.get("path") else "complete",
           "page_totals": "complete" if m["code"] == ALL and not m.get("path") else "named_only",
           "truncated_days": [t for t in (truncation or []) if t.get("date", "") >= str(W["today"] - timedelta(days=BACKFILL_DAYS))]}
    if not m.get("path"):
        out["hidden_clicks_share"] = round((tc - nc) / tc * 100, 1) if tc else None
    return out


def sections_payload(m, meta, series, summ, W, generated):
    """Fichier du dashboard pour Trafic > Par dossier (chargé à la demande)."""
    def items(lst):
        return [[x["k"], x["cc"], x["ci"], x["cp"], x["rc"], x["ri"], x["rp"]] for x in (lst or [])]

    def ref_block(r, kind):
        base = {"win": items(r.get("win")), "lose": items(r.get("lose")), "new": items(r.get("new")), "gone": items(r.get("gone")),
                "n_new": r.get("n_new", 0), "n_gone": r.get("n_gone", 0), "new_clicks": r.get("new_clicks", 0), "gone_clicks": r.get("gone_clicks", 0)}
        if kind == "pages":
            return {"active": r.get("ref_active", 0), "clicks": r.get("ref_clicks", 0), **base}
        return {"count": r.get("ref_active", 0), "dist": r.get("ref_dist", [0, 0, 0, 0]), **base}

    groupings = []
    for g, secs in meta["groupings"].items():
        out = []
        for x in secs:
            sm = {}
            for kind in ("pages", "queries", "queries_nonbrand"):
                cur = summ.get((g, x["key"], kind, "prev")) or {}
                blk = {ref: ref_block(summ.get((g, x["key"], kind, ref)) or {}, kind) for ref in ("prev", "n1")}
                if kind == "pages":
                    tot = cur.get("clicks", 0)
                    sm[kind] = {"active": cur.get("active", 0), "clicks": tot,
                                "top10_share": round((cur.get("top10") or 0) / tot * 100, 1) if tot else None, **blk}
                else:
                    sm[kind] = {"count": cur.get("active", 0), "named_clicks": cur.get("clicks", 0), "dist": cur.get("dist", [0, 0, 0, 0]), **blk}
            out.append({"key": x["key"], "label": x["label"], "rx": x["rx"], "series": {"total": sorted(series.get((g, x["key"]), []))},
                        "summary": sm})
        groupings.append({"id": g, "label": GROUPINGS.get(g, g), "sections": out})
    return {"generated_at": generated, "source": "bigquery", "main_host": meta.get("main_host"), "market_path": meta.get("market_path"),
            "languages": meta.get("languages"), "page_totals": "complete" if m["code"] == ALL and not m.get("path") else "named_only",
            "windows": {"28": {lbl: [str(a), str(b)] for lbl, (a, b) in W["sec"].items()}}, "groupings": groupings}


# ---------------------------------------------------------------- règles métier (inchangées depuis l'outil datashake)

def url_host(u):
    h = urlparse(u).netloc.lower()
    return h[4:] if h.startswith("www.") else h


def detect_sections(pages, m, previous=None):
    """Découpe les pages d'un marché en sections, pour chaque regroupement (dossier, langue).

    pages = {url: clics} sur l'union des périodes observées. Lecture d'une URL : hôte (un sous-domaine est une section à
    part, www et sans www fusionnés), puis préfixe du marché déclaré ou préfixe de langue détecté, puis premier segment.
    Chaque section porte la regex (RE2) qui sert aussi de filtre GSC, pour que le classement des pages et les séries
    soient identiques. « Autres pages » = tout ce qu'aucune regex ne prend. Une section déjà détectée est conservée."""
    previous = previous or {}
    hosts = defaultdict(float)
    for u, c in pages.items():
        hosts[url_host(u)] += c + 1e-6
    if not hosts:
        return previous, {}
    main = max(hosts, key=hosts.get)
    main_pages = [u for u in pages if url_host(u) == main]
    mp = "/".join(x for x in (m.get("path") or "").split("/") if x)
    codes = []
    if not mp:
        cnt = defaultdict(int)
        for u in main_pages:
            first = urlparse(u).path.lstrip("/").split("/", 1)[0]
            lm = LOCALE.match(first)
            if lm and lm.group(1).lower() in LANGS:
                cnt[first] += 1
        # Préfixe de langue : plusieurs codes bien présents, ou un code qui couvre une bonne part du site
        # (évite de prendre une rubrique /it/ ou /tv/ pour une langue)
        if main_pages and (sum(v >= SEC_MIN_PAGES for v in cnt.values()) >= 2 or sum(cnt.values()) / len(main_pages) >= 0.3):
            codes = sorted(cnt)
    host_rx = r"^https?://(?:www\.)?" + re.escape(main) + "/"
    if mp:
        pre = pre_root = re.escape(mp) + "/"
    elif codes:
        alt = "|".join(re.escape(c) for c in codes)
        pre, pre_root = f"(?:(?:{alt})/)?", f"(?:(?:{alt})/?)?"
    else:
        pre = pre_root = ""

    total = sum(pages.values()) or 1
    cand, lang = defaultdict(lambda: [0, 0.0]), defaultdict(lambda: [0, 0.0])
    for u, c in pages.items():
        h = url_host(u)
        if h != main:
            key = "h:" + h
        else:
            rest = urlparse(u).path.lstrip("/")
            if mp:
                if not rest.startswith(mp + "/"):
                    continue
                rest = rest[len(mp) + 1:]
            elif codes:
                head, _, tail = rest.partition("/")
                if head in codes:
                    lang["l:" + head][0] += 1; lang["l:" + head][1] += c
                    rest = tail
            seg, slash, _ = rest.partition("/")
            if not slash or not seg:
                continue  # page de premier niveau
            key = "d:" + seg
        cand[key][0] += 1; cand[key][1] += c

    def label(key):
        kind, _, v = key.partition(":")
        return {"h": v, "d": f"/{v}/", "l": f"/{v}/"}.get(kind) or {"racine": "Pages de premier niveau", "autres": "Autres pages"}[key]

    def rx(key):
        kind, _, v = key.partition(":")
        if kind == "h":
            return r"^https?://" + re.escape(v) + "/"
        if kind == "d":
            return host_rx + pre + re.escape(v) + "/"
        if kind == "l":
            return host_rx + re.escape(v) + "(?:/|$)"
        return host_rx + pre_root + "[^/]*$" if key == "racine" else None

    def pick(pool, prev_list):
        prev_keys = [x["key"] for x in prev_list if x["key"] not in ("racine", "autres")]
        new = sorted((k for k, (n, c) in pool.items() if k not in prev_keys and (n >= SEC_MIN_PAGES or c / total >= SEC_MIN_SHARE)),
                     key=lambda k: -pool[k][1])
        return prev_keys + new[:max(0, SEC_MAX - len(prev_keys))]

    out = {"dossier": [{"key": k, "label": label(k), "rx": rx(k)} for k in ["racine"] + pick(cand, previous.get("dossier", []))]}
    if codes:
        keys = pick(lang, previous.get("langue", []))
        if len(keys) >= 2:
            out["langue"] = [{"key": k, "label": label(k), "rx": rx(k)} for k in keys]
    for secs in out.values():
        secs.append({"key": "autres", "label": "Autres pages", "rx": None})
    return out, {"main_host": main, "market_path": mp or None, "languages": codes}


def wavg(rows):
    impr = sum(r[2] for r in rows)
    clicks = sum(r[1] for r in rows)
    pos = sum(r[0] * r[2] for r in rows) / impr if impr else None
    return pos, clicks, impr


def daily(rows, queries, page=None):
    """Agrège par jour (position pondérée par les impressions) les lignes des requêtes d'un groupe."""
    by = defaultdict(list)
    fresh = set()
    for r in rows:
        if r.get("keyword", r.get("query")) in queries and (page is None or r.get("page") == page):
            by[r["date"]].append((float(r["position"]), int(r["clicks"]), int(r["impressions"])))
            if r.get("data_state") == "fresh":
                fresh.add(r["date"])
    out = []
    for d in sorted(by):
        p, c, i = wavg(by[d])
        out.append([d, round(p, 1) if p is not None else None, c, i, 1 if d in fresh else 0])
    return out


def window_stats(series, a, b):
    rows = [(x[1], x[2], x[3]) for x in series if a <= x[0] <= b and x[1] is not None]
    return wavg(rows)


def ctr_curve(pos_rows, last_final):
    """Courbe de CTR par position calculée sur les données du client (90 derniers jours, données définitives)."""
    since = str(date.fromisoformat(last_final) - timedelta(days=90))
    b = defaultdict(lambda: [0, 0])
    for r in pos_rows:
        if since <= r["date"] <= last_final:
            k = min(20, max(1, round(float(r["position"]))))
            b[k][0] += int(r["clicks"]); b[k][1] += int(r["impressions"])
    pts = {k: v[0] / v[1] for k, v in b.items() if v[1] >= 100}
    if not pts:
        return None
    curve, known = [], sorted(pts)
    for k in range(1, 21):
        if k in pts:
            v = pts[k]
        else:
            lo = max([x for x in known if x < k], default=None)
            hi = min([x for x in known if x > k], default=None)
            v = pts[lo] + (pts[hi] - pts[lo]) * (k - lo) / (hi - lo) if lo and hi else pts[lo or hi]
        curve.append(v)
    for i in range(1, 20):  # une position plus basse ne peut pas avoir un meilleur CTR
        curve[i] = min(curve[i], curve[i - 1])
    return [round(v, 5) for v in curve]


def ctr_at(curve, pos):
    if not curve or pos is None:
        return 0
    if pos <= 1:
        return curve[0]
    if pos >= 20:
        return curve[19]
    lo = int(pos)
    return curve[lo - 1] + (curve[lo] - curve[lo - 1]) * (pos - lo)


def fr(x):
    return f"{x:.1f}".replace(".", ",")


def dshift(d, n):
    return str(date.fromisoformat(d) + timedelta(days=n))


def pos_at(series_map, d, lookback=LOOKBACK):
    """Position au jour d, sinon la dernière connue dans les `lookback` jours précédents. Renvoie le point ou None."""
    for n in range(lookback + 1):
        x = series_map.get(dshift(d, -n))
        if x and x[1] is not None:
            return x
    return None


def build_project(s, m, ms, dm, pos_rows, kw_rows, qp_rows, site_rows, extras, insp, st, generated):
    name = s["name"]
    today = str(datetime.now(timezone.utc).date())
    all_dates = sorted({r["date"] for r in site_rows} | {r["date"] for r in kw_rows})
    finals = sorted({r["date"] for r in site_rows if r["data_state"] == "final"} | {r["date"] for r in kw_rows if r["data_state"] == "final"})
    last = all_dates[-1] if all_dates else None
    lf = finals[-1] if finals else last
    curve = ctr_curve(pos_rows, lf) if lf else None

    # Pages qui reçoivent des impressions sur chaque requête, par jour (changement d'URL)
    qp_day = defaultdict(lambda: defaultdict(list))
    for r in qp_rows:
        qp_day[r["query"]][r["date"]].append(r)

    groups = []
    for i, k in enumerate(s["keywords"]):
        qs = set(k["queries"])
        site_s = daily(kw_rows, qs)
        tracked = site_s if k["page"] == SITE_LEVEL else daily(pos_rows, qs, k["page"])
        g = {"i": i, "keyword": k["keyword"], "page": k["page"], "variants": k["variants"], "tags": k["tags"],
             "note": k.get("note"), "status": k["status"], "target": k["target"], "s": tracked, "ss": site_s}
        if lf:
            a28 = dshift(lf, -27)
            g["variants_detail"] = []
            for q in k["queries"]:
                vp = window_stats(daily(pos_rows, {q}, k["page"]) if k["page"] != SITE_LEVEL else daily(kw_rows, {q}), a28, lf)
                vs = window_stats(daily(kw_rows, {q}), a28, lf)
                g["variants_detail"].append({"query": q, "pos": r1(vp[0]), "clicks": vp[1], "impr": vp[2], "site_pos": r1(vs[0]), "site_impr": vs[2]})
            g["pages"] = competing(qp_rows, qs, k["page"], dshift(lf, -27), lf, dshift(lf, -6))
            g["splits"] = splits_for(extras.get("splits", {}), qs, k["page"])
        # Page qui capte le plus d'impressions chaque jour, quand ce n'est pas la page suivie
        if k["page"] != SITE_LEVEL:
            alt = {}
            dates = {d for q in qs for d in qp_day[q]}
            for d in dates:
                per = defaultdict(list)
                for q in qs:
                    for r in qp_day[q].get(d, []):
                        per[r["page"]].append((float(r["position"]), int(r["clicks"]), int(r["impressions"])))
                agg = {pg: wavg(v) for pg, v in per.items()}
                lead = max(agg, key=lambda pg: agg[pg][2])
                if lead != k["page"] and agg[lead][2] > agg.get(k["page"], (None, 0, 0))[2]:
                    alt[d] = [lead, agg[lead][2], r1(agg[lead][0]), agg.get(k["page"], (None, 0, 0))[2]]
            g["alt"] = alt
        groups.append(g)

    alerts, events, moves = detect(groups, qp_rows, curve, finals)
    for url, cur in insp.get("current", {}).items():
        if cur.get("verdict") and cur["verdict"] != "PASS":
            alerts.append(alert("critique", "indexation", None, url, f"Page non indexée : {cur.get('coverageState')} (vérifié le {cur.get('checked')})", lf))
        elif cur.get("googleCanonical") and cur.get("userCanonical") and norm_url(cur["googleCanonical"]) != norm_url(cur["userCanonical"]):
            alerts.append(alert("attention", "canonical", None, url, f"Google retient une autre canonique : {cur['googleCanonical']} (vérifié le {cur.get('checked')})", lf))
    for h in insp.get("history", []):
        events.append({"date": h["date"], "severity": "attention", "type": "inspection", "page": h["url"],
                       "text": f"Inspection : {h['field']} passe de « {h['old']} » à « {h['new']} »"})
    if st.get("ok") is False:
        alerts.append(alert("critique", "synchro", None, None, f"La dernière synchro a échoué : {st.get('error')}", today))
    elif last and (date.fromisoformat(today) - date.fromisoformat(last)).days > 4:
        alerts.append(alert("critique", "synchro", None, None, f"Pas de nouvelle donnée depuis le {last}", today))
    alerts.sort(key=lambda a: ({"critique": 0, "attention": 1, "info": 2}[a["severity"]], -(a.get("impact") or 0)))
    events.sort(key=lambda e: e["date"], reverse=True)

    actions = impact(s["actions"], groups, finals)
    segs = {seg: [[r["date"], float(r["position"]), int(r["clicks"]), int(r["impressions"]), 1 if r["data_state"] == "fresh" else 0]
                  for r in sorted(site_rows, key=lambda r: r["date"]) if r["segment"] == seg] for seg in ("total", "brand", "nonbrand")}
    anonymized = None
    if lf:
        a28 = dshift(lf, -27)
        tot = sum(x[2] for x in segs["total"] if a28 <= x[0] <= lf)
        named = sum(x[2] for sg in ("brand", "nonbrand") for x in segs[sg] if a28 <= x[0] <= lf)
        anonymized = round((tot - named) / tot * 100, 1) if tot else None

    crit = sum(a["severity"] == "critique" for a in alerts)
    att = sum(a["severity"] == "attention" for a in alerts)
    tracked_q = {q for k in s["keywords"] for q in k["queries"]}
    return {
        "name": name, "label": s.get("label", name), "property": s["property"], "owner": s.get("owner"),
        "account": s["account"], "generated_at": generated, "last_date": last, "last_final": lf,
        "market": m["code"], "market_label": m["label"], "market_path": m.get("path"), "default_market": dm,
        "markets": [{"code": x["code"], "label": x["label"]} for x in ms],
        "status": st, "health": max(0, 100 - 15 * crit - 5 * att), "ctr_curve": curve, "anonymized_share": anonymized,
        "keywords": groups, "alerts": alerts, "events": events[:3000], "moves": moves, "actions": actions,
        "segments": segs, "inspection": insp, "page_queries": extras.get("page_queries", {}), "extras_period": extras.get("period"),
        "suggestions": suggestions(extras.get("queries", []), tracked_q, curve),
        "cannib": extras.get("cannib", []),
    }


def r1(v):
    return round(v, 1) if v is not None else None


def competing(qp_rows, qs, tracked_page, a28, lf, a7):
    per = defaultdict(lambda: [[], []])
    for r in qp_rows:
        if r["query"] in qs and a28 <= r["date"] <= lf:
            t = (float(r["position"]), int(r["clicks"]), int(r["impressions"]))
            per[r["page"]][0].append(t)
            if r["date"] >= a7:
                per[r["page"]][1].append(t)
    tot28 = sum(sum(x[2] for x in v[0]) for v in per.values()) or 1
    tot7 = sum(sum(x[2] for x in v[1]) for v in per.values()) or 1
    out = []
    for p, (l28, l7) in per.items():
        p28, c28, i28 = wavg(l28)
        p7, c7, i7 = wavg(l7)
        out.append({"page": p, "tracked": p == tracked_page, "pos": r1(p28), "clicks": c28, "impr": i28,
                    "share": round(i28 / tot28 * 100, 1), "pos7": r1(p7), "impr7": i7, "share7": round(i7 / tot7 * 100, 1)})
    out.sort(key=lambda x: -x["impr"])
    return out[:10]


def splits_for(splits, qs, page):
    out = {}
    for dim, rows in splits.items():
        agg = defaultdict(list)
        for q, p, val, c, i, pos in rows:
            if q in qs and (page == SITE_LEVEL or p == page):
                agg[val].append((pos, c, i))
        lst = []
        for k, v in agg.items():
            pos, c, i = wavg(v)
            lst.append({"key": k, "pos": r1(pos), "clicks": c, "impr": i})
        lst.sort(key=lambda x: -x["impr"])
        out[dim] = lst[:8]
    return out


def alert(sev, typ, g, page, text, d, impact_clicks=None):
    return {"severity": sev, "type": typ, "keyword": g["keyword"] if g else None, "i": g["i"] if g else None,
            "page": page, "text": text, "date": d, "impact": impact_clicks}


def detect(groups, qp_rows, curve, finals):
    """Règles d'alerte évaluées sur chaque jour définitif de l'historique.

    La variation de position est la même partout dans l'outil : position du jour J contre position du jour J-7
    (colonne « 7 j » du tableau, mouvements de la semaine, alertes). Elle ne compte que si chacun des deux jours
    a au moins MIN_IMPR_DAY impressions.
    Alertes = règles vraies au dernier jour définitif. Événements = jours où une règle devient vraie.
    Mouvements = toutes les variations sur 7 jours valides au dernier jour définitif."""
    if not finals:
        return [], [], []
    lf = finals[-1]
    qp_by = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))   # requête -> date -> page -> impressions
    for r in qp_rows:
        qp_by[r["query"]][r["date"]][r["page"]] += int(r["impressions"])
    qp_first = min((r["date"] for r in qp_rows), default=None)
    alerts, events, moves = [], [], []

    def wsum(mp, a, n):  # impressions des n jours qui finissent le jour a
        return sum(mp[dshift(a, -j)][3] for j in range(n) if dshift(a, -j) in mp)

    for g in groups:
        s = {x[0]: x for x in g["s"] if not x[4] and x[1] is not None}
        ss = {x[0]: x for x in g["ss"] if not x[4] and x[1] is not None}
        qs = [g["keyword"]] + g["variants"]
        prev_flags = set()
        for D in finals:
            flags = {}
            c, r = s.get(D), s.get(dshift(D, -7))
            if c and r and c[3] >= MIN_IMPR_DAY and r[3] >= MIN_IMPR_DAY:
                p0, p1 = r[1], c[1]
                d = round(p1 - p0, 1)                      # positif = recul
                if D == lf:
                    moves.append({"i": g["i"], "p0": p0, "p1": p1, "d": -d, "i0": r[3], "i1": c[3]})
                thr = 1 if p0 <= 3 else 2 if p0 <= 10 else 3
                i28 = wsum(ss, D, 28)
                lost = round(i28 * (ctr_at(curve, p0) - ctr_at(curve, p1))) if curve else None
                if p0 <= 10 < p1 and d >= 1:
                    flags["top10"] = ("critique", f"Sort du top 10 : {fr(p0)} → {fr(p1)} en 7 jours", lost)
                elif p0 <= 3 < p1 and d >= 1:
                    flags["top3"] = ("attention", f"Sort du top 3 : {fr(p0)} → {fr(p1)} en 7 jours", lost)
                elif d >= thr:
                    flags["baisse"] = ("attention", f"Perd {fr(d)} place{'s' if d >= 2 else ''} en 7 jours : {fr(p0)} → {fr(p1)}", lost)
                if -d >= thr:
                    flags["hausse"] = ("info", f"Gagne {fr(-d)} place{'s' if -d >= 2 else ''} en 7 jours : {fr(p0)} → {fr(p1)}", -lost if lost else None)
            if g["page"] != SITE_LEVEL and wsum(s, dshift(D, -3), 7) >= 30 and wsum(s, D, 3) == 0:
                flags["disparue"] = ("critique", "La page suivie ne reçoit plus aucune impression sur ce mot-clé depuis 3 jours", None)
            w1, w0 = wsum(s, D, 7), wsum(s, dshift(D, -7), 7)
            if w0 >= 200 and w1 <= 0.7 * w0:
                sw1, sw0 = wsum(ss, D, 7), wsum(ss, dshift(D, -7), 7)
                demand = bool(sw0) and sw1 <= 0.75 * sw0
                flags["impressions"] = ("info" if demand else "attention",
                                        f"Impressions de la page : {w0} → {w1} sur 7 jours ({(w1 - w0) / w0 * 100:+.0f} %)"
                                        + (", la demande baisse aussi" if demand else ", alors que la demande sur le mot-clé tient"), None)
            if g["page"] != SITE_LEVEL and qp_first and dshift(D, -6) >= qp_first:
                per = defaultdict(int)
                for q in qs:
                    for j in range(7):
                        for pg, n in qp_by[q].get(dshift(D, -j), {}).items():
                            per[pg] += n
                if per:
                    lead = max(per, key=per.get)
                    if lead != g["page"] and per[lead] > per.get(g["page"], 0) and per[lead] >= 50:
                        flags["page"] = ("attention", f"Une autre page est en tête sur 7 jours : {lead} ({per[lead]} impressions contre {per.get(g['page'], 0)})", None)
            for t, (sev, text, imp) in flags.items():
                if t not in prev_flags:
                    events.append({"date": D, "severity": sev, "type": t, "keyword": g["keyword"], "i": g["i"], "page": g["page"], "text": text, "impact": imp})
            prev_flags = set(flags)
            if D == lf:
                for t, (sev, text, imp) in flags.items():
                    if sev != "info":
                        alerts.append(alert(sev, t, g, g["page"], text, D, imp))
    return alerts, events, moves


def impact(actions, groups, finals):
    out = []
    if not finals:
        return out
    lf = finals[-1]
    touched = defaultdict(list)
    for a in actions:
        if a.get("date") and a.get("page"):
            touched[norm_url(a["page"])].append(str(a["date"]))
    for n, a in enumerate(sorted(actions, key=lambda a: str(a.get("date")), reverse=True)):
        D = str(a.get("date"))
        res = {**{k: (str(v) if isinstance(v, date) else v) for k, v in a.items()}, "id": n}
        aff = [g for g in groups if a.get("page") and norm_url(g["page"]) == norm_url(a["page"])]
        res["keywords"] = [g["i"] for g in aff]
        days_after = (date.fromisoformat(lf) - date.fromisoformat(D)).days if D <= lf else -1
        res["days_after"] = days_after
        if not aff:
            res["impact"] = None
            res["reason"] = "Aucun mot-clé suivi sur cette page"
        elif D < dshift(finals[0], 28):
            res["impact"] = None
            res["reason"] = f"Date trop proche du début des données ({finals[0]}) : il faut 28 jours d'historique avant l'action pour la mesurer"
        elif days_after < 7:
            res["impact"] = None
            res["reason"] = f"Pas assez de recul ({max(days_after, 0)} jour{'s' if days_after > 1 else ''} de données définitives après l'action, 7 minimum)"
        else:
            n_after = min(days_after, 28)
            b0, b1, a0, a1 = dshift(D, -28), dshift(D, -1), dshift(D, 1), dshift(D, n_after)

            def agg(gs, x, y):
                rows = [(p[1], p[2], p[3]) for g in gs for p in g["s"] if x <= p[0] <= y and p[1] is not None and not p[4]]
                return wavg(rows)
            pb, cb, ib = agg(aff, b0, b1)
            pa, ca, ia = agg(aff, a0, a1)
            ctrl = [g for g in groups if g not in aff and not any(abs((date.fromisoformat(d) - date.fromisoformat(D)).days) <= 28
                                                                  for d in touched.get(norm_url(g["page"]), []))]
            _, ccb, _ = agg(ctrl, b0, b1)
            _, cca, _ = agg(ctrl, a0, a1)
            per_b, per_a = cb / 28, ca / n_after
            ctrl_ratio = (cca / n_after) / (ccb / 28) if ccb else None
            adj = per_a - per_b * ctrl_ratio if ctrl_ratio else None
            res["impact"] = {"window_after": n_after, "pos_before": r1(pb), "pos_after": r1(pa),
                             "clicks_day_before": round(per_b, 1), "clicks_day_after": round(per_a, 1),
                             "impr_day_before": round(ib / 28, 1), "impr_day_after": round(ia / n_after, 1),
                             "control_ratio": round(ctrl_ratio, 3) if ctrl_ratio else None, "control_size": len(ctrl),
                             "clicks_month_adjusted": round(adj * 28) if adj is not None else None}
        out.append(res)
    return out


def suggestions(queries, tracked, curve):
    out = []
    for q, c, i, p, best, prev in queries:
        if q in tracked or not p:
            continue
        flags = []
        if 4 <= p <= 20 and i >= 100:
            flags.append("striking")
        if i >= 50 and prev <= i * 0.1:
            flags.append("nouvelle")
        target = 1 if p <= 3 else 3
        pot = round(i * max(0, ctr_at(curve, target) - ctr_at(curve, p))) if curve else None
        out.append({"query": q, "clicks": c, "impr": i, "pos": p, "page": best, "prev_impr": prev, "flags": flags, "potential": pot})
    by_clicks = sorted(out, key=lambda x: -x["clicks"])[:40]
    for x in by_clicks:
        x["flags"].insert(0, "top")
    keep = {x["query"]: x for x in by_clicks}
    for x in sorted(out, key=lambda x: -(x["potential"] or 0))[:60]:
        keep.setdefault(x["query"], x)
    for x in out:
        if "nouvelle" in x["flags"] or "striking" in x["flags"]:
            keep.setdefault(x["query"], x)
    return sorted(keep.values(), key=lambda x: -(x["potential"] or 0))[:200]


def summary(p):
    """Résumé d'un projet pour le portefeuille (marché par défaut). Positions données au dernier jour et au dernier jour définitif."""
    lf, last = p["last_final"], p["last_date"]
    out = {k: p[k] for k in ("name", "label", "property", "owner", "health", "last_date", "last_final", "status", "market", "market_label")}
    out["n_keywords"] = len(p["keywords"])
    out["kw"] = [[g["i"], g["keyword"]] for g in p["keywords"]]   # recherche rapide du dashboard
    out["alerts"] = {s: sum(a["severity"] == s for a in p["alerts"]) for s in ("critique", "attention")}
    if lf:
        nb = p["segments"]["nonbrand"]
        win = lambda a, b: sum(x[2] for x in nb if a <= x[0] <= b)
        cur, prev = win(dshift(lf, -27), lf), win(dshift(lf, -55), dshift(lf, -28))
        n1 = win(dshift(lf, -27 - 364), dshift(lf, -364))
        out["nonbrand_clicks"] = cur
        out["nonbrand_vs_prev"] = round((cur - prev) / prev * 100, 1) if prev else None
        out["nonbrand_vs_n1"] = round((cur - n1) / n1 * 100, 1) if n1 else None
        maps = [{x[0]: x for x in g["s"]} for g in p["keywords"]]
        for tag, D in (("final", lf), ("last", last)):
            now = [x[1] for x in (pos_at(mp, D) for mp in maps) if x]
            before = [x[1] for x in (pos_at(mp, dshift(D, -28)) for mp in maps) if x]
            out[f"pos_{tag}"] = r1(sum(now) / len(now)) if now else None
            out[f"pos_{tag}_prev"] = r1(sum(before) / len(before)) if before else None
            out[f"top10_{tag}"] = sum(1 for v in now if v <= 10)
    return out



# ---------------------------------------------------------------- vérification d'indexation à la demande

def inspect(site_name, pages_file=None):
    """Formulaire « Vérifier l'indexation » ou ligne de commande. Le dashboard est recalculé ensuite par le workflow."""
    s = next(x for x in load_sites() if x["name"] == site_name)
    tracked = tracked_pages(s)
    want = [l.strip() for l in Path(pages_file).read_text(encoding="utf-8").splitlines() if l.strip()] if pages_file else []
    pages = [u for u in tracked if not want or norm_url(u) in {norm_url(w) for w in want}]
    extra = [w for w in want if norm_url(w) not in {norm_url(u) for u in tracked}]
    if extra:
        print("  pages non suivies ignorées : " + ", ".join(extra))
    store = bq.state_get([site_name]).get((site_name, "inspection"))
    new = inspect_pages(s, pages, store, tracked=tracked) if pages else None
    done = [(u, c) for u, c in (new or {}).pop("_done", [])] if new else []
    if new is not None:
        bq.state_put({(site_name, "inspection"): new})
    ok = [u for u, c in done if c.get("verdict") == "PASS"]
    ko = [f"{path_of(u)} ({c.get('coverageState') or c.get('verdict')})" for u, c in done if c.get("verdict") != "PASS"]
    msg = f"{len(done)} page{'s' if len(done) > 1 else ''} vérifiée{'s' if len(done) > 1 else ''} : {len(ok)} indexée{'s' if len(ok) > 1 else ''}"
    msg += f", {len(ko)} avec un problème : {', '.join(ko)}." if ko else "."
    if extra:
        msg += f" Ignorées car non suivies : {', '.join(extra)}."
    print(f"RESULT={msg} Le dashboard est mis à jour dans 1 à 2 minutes.")


# ---------------------------------------------------------------- nouveau projet : mots-clés de départ

def seed(site_name, n):
    s = next(x for x in load_sites() if x["name"] == site_name)
    path = CONF / "keywords" / f"{site_name}.yaml"
    if s["keywords"]:
        print("Le projet a déjà des mots-clés, rien à faire.")
        return
    end = today_utc() - timedelta(days=FINAL_AFTER_DAYS)
    rows = gsc.query(s["account"], s["property"], end - timedelta(days=27), end, ["query", "page"],
                     [gsc.f("query", "excludingRegex", brand_rx(s))], max_rows=25000)
    agg = {}
    for r in rows:
        q, p = r["keys"]
        a = agg.setdefault(q, {"clicks": 0, "best": None, "bi": -1})
        a["clicks"] += r["clicks"]
        if r["impressions"] > a["bi"]:
            a["best"], a["bi"] = p, r["impressions"]
    top = sorted(agg.items(), key=lambda kv: -kv[1]["clicks"])[:n]
    lines = [f"# Mots-clés suivis pour {s.get('label', site_name)}, pré-remplis avec les {n} premières requêtes hors marque par clics (28 jours).",
             "# Champs : keyword, page, variants, tags, status (à travailler, en cours, acquis), target, note (voir le README).", "", "keywords:"]
    for q, a in top:
        lines += [f"  - keyword: {json.dumps(q, ensure_ascii=False)}", f"    page: {a['best']}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(top)} mots-clés écrits dans {path.relative_to(ROOT)}")


# ---------------------------------------------------------------- digest Slack

def notify():
    hook = gsc.secrets().get("SLACK_WEBHOOK_URL")
    if not hook:
        print("SLACK_WEBHOOK_URL absent, pas de digest.")
        return
    sent = set(bq.state_get([""]).get(("", "alerts_sent")) or [])
    base = gsc.secrets().get("DASHBOARD_URL", "https://darkix19988.github.io/suivi-positions-gsc/")
    idx = read_json(OUT / "index.json", {"projects": []})
    lines, now_ids = [], set()
    for sp in idx["projects"]:
        p = read_json(OUT / f"{sp['name']}{suffix(sp.get('market') or ALL)}.json", {})
        new = []
        for a in p.get("alerts", []):
            aid = f"{sp['name']}|{a['type']}|{a.get('keyword')}|{a.get('page')}"
            now_ids.add(aid)
            if aid not in sent:
                new.append(a)
        if new:
            lines.append(f"*{sp['label']}* ({sp.get('market_label') or 'Tous pays'}) <{base}#/{sp['name']}/a-traiter|voir ce qui est à traiter>")
            lines += [f"• [{a['severity']}] {a.get('keyword') or a.get('page') or ''} : {a['text']}" for a in new[:10]]
    if today_utc().weekday() == 0:
        lines.append("\n*Récap de la semaine*")
        for sp in idx["projects"]:
            lines.append(f"• {sp['label']} : {sp.get('nonbrand_clicks', '-')} clics hors marque sur 28 j "
                         f"({sp.get('nonbrand_vs_prev') or 0:+} % vs 28 j précédents), position moyenne {sp.get('pos_final')}, "
                         f"{sp['alerts']['critique']} urgente(s), {sp['alerts']['attention']} à surveiller")
    if lines:
        requests.post(hook, json={"text": "\n".join(lines)}, timeout=30).raise_for_status()
        print(f"Digest envoyé ({len(lines)} lignes).")
    bq.state_put({("", "alerts_sent"): sorted(now_ids)})


# ---------------------------------------------------------------- projets touchés par un commit (déclencheur push)

def changed(before):
    """Projets dont la configuration a changé depuis le commit `before` : nouveau projet ou projet modifié dans sites.yaml,
    fichier de mots-clés modifié. Les actions et les projets supprimés ne demandent pas de collecte."""
    def show(path):
        r = subprocess.run(["git", "show", f"{before}:{path}"], cwd=ROOT, capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else None
    old_sites = {s["name"]: s for s in ((yaml.safe_load(show("config/sites.yaml") or "") or {}).get("sites") or [])}
    names = set()
    for s in load_yaml(CONF / "sites.yaml", {}).get("sites", []):
        o = old_sites.get(s["name"])
        if o != s:
            names.add(s["name"])
        kw = CONF / "keywords" / f"{s['name']}.yaml"
        if kw.exists() and show(f"config/keywords/{s['name']}.yaml") != kw.read_text(encoding="utf-8"):
            names.add(s["name"])
    print(",".join(sorted(names)))


# ---------------------------------------------------------------- reprise de l'ancien état (data/), une fois

def migrate():
    data = ROOT / "data"
    bq.ensure_schema()
    upd = {}
    if (data / "google_updates.json").exists():
        upd[("", "google_updates")] = read_json(data / "google_updates.json", [])
    if (data / "alerts_sent.json").exists():
        upd[("", "alerts_sent")] = read_json(data / "alerts_sent.json", [])
    for s in load_sites():
        d = data / s["name"]
        if (d / "inspection.json").exists():
            upd[(s["name"], "inspection")] = read_json(d / "inspection.json", {})
        for m in markets(s):
            meta = read_json(d / f"sections{suffix(m['code'])}.json", None)
            if meta and meta.get("groupings"):
                upd[(s["name"], f"sections|{m['code']}")] = {"groupings": meta["groupings"], "main_host": meta.get("main_host"),
                                                              "market_path": meta.get("market_path"), "languages": meta.get("languages")}
        st = read_json(data / "status.json", {}).get(s["name"])
        if st:
            upd[(s["name"], "status")] = st
    bq.state_put(upd)
    print(f"État repris dans BigQuery : {len(upd)} clés")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sa = sub.add_parser("sync")
    sa.add_argument("--days", type=int, default=10)
    sa.add_argument("--site", help="un ou plusieurs projets séparés par des virgules")
    sa.add_argument("--skip-if-fresh", type=float, help="ne rien faire si une synchro a réussi il y a moins de N heures")
    sub.add_parser("build")
    ia = sub.add_parser("inspect")
    ia.add_argument("site")
    ia.add_argument("--pages-file")
    se = sub.add_parser("seed")
    se.add_argument("site")
    se.add_argument("--n", type=int, default=20)
    sub.add_parser("notify")
    ch = sub.add_parser("changed")
    ch.add_argument("before")
    sub.add_parser("migrate")
    a = ap.parse_args()
    if a.cmd == "sync":
        done = sync(a.days, set(x for x in (a.site or "").split(",") if x) or None, a.skip_if_fresh)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
                fh.write(f"done={'1' if done else '0'}\n")
    elif a.cmd == "build":
        build()
    elif a.cmd == "inspect":
        inspect(a.site, a.pages_file)
    elif a.cmd == "seed":
        seed(a.site, a.n)
    elif a.cmd == "notify":
        notify()
    elif a.cmd == "changed":
        changed(a.before)
    else:
        migrate()

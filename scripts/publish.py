"""Prépare le site statique à publier dans dist/ : front (docs/) + données calculées (docs/data/).

- Versionne les fichiers du front par leur contenu (`app.js?v=<empreinte>`) : plus d'incrément manuel de `?v=`, et un
  navigateur ne retélécharge un fichier que s'il a changé.
- Ajoute les règles de cache pour les hébergeurs qui les lisent : `_headers` (Cloudflare Pages, Netlify) et `vercel.json`.
  manifest.json n'est jamais mis en cache ; les autres fichiers de données sont appelés avec la version du manifest.
- dist/ se publie tel quel sur GitHub Pages, Cloudflare Pages (`wrangler pages deploy dist`) ou Vercel
  (`vercel deploy dist --prod`) : aucun fichier ne dépend de l'hébergeur.
"""

import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, DIST = ROOT / "docs", ROOT / "dist"

HEADERS = """/manifest.json
  Cache-Control: no-cache
/data/manifest.json
  Cache-Control: no-cache
/data/*
  Cache-Control: public, max-age=31536000, immutable
/*.js
  Cache-Control: public, max-age=31536000, immutable
/*.css
  Cache-Control: public, max-age=31536000, immutable
/index.html
  Cache-Control: no-cache
/*
  X-Robots-Tag: noindex, nofollow
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
"""


def main():
    if not (SRC / "data" / "index.json").exists():
        raise SystemExit("docs/data/index.json absent : lancer `tracker.py build` avant la publication")
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SRC, DIST)
    html = (DIST / "index.html").read_text(encoding="utf-8")
    for f in ("app.js", "app.css", "config.js"):
        h = hashlib.sha1((DIST / f).read_bytes()).hexdigest()[:10]
        html, n = re.subn(rf'{re.escape(f)}\?v=[^"\']*', f"{f}?v={h}", html)
        if not n:
            raise SystemExit(f"{f} n'est pas référencé dans index.html")
    (DIST / "index.html").write_text(html, encoding="utf-8")
    (DIST / "_headers").write_text(HEADERS, encoding="utf-8")
    rules = [{"source": "/data/manifest.json", "headers": [{"key": "Cache-Control", "value": "no-cache"}]},
             {"source": "/data/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]},
             {"source": "/(.*)\\.(js|css)", "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]},
             {"source": "/(.*)", "headers": [{"key": "X-Robots-Tag", "value": "noindex, nofollow"}]}]
    (DIST / "vercel.json").write_text(json.dumps({"headers": rules}, indent=1), encoding="utf-8")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    size = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"dist/ prêt : {sum(1 for p in DIST.rglob('*') if p.is_file())} fichiers, {size / 1e6:.1f} Mo")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""GitHub Explorer - data pipeline + single-file build.

Project layout
    src/index.template.html   page skeleton
    src/tokens.css            design tokens (website-ui-designer)
    src/app.css               styles
    src/app.js                client logic
    src/favicon.svg           brand mark
    build_github_explorer.py  this file: fetch GitHub data, inject, emit
    site/                     generated standalone tool site (publishable)
                              incl. catalogue.html (crawlable static index)
                              and sitemap.xml (when SITE_URL is configured)
    github-explorer.html      generated self-contained single file
    repos_cache.json          local data cache
    tests/                    smoke + contrast checks

Four catalogue lenses (no view-level Top-N truncation any more):
    total    cumulative stars, 11 topic-based categories, up to TOP_N each
    rising   star gains over daily/weekly/monthly windows, ALL merged rows
             (16 GitHub Trending pages, deduplicated)
    new      recently created repos ranked by stars/day, up to TOP_N each
    tags     tag cloud + live GitHub API discovery (client side)

The client renders every collected row progressively; "all" means all rows in
this snapshot, not all of GitHub (Search API caps a query at 1000 results).

Usage
    python build_github_explorer.py             # reuse cache when fresh
    python build_github_explorer.py --force    # re-pull everything
    python build_github_explorer.py --force --ci   # strict: fail instead of
                                    publishing a partial/empty snapshot

Env
    WB_PROXY        optional proxy URL; empty (default) or "-" = direct
    GITHUB_TOKEN    optional PAT, supplied via CI secrets. Never written to HTML.
    CI              set by GitHub Actions; enables strict validation
    SITE_URL        optional public origin, e.g. https://example.com (no slash).
                    Enables canonical URLs, og:url and sitemap.xml. Leave unset
                    for local builds / share links so no wrong canonical leaks.
"""
import html as html_lib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
SITE = os.path.join(HERE, "site")
OUT_HTML = os.path.join(HERE, "github-explorer.html")
CACHE = os.path.join(HERE, "repos_cache.json")
CACHE_VERSION = 5
BASE_TTL = 7 * 86400
DYN_TTL = 3 * 3600
TOP_N = 200
SEARCH_PAGE = 100
FORCE = "--force" in sys.argv
CI = ("--ci" in sys.argv) or bool(os.environ.get("CI"))
PROXY = os.environ.get("WB_PROXY", "").strip()
SITE_URL = os.environ.get("SITE_URL", "").strip().rstrip("/")
CURL = shutil.which("curl") or r"C:\Windows\System32\curl.exe"
SEO_TITLE = "Starscope · GitHub 项目雷达"
SEO_DESC = ("按分类与标签浏览 GitHub 项目，已收录项目按星标与增量从高到低完整列出，"
            "顺着标签发现目录之外的工具。")

CATS = [
    {"id": "all",        "name": "全部项目 · 总榜",   "q": "stars:>70000 archived:false"},
    {"id": "ai",         "name": "AI 与大模型",       "q": "topic:llm stars:>1500 archived:false"},
    {"id": "agent",      "name": "AI Agent",          "q": "topic:ai-agent stars:>300 archived:false"},
    {"id": "selfhost",   "name": "自部署 / 自建服务",  "q": "topic:self-hosted stars:>800 archived:false"},
    {"id": "devtools",   "name": "开发者工具 / CLI",   "q": "topic:developer-tools stars:>1500 archived:false"},
    {"id": "frontend",   "name": "前端与 UI",         "q": "topic:frontend stars:>1500 archived:false"},
    {"id": "db",         "name": "数据库与存储",       "q": "topic:database stars:>1500 archived:false"},
    {"id": "devops",     "name": "DevOps / 云原生",    "q": "topic:kubernetes stars:>1000 archived:false"},
    {"id": "security",   "name": "安全与逆向",         "q": "topic:security stars:>1500 archived:false"},
    {"id": "automation", "name": "自动化与效率",       "q": "topic:automation stars:>800 archived:false"},
    {"id": "game",       "name": "游戏与多媒体",       "q": "topic:game-engine stars:>800 archived:false"},
    {"id": "learn",      "name": "学习资源 / Awesome", "q": "awesome in:name stars:>8000 archived:false"},
]

# Keyword rules let trending/new/online rows be filtered by the SAME category
# tree as the cumulative ranking. Shipped to the client for live API rows.
RULES = [
    {"id": "ai",         "k": ["llm", "gpt", "transformer", "diffusion", "machine-learning",
                               "deep-learning", "generative", "neural", "pytorch", "huggingface",
                               "embedding", "inference", "fine-tun", "rag", "ollama", "chatgpt",
                               "text-to-image", "stable-diffusion", "model", "ai "]},
    {"id": "agent",      "k": ["agent", "autonomous", "copilot", "mcp", "tool-use", "browser-use",
                               "workflow-engine", "assistant"]},
    {"id": "selfhost",   "k": ["self-host", "selfhost", "homelab", "docker-compose", "nas ",
                               "自建", "自部署", "private-cloud", "single-binary", "self hosted"]},
    {"id": "devtools",   "k": ["cli", "terminal", "editor", "debugger", "developer-tools", "ide ",
                               "sdk", "toolkit", "linter", "formatter", "shell", "devtool", "plugin"]},
    {"id": "frontend",   "k": ["frontend", "react", "vue", "css", "ui ", "component", "tailwind",
                               "design-system", "browser", "webapp", "svelte", "angular", "chart"]},
    {"id": "db",         "k": ["database", "sql", "postgres", "redis", "sqlite", "orm ", "storage",
                               "data-warehouse", "vector-db", "nosql", "query-engine"]},
    {"id": "devops",     "k": ["kubernetes", "docker", "ci/cd", "deploy", "terraform", "observability",
                               "cloud-native", "devops", "helm", "monitoring", "container", "k8s"]},
    {"id": "security",   "k": ["security", "pentest", "vulnerability", "malware", "reverse",
                               "exploit", "privacy", "scanner", "forensics", "encryption", "ctf"]},
    {"id": "automation", "k": ["automation", "script", "workflow", "n8n", "zapier", "scraper",
                               "cron", "rpa", "bot", "no-code", "low-code"]},
    {"id": "game",       "k": ["game", "engine", "unity", "emulator", "renderer", "graphics",
                               "ffmpeg", "video", "audio", "media", "3d", "shader"]},
    {"id": "learn",      "k": ["awesome", "tutorial", "roadmap", "interview", "learning", "course",
                               "cheat-sheet", "examples", "教程", "学习", "handbook", "guide"]},
]

PERIODS = [
    {"id": "daily",   "name": "今日涨势", "label": "今日"},
    {"id": "weekly",  "name": "本周涨势", "label": "本周"},
    {"id": "monthly", "name": "本月涨势", "label": "本月"},
]
WINDOWS = [
    {"id": "90d",  "name": "近 90 天新建", "days": 90,  "minStars": 300},
    {"id": "365d", "name": "近 1 年新建",  "days": 365, "minStars": 1000},
]
# Overall Trending only exposes ~25 rows. Merge language pages to reach top 50.
TRENDING_PATHS = ["", "python", "javascript", "typescript", "rust", "go", "java", "c++",
                  "shell", "swift", "kotlin", "dart", "jupyter-notebook", "vue", "html", "php"]


def get_token():
    """CI supplies the PAT as a secret. Never auto-harvest a local login."""
    return (os.environ.get("GITHUB_TOKEN") or "").strip()


TOKEN = get_token()
PAUSE = 2.3 if TOKEN else 7.0


def curl_get(url, accept=None, post_json=None):
    cmd = [CURL, "-sS", "--max-time", "35", "-H", "User-Agent: workbuddy-explorer"]
    if PROXY and PROXY != "-":
        cmd += ["-x", PROXY]
    if TOKEN:
        cmd += ["-H", "Authorization: Bearer " + TOKEN]
    if accept:
        cmd += ["-H", "Accept: " + accept]
    if post_json is not None:
        cmd += ["-X", "POST", "-H", "Content-Type: application/json",
                "-d", json.dumps({"query": post_json}, ensure_ascii=False)]
    cmd.append(url)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=45)
        return proc.stdout or ""
    except Exception as exc:
        print("    curl error: %s" % exc, flush=True)
        return ""


def fetch_search(q, want=TOP_N, sort="stars"):
    """Paginate Search API: 100 per page, 1000 results per query (official cap)."""
    out, seen = [], set()
    pages = max(1, min(10, (want + SEARCH_PAGE - 1) // SEARCH_PAGE))
    for page in range(1, pages + 1):
        url = ("https://api.github.com/search/repositories?q=" + quote(q, safe="")
               + "&sort=" + sort + "&order=desc&per_page=" + str(SEARCH_PAGE)
               + "&page=" + str(page))
        items = []
        for attempt in range(1, 5):
            try:
                data = json.loads(curl_get(url, "application/vnd.github+json"))
            except Exception as exc:
                print("    parse error: %s" % exc, flush=True)
                data = {}
            if isinstance(data, dict) and "items" in data:
                items = data["items"]
                break
            msg = data.get("message", "bad response") if isinstance(data, dict) else "bad response"
            print("    attempt %d (page %d): %s -> waiting" % (
                attempt, page, str(msg)[:90]), flush=True)
            time.sleep(20 if TOKEN else 35)
        fresh = 0
        for it in items:
            name = it.get("full_name")
            if name and name not in seen:
                seen.add(name)
                out.append(it)
                fresh += 1
        if len(items) < SEARCH_PAGE or len(out) >= want or not fresh:
            break
        if page < pages:
            time.sleep(1.2 if TOKEN else 7.0)
    return out[:want]


def clean(text):
    text = html_lib.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"\s+", " ", text).strip()


def to_int(text):
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else 0


def parse_trending_page(page, period):
    rows = []
    for block in re.findall(r'<article class="Box-row">(.*?)</article>', page, re.S):
        m = re.search(r'<h2[^>]*>.*?<a[^>]*href="/([^"?]+)"', block, re.S)
        if not m:
            continue
        flat = clean(block)
        gain_m = re.search(r"([\d,]+)\s+stars?\s+(?:today|this week|this month)", flat)
        if not gain_m:
            continue
        name = m.group(1).strip().strip("/")
        desc = re.search(r'<p[^>]*class="[^"]*col-9[^"]*"[^>]*>(.*?)</p>', block, re.S)
        lang = re.search(r'itemprop="programmingLanguage">\s*([^<]+)', block)
        st = re.search(r'href="/[^"]+/stargazers"[^>]*>(.*?)</a>', block, re.S)
        fk = re.search(r'href="/[^"]+/forks"[^>]*>(.*?)</a>', block, re.S)
        total = to_int(clean(st.group(1))) if st else 0
        gain = to_int(gain_m.group(1))
        rows.append({
            "n": name,
            "d": clean(desc.group(1))[:240] if desc else "",
            "s": total,
            "f": to_int(clean(fk.group(1))) if fk else 0,
            "l": lang.group(1).strip() if lang else "",
            "gain": gain,
            "ratio": round(gain / total * 100, 1) if total else 0,
            "u": "https://github.com/" + name,
            "t": [], "p": "", "c": "", "lic": "", "i": 0, "cats": [],
        })
    return rows


def graphql_enrich(names):
    """Batch-fetch topics + metadata for trending repos (25 aliases per call)."""
    out = {}
    if not TOKEN:
        print("  (no token: skipping topic enrichment)", flush=True)
        return out
    for start in range(0, len(names), 25):
        chunk = names[start:start + 25]
        parts = []
        for i, full in enumerate(chunk):
            if "/" not in full:
                continue
            owner, repo = full.split("/", 1)
            parts.append(
                'r%d: repository(owner:"%s",name:"%s"){ nameWithOwner description '
                'stargazerCount forkCount primaryLanguage{name} licenseInfo{spdxId} '
                'repositoryTopics(first:8){nodes{topic{name}}} pushedAt createdAt }'
                % (i, owner.replace('"', ''), repo.replace('"', ''))
            )
        if not parts:
            continue
        raw = curl_get("https://api.github.com/graphql", "application/json",
                       post_json="query { " + " ".join(parts) + " }")
        try:
            data = json.loads(raw).get("data") or {}
        except Exception:
            data = {}
        for value in data.values():
            if not value:
                continue
            topics = [n["topic"]["name"] for n in
                      (value.get("repositoryTopics") or {}).get("nodes", []) if n.get("topic")]
            lang = (value.get("primaryLanguage") or {}).get("name") or ""
            lic = (value.get("licenseInfo") or {}).get("spdxId") or ""
            out[value["nameWithOwner"].lower()] = {
                "d": (value.get("description") or "")[:240], "t": topics[:8],
                "l": lang, "lic": lic,
                "p": (value.get("pushedAt") or "")[:10], "c": (value.get("createdAt") or "")[:10],
                "s": value.get("stargazerCount") or 0, "f": value.get("forkCount") or 0,
            }
        print("    enriched %d/%d" % (min(start + 25, len(names)), len(names)), flush=True)
        time.sleep(0.4)
    return out


def classify(rec):
    hay = ((rec.get("n") or "") + " " + (rec.get("d") or "") + " "
           + " ".join(rec.get("t") or [])).lower()
    return [r["id"] for r in RULES if any(k in hay for k in r["k"])]


def normalize(item):
    return {
        "n": item.get("full_name") or "",
        "d": (item.get("description") or "")[:240],
        "s": item.get("stargazers_count") or 0,
        "f": item.get("forks_count") or 0,
        "l": item.get("language") or "",
        "t": (item.get("topics") or [])[:8],
        "p": (item.get("pushed_at") or "")[:10],
        "c": (item.get("created_at") or "")[:10],
        "lic": ((item.get("license") or {}).get("spdx_id") or ""),
        "i": item.get("open_issues_count") or 0,
        "u": item.get("html_url") or ("https://github.com/" + (item.get("full_name") or "")),
        "cats": [],
    }


def age_days(created):
    try:
        d = datetime.strptime(created, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        return max(1, (datetime.now(timezone.utc) - d).days)
    except Exception:
        return 0


def build_base():
    repos = {}
    for idx, cat in enumerate(CATS):
        print("  [%d/%d] %s" % (idx + 1, len(CATS), cat["name"]), flush=True)
        items = fetch_search(cat["q"], want=TOP_N)
        print("      %d repos" % len(items), flush=True)
        for it in items:
            name = it.get("full_name") or ""
            if not name:
                continue
            rec = repos.get(name)
            if rec is None:
                rec = normalize(it)
                repos[name] = rec
            if cat["id"] != "all" and cat["id"] not in rec["cats"]:
                rec["cats"].append(cat["id"])
        if idx < len(CATS) - 1:
            time.sleep(PAUSE)
    return sorted(repos.values(), key=lambda r: -r["s"])


def build_newstars():
    result = {}
    now = datetime.now(timezone.utc)
    for win in WINDOWS:
        since = (now - timedelta(days=win["days"])).strftime("%Y-%m-%d")
        q = "created:>%s stars:>%d archived:false" % (since, win["minStars"])
        print("  new stars %s" % win["name"], flush=True)
        rows = []
        for it in fetch_search(q, want=TOP_N):
            rec = normalize(it)
            age = age_days(rec["c"])
            rec["age"] = age
            rec["spd"] = round(rec["s"] / age, 1) if age else 0
            rec["cats"] = classify(rec)
            rows.append(rec)
        result[win["id"]] = sorted(rows, key=lambda r: -r["spd"])
        print("      %d repos" % len(result[win["id"]]), flush=True)
        time.sleep(PAUSE)
    return result


def build_trending(index):
    result = {}
    for period in PERIODS:
        merged = {}
        for path in TRENDING_PATHS:
            url = "https://github.com/trending" + ("/" + path if path else "") + "?since=" + period["id"]
            for rec in parse_trending_page(curl_get(url, "text/html"), period["id"]):
                old = merged.get(rec["n"])
                if old is None or rec["gain"] > old["gain"]:
                    merged[rec["n"]] = rec
            time.sleep(0.2)
        # Trending can expose "0 stars today"; those rows carry no signal.
        rows = sorted((r for r in merged.values() if r["gain"] > 0),
                      key=lambda r: -r["gain"])
        result[period["id"]] = rows
        print("  trending %-8s %3d unique -> keeping all %d with real gain" % (
            period["id"], len(merged), len(rows)), flush=True)

    names = sorted({r["n"] for rows in result.values() for r in rows})
    print("  enriching %d unique trending repos" % len(names), flush=True)
    meta = graphql_enrich(names)
    for rows in result.values():
        for rec in rows:
            extra = meta.get(rec["n"].lower()) or {}
            for key in ("d", "t", "p", "c", "lic", "l"):
                if not rec.get(key) and extra.get(key):
                    rec[key] = extra[key]
            base = index.get(rec["n"])
            if base:
                for key in ("t", "p", "c", "lic", "i", "l"):
                    if not rec.get(key) and base.get(key):
                        rec[key] = base[key]
                if base.get("cats"):
                    rec["cats"] = base["cats"][:]
            if not rec.get("cats"):
                rec["cats"] = classify(rec)
            if not rec["d"]:
                rec["d"] = extra.get("d", "")
    return result


def build_topics(base, trending, newstars):
    counter = Counter()
    seen = set()
    for rec in base:
        seen.add(rec["n"])
    for rec in [r for rows in list(trending.values()) + list(newstars.values()) for r in rows]:
        seen.add(rec["n"])
    for rec in base:
        for t in rec["t"]:
            counter[str(t).lower()] += 1
    for rows in list(trending.values()) + list(newstars.values()):
        for rec in rows:
            for t in rec["t"]:
                counter[str(t).lower()] += 1
    return [{"t": t, "n": n} for t, n in counter.most_common(160) if n >= 2]


def validate_data(base, trending, newstars):
    """Refuse to publish a partial/empty snapshot over a healthy live site."""
    problems = []
    if len(base) < 300:
        problems.append("cumulative catalogue has only %d rows (<300)" % len(base))
    for p in PERIODS:
        n = len(trending.get(p["id"], []))
        if n < 30:
            problems.append("trending %s has only %d rows (<30)" % (p["id"], n))
    for w in WINDOWS:
        n = len(newstars.get(w["id"], []))
        if n < 30:
            problems.append("new %s has only %d rows (<30)" % (w["id"], n))
    if base and not all(r.get("n") and isinstance(r.get("s"), int) for r in base[:50]):
        problems.append("malformed repository records")
    return problems


def load_cache():
    try:
        with open(CACHE, encoding="utf-8") as fh:
            c = json.load(fh)
        if c.get("v") == CACHE_VERSION and c.get("base"):
            return c
    except Exception:
        pass
    return {"v": CACHE_VERSION, "base_ts": 0, "dyn_ts": 0, "base": [], "trending": {}, "newstars": {}}


def main():
    print("proxy: %s | token: %s | curl: %s | ci: %s" % (
        PROXY or "direct", "yes" if TOKEN else "no", CURL, CI), flush=True)
    for f in ("index.template.html", "tokens.css", "app.css", "app.js", "favicon.svg"):
        if not os.path.exists(os.path.join(SRC, f)):
            raise SystemExit("Missing source file: src/" + f)

    cache = load_cache()
    now_ts = time.time()
    base_fresh = not FORCE and cache.get("base") and now_ts - cache.get("base_ts", 0) < BASE_TTL
    dyn_fresh = not FORCE and cache.get("trending") and now_ts - cache.get("dyn_ts", 0) < DYN_TTL

    if base_fresh:
        base = cache["base"]
        print("Cumulative: reuse cache (%d repos, --force to re-pull)" % len(base), flush=True)
    else:
        print("Cumulative: pulling %d categories x %d" % (len(CATS), TOP_N), flush=True)
        base = build_base()
        cache["base"] = base
        cache["base_ts"] = now_ts
        print("  total %d unique repos" % len(base), flush=True)

    index = {r["n"]: r for r in base}
    if dyn_fresh:
        trending, newstars = cache["trending"], cache["newstars"]
        print("Momentum/new: reuse cache (--force to re-pull)", flush=True)
    else:
        print("Momentum: merging %d Trending pages x %d windows" % (
            len(TRENDING_PATHS), len(PERIODS)), flush=True)
        trending = build_trending(index)
        print("New projects: pulling 2 windows x %d" % TOP_N, flush=True)
        newstars = build_newstars()
        cache["trending"], cache["newstars"], cache["dyn_ts"] = trending, newstars, now_ts
    problems = validate_data(base, trending, newstars)
    if problems:
        print("\nSNAPSHOT VALIDATION FAILED:", flush=True)
        for problem in problems:
            print("  - " + problem, flush=True)
        has_live = (os.path.exists(os.path.join(SITE, "data", "snapshot.js"))
                    and os.path.exists(OUT_HTML))
        if has_live:
            print("  Keeping the previous published snapshot; nothing overwritten.", flush=True)
            sys.exit(2 if CI else 0)
        print("  No previous snapshot exists; building this one anyway.", flush=True)

    cache["v"] = CACHE_VERSION
    with open(CACHE, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(cache, fh, ensure_ascii=False)

    topics = build_topics(base, trending, newstars)
    all_names = {r["n"] for r in base}
    for rows in list(trending.values()) + list(newstars.values()):
        all_names.update(r["n"] for r in rows)
    now = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    payload = {
        "generated": now,
        "cats": [{"id": c["id"], "name": c["name"], "q": c["q"]} for c in CATS],
        "rules": RULES,
        "periods": PERIODS,
        "windows": [{"id": w["id"], "name": w["name"]} for w in WINDOWS],
        "repos": base,
        "trending": trending,
        "newstars": newstars,
        "topics": topics,
        "coverage": {
            "perCategory": TOP_N,
            "searchCap": 1000,
            "unique": len(all_names),
            "rising": {p["id"]: len(trending.get(p["id"], [])) for p in PERIODS},
            "newstars": {w["id"]: len(newstars.get(w["id"], [])) for w in WINDOWS},
        },
    }
    data_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")

    def read_src(name):
        with open(os.path.join(SRC, name), encoding="utf-8") as fh:
            return fh.read()

    tpl = read_src("index.template.html")
    tokens = read_src("tokens.css")
    css = tokens + "\n\n" + read_src("app.css")
    js = read_src("app.js")
    favicon = read_src("favicon.svg")
    fav_data = "data:image/svg+xml," + quote(favicon, safe="")

    def esc(value):
        return html_lib.escape(str(value if value is not None else ""), quote=True)

    def seo_meta(include_canonical):
        """Social/search metadata. A canonical URL is emitted only for a real public origin."""
        lines = [
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="Starscope">',
            '<meta property="og:locale" content="zh_CN">',
            '<meta property="og:title" content="%s">' % esc(SEO_TITLE),
            '<meta property="og:description" content="%s">' % esc(SEO_DESC),
            '<meta name="twitter:card" content="summary">',
            '<meta name="twitter:title" content="%s">' % esc(SEO_TITLE),
            '<meta name="twitter:description" content="%s">' % esc(SEO_DESC),
        ]
        if SITE_URL and include_canonical:
            lines += [
                '<link rel="canonical" href="%s/">' % esc(SITE_URL),
                '<meta property="og:url" content="%s/">' % esc(SITE_URL),
            ]
        ld = {"@context": "https://schema.org", "@type": "WebSite",
              "name": "Starscope", "description": SEO_DESC, "inLanguage": "zh-CN"}
        if SITE_URL:
            ld["url"] = SITE_URL + "/"
        lines.append('<script type="application/ld+json">'
                     + json.dumps(ld, ensure_ascii=False).replace("<", "\\u003c")
                     + "</script>")
        return "\n".join(lines)

    def build_catalogue(rows, cats, generated):
        """A crawlable, JS-free page: real project names live in the HTML itself.

        The main app renders its list client-side, which leaves crawlers with an
        empty container. This page gives them (and no-JS users) real content and
        links back into the deep-linked tool.
        """
        top = sorted(rows, key=lambda r: -(r.get("s") or 0))[:100]
        body_rows = "\n".join(
            '<tr><td class="num">%d</td>'
            '<td><a href="%s" rel="noopener noreferrer">%s</a></td>'
            '<td class="num">%s</td><td>%s</td><td class="desc">%s</td></tr>'
            % (i, esc(r.get("u") or "https://github.com/" + r["n"]),
               esc(r["n"]), format(r.get("s") or 0, ","),
               esc(r.get("l") or "—"), esc((r.get("d") or "")[:150]))
            for i, r in enumerate(top, 1)
        )
        cat_links = "\n".join(
            '<li><a href="index.html?view=total&amp;cat=%s">%s</a></li>'
            % (esc(c["id"]), esc(c["name"])) for c in cats
        )
        canonical = ('<link rel="canonical" href="%s/catalogue.html">' % esc(SITE_URL)) if SITE_URL else ""
        page = """<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GitHub 项目目录 · Starscope 静态索引</title>
<meta name="description" content="__DESC__">
<meta name="robots" content="index,follow">
__CANONICAL__
<link rel="stylesheet" href="assets/app.css">
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<style>
  body { font-family: var(--font-body); background: var(--bg); color: var(--text); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: var(--space-10) var(--space-5) var(--space-20); }
  .topbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: var(--space-4); margin-bottom: var(--space-8); }
  .brand { font-weight: 700; font-size: 1.05rem; letter-spacing: -0.02em; }
  h1 { font-size: clamp(1.6rem, 3.5vw, 2.3rem); line-height: 1.2; margin: 0 0 var(--space-3); }
  h2 { font-size: 1.15rem; margin: var(--space-10) 0 var(--space-3); }
  p { color: var(--text-muted); line-height: 1.7; }
  a { color: var(--accent); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .meta { font-size: .9rem; }
  .cats { columns: 2; padding-left: var(--space-5); line-height: 1.9; }
  table { width: 100%; border-collapse: collapse; font-size: .92rem; }
  th, td { text-align: left; padding: var(--space-3) var(--space-2); border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--text-muted); font-weight: 600; font-size: .82rem; }
  .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; width: 1%; }
  .desc { color: var(--text-muted); }
  .foot { margin-top: var(--space-12); padding-top: var(--space-6); border-top: 1px solid var(--border); font-size: .88rem; }
  @media (max-width: 600px) { .cats { columns: 1; } .desc { display: none; } }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
</head>
<body>
<main class="wrap">
  <div class="topbar"><span class="brand">Starscope</span><a href="index.html">← 打开完整项目浏览器</a></div>
  <h1>GitHub 项目目录 · 静态索引</h1>
  <p>这一页不依赖 JavaScript，直接列出本快照中累计星标最高的 100 个项目。完整目录共收录 <strong>__TOTAL__</strong> 个项目，支持按分类、语言、星标、更新时间筛选，以及涨势、新星与标签探索视角，请<a href="index.html">回到主站</a>使用。</p>
  <p class="meta">数据快照：__TIME__（北京时间） · 星标数据以 GitHub 实时页面为准</p>

  <h2>按分类浏览</h2>
  <ul class="cats">__CATS__</ul>

  <h2>累计星标前 100</h2>
  <table>
    <thead><tr><th>#</th><th>项目</th><th>星标</th><th>语言</th><th class="desc">简介</th></tr></thead>
    <tbody>
__ROWS__
    </tbody>
  </table>

  <div class="foot">
    <p><strong>数据来源与边界：</strong>累计与新星数据来自 GitHub Search API，每类最多收录 200 条（官方单次查询上限 1000 条）；涨势数据来自 GitHub Trending 页面解析。「全部」指本快照已收录的全部项目，不是 GitHub 全量仓库。涨得快不等于质量好。</p>
    <p><strong>非官方、非隶属：</strong>Starscope 是独立第三方工具，与 GitHub, Inc. 无隶属、授权或背书关系。GitHub 是 GitHub, Inc. 的商标。详见主站<a href="index.html#legal">数据来源、边界与声明</a>。</p>
  </div>
</main>
</body>
</html>
"""
        return (page.replace("__DESC__", esc(SEO_DESC))
                    .replace("__CANONICAL__", canonical)
                    .replace("__TIME__", esc(generated))
                    .replace("__TOTAL__", str(len(rows)))
                    .replace("__ROWS__", body_rows)
                    .replace("__CATS__", cat_links))

    def fill(style_block, data_block, app_block, icon_block, seo):
        return (tpl.replace("__STYLE_BLOCK__", style_block)
                   .replace("__DATA_BLOCK__", data_block)
                   .replace("__APP_SCRIPT__", app_block)
                   .replace("__FAVICON_BLOCK__", icon_block)
                   .replace("__SEO_BLOCK__", seo)
                   .replace("__TIME__", now))

    # 1) Standalone tool site: linked assets, works over http and file:// alike.
    for sub in ("assets", "data"):
        os.makedirs(os.path.join(SITE, sub), exist_ok=True)
    # Disable Jekyll so GitHub Pages serves assets/data verbatim (no underscore
    # rewriting) and never injects its own default theme.
    with open(os.path.join(SITE, ".nojekyll"), "w", encoding="utf-8") as fh:
        fh.write("")
    site_index = fill(
        '<link rel="stylesheet" href="assets/app.css">',
        '<script src="data/snapshot.js"></script>',
        '<script src="assets/app.js"></script>',
        '<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">',
        seo_meta(True),
    )
    with open(os.path.join(SITE, "index.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(site_index)
    with open(os.path.join(SITE, "catalogue.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(build_catalogue(base, payload["cats"], now))
    robots = "User-agent: *\nAllow: /\n"
    if SITE_URL:
        robots += "Sitemap: %s/sitemap.xml\n" % SITE_URL
        today = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
        urls = [("", "daily", "1.0"), ("/catalogue.html", "daily", "0.8")]
        sitemap = ['<?xml version="1.0" encoding="UTF-8"?>',
                   '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
        for path, freq, prio in urls:
            sitemap += ["  <url>", "    <loc>%s%s</loc>" % (esc(SITE_URL), path),
                        "    <lastmod>%s</lastmod>" % today,
                        "    <changefreq>%s</changefreq>" % freq,
                        "    <priority>%s</priority>" % prio, "  </url>"]
        sitemap.append("</urlset>")
        with open(os.path.join(SITE, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(sitemap) + "\n")
    else:
        # Never leave a stale sitemap pointing at a previously configured origin.
        stale = os.path.join(SITE, "sitemap.xml")
        if os.path.exists(stale):
            os.remove(stale)
    with open(os.path.join(SITE, "robots.txt"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(robots)
    with open(os.path.join(SITE, "assets", "app.css"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(css)
    with open(os.path.join(SITE, "assets", "app.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(js)
    with open(os.path.join(SITE, "assets", "favicon.svg"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(favicon)
    with open(os.path.join(SITE, "data", "snapshot.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("window.SNAPSHOT = " + data_json + ";\n")

    # Cloudflare Pages response headers: a security CSP plus long-cache for the
    # static assets. Harmless on GitHub Pages (it is ignored there). The CSP is
    # audit-strict: no inline scripts (script-src 'self' only); 'unsafe-inline'
    # is allowed solely for styles because catalogue.html ships an inline
    # <style> and the app writes CSS custom properties inline for theming.
    # connect-src permits the live tag-explorer queries to api.github.com.
    headers = (
        "/*\n"
        "  Content-Security-Policy: default-src 'self'; script-src 'self';"
        " style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
        " font-src 'self' data:; connect-src 'self' https://api.github.com;"
        " object-src 'none'; base-uri 'self'; frame-ancestors 'none';"
        " form-action 'none'\n"
        "  X-Content-Type-Options: nosniff\n"
        "  Referrer-Policy: strict-origin-when-cross-origin\n"
        "  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()\n"
        "\n"
        "/assets/*\n"
        "  Cache-Control: public, max-age=31536000, immutable\n"
        "\n"
        "/data/*\n"
        "  Cache-Control: public, max-age=21600\n"
    )
    with open(os.path.join(SITE, "_headers"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(headers)

    # 2) Self-contained single file: same sources, everything inlined.
    out = fill(
        "<style>\n" + css + "\n</style>",
        '<script id="repo-data" type="application/json">' + data_json + "</script>",
        "<script>\n" + js + "\n</script>",
        '<link rel="icon" type="image/svg+xml" href="' + fav_data + '">',
        seo_meta(False),
    )
    with open(OUT_HTML, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)

    print("\nBuilt:", flush=True)
    print("  site/index.html + catalogue.html + assets/ + data/  (standalone tool site)", flush=True)
    print("  canonical/sitemap: %s" % (SITE_URL or "disabled (set SITE_URL to enable)"), flush=True)
    print("  github-explorer.html                (single file, %.1f KB)" % (len(out.encode("utf-8")) / 1024), flush=True)
    print("  cumulative %d | rising %s | new %s | topics %d" % (
        len(base),
        "/".join(str(len(trending.get(p["id"], []))) for p in PERIODS),
        "/".join(str(len(newstars.get(w["id"], []))) for w in WINDOWS),
        len(topics)), flush=True)
    print("\nWeekly momentum, highest gain ratio:", flush=True)
    for r in sorted(trending.get("weekly", []), key=lambda x: -x["ratio"])[:6]:
        print("  %-48s total %7d  +%6d  %5.1f%%" % (
            r["n"], r["s"], r["gain"], r["ratio"]), flush=True)


if __name__ == "__main__":
    main()

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
HISTORY = os.path.join(HERE, "stars_history.json")
HISTORY_MAX_DAYS = 35
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
# Tier C rework: the engine now matches WORDS, not substrings. Two lists —
#   w  word/phrase keywords: matched on token boundaries and tolerant of
#      "-" vs " " separators ("self hosted" also matches "self-hosted")
#   k  substring keywords: raw substring on name+desc+topics, for stems
#      ("fine-tun") and CJK terms ("自建")
# This kills the old class of misclassification where "ai " matched "chai ",
# "model" matched every data-model, "learning" pulled all ML repos into the
# 学习资源 category, and "engine" made search engines into games.
RULES = [
    {"id": "ai", "w": ["ai", "llm", "gpt", "rag", "mcp", "transformer", "diffusion",
                       "pytorch", "huggingface", "hugging face", "embedding", "inference",
                       "ollama", "openai", "anthropic", "llama", "mistral", "deepseek",
                       "machine learning", "deep learning", "generative ai",
                       "text to image", "text to speech", "stable diffusion",
                       "large language model", "vision language model", "vllm"],
     "k": ["fine-tun", "neural", "chatgpt", "generative", "机器学习", "大模型"]},
    {"id": "agent", "w": ["agent", "agents", "agentic", "autonomous", "copilot",
                          "assistant", "tool use", "browser use", "workflow engine"],
     "k": ["ai-agent", "ai agent", "智能体"]},
    {"id": "selfhost", "w": ["selfhost", "self hosted", "homelab", "nas",
                             "private cloud", "single binary", "docker compose",
                             "docker-compose"],
     "k": ["self-host", "self host", "自建", "自部署", "私有化部署"]},
    {"id": "devtools", "w": ["cli", "tui", "terminal", "editor", "debugger", "ide",
                             "sdk", "shell", "devtool", "linter", "formatter",
                             "plugin", "developer tools", "toolkit",
                             "command line", "commandline", "commandline tool"],
     "k": ["dev-tool", "dev tool"]},
    {"id": "frontend", "w": ["frontend", "front end", "react", "vue", "svelte",
                             "angular", "tailwind", "css", "ui", "webapp",
                             "web app", "chart", "charts", "component",
                             "component library", "design system", "webgl",
                             "webgpu"],
     "k": []},
    {"id": "db", "w": ["sql", "postgres", "postgresql", "mysql", "redis", "sqlite",
                       "nosql", "database", "orm", "storage", "query engine",
                       "data warehouse", "vector database", "vector db",
                       "clickhouse", "duckdb", "mongodb", "opensearch"],
     "k": ["vector-db", "data-lake", "数据库"]},
    {"id": "devops", "w": ["kubernetes", "docker", "terraform", "helm", "devops",
                           "observability", "cloud native", "monitoring",
                           "container", "k8s", "deployment", "infrastructure as code",
                           "gitops", "serverless", "k3s"],
     "k": ["ci/cd", "云原生"]},
    {"id": "security", "w": ["security", "pentest", "exploit", "scanner",
                             "forensics", "ctf", "malware", "privacy",
                             "encryption", "cryptography", "vulnerability",
                             "reverse engineering", "osint", "red team",
                             "漏洞", "安全"],
     "k": ["vulnerab", "逆向"]},
    {"id": "automation", "w": ["automation", "workflow", "cron", "rpa", "bot",
                               "scraper", "scraping", "n8n", "zapier",
                               "no code", "low code", "productivity"],
     "k": ["自动化"]},
    {"id": "game", "w": ["game", "games", "gaming", "unity", "godot", "unreal",
                         "bevy", "emulator", "renderer", "rendering",
                         "graphics", "shader", "ffmpeg", "video", "audio",
                         "multimedia", "3d", "game engine", "voxel"],
     "k": ["多媒体"]},
    {"id": "learn", "w": ["awesome", "tutorial", "tutorials", "roadmap",
                          "interview", "course", "courses", "handbook",
                          "guide", "guides", "cheatsheet", "cheat sheet",
                          "curriculum", "study"],
     "k": ["cheat-sheet", "教程", "学习"]},
]

# Tokenizer shared by the word-boundary matcher (mirrored in src/app.js).
_SEP_RE = re.compile(r"[^a-z0-9\u4e00-\u9fff]+")


def _tokens(text):
    return " " + _SEP_RE.sub(" ", (text or "").lower()).strip() + " "


def classify(rec):
    """Token-aware category matching. Must stay in sync with src/app.js."""
    raw = ((rec.get("n") or "") + " " + (rec.get("d") or "") + " "
           + " ".join(rec.get("t") or [])).lower()
    hay = _tokens(raw)
    out = []
    for rule in RULES:
        if any(k in raw for k in rule.get("k", [])):
            out.append(rule["id"])
            continue
        if any(_tokens(k) in hay for k in rule.get("w", [])):
            out.append(rule["id"])
    return out

PERIODS = [
    {"id": "daily",   "name": "今日涨势", "label": "今日"},
    {"id": "weekly",  "name": "本周涨势", "label": "本周"},
    {"id": "monthly", "name": "本月涨势", "label": "本月"},
]
PERIOD_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}
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


# ---- star-count history: snapshot deltas instead of scraped text ----
# Every build records (timestamp, stars) per known repo. Trending gains are
# then computed as stars_now - stars_N_days_ago whenever history covers the
# window, which is reproducible and immune to GitHub Trending's markup. The
# scraped "N stars today" text stays as a fallback for repos with no history.
# The history file persists locally and, in CI, via an actions/cache entry,
# so the delta path takes over as snapshots accumulate.

def load_history():
    try:
        with open(HISTORY, encoding="utf-8") as fh:
            h = json.load(fh)
        if isinstance(h.get("repos"), dict):
            return h
    except Exception:
        pass
    return {"v": 1, "repos": {}}


def _point_near_days_old(pts, days, tolerance_days, slack_hours=8):
    """Daily sample closest to `days` ago, or None when history can't cover it.

    History keeps one point per Beijing calendar day (the day's first build).
    A strict `ts <= now - days` test fails whenever today's build runs a few
    hours earlier than yesterday's, so allow a bounded slack on the recent
    side while keeping the older tolerance. Recent points are still excluded:
    e.g. daily requires a sample at least ~16h old, never last build's point.
    """
    target = time.time() - days * 86400
    lo = target - tolerance_days * 86400
    hi = target + slack_hours * 3600
    best = None
    for ts, stars in pts:
        if lo <= ts <= hi and (best is None or abs(ts - target) < abs(best[0] - target)):
            best = [ts, stars]
    return best


def _baseline_tolerance(days):
    """Max age (in days) beyond the advertised window for a valid baseline.

    The old `max(1.5, days * 0.5)` let a 15-day-old sample stand in for a
    30-day baseline — accurate to "sometime in the last six weeks", not
    "the last 30 days". Keep the baseline close to the label so the UI copy
    stays honest. The recent-side slack lives in _point_near_days_old.
    """
    if days <= 1:
        return 0.5
    if days >= 30:
        return 2.0
    return 1.0


def delta_gain(history, name, stars, days):
    """stars_now - stars_N_days_ago, or None if history doesn't cover it."""
    pts = (history.get("repos") or {}).get(name) or []
    if not pts or not stars:
        return None
    point = _point_near_days_old(pts, days, _baseline_tolerance(days))
    if not point:
        return None
    return max(0, stars - point[1])


def net_growth(history, name, stars, days):
    """Same as delta_gain but reported as a signed net change."""
    pts = (history.get("repos") or {}).get(name) or []
    if not pts or not stars:
        return None
    point = _point_near_days_old(pts, days, _baseline_tolerance(days))
    if not point:
        return None
    return stars - point[1]


def record_history(history, base, trending, newstars, now_ts):
    repos = history.setdefault("repos", {})

    def day_bucket(ts):
        """Beijing-time (UTC+8) calendar day — one stable sample per day."""
        return int((ts + 8 * 3600) // 86400)

    def add(name, stars):
        if not name or not stars:
            return
        pts = repos.setdefault(name, [])
        bucket = day_bucket(now_ts)
        # Keep the FIRST sample of each day. Refreshing today's point on every
        # build (CI runs every 6h) used to collapse the whole history into a
        # single "today" point, which made snapshot deltas impossible forever.
        # Skipping same-day updates also keeps delta baselines stable.
        if pts and day_bucket(pts[-1][0]) == bucket:
            return
        pts.append([now_ts, stars])
        cutoff = now_ts - HISTORY_MAX_DAYS * 86400
        if len(pts) > 40:
            del pts[:-40]
        repos[name] = [p for p in pts if p[0] >= cutoff]

    for r in base:
        add(r["n"], r.get("s") or 0)
    for rows in list(trending.values()) + list(newstars.values()):
        for r in rows:
            add(r["n"], r.get("s") or 0)
    history["v"] = 1
    return history


def main():
    print("proxy: %s | token: %s | curl: %s | ci: %s" % (
        PROXY or "direct", "yes" if TOKEN else "no", CURL, CI), flush=True)
    for f in ("index.template.html", "tokens.css", "app.css", "app.js", "monitor.js", "i18n.js", "favicon.svg"):
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

    # ---- Tier C: snapshot-delta gains (history-backed, reproducible) ----
    history = load_history()
    gain_src = {}
    for period in PERIODS:
        days = PERIOD_DAYS[period["id"]]
        rows = trending.get(period["id"], [])
        n_delta = 0
        for rec in rows:
            g = delta_gain(history, rec["n"], rec.get("s") or 0, days)
            if g is not None and g > 0:
                rec["gain"] = g
                rec["ratio"] = round(g / (rec.get("s") or 1) * 100, 1)
                rec["gsrc"] = "delta"
                n_delta += 1
            else:
                rec["gsrc"] = "page"
        gain_src[period["id"]] = {"delta": n_delta, "page": len(rows) - n_delta}
    # 30-day net growth where history already covers it (fills in over time).
    for r in base:
        g = net_growth(history, r["n"], r.get("s") or 0, 30)
        if g is not None:
            r["n30"] = g
    n30_covered = sum(1 for r in base if isinstance(r.get("n30"), int))

    record_history(history, base, trending, newstars, now_ts)
    with open(HISTORY, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(history, fh, ensure_ascii=False, separators=(",", ":"))
    print("  gain source: %s | history repos: %d | n30 covered: %d/%d" % (
        " ".join("%s=%dΔ/%dpg" % (p, gain_src[p]["delta"], gain_src[p]["page"]) for p in gain_src),
        len(history.get("repos") or {}), n30_covered, len(base)), flush=True)

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
            "gainSource": gain_src,
            # n30 coverage: how many catalogue rows carry a real 30-day net
            # growth from snapshot history. Fills in as daily history accrues;
            # audited ~monthly (see the one-shot check scheduled in the ops log).
            "n30": {"covered": n30_covered, "total": len(base)},
        },
    }
    # ---- shard the heavy arrays for progressive / on-demand loading ----
    # The cumulative catalogue (repos) is the bulk of the payload. We split it
    # into chunks so the first screen only downloads/parses the head, and the
    # rest streams in as the user scrolls. Momentum (trending/newstars) is
    # small enough to ship with the first screen but kept in its own file so it
    # can be cached independently. Redundant fields (u, cats) are stripped: the
    # URL is derivable from the full_name and categories are re-derived
    # client-side from the shipped RULES, so nothing is lost.
    CHUNK = 250

    def slim(rec, catalogue=False):
        # Strip the URL (derivable from n). Categories ship as a compact
        # space-joined string 'ct' instead of a JSON array — same information,
        # roughly half the bytes, and the sidebar/filter stay exact without
        # re-running the classifier client-side for catalogue rows.
        out = {k: v for k, v in rec.items() if k not in ('u', 'cats')}
        cats = rec.get('cats') or []
        # Catalogue rows ALWAYS carry ct, even when empty. Otherwise the client
        # falls back to classify() for unclassified rows, so filtering a
        # category returns more rows than idx.counts advertises in the sidebar.
        # Momentum/online rows have no ground-truth cats and must keep using
        # the client classifier, so they only get ct when it is non-empty.
        if catalogue or cats:
            out['ct'] = ' '.join(cats)
        return out

    def slim_list(arr, catalogue=False):
        return [slim(r, catalogue) for r in arr]

    # Classification counts + total, so the sidebar tree is exact without
    # having to load every chunk first.
    idx_counts = {}
    for r in base:
        for cid in (r.get('cats') or []):
            idx_counts[cid] = idx_counts.get(cid, 0) + 1
    # Distinct languages across every lens, so the language filter is complete.
    lang_set = set()
    for rec in base:
        if rec.get('l'):
            lang_set.add(rec['l'])
    for rows in list(trending.values()) + list(newstars.values()):
        for rec in rows:
            if rec.get('l'):
                lang_set.add(rec['l'])
    langs = sorted(lang_set)
    meta_payload = {
        "generated": now,
        "cats": [{"id": c["id"], "name": c["name"], "q": c["q"]} for c in CATS],
        "rules": RULES,
        "periods": PERIODS,
        "windows": [{"id": w["id"], "name": w["name"]} for w in WINDOWS],
        "coverage": payload["coverage"],
        "topics": topics,
        "idx": {"counts": idx_counts, "total": len(base)},
        "langs": langs,
    }
    momentum_payload = {
        "trending": {p: slim_list(v) for p, v in trending.items()},
        "newstars": {w: slim_list(v) for w, v in newstars.items()},
    }
    repo_chunks = [slim_list(base[i:i + CHUNK], True) for i in range(0, len(base), CHUNK)]
    # Single-file build keeps the full payload inline (offline, no chunk fetch).
    full_slim = dict(payload)
    full_slim["repos"] = slim_list(base, True)
    full_slim["trending"] = momentum_payload["trending"]
    full_slim["newstars"] = momentum_payload["newstars"]
    full_slim["idx"] = meta_payload["idx"]
    full_slim["langs"] = langs
    data_json = json.dumps(full_slim, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")

    def read_src(name):
        with open(os.path.join(SRC, name), encoding="utf-8") as fh:
            return fh.read()

    tpl = read_src("index.template.html")
    tokens = read_src("tokens.css")
    css = tokens + "\n\n" + read_src("app.css")
    js = read_src("app.js")
    monitor = read_src("monitor.js")
    i18n = read_src("i18n.js")
    favicon = read_src("favicon.svg")
    fav_data = "data:image/svg+xml," + quote(favicon, safe="")

    # Runtime monitor: shipped linked on the site, inlined in the single file.
    # With SITE_URL configured the site build points the monitor at the
    # same-origin Pages Function /api/errors (functions/api/errors.js, copied
    # into site/functions below). connect-src 'self' already permits it, so
    # the strict CSP stays untouched. The single-file build stays silent — it
    # runs from file:// where no origin and no endpoint exist.
    report_url = "/api/errors" if SITE_URL else ""
    monitor_cfg = '<script>window.__ERROR_REPORT_URL__="%s";</script>' % report_url
    site_monitor = monitor_cfg + '<script src="assets/monitor.js"></script>'
    single_monitor = '<script>window.__ERROR_REPORT_URL__="";</script>' + "<script>\n" + monitor + "\n</script>"

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
        # Cloudflare Pages 308-redirects /catalogue.html -> /catalogue, so the
        # canonical must point at the extensionless final URL.
        canonical = ('<link rel="canonical" href="%s/catalogue">' % esc(SITE_URL)) if SITE_URL else ""
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

    def build_rss(trending, generated):
        """Weekly-gain digest feed. RSS items need absolute links, so this is
        only emitted for a configured public origin (same rule as sitemap)."""
        if not SITE_URL:
            return ""
        def xesc(s):
            return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
                    .replace(">", "&gt;").replace('"', "&quot;"))
        pub_str = datetime.now(timezone(timedelta(hours=8))).strftime(
            "%a, %d %b %Y %H:%M:%S +0800")
        items = []
        for rec in sorted(trending.get("weekly", []),
                          key=lambda r: -r["gain"])[:30]:
            link = "https://github.com/" + rec["n"]
            title = "%s（本周 +%%d 星）" % rec["n"] % (rec.get("gain") or 0)
            desc = "%s — ★ %s · 本周 +%d · 涨幅 %s%%" % (
                rec.get("d") or "（无简介）", format(rec.get("s") or 0, ","),
                rec.get("gain") or 0, rec.get("ratio") or 0)
            items += [
                "    <item>",
                "      <title>%s</title>" % xesc(title),
                "      <link>%s</link>" % xesc(link),
                '      <guid isPermaLink="true">%s</guid>' % xesc(link),
                "      <description>%s</description>" % xesc(desc),
                "      <pubDate>%s</pubDate>" % pub_str,
                "    </item>",
            ]
        return "\n".join([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
            "  <channel>",
            "    <title>Starscope · 每周涨势精选</title>",
            "    <link>%s/</link>" % xesc(SITE_URL),
            "    <description>%s</description>" % xesc(SEO_DESC),
            "    <language>zh-CN</language>",
            "    <ttl>360</ttl>",
            "    <lastBuildDate>%s</lastBuildDate>" % pub_str,
            '    <atom:link href="%s/rss.xml" rel="self" type="application/rss+xml"/>' % xesc(SITE_URL),
        ] + items + ["  </channel>", "</rss>"]) + "\n"

    def fill(style_block, data_block, app_block, icon_block, seo, monitor_block, rss_link=""):
        return (tpl.replace("__STYLE_BLOCK__", style_block)
                   .replace("__DATA_BLOCK__", data_block)
                   .replace("__APP_SCRIPT__", app_block)
                   .replace("__FAVICON_BLOCK__", icon_block)
                   .replace("__SEO_BLOCK__", seo)
                   .replace("__MONITOR_BLOCK__", monitor_block)
                   .replace("__RSS_LINK__", rss_link)
                   .replace("__TIME__", now))

    # 1) Standalone tool site: linked assets, works over http and file:// alike.
    for sub in ("assets", "data"):
        os.makedirs(os.path.join(SITE, sub), exist_ok=True)
    # Disable Jekyll so GitHub Pages serves assets/data verbatim (no underscore
    # rewriting) and never injects its own default theme.
    with open(os.path.join(SITE, ".nojekyll"), "w", encoding="utf-8") as fh:
        fh.write("")
    rss_link = ('<li data-i18n="footer.rss"><a href="rss.xml" target="_blank" rel="noopener">RSS 订阅 · 每周涨势精选</a></li>'
                if SITE_URL else "")
    site_index = fill(
        '<link rel="stylesheet" href="assets/app.css">',
        '<script src="data/snapshot.js"></script>'
        '<script src="data/momentum.js"></script>'
        '<script src="data/repos-0.js"></script>',
        '<script src="assets/i18n.js"></script>'
        '<script src="assets/app.js"></script>',
        '<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">',
        seo_meta(True),
        site_monitor,
        rss_link,
    )
    with open(os.path.join(SITE, "index.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(site_index)
    with open(os.path.join(SITE, "catalogue.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(build_catalogue(base, payload["cats"], now))
    # Without a 404.html, Cloudflare Pages falls back to SPA behaviour and
    # answers unknown URLs with 200 + the homepage (a soft 404). Shipping one
    # makes Pages return a real 404 status for those URLs.
    not_found = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>页面不存在 · Starscope</title>
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<style>
:root{color-scheme:dark light}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
 background:#0d1117;color:#e6edf3;font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:520px;text-align:center}
.code{font:700 4rem/1 ui-monospace,SFMono-Regular,monospace;color:#58a6ff;margin:0 0 16px}
h1{font-size:1.5rem;margin:0 0 12px}
p{color:#8b949e;margin:0 0 28px}
a{display:inline-block;padding:10px 20px;border-radius:8px;background:#58a6ff;color:#0d1117;
 font-weight:600;text-decoration:none}
a:hover{background:#79c0ff}
a:focus-visible{outline:2px solid #79c0ff;outline-offset:3px}
@media (prefers-color-scheme:light){body{background:#fafafb;color:#111827}p{color:#6b7280}
 a{background:#2563eb;color:#fff}a:hover{background:#1d4ed8}}
</style>
</head>
<body>
<main>
<p class="code">404</p>
<h1>这个页面不存在</h1>
<p>链接可能已失效，或地址拼写有误。回到首页继续浏览 GitHub 项目目录。</p>
<a href="/">返回 Starscope 首页 →</a>
</main>
</body>
</html>
"""
    with open(os.path.join(SITE, "404.html"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(not_found)
    rss_xml = build_rss(trending, now)
    if rss_xml:
        with open(os.path.join(SITE, "rss.xml"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(rss_xml)
    else:
        stale = os.path.join(SITE, "rss.xml")
        if os.path.exists(stale):
            os.remove(stale)   # never ship an rss pointing at a stale origin
    robots = "User-agent: *\nAllow: /\n"
    if SITE_URL:
        robots += "Sitemap: %s/sitemap.xml\n" % SITE_URL
        today = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
        urls = [("/", "daily", "1.0"), ("/catalogue", "daily", "0.8")]
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
    with open(os.path.join(SITE, "assets", "monitor.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(monitor)
    with open(os.path.join(SITE, "assets", "i18n.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(i18n)
    # Pages Function: same-origin error-report sink. Copied verbatim into
    # site/functions so `wrangler pages deploy site` picks it up as a route
    # (POST/GET /api/errors). Regenerated from source on every build.
    site_functions = os.path.join(SITE, "functions")
    functions_src = os.path.join(HERE, "functions")
    if os.path.isdir(site_functions):
        shutil.rmtree(site_functions)
    if os.path.isdir(functions_src):
        for root, _dirs, files in os.walk(functions_src):
            rel = os.path.relpath(root, functions_src)
            dst_dir = site_functions if rel == "." else os.path.join(site_functions, rel)
            os.makedirs(dst_dir, exist_ok=True)
            for fn in files:
                shutil.copyfile(os.path.join(root, fn), os.path.join(dst_dir, fn))
    with open(os.path.join(SITE, "assets", "favicon.svg"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(favicon)
    with open(os.path.join(SITE, "data", "snapshot.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("window.SNAPSHOT = "
                 + json.dumps(meta_payload, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
                 + ";\n")
    with open(os.path.join(SITE, "data", "momentum.js"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("window.SNAPSHOT_MOMENTUM = "
                 + json.dumps(momentum_payload, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
                 + ";\n")
    for i, chunk in enumerate(repo_chunks):
        with open(os.path.join(SITE, "data", "repos-%d.js" % i), "w", encoding="utf-8", newline="\n") as fh:
            fh.write("window.REPOS_CHUNKS=window.REPOS_CHUNKS||[];window.REPOS_CHUNKS[%d]=" % i
                     + json.dumps(chunk, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
                     + ";\n")

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
        "\n"
        "/api/*\n"
        "  Cache-Control: no-store\n"
    )
    with open(os.path.join(SITE, "_headers"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(headers)

    # 2) Self-contained single file: same sources, everything inlined.
    out = fill(
        "<style>\n" + css + "\n</style>",
        '<script id="repo-data" type="application/json">' + data_json + "</script>",
        "<script>\n" + i18n + "\n</script>\n<script>\n" + js + "\n</script>",
        '<link rel="icon" type="image/svg+xml" href="' + fav_data + '">',
        seo_meta(False),
        single_monitor,
    )
    with open(OUT_HTML, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(out)

    print("\nBuilt:", flush=True)
    print("  site/index.html + catalogue.html + assets/ + data/  (standalone tool site)", flush=True)
    print("    snapshot.js(meta) + momentum.js + repos-*.js (%d chunks x %d)" % (len(repo_chunks), CHUNK), flush=True)
    print("  canonical/sitemap: %s" % (SITE_URL or "disabled (set SITE_URL to enable)"), flush=True)
    print("  error reporting: %s" % ("POST /api/errors (Pages Function + KV)" if SITE_URL
                                     else "off (set SITE_URL to enable the /api/errors sink)"), flush=True)
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

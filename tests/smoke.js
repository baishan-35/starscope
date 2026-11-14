/* Static + payload checks for both build outputs.
 * Runtime behaviour is covered by tests/browser-check.js and token contrast
 * by tests/contrast.js.
 *   node tests/smoke.js
 */
const fs = require('fs');
const path = require('path');

const root = path.dirname(__dirname);
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ok = [], fail = [];
const check = (cond, label) => (cond ? ok : fail).push(label);

const single = read('github-explorer.html');
const site = read('site/index.html');
const tokens = read('src/tokens.css');
const styles = read('src/app.css');
const app = read('src/app.js');
const tpl = read('src/index.template.html');

/* ---- payload ---- */
const data = JSON.parse(single.match(/<script id="repo-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const snapshot = read('site/data/snapshot.js');
check(snapshot.startsWith('window.SNAPSHOT = '), 'site snapshot is a JS assignment (file:// safe)');
check(snapshot.trim().endsWith(';'), 'site snapshot terminates correctly');
const meta = JSON.parse(snapshot.slice('window.SNAPSHOT = '.length).replace(/;\s*$/, ''));
check(meta.cats.length === 12, `12 categories in metadata (got ${meta.cats.length})`);
check(meta.rules.length === 11, `11 classification rules in metadata (got ${meta.rules.length})`);
check(meta.topics.length >= 100, `tag cloud >= 100 (got ${meta.topics.length})`);
check(meta.coverage && meta.coverage.unique >= 900, 'coverage metadata declares the collected total');
check(meta.coverage.perCategory === 200 && meta.coverage.searchCap === 1000,
  'coverage bounds are explicit in the metadata');
check(meta.idx && typeof meta.idx.total === 'number' && meta.idx.total >= 900,
  'metadata ships a precise total for the sidebar');
check(meta.idx && meta.idx.counts && Object.keys(meta.idx.counts).length === 11,
  'metadata ships exact per-category counts');
check(Array.isArray(meta.langs) && meta.langs.length >= 10,
  `metadata ships the full language list (got ${meta.langs.length})`);

check(data.repos.length >= 900, `cumulative catalogue >= 900 (got ${data.repos.length})`);
check(data.coverage && data.coverage.unique >= 900, 'coverage metadata declares the collected total');
check(data.coverage.perCategory === 200 && data.coverage.searchCap === 1000,
  'coverage bounds are explicit in the payload');
check(data.cats.length === 12, `12 categories (got ${data.cats.length})`);
check(data.rules.length === 11, `11 classification rules (got ${data.rules.length})`);
check(data.topics.length >= 100, `tag cloud >= 100 (got ${data.topics.length})`);
for (const p of ['daily', 'weekly', 'monthly']) {
  const rows = data.trending[p];
  check(rows.length >= 50, `trending ${p} keeps all merged rows (got ${rows.length})`);
  check(rows.every(r => r.gain > 0), `trending ${p}: every row has a real gain`);
  check(rows.filter(r => (r.t || []).length).length > 25, `trending ${p}: majority enriched with topics`);
}
for (const w of ['90d', '365d']) check(data.newstars[w].length >= 100,
  `newstars ${w} keeps the full window (got ${data.newstars[w].length})`);

const momentum = JSON.parse(read('site/data/momentum.js')
  .replace('window.SNAPSHOT_MOMENTUM = ', '').replace(/;\s*$/, ''));
for (const p of ['daily', 'weekly', 'monthly']) {
  check(momentum.trending[p].length === data.trending[p].length, `trending ${p}: site and single-file agree`);
}
for (const w of ['90d', '365d']) {
  check(momentum.newstars[w].length === data.newstars[w].length, `newstars ${w}: site and single-file agree`);
}
const chunkFiles = fs.readdirSync(path.join(root, 'site', 'data'))
  .filter(f => /^repos-\d+\.js$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
check(chunkFiles.length >= 5, `repos are sharded into chunks (got ${chunkFiles.length})`);
const siteRepos = chunkFiles.map(f => {
  const src = read(path.join('site', 'data', f));
  const marker = src.lastIndexOf('REPOS_CHUNKS[');
  const eq = src.indexOf('=', marker);
  const start = src.indexOf('[', eq);
  return JSON.parse(src.slice(start).replace(/;\s*$/, ''));
}).reduce((acc, c) => acc.concat(c), []);
check(siteRepos.length === data.repos.length,
  `sharded repos reconcile with single-file (${siteRepos.length} vs ${data.repos.length})`);
check(siteRepos.every(r => !('u' in r) && !('cats' in r)),
  'sharded repos strip redundant u/cats fields');
check(data.repos.every(r => !('u' in r) && !('cats' in r)),
  'single-file repos also strip u/cats (client re-derives them)');
/* ---- Tier C: compact categories + snapshot-delta gains ---- */
check(siteRepos.some(r => typeof r.ct === 'string') && siteRepos.filter(r => r.ct).length > 1000,
  `repos ship compact ct categories (got ${siteRepos.filter(r => r.ct).length})`);
const CAT_IDS = new Set(data.cats.map(c => c.id));
check(siteRepos.every(r => typeof r.ct !== 'string' || r.ct.split(' ').every(c => CAT_IDS.has(c))),
  'ct strings reference valid category ids');
check(data.rules.every(r => r.id && (Array.isArray(r.w) || Array.isArray(r.k))),
  'rules ship word and/or substring keyword lists');
check(/normTokens/.test(app) && /ct\.split/.test(app),
  'client mirrors the token-aware classifier and reads ct');
for (const p of ['daily', 'weekly', 'monthly']) {
  check(data.trending[p].every(r => r.gsrc === 'delta' || r.gsrc === 'page'),
    `trending ${p}: every gain is labelled delta or page`);
}
check(data.coverage.gainSource && ['daily', 'weekly', 'monthly'].every(p => data.coverage.gainSource[p]),
  'coverage reports the delta/page gain split');

/* ---- build outputs ---- */
for (const [label, html] of [['single-file', single], ['site', site]]) {
  check(!/__STYLE_BLOCK__|__DATA_BLOCK__|__APP_SCRIPT__|__FAVICON_BLOCK__|__SEO_BLOCK__|__MONITOR_BLOCK__|__RSS_LINK__|__TIME__/.test(html),
    `${label}: no unreplaced placeholders`);
  check(!/(?:gho_|ghp_|ghu_|ghs_|github_pat_)[A-Za-z0-9_]{16,}/.test(html),
    `${label}: no GitHub credential embedded`);
}
/* Check the template, not the payload: real repo topics legitimately
   contain words like "todo". */
check(!/lorem ipsum|\[copy\]|>TODO<|>FIXME<|placeholder text/i.test(tpl),
  'template contains no placeholder copy');
check(site.includes('href="assets/app.css"') && site.includes('src="data/snapshot.js"')
      && site.includes('src="data/momentum.js"') && site.includes('src="data/repos-0.js"')
      && site.includes('src="assets/app.js"'), 'site links its own assets (meta + momentum + first chunk)');
for (const f of ['assets/app.css', 'assets/app.js', 'assets/monitor.js', 'assets/favicon.svg', 'data/snapshot.js', 'data/momentum.js', 'data/repos-0.js']) {
  check(fs.existsSync(path.join(root, 'site', f)), `site/${f} exists`);
}

/* ---- runtime monitor (Tier B) ---- */
const monitorSrc = read('src/monitor.js');
check(site.includes('src="assets/monitor.js"') && site.includes('__ERROR_REPORT_URL__'),
  'site loads the runtime monitor with its config');
check(single.includes('__ERROR_REPORT_URL__') && single.includes('STASCOPE_REPORT'),
  'single-file inlines the runtime monitor');
check(read('site/assets/monitor.js') === monitorSrc, 'site monitor.js is byte-identical to src/monitor.js');
check(/STASCOPE_REPORT/.test(app) && /chunk-load-failed/.test(app) && /tag-api-error/.test(app),
  'app reports chunk and tag-API failures to the monitor');
check(/toastHost/.test(monitorSrc) && /aria-live/.test(monitorSrc) && /unhandledrejection/.test(monitorSrc),
  'monitor catches errors/rejections and surfaces an accessible toast');
check(/#toastHost/.test(styles) && /toast--err/.test(styles), 'toast styles are defined');
check(!/sendBeacon/.test(app), 'the app itself never beacons — only the monitor does');

/* ---- Tier D: i18n scaffold ---- */
const i18nSrc = read('src/i18n.js');
check(site.includes('src="assets/i18n.js"') && site.indexOf('assets/i18n.js') < site.indexOf('assets/app.js'),
  'site loads i18n.js before app.js');
check(single.includes('STASCOPE_I18N') && single.indexOf('STASCOPE_I18N') < single.indexOf('window.SNAPSHOT ||'),
  'single-file inlines the i18n layer before the app');
check(read('site/assets/i18n.js') === i18nSrc, 'site i18n.js is byte-identical to src/i18n.js');
check(/window\.t\s*=/.test(i18nSrc) && /'en'/.test(i18nSrc) && /starscope-lang/.test(i18nSrc),
  'i18n ships the t() lookup with a persisted language switch');
check(/\bt\(/.test(app) && /STASCOPE_I18N/.test(app) && /applyLangChrome/.test(app),
  'app routes dynamic strings through t() and swaps the chrome on switch');
check(/id="langToggle"/.test(tpl), 'template ships the language toggle');
check(single.includes('<style>') && single.includes('id="repo-data"') && single.includes('window.SNAPSHOT ||'),
  'single-file inlines CSS, data and app with dual-source data loader');
check(read('site/assets/app.js') === app, 'site app.js is byte-identical to src/app.js');
check(read('site/assets/app.css') === tokens + '\n\n' + styles, 'site stylesheet = tokens + app styles');

/* ---- semantics & token discipline (website-ui-designer Stage 5) ---- */
check((tpl.match(/<h1\b/g) || []).length === 1, 'exactly one h1');
check(/<header\b/.test(tpl) && /<nav\b/.test(tpl) && /<main\b/.test(tpl) && /<footer\b/.test(tpl),
  'all four landmarks present');
check(/class="skip-link"/.test(tpl), 'skip link present');
check(/role="tablist"/.test(tpl) && /role="tab"/.test(tpl) && /role="tabpanel"/.test(tpl),
  'tabs expose ARIA roles');
const inputs = [...tpl.matchAll(/<(input|select)\b[^>]*id="([^"]+)"/g)].map(m => m[2]);
check(inputs.every(id => new RegExp(`for="${id}"`).test(tpl)), `all ${inputs.length} form controls have a label`);
check(inputs.length >= 8, `toolbar has a full set of controls (${inputs.length})`);
check(/prefers-reduced-motion/.test(tokens), 'reduced-motion guard present');
check(/:focus-visible/.test(tokens), 'focus-visible rule present');
check(/--text:|--accent:|--space-4:|--radius-md:|--dur-base:/.test(tokens), 'token layers present');
check(!/#[0-9a-fA-F]{6}\b/.test(styles), 'app.css contains no raw hex — all colors resolve to tokens');
check(/@media \(min-width: 1024px\)/.test(styles) && /@media \(min-width: 768px\)/.test(styles),
  'mobile-first breakpoints defined');
check(/scroll-margin-top/.test(styles), 'sticky-header anchor offset defined');
check(/font-size: 1rem/.test(styles), 'inputs use >=16px to avoid iOS zoom');
check(/aria-pressed/.test(app) && /aria-selected/.test(app), 'ARIA state kept in sync by app logic');
check(/state\.cat/.test(app) && /switchView/.test(app), 'category state persists across views');

/* ---- catalogue semantics & interaction fixes ---- */
check(!/id="limit"/.test(tpl) && !/state\.limit/.test(app), 'Top-N truncation control removed');
check(/PAGE_SIZE/.test(app) && /appendRows/.test(app) && /showAll/.test(app),
  'the full list renders progressively');
check(/IntersectionObserver/.test(app), 'scroll sentinel loads further rows');
check(/id="filterbar"/.test(tpl) && /renderFilterbar/.test(app) && /clearFilter/.test(app),
  'active filters are visible and individually removable');
check(/id="legal"/.test(tpl) && /非官方、非隶属/.test(tpl), 'legal / data-source section present');
check(/核验于 2026-11-14/.test(tpl), 'compliance references carry a verification date');
check(!/ghToken|GITHUB_TOKEN/.test(tpl) && !/Authorization/.test(app),
  'no credential input or auth header in the client');
check(/popstate/.test(app) && /pushState/.test(app), 'browser back/forward restores views');
check(/AbortController/.test(app) && /searchSeq/.test(app), 'tag queries cancel stale requests');
check(app.includes(' 条">') && !/repo--r1/.test(app),
  'rows are numbered as entries, not ranked places');
check(/moreOnlineBtn/.test(tpl) && /ONLINE_MAX_PAGES/.test(app),
  'tag discovery can page through GitHub results');
check(fs.existsSync(path.join(root, 'site', 'robots.txt')), 'site ships robots.txt');
check(fs.existsSync(path.join(root, '.github', 'workflows', 'update-snapshot.yml')),
  'scheduled snapshot refresh workflow exists');

/* ---- SEO / crawlability ---- */
check(/property="og:title"/.test(site) && /application\/ld\+json/.test(site),
  'site ships Open Graph and JSON-LD metadata');
check(/property="og:title"/.test(single), 'single-file carries social metadata too');
check(!/rel="canonical"/.test(single), 'offline single-file emits no canonical URL');
const catalogue = read('site/catalogue.html');
check(/<table[\s\S]*?<tbody>/.test(catalogue), 'crawlable catalogue has a real HTML table');
check((catalogue.match(/rel="noopener noreferrer"/g) || []).length === 100,
  'catalogue lists 100 real projects with safe external links');
const topRepo = [...data.repos].sort((a, b) => b.s - a.s)[0];
check(catalogue.includes('>' + topRepo.n + '</a>'),
  `catalogue contains the highest-starred real repository (${topRepo.n})`);
check(catalogue.includes('非官方、非隶属') && catalogue.includes('GitHub, Inc.'),
  'catalogue carries the non-affiliation notice');
check(/href="index\.html\?view=total&amp;cat=/.test(catalogue),
  'catalogue deep-links into the interactive tool');
check(!/__[A-Z_]+__/.test(catalogue), 'catalogue has no unreplaced placeholders');
check(/^User-agent: \*/m.test(read('site/robots.txt')), 'robots.txt has a valid user-agent rule');

/* ---- Tier D: detail sheet + favourites ---- */
check(/role="dialog"/.test(tpl) && /aria-modal="true"/.test(tpl) && /id="detailTitle"/.test(tpl),
  'template ships an accessible detail dialog');
check(/openDetail/.test(app) && /closeDetail/.test(app) && /detailReturn/.test(app),
  'detail sheet opens from rows and returns focus on close');
check(/favBtnHtml/.test(app) && /starscope-favs/.test(app) && /aria-pressed/.test(app),
  'favourites persist in localStorage behind an aria-pressed toggle');
check(/id="favToggle"/.test(tpl) && /id="favExport"/.test(tpl) && /id="favClear"/.test(tpl),
  'favourites chrome (toggle / export / clear) is in the template');
check(/n30/.test(app), 'net-30-day growth is surfaced when history covers it');
check(/\.detail__panel/.test(styles) && /\.favbtn/.test(styles), 'detail and favourite styles exist');

/* ---- Tier D: RSS feed ---- */
const rssPath = path.join(root, 'site', 'rss.xml');
if (fs.existsSync(rssPath)) {
  const rss = read('site/rss.xml');
  check(rss.startsWith('<?xml') && /<rss version="2\.0"/.test(rss) && /<channel>/.test(rss),
    'rss.xml is a valid RSS 2.0 channel');
  check((rss.match(/<item>/g) || []).length >= 10,
    `rss.xml carries a digest of items (got ${(rss.match(/<item>/g) || []).length})`);
  check(/https:\/\/github\.com\//.test(rss) && /<guid/.test(rss),
    'rss items deep-link to GitHub repos');
  check(/<language>zh-CN<\/language>/.test(rss), 'rss declares its language');
}
check(!/rel="canonical"/.test(site) || /href="rss\.xml"/.test(site),
  'site footer exposes the RSS feed whenever canonical is enabled');

console.log(`PASS (${ok.length})`);
ok.forEach(x => console.log('  ok  ' + x));
if (fail.length) {
  console.log(`FAIL (${fail.length})`);
  fail.forEach(x => console.log('  !!  ' + x));
  process.exit(1);
}
console.log('\nAll static checks passed.');

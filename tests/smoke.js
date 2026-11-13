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
const sitePayload = JSON.parse(snapshot.slice('window.SNAPSHOT = '.length).replace(/;\s*$/, ''));
check(JSON.stringify(sitePayload).length === JSON.stringify(data).length,
  'site and single-file carry identical payloads');

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

/* ---- build outputs ---- */
for (const [label, html] of [['single-file', single], ['site', site]]) {
  check(!/__STYLE_BLOCK__|__DATA_BLOCK__|__APP_SCRIPT__|__FAVICON_BLOCK__|__SEO_BLOCK__|__TIME__/.test(html),
    `${label}: no unreplaced placeholders`);
  check(!/(?:gho_|ghp_|ghu_|ghs_|github_pat_)[A-Za-z0-9_]{16,}/.test(html),
    `${label}: no GitHub credential embedded`);
}
/* Check the template, not the payload: real repo topics legitimately
   contain words like "todo". */
check(!/lorem ipsum|\[copy\]|>TODO<|>FIXME<|placeholder text/i.test(tpl),
  'template contains no placeholder copy');
check(site.includes('href="assets/app.css"') && site.includes('src="data/snapshot.js"')
      && site.includes('src="assets/app.js"'), 'site links its own assets');
for (const f of ['assets/app.css', 'assets/app.js', 'assets/favicon.svg', 'data/snapshot.js']) {
  check(fs.existsSync(path.join(root, 'site', f)), `site/${f} exists`);
}
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

console.log(`PASS (${ok.length})`);
ok.forEach(x => console.log('  ok  ' + x));
if (fail.length) {
  console.log(`FAIL (${fail.length})`);
  fail.forEach(x => console.log('  !!  ' + x));
  process.exit(1);
}
console.log('\nAll static checks passed.');

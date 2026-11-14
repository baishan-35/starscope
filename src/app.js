/* Starscope — application logic. Works both as a linked static site and as
 * an inlined single-file page. Data comes from window.SNAPSHOT (site build)
 * or the #repo-data JSON script (single-file build). */
const DATA = window.SNAPSHOT || JSON.parse(document.getElementById('repo-data').textContent);
/* Progressive loading: the cumulative catalogue is sharded into data/repos-N.js
 * chunks. The first chunk is linked synchronously in the page; further chunks
 * stream in on scroll / "show all". The single-file build inlines the full
 * payload and never sets window.REPOS_CHUNKS, so it stays in classic mode.
 * Momentum (trending/newstars) ships in its own momentum.js, also linked up
 * front, so switching to those views is instant. */
const SHARDED = !!window.REPOS_CHUNKS;
if (SHARDED) {
  DATA.repos = (window.REPOS_CHUNKS || []).filter(Boolean).flat();
  if (window.SNAPSHOT_MOMENTUM) {
    DATA.trending = window.SNAPSHOT_MOMENTUM.trending || {};
    DATA.newstars = window.SNAPSHOT_MOMENTUM.newstars || {};
  }
}
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => n >= 1000 ? (n/1000).toFixed(1).replace(/\.0$/,'') + 'k' : String(n);
const int = n => Number(n||0).toLocaleString('en-US');
const uniq = a => [...new Set(a)];

const PAGE_SIZE = 60;
const ONLINE_PAGE_SIZE = 100;
const ONLINE_MAX_PAGES = 10;

const SORTS = {
  total:[['stars','星标总数'],['pushed','最近更新'],['forks','Fork 数'],['created','创建时间']],
  rising:[['gain','新增星标'],['ratio','涨幅'],['stars','星标总数'],['created','创建时间']],
  new:[['spd','日均涨星'],['stars','星标总数'],['created','创建时间']],
  tags:[['stars','星标总数'],['updated','最近更新'],['created','创建时间']]
};
const HINTS = {
  total:'累计目录：把已收录项目按星标从高到低完整列出，不截断。老项目有先发优势，涨得快的新项目通常排在后面。',
  rising:'涨势目录：按时间窗口内的新增星标从高到低完整列出已收录项目。涨幅 = 新增 ÷ 总星标，小基数高增长会浮到前面。',
  new:'新星目录：只看近期新建且已起量的项目，按「日均涨星」完整列出，用来找还没长成巨头但跑得很快的工具。',
  tags:'标签探索：点项目上的 #标签、从标签云选一个，或直接输入标签。先给快照内的项目，再实时向 GitHub API 查询该标签下的其他项目。'
};
const SUBDEFAULT = {total:'all', rising:'daily', new:'90d', tags:''};
const VIEWNAME = {total:'累计目录', rising:'涨势目录', new:'新星目录', tags:'标签探索'};
const SINCE_LABEL = {30:'近 1 个月更新', 180:'近半年更新', 365:'近 1 年更新'};
const LANG_COLOR = {JavaScript:'#f1e05a',TypeScript:'#3178c6',Python:'#3572A5',Rust:'#dea584',Go:'#00ADD8',Java:'#b07219','C++':'#f34b7d',C:'#555555','C#':'#178600',Ruby:'#701516',PHP:'#4F5D95',Swift:'#F05138',Kotlin:'#A97BFF',Dart:'#00B4AB',Shell:'#89e051',HTML:'#e34c26',CSS:'#563d7c',Vue:'#41b883',Lua:'#000080',Scala:'#c22d40',Zig:'#ec915c',Markdown:'#083fa1',Jupyter:'#DA5B0B'};

const state = {
  view:'total', sub:'all', cat:'all',
  q:'', lang:'', minStars:0, since:0, sort:'stars',
  visible:PAGE_SIZE,
  tag:'', tagMode:'topic', onlineRows:[], onlineStatus:'', onlineClass:'info',
  onlinePage:1, hasMoreOnline:false, busy:false,
  refreshRows:[]
};
let searchSeq = 0;
let searchAbort = null;
let qTimer = null;

/* ---------- data helpers ---------- */
function allRows(){
  const map = new Map();
  const push = arr => (arr||[]).forEach(r => { if(r && r.n && !map.has(r.n)) map.set(r.n, r); });
  push(DATA.repos);
  Object.values(DATA.trending||{}).forEach(push);
  Object.values(DATA.newstars||{}).forEach(push);
  return [...map.values()];
}
let ALLROWS = allRows();

function classify(r){
  const hay = ((r.n||'')+' '+(r.d||'')+' '+(r.t||[]).join(' ')).toLowerCase();
  return (DATA.rules||[]).filter(rule => rule.k.some(k => hay.indexOf(k) >= 0)).map(rule => rule.id);
}
function catsOf(r){ return (r.cats && r.cats.length) ? r.cats : classify(r); }
function catName(id){ const c = DATA.cats.find(x => x.id === id); return c ? c.name : id; }

/* ---------- progressive chunk loading (sharded builds only) ---------- */
const CHUNK_SIZE = 250;
function loadedChunkCount(){ return (window.REPOS_CHUNKS || []).filter(Boolean).length; }
function ensureChunk(i){
  return new Promise(resolve => {
    if (!SHARDED || i < loadedChunkCount()){ resolve(); return; }
    const s = document.createElement('script');
    s.src = 'data/repos-' + i + '.js';
    s.onload = () => {
      DATA.repos = (window.REPOS_CHUNKS || []).filter(Boolean).flat();
      ALLROWS = allRows();
      resolve();
    };
    s.onerror = () => { console.warn('Starscope: chunk load failed', i); resolve(); };
    document.head.appendChild(s);
  });
}
async function ensureReposThrough(index){
  if (!SHARDED) return;
  const need = Math.floor(index / CHUNK_SIZE) + 1;
  for (let i = loadedChunkCount(); i < need; i++) await ensureChunk(i);
}
async function ensureAllChunks(){
  let guard = 0;
  while (guard++ < 64){
    const i = loadedChunkCount();
    const prev = window.REPOS_CHUNKS[i - 1];
    if (prev && prev.length < CHUNK_SIZE) break;   // previous chunk was partial -> end of data
    await ensureChunk(i);
    if (i >= loadedChunkCount()) break;            // nothing new loaded (e.g. error) -> stop
  }
}
function matchLocalTag(r){
  const t = state.tag.trim().toLowerCase();
  if(!t) return false;
  if(state.tagMode === 'topic') return (r.t||[]).some(x => String(x).toLowerCase() === t);
  return ((r.n||'')+' '+(r.d||'')+' '+(r.t||[]).join(' ')).toLowerCase().indexOf(t) >= 0;
}
function tagResults(){
  if(!state.tag) return [];
  const map = new Map();
  ALLROWS.filter(matchLocalTag).forEach(r => map.set(r.n, Object.assign({}, r, {_src:'local'})));
  (state.onlineRows||[]).forEach(r => { if(!map.has(r.n)) map.set(r.n, Object.assign({}, r, {_src:'online'})); });
  return [...map.values()];
}
function currentRows(){
  if(state.view === 'tags') return tagResults();
  if(state.view === 'rising') return DATA.trending[state.sub] || [];
  if(state.view === 'new') return DATA.newstars[state.sub] || [];
  if(!state.refreshRows.length) return DATA.repos;
  const merged = new Map();
  DATA.repos.forEach(r => merged.set(r.n, r));
  state.refreshRows.forEach(r => { if(!merged.has(r.n)) merged.set(r.n, r); });
  return [...merged.values()];
}
function daysAgo(n){ return new Date(Date.now() - n*86400000).toISOString().slice(0,10); }
function sortKey(){ return state.sort === 'updated' ? 'pushed' : state.sort; }
function filtered(){
  const kw = state.q.trim().toLowerCase();
  const sinceDate = state.since ? daysAgo(state.since) : '';
  let arr = currentRows().slice();
  if(state.cat !== 'all') arr = arr.filter(r => catsOf(r).indexOf(state.cat) >= 0);
  arr = arr.filter(r => {
    if(state.lang && r.l !== state.lang) return false;
    if(state.minStars && (r.s||0) < state.minStars) return false;
    if(sinceDate && (r.p||'') < sinceDate) return false;
    if(kw && ((r.n||'')+' '+(r.d||'')+' '+(r.t||[]).join(' ')).toLowerCase().indexOf(kw) < 0) return false;
    return true;
  });
  const k = sortKey();
  arr.sort((a,b) => (k === 'pushed' || k === 'created')
    ? String(b[k]||'').localeCompare(String(a[k]||''))
    : (Number(b[k])||0) - (Number(a[k])||0));
  return arr;
}
function activeFilters(){
  const out = [];
  if(state.cat !== 'all') out.push({k:'cat', label:'分类：'+catName(state.cat)});
  if(state.q.trim()) out.push({k:'q', label:'关键词：'+state.q.trim()});
  if(state.lang) out.push({k:'lang', label:'语言：'+state.lang});
  if(state.minStars) out.push({k:'minStars', label:'≥ '+num(state.minStars)+' 星'});
  if(state.since) out.push({k:'since', label:SINCE_LABEL[state.since] || '更新时限'});
  if(state.view === 'tags' && state.tag) out.push({k:'tag', label:'标签：#'+state.tag});
  if(state.refreshRows.length) out.push({k:'refresh', label:'在线补充结果'});
  return out;
}

/* ---------- sidebar (present in every view) ---------- */
function buildRail(){
  const active = document.activeElement;
  const focusCat = active && active.dataset ? active.dataset.cat : null;
  const focusTag = active && active.dataset ? active.dataset.tag : null;
  const rows = currentRows();
  const counts = {};
  DATA.cats.forEach(c => { if(c.id !== 'all') counts[c.id] = 0; });
  if(state.view === 'total' && DATA.idx && DATA.idx.counts){
    DATA.cats.forEach(c => { if(c.id !== 'all') counts[c.id] = DATA.idx.counts[c.id] || 0; });
  } else {
    rows.forEach(r => catsOf(r).forEach(id => { if(id in counts) counts[id] += 1; }));
  }
  const allN = (state.view === 'total' && DATA.idx) ? (DATA.idx.total || rows.length) : rows.length;
  const items = [{id:'all', name:'全部项目', n:allN}]
    .concat(DATA.cats.filter(c => c.id !== 'all').map(c => ({id:c.id, name:c.name, n:counts[c.id]||0})));
  const list = items.map(x =>
    '<button class="side-item'+(x.n===0?' is-zero':'')+'" type="button" data-cat="'+esc(x.id)+'" aria-pressed="'+(x.id===state.cat)+'">'
    +'<span>'+esc(x.name)+'</span><span class="side-item__count">'+x.n+'</span></button>').join('');
  const mini = (DATA.topics||[]).slice(0,18).map(t =>
    '<button class="chip" type="button" data-tag="'+esc(t.t)+'">#'+esc(t.t)+'</button>').join('');
  $('rail').innerHTML =
    '<div class="rail__title"><span>按分类浏览</span><span>'+rows.length+' 项</span></div>'
    + '<div class="rail__list">'+list+'</div>'
    + '<div class="rail__divider"></div>'
    + '<div class="rail__title"><span>热门标签</span><span>点击探索</span></div>'
    + '<div class="rail__tags">'+mini+'</div>'
    + '<div class="rail__cta"><b>没找到想要的？</b><p>快照只收录有限项目，用标签顺着找 GitHub 上更多同类项目。</p>'
    + '<button class="btn btn--ghost btn--sm" type="button" data-act="tags">打开标签探索 →</button></div>';
  $('rail').querySelectorAll('[data-cat]').forEach(el => el.onclick = () => {
    state.cat = el.dataset.cat; writeUrl(); updateRailActive(); buildSub(); render();
  });
  $('rail').querySelectorAll('[data-tag]').forEach(el => el.onclick = () => openTag(el.dataset.tag));
  $('rail').querySelectorAll('[data-act]').forEach(el => el.onclick = () => { if(el.dataset.act === 'tags') showView('tags', true); });
  if(focusCat || focusTag){
    const selector = focusCat ? '[data-cat="'+focusCat+'"]' : '[data-tag="'+focusTag+'"]';
    const again = $('rail').querySelector(selector);
    if(again && again.focus) again.focus({preventScroll:true});
  }
}
function updateRailActive(){
  $('rail').querySelectorAll('[data-cat]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.cat === state.cat)));
}

/* ---------- sub selector / toolbar ---------- */
function buildSub(){
  let h = '';
  if(state.view === 'rising'){
    h = '<span class="subbar__label">时间窗口</span>' + DATA.periods.map(p =>
      '<button class="seg" type="button" data-sub="'+esc(p.id)+'" aria-pressed="'+(p.id===state.sub)+'">'+esc(p.name)+'</button>').join('')
      + '<span class="subbar__label">共 '+(DATA.trending[state.sub]||[]).length+' 条真实增星数据</span>';
  } else if(state.view === 'new'){
    h = '<span class="subbar__label">创建窗口</span>' + DATA.windows.map(w =>
      '<button class="seg" type="button" data-sub="'+esc(w.id)+'" aria-pressed="'+(w.id===state.sub)+'">'+esc(w.name)+'</button>').join('');
  } else if(state.view === 'tags'){
    h = '<span class="subbar__label">标签探索</span>' + (state.tag
      ? '<button class="seg" type="button" data-act="tagchip" aria-pressed="true">#'+esc(state.tag)+'</button>'
        + '<button class="seg" type="button" data-act="tagclear">清空标签</button>'
      : '<span class="subbar__label">在下方标签云点一个标签，或输入标签后回车</span>');
  } else {
    h = '<span class="subbar__label">当前分类：'+(state.cat==='all'?'全部项目':esc(catName(state.cat)))+'</span>'
      + (state.cat!=='all' ? '<button class="seg" type="button" data-act="catclear">清除分类</button>' : '')
      + '<span class="subbar__label">分类在左侧，切换视角不会消失</span>';
  }
  $('subbar').innerHTML = h;
  $('subbar').querySelectorAll('[data-sub]').forEach(el => el.onclick = () => {
    state.sub = el.dataset.sub; writeUrl(true); buildSub(); buildRail(); render();
  });
  $('subbar').querySelectorAll('[data-act]').forEach(el => el.onclick = () => {
    if(el.dataset.act === 'catclear'){ clearFilter('cat'); }
    if(el.dataset.act === 'tagclear') clearTag();
  });
}
function buildSort(){
  $('sort').innerHTML = SORTS[state.view].map(o => '<option value="'+o[0]+'">'+o[1]+'</option>').join('');
  $('sort').value = state.sort;
}
function buildLangs(){
  const langs = (DATA.langs && DATA.langs.length)
    ? DATA.langs.slice()
    : uniq(ALLROWS.concat(state.refreshRows).map(r => r.l).filter(Boolean)).sort();
  $('lang').innerHTML = '<option value="">全部语言</option>'
    + langs.map(l => '<option value="'+esc(l)+'">'+esc(l)+'</option>').join('');
  $('lang').value = state.lang;
}
function syncChrome(){
  document.querySelectorAll('#tabs [role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  $('hint').textContent = HINTS[state.view];
  $('tagpanel').hidden = state.view !== 'tags';
  $('q').placeholder = state.view === 'tags' ? '在当前标签结果中筛选名称、简介…' : '搜索项目名、简介、标签…';
  $('refreshBtn').textContent = {
    total:'在线补充此分类', rising:'查看数据来源', new:'查看数据来源', tags:'重新查询该标签'
  }[state.view];
  document.title = VIEWNAME[state.view] + ' · Starscope';
}

/* ---------- rendering ---------- */
function periodLabel(id){ const p = DATA.periods.find(x => x.id === id); return p ? p.label : ''; }
function badges(r){
  const out = [];
  if(r.lic && r.lic !== 'NOASSERTION') out.push('<span class="badge badge--lic">'+esc(r.lic)+'</span>');
  if(state.view === 'rising') out.push('<span class="badge badge--gain">+'+int(r.gain)+' '+esc(periodLabel(state.sub))+'</span>',
    '<span class="badge badge--ratio">涨幅 '+(r.ratio||0)+'%</span>');
  if(state.view === 'new') out.push('<span class="badge badge--gain">+'+r.spd+' 星/天</span>',
    '<span class="badge badge--age">'+(r.age||0)+' 天 · 创建 '+esc(r.c)+'</span>');
  if(state.view === 'tags') out.push(r._src === 'online'
    ? '<span class="badge badge--online">在线发现</span>'
    : '<span class="badge badge--local">快照</span>');
  if(r._src === 'online' && state.view === 'total') out.push('<span class="badge badge--online">在线补充</span>');
  return out.join('');
}
function chipsHtml(r){
  const cats = catsOf(r).slice(0,2).map(c => '<button class="chip chip--cat" type="button" data-cat="'+esc(c)+'">'+esc(catName(c))+'</button>').join('');
  const tags = (r.t||[]).slice(0,6).map(t => '<button class="chip" type="button" data-tag="'+esc(t)+'">#'+esc(t)+'</button>').join('');
  return cats || tags ? '<div class="repo__chips">'+cats+tags+'</div>' : '';
}
function rowHtml(r, i){
  const stats = [];
  if(r.l) stats.push('<span><i class="lang-dot" style="background:'+(LANG_COLOR[r.l]||'#8b949e')+'" aria-hidden="true"></i>'+esc(r.l)+'</span>');
  stats.push('<span>★ '+num(r.s)+'</span>');
  if(r.f) stats.push('<span>Fork '+num(r.f)+'</span>');
  if(r.p) stats.push('<span>更新 '+esc(r.p)+'</span>');
  if(r.c && state.view !== 'new') stats.push('<span>创建 '+esc(r.c)+'</span>');
  if(r.i) stats.push('<span>issue '+num(r.i)+'</span>');
  return '<article class="repo">'
    + '<div class="repo__rank" aria-label="第 '+(i+1)+' 条">'+(i+1)+'</div>'
    + '<div class="repo__body"><h3 class="repo__title"><a href="'+esc(r.u || ('https://github.com/' + r.n))+'" target="_blank" rel="noopener">'+esc(r.n)+'</a>'+badges(r)+'</h3>'
    + (r.d ? '<p class="repo__desc">'+esc(r.d)+'</p>' : '')
    + chipsHtml(r)
    + '<div class="repo__stats">'+stats.map(s => s).join('')+'</div></div></article>';
}
function emptyHtml(msg){
  const f = activeFilters();
  return '<div class="empty"><p class="empty__title">'+esc(msg)+'</p>'
    + '<p class="empty__body">可以放宽筛选条件、切换目录视角，或者顺着标签去 GitHub 找更多同类项目。</p>'
    + (f.length ? '<p class="empty__body">当前生效：'+esc(f.map(x => x.label).join(' · '))+'</p>' : '')
    + '<div class="empty__actions"><button class="btn btn--ghost btn--sm" type="button" data-act="reset">清空筛选</button>'
    + '<button class="btn btn--primary btn--sm" type="button" data-act="tags">用标签探索 →</button></div></div>';
}
function renderFilterbar(){
  const f = activeFilters();
  $('filterbar').innerHTML = f.length
    ? '<span class="filterbar__label">生效筛选</span>'
      + f.map(x => '<span class="filter-chip">'+esc(x.label)
          + '<button type="button" data-clear="'+esc(x.k)+'" aria-label="移除 '+esc(x.label)+'">×</button></span>').join('')
      + '<button class="filterbar__clear" type="button" data-clear="all">清空全部</button>'
    : '';
}
function renderLoadmore(total, shown){
  const box = $('loadmore');
  if(shown >= total){ box.hidden = true; return; }
  box.hidden = false;
  const cov = DATA.coverage || {};
  $('loadmoreInfo').textContent = '已显示 ' + shown + ' / 共 ' + total
    + ' 个 · 滚动到底自动继续加载' + (cov.unique ? ' · 本快照共收录 ' + int(cov.unique) + ' 个项目' : '');
  $('showAllBtn').textContent = '显示全部 ' + total + ' 个';
}
function render(resetVisible){
  if(resetVisible !== false) state.visible = PAGE_SIZE;
  updateRailActive();
  if(state.view === 'tags') renderTagPanel();
  renderFilterbar();
  const arr = filtered();
  const sortText = ($('sort').selectedOptions[0] || {}).text || '默认';
  const cov = DATA.coverage || {};
  const shown = arr.slice(0, state.visible);
  $('resultInfo').innerHTML = '<b>'+esc(VIEWNAME[state.view])+'</b> · 共 <b>'+arr.length+'</b> 个项目'
    + (shown.length < arr.length ? '，已显示 <b>'+shown.length+'</b> 个' : '，已全部显示')
    + ' · 排序：<b>'+esc(sortText)+'</b>'
    + (state.cat !== 'all' ? ' · 分类 <b>'+esc(catName(state.cat))+'</b>' : '')
    + (cov.unique ? ' · 快照收录 '+int(cov.unique)+' 个' : '');
  if(state.view === 'tags' && !state.tag){
    $('list').innerHTML = '<div class="empty"><p class="empty__title">从标签出发，找目录之外的项目</p>'
      + '<p class="empty__body">点任意项目卡片上的 #标签，或在上方标签云里选一个；也可以直接输入标签，例如 rss、self-hosted、cli。</p>'
      + '<div class="empty__actions"><button class="btn btn--ghost btn--sm" type="button" data-act="showcloud">查看全部标签</button></div></div>';
    $('loadmore').hidden = true;
    return;
  }
  $('list').innerHTML = shown.length ? shown.map(rowHtml).join('') : emptyHtml('没有符合条件的项目');
  renderLoadmore(arr.length, shown.length);
}
function appendNow(extra){
  const arr = filtered();
  const from = state.visible;
  const to = extra === Infinity ? arr.length : Math.min(arr.length, from + extra);
  if(to <= from) return;
  state.visible = to;
  $('list').insertAdjacentHTML('beforeend', arr.slice(from, to).map((r,i) => rowHtml(r, from+i)).join(''));
  renderLoadmore(arr.length, to);
}
function appendRows(extra){
  const arr = filtered();
  const to = extra === Infinity ? arr.length : Math.min(arr.length, state.visible + extra);
  if(to <= state.visible) return;
  // Load any chunk the new range needs first; otherwise append synchronously so
  // immediate clicks stay responsive (and headless checks stay synchronous).
  if(SHARDED && to - 1 >= loadedChunkCount() * CHUNK_SIZE){
    ensureReposThrough(to - 1).then(() => appendNow(extra));
    return;
  }
  appendNow(extra);
}
function showAll(){
  const finish = () => {
    if(state.visible >= filtered().length) return;
    appendNow(200);
    if(typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    else setTimeout(finish, 0);
  };
  if(SHARDED) ensureAllChunks().then(finish);
  else finish();
}
function setupSentinel(){
  if(!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(entries => {
    if(entries.some(e => e.isIntersecting) && !$('loadmore').hidden) appendRows(PAGE_SIZE);
  }, {rootMargin:'400px'});
  io.observe($('listSentinel'));
}

/* ---------- tag explorer ---------- */
function renderTagPanel(){
  $('tagMode').value = state.tagMode;
  const kw = ($('cloudFilter').value || '').trim().toLowerCase();
  const list = (DATA.topics||[]).filter(x => !kw || x.t.indexOf(kw) >= 0).slice(0,60);
  const max = list.length ? list[0].n : 1;
  $('cloud').innerHTML = '<p class="cloud__hint">标签云 · 来自快照内 '+(DATA.topics||[]).length+' 个标签'
    + (kw ? '（按「'+esc(kw)+'」过滤）' : '') + '，点击即搜索</p>'
    + (list.length ? list.map(x => {
        const size = (11.5 + 3 * Math.sqrt(x.n / max)).toFixed(1);
        return '<button type="button" data-tag="'+esc(x.t)+'" style="font-size:'+size+'px" aria-pressed="'+(state.tag===x.t)+'">#'
          + esc(x.t) + ' <span>'+x.n+'</span></button>';
      }).join('') : '<p class="cloud__hint">没有匹配的标签，可以直接回车按输入的词搜索 GitHub。</p>');
  $('cloud').querySelectorAll('[data-tag]').forEach(el => el.onclick = () => openTag(el.dataset.tag));

  const counts = {};
  tagResults().forEach(r => (r.t||[]).forEach(t => {
    const k = String(t).toLowerCase();
    if(k !== state.tag.toLowerCase()) counts[k] = (counts[k]||0) + 1;
  }));
  const rel = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,16);
  $('related').innerHTML = rel.length
    ? '<span class="related__label">相关标签</span>' + rel.map(([t,n]) => '<button class="chip" type="button" data-tag="'+esc(t)+'">#'+esc(t)+' '+n+'</button>').join('')
    : '';
  $('related').querySelectorAll('[data-tag]').forEach(el => el.onclick = () => openTag(el.dataset.tag));

  $('tagStatus').className = 'status status--' + state.onlineClass;
  $('tagStatus').hidden = !state.onlineStatus;
  $('tagStatus').textContent = state.onlineStatus;
  $('moreOnlineBtn').hidden = !(state.tag && state.hasMoreOnline && !state.busy);
}
function clearTag(){
  state.tag = ''; state.onlineRows = []; state.onlineStatus = ''; state.hasMoreOnline = false;
  state.onlinePage = 1;
  $('tagInput').value = ''; writeUrl();
  buildRail(); buildSub(); render();
}
function buildQuery(){
  const t = state.tag.trim();
  let q;
  if(state.tagMode === 'topic') q = 'topic:' + t + ' archived:false';
  else if(state.tagMode === 'keyword') q = t + ' in:name,description archived:false';
  else q = t + ' in:readme archived:false';
  if(state.minStars) q += ' stars:>' + state.minStars;
  return q;
}
function normalizeOnline(it){
  return {
    n:it.full_name, d:(it.description||'').slice(0,240), s:it.stargazers_count||0,
    f:it.forks_count||0, l:it.language||'', t:(it.topics||[]).slice(0,8),
    p:(it.pushed_at||'').slice(0,10), c:(it.created_at||'').slice(0,10),
    lic:((it.license||{}).spdx_id||''), i:it.open_issues_count||0,
    u:it.html_url || ('https://github.com/'+it.full_name), cats:[]
  };
}
async function onlineSearch(silent, page){
  if(!state.tag) return;
  const seq = ++searchSeq;
  if(searchAbort){ try{ searchAbort.abort(); }catch(e){} }
  const ctrl = new AbortController();
  searchAbort = ctrl;
  const p = page || 1;
  const apiSort = {stars:'stars', updated:'updated', created:'created'}[state.sort] || 'stars';
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(buildQuery())
    + '&sort=' + apiSort + '&order=desc&per_page=' + ONLINE_PAGE_SIZE + '&page=' + p;
  state.busy = true;
  if(!silent){
    state.onlineStatus = '正在向 GitHub 查询更多「'+state.tag+'」项目…';
    state.onlineClass = 'info'; renderTagPanel();
  }
  try{
    const res = await fetch(url, {headers:{'Accept':'application/vnd.github+json'}, signal:ctrl.signal});
    if(seq !== searchSeq) return;
    const remain = res.headers.get('X-RateLimit-Remaining');
    if(!res.ok){
      let why = 'HTTP ' + res.status;
      if(res.status === 403 || res.status === 429){
        const reset = res.headers.get('X-RateLimit-Reset');
        const when = reset ? new Date(Number(reset)*1000).toLocaleTimeString('zh-CN') : '稍后';
        why += ' · 触发匿名限流（约 10 次/分钟），约 '+when+' 恢复，稍后重试即可';
      }
      throw new Error(why);
    }
    const d = await res.json();
    const rows = (d.items||[]).filter(x => x && x.full_name).map(normalizeOnline);
    if(p > 1){
      const seen = new Set(state.onlineRows.map(r => r.n));
      rows.forEach(r => { if(!seen.has(r.n)){ state.onlineRows.push(r); seen.add(r.n); } });
      state.visible += rows.length;
    } else {
      state.onlineRows = rows;
    }
    state.onlinePage = p;
    state.hasMoreOnline = rows.length === ONLINE_PAGE_SIZE && p < ONLINE_MAX_PAGES;
    const fresh = state.onlineRows.filter(r => !ALLROWS.some(a => a.n === r.n)).length;
    state.onlineStatus = 'GitHub 返回累计 '+state.onlineRows.length+' 个项目，其中 '+fresh
      + ' 个是快照之外的项目' + (remain ? ' · 本次剩余配额 '+remain : '')
      + (state.hasMoreOnline ? ' · 可继续加载下一页' : ' · 已到本次查询上限');
    state.onlineClass = 'info';
  }catch(e){
    if(e.name === 'AbortError' || seq !== searchSeq) return;
    state.onlineStatus = '在线查询失败：' + e.message + '；快照内的结果仍可正常浏览。';
    state.onlineClass = 'err';
  }finally{
    if(seq === searchSeq){
      state.busy = false;
      if(searchAbort === ctrl) searchAbort = null;
      buildRail(); render(p > 1 ? false : true);
    }
  }
}
function openTag(tag){
  if(state.view !== 'tags') switchView('tags');
  state.tag = String(tag).toLowerCase().slice(0,64);
  state.onlineRows = []; state.onlineStatus = ''; state.hasMoreOnline = false; state.onlinePage = 1;
  $('tagInput').value = state.tag;
  writeUrl(true);
  buildRail(); buildSub(); render();
  if($('tagInput').focus) $('tagInput').focus({preventScroll:true});
  onlineSearch();
}
function runTagSearch(){
  const v = $('tagInput').value.trim();
  if(!v){ clearTag(); return; }
  state.tagMode = $('tagMode').value;
  openTag(v);
}
function switchView(v){
  state.view = v;
  state.sub = SUBDEFAULT[v];
  state.sort = SORTS[v][0][0];
  if(v !== 'tags'){ state.tag = ''; state.onlineRows = []; state.onlineStatus = ''; state.hasMoreOnline = false; }
  state.refreshRows = [];
  $('onlineMsg').textContent = '';
  writeUrl(true);
  syncChrome(); buildSub(); buildSort(); buildLangs(); buildRail(); render();
  const carried = activeFilters().filter(x => x.k !== 'cat').length;
  if(carried && filtered().length < 20){
    $('onlineMsg').textContent = '上一视角的筛选条件仍生效，结果较少；点上方筛选标签或「清空全部」可放宽';
  }
}
function showView(v, scroll){
  switchView(v);
  if(scroll){
    const el = $('explore');
    if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'start'});
  }
}

/* ---------- data actions / share ---------- */
async function refreshCatalogue(){
  const cat = DATA.cats.find(c => c.id === state.cat) || DATA.cats[0];
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(cat.q)
    + '&sort=stars&order=desc&per_page=' + ONLINE_PAGE_SIZE;
  const btn = $('refreshBtn'); btn.disabled = true;
  $('onlineMsg').textContent = '正在从 GitHub 查询「'+cat.name+'」…';
  try{
    const res = await fetch(url, {headers:{'Accept':'application/vnd.github+json'}});
    if(!res.ok) throw new Error('HTTP '+res.status+(res.status===403 ? '（匿名限流约 10 次/分钟，稍后再试）' : ''));
    const d = await res.json();
    state.refreshRows = (d.items||[]).filter(x => x && x.full_name)
      .map(x => Object.assign(normalizeOnline(x), {_src:'online'}));
    $('onlineMsg').textContent = '已在线补充 '+state.refreshRows.length+' 个项目，仅本次会话有效，切换视角即清除';
    buildLangs(); buildRail(); render();
  }catch(e){ $('onlineMsg').textContent = '在线补充失败：'+e.message+'，内嵌快照不受影响。'; }
  finally{ btn.disabled = false; }
}
function openDataAction(){
  if(state.view === 'tags'){
    if(state.tag) onlineSearch(); else $('onlineMsg').textContent = '先选一个标签再查询。';
    return;
  }
  if(state.view === 'total'){ refreshCatalogue(); return; }
  const el = $('legal');
  if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth', block:'start'});
}
async function copyLink(){
  writeUrl();
  try{
    await navigator.clipboard.writeText(location.href);
    $('onlineMsg').textContent = '链接已复制，可直接分享这个视图';
  }catch(e){
    $('onlineMsg').textContent = '当前环境不支持自动复制，地址栏里的链接已包含视图参数';
  }
}

/* ---------- chrome: theme, menu, hero, routing ---------- */
function applyTheme(t){
  document.documentElement.dataset.theme = t;
  $('themeToggle').textContent = t === 'dark' ? '◐' : '◑';
  $('themeToggle').setAttribute('aria-label', t === 'dark' ? '切换到浅色主题' : '切换到深色主题');
  try{ localStorage.setItem('starscope-theme', t); }catch(e){}
}
function setupTheme(){
  let saved = 'dark';
  try{ saved = localStorage.getItem('starscope-theme') || 'dark'; }catch(e){}
  applyTheme(saved);
  $('themeToggle').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}
function setupMenu(){
  const toggle = $('navToggle'), menu = $('navMenu');
  const setOpen = open => {
    menu.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
  };
  toggle.onclick = () => setOpen(menu.dataset.open !== 'true');
  menu.querySelectorAll('a').forEach(a => a.onclick = () => setOpen(false));
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && menu.dataset.open === 'true'){ setOpen(false); toggle.focus(); } });
  document.querySelectorAll('.nav__links a, .mobile-menu a').forEach(a => {
    a.addEventListener('click', () => document.querySelectorAll('.nav__links a').forEach(x => x.removeAttribute('aria-current')));
  });
}
function setupHeader(){
  const header = $('siteHeader');
  const onScroll = () => { header.dataset.scrolled = String(window.scrollY > 8); };
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();
}
function setupHero(){
  $('kpiRepos').textContent = int((DATA.idx && DATA.idx.total) || DATA.repos.length);
  $('kpiTrending').textContent = int(Object.values(DATA.trending||{}).reduce((a,rows) => a + rows.length, 0));
  $('kpiTopics').textContent = int((DATA.topics||[]).length);
  $('kpiCats').textContent = int(DATA.cats.filter(c => c.id !== 'all').length);
  $('snapshotStatus').textContent = '快照 ' + DATA.generated;
  const gains = (DATA.trending.daily||[]).slice(0,24).map(r => r.gain);
  const peak = Math.max.apply(null, gains.concat([1]));
  $('heroBarcode').innerHTML = gains.map(g =>
    '<span style="--h:'+Math.max(6, Math.round(g/peak*100))+'%"></span>').join('');
  $('heroPeak').textContent = '峰值 +' + int(peak) + ' / 今日';
  const cov = DATA.coverage || {};
  const unique = cov.unique || ALLROWS.length;
  if($('caveatCount')) $('caveatCount').textContent = int(unique);
  if($('legalCoverage')) $('legalCoverage').textContent =
    '累计与新星数据来自 GitHub Search API，涨势数据来自 GitHub Trending 页面的日 / 周 / 月新增星标。'
    + '本次快照 ' + DATA.generated + '（北京时间）生成，共收录 ' + int(unique) + ' 个去重项目；'
    + '每类最多收录 ' + int(cov.perCategory || 200) + ' 条，官方单次查询上限 ' + int(cov.searchCap || 1000) + ' 条结果。';
}
function readUrl(){
  try{
    const p = new URLSearchParams(location.search);
    const v = p.get('view');
    if(v && VIEWNAME[v]){ state.view = v; state.sub = SUBDEFAULT[v]; state.sort = SORTS[v][0][0]; }
    const sub = p.get('sub');
    if(sub){
      const allowed = state.view === 'rising' ? (DATA.periods||[]).map(x => x.id)
                    : state.view === 'new' ? (DATA.windows||[]).map(x => x.id) : [];
      if(allowed.indexOf(sub) >= 0) state.sub = sub;
    }
    const cat = p.get('cat');
    if(cat && DATA.cats.some(c => c.id === cat)) state.cat = cat;
    const tag = p.get('tag');
    if(tag) state.tag = String(tag).toLowerCase().slice(0,64);
  }catch(e){}
}
function writeUrl(push){
  try{
    const p = new URLSearchParams();
    p.set('view', state.view);
    if(state.sub && state.view !== 'total') p.set('sub', state.sub);
    if(state.cat !== 'all') p.set('cat', state.cat);
    if(state.view === 'tags' && state.tag) p.set('tag', state.tag);
    const url = location.pathname + '?' + p.toString() + location.hash;
    if(url === location.pathname + location.search + location.hash) return;
    if(push && history.pushState) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }catch(e){}
}
function applyUrl(){
  state.view = 'total'; state.sub = SUBDEFAULT.total; state.sort = SORTS.total[0][0];
  state.cat = 'all'; state.tag = ''; state.refreshRows = [];
  state.onlineRows = []; state.onlineStatus = ''; state.hasMoreOnline = false; state.onlinePage = 1;
  readUrl();
  $('tagInput').value = state.tag;
  $('onlineMsg').textContent = '';
  syncChrome(); buildSub(); buildSort(); buildLangs(); buildRail(); render();
  if(state.view === 'tags' && state.tag) onlineSearch();
}
function setupShortcuts(){
  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if((e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))
       && tag !== 'input' && tag !== 'textarea' && tag !== 'select'){
      e.preventDefault(); $('q').focus();
    }
  });
  $('tabs').addEventListener('keydown', e => {
    if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const views = ['total','rising','new','tags'];
    const i = views.indexOf(state.view);
    const next = views[(i + (e.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length];
    e.preventDefault(); switchView(next);
    const tab = document.querySelector('#tabs [data-view="'+next+'"]');
    if(tab && tab.focus) tab.focus();
  });
}
function clearFilter(k){
  if(k === 'all'){ resetFilters(); return; }
  if(k === 'cat') state.cat = 'all';
  else if(k === 'q'){ state.q = ''; $('q').value = ''; }
  else if(k === 'lang'){ state.lang = ''; $('lang').value = ''; }
  else if(k === 'minStars'){ state.minStars = 0; $('minStars').value = '0'; }
  else if(k === 'since'){ state.since = 0; $('since').value = '0'; }
  else if(k === 'tag'){ clearTag(); return; }
  else if(k === 'refresh') state.refreshRows = [];
  writeUrl(); updateRailActive(); buildSub(); buildLangs(); render();
}
function resetFilters(){
  clearTimeout(qTimer);
  state.q = ''; state.lang = ''; state.minStars = 0; state.since = 0;
  state.cat = 'all'; state.refreshRows = [];
  $('q').value = ''; $('lang').value = ''; $('minStars').value = '0'; $('since').value = '0';
  writeUrl(); updateRailActive(); buildSub(); buildLangs(); render();
}

/* ---------- wiring ---------- */
$('q').oninput = e => {
  clearTimeout(qTimer);
  const v = e.target.value;
  qTimer = setTimeout(() => { state.q = v; render(); }, 120);
};
$('lang').onchange = e => { state.lang = e.target.value; render(); };
$('minStars').onchange = e => { state.minStars = +e.target.value; render(); };
$('since').onchange = e => { state.since = +e.target.value; render(); };
$('sort').onchange = e => {
  state.sort = e.target.value; render();
  if(state.view === 'tags' && state.tag) onlineSearch(true);
};
$('filterbar').addEventListener('click', e => {
  const b = e.target.closest('[data-clear]');
  if(b) clearFilter(b.dataset.clear);
});
$('loadmoreBtn').onclick = () => appendRows(PAGE_SIZE);
$('showAllBtn').onclick = showAll;
$('moreOnlineBtn').onclick = () => onlineSearch(true, state.onlinePage + 1);
$('refreshBtn').onclick = openDataAction;
$('copyLinkBtn').onclick = copyLink;
$('findMore').onclick = () => showView('tags', true);
$('navTags').onclick = () => showView('tags', true);
$('ctaTags').onclick = () => showView('tags', true);
$('heroRising').onclick = () => showView('rising', true);
$('heroExplore').onclick = () => { const el = $('explore'); if(el && el.scrollIntoView) el.scrollIntoView({behavior:'smooth'}); };
$('tagGo').onclick = runTagSearch;
$('tagInput').onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); runTagSearch(); } };
$('cloudFilter').oninput = () => renderTagPanel();
$('tagMode').onchange = e => { state.tagMode = e.target.value; if(state.tag) openTag(state.tag); };
document.querySelectorAll('#tabs [role="tab"]').forEach(b => b.onclick = () => switchView(b.dataset.view));
document.querySelectorAll('[data-view]').forEach(el => {
  if(el.closest('#tabs')) return;
  el.addEventListener('click', () => switchView(el.dataset.view));
});
$('list').addEventListener('click', e => {
  const t = e.target.closest('[data-tag]');
  if(t){ openTag(t.dataset.tag); return; }
  const c = e.target.closest('[data-cat]');
  if(c){ state.cat = c.dataset.cat; writeUrl(); updateRailActive(); buildSub(); render(); return; }
  const a = e.target.closest('[data-act]');
  if(!a) return;
  const act = a.dataset.act;
  if(act === 'reset') resetFilters();
  if(act === 'tags') showView('tags', true);
  if(act === 'showcloud') $('cloudFilter').focus();
});
window.addEventListener('popstate', applyUrl);

/* ---------- boot ---------- */
readUrl();
setupTheme();
setupMenu();
setupHeader();
setupHero();
setupShortcuts();
setupSentinel();
$('tagInput').value = state.tag;
syncChrome(); buildSub(); buildSort(); buildLangs(); buildRail(); render();
if(state.view === 'tags' && state.tag) onlineSearch();

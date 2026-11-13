/* Real-browser checks via headless Chrome (website-ui-designer Stage 5).
 * Verifies four breakpoints, no horizontal scroll, ARIA/semantics, view
 * switching, theme override and absence of runtime errors.
 *   node tests/browser-check.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.dirname(__dirname);
const site = path.join(root, 'site');
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chrome = candidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!chrome) { console.log('SKIP: no Chrome/Edge found (set CHROME_PATH)'); process.exit(0); }

const index = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const headProbe = '<script>window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message))});</script>';
const bodyProbe = `<script>
window.addEventListener('load',function(){setTimeout(function(){
  var d=document,iw=innerWidth,res={};
  function n(sel){return d.querySelectorAll(sel).length}
  res.iw=iw;res.sw=d.documentElement.scrollWidth;
  res.off=[].slice.call(d.querySelectorAll('*')).filter(function(e){return e.getBoundingClientRect().right>iw+1}).slice(0,8).map(function(e){return e.tagName+'.'+String(e.className||'').slice(0,40)});
  res.h1=n('h1');res.rows=n('#list .repo');res.cats=n('#rail [data-cat]');
  res.heroBars=n('#heroBarcode span');
  res.labels=[].slice.call(d.querySelectorAll('input,select')).every(function(el){return (el.labels&&el.labels.length)||el.getAttribute('aria-label')});
  res.toolbarRows=[].slice.call(d.querySelectorAll('#toolbar .field')).map(function(f){return Math.round(f.getBoundingClientRect().top)}).filter(function(v,i,a){return a.indexOf(v)===i}).length;
  res.theme=d.documentElement.dataset.theme;
  res.selected=(d.querySelector('#tabs [aria-selected="true"]')||{getAttribute:function(){return ''}}).getAttribute('data-view');
  res.tagHidden=d.getElementById('tagpanel').hidden;
  res.bodyBg=getComputedStyle(d.body).backgroundColor;
  res.bodyColor=getComputedStyle(d.body).color;
  res.legal=!!d.getElementById('legal');
  res.coverage=/快照收录/.test(d.getElementById('resultInfo').textContent);
  res.loadmoreHidden=d.getElementById('loadmore').hidden;
  d.getElementById('loadmoreBtn').click();
  res.afterLoad=n('#list .repo');
  d.querySelector('#tabs [data-view="rising"]').click();
  res.afterRising={rows:n('#list .repo'),cats:n('#rail [data-cat]'),selected:d.querySelector('#tabs [aria-selected="true"]').getAttribute('data-view')};
  d.querySelector('#tabs [data-view="tags"]').click();
  res.afterTags={cats:n('#rail [data-cat]'),tagHidden:d.getElementById('tagpanel').hidden};
  var q=d.getElementById('q');q.value='react';q.dispatchEvent(new Event('input',{bubbles:true}));
  setTimeout(function(){
    res.filterChips=n('#filterbar .filter-chip');
    res.errs=window.__errs||[];
    var p=d.createElement('pre');p.id='wbprobe';p.textContent=JSON.stringify(res);d.body.appendChild(p);
  },260);
},300)});
</script>`;

const probe = index.replace('<head>', '<head>' + headProbe).replace('</body>', bodyProbe + '</body>');
/* Set the theme before CSS/JS boot so computed styles are never read mid-switch. */
const probeLight = probe.replace('<head>',
  '<head><script>try{localStorage.setItem("starscope-theme","light")}catch(e){};document.documentElement.dataset.theme="light";</script>');
const frame = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0}iframe{width:360px;height:900px;border:0;display:block}</style></head><body>
<iframe id="f" src="_probe.html"></iframe><script>
document.getElementById('f').addEventListener('load',function(){setTimeout(function(){
 var d=document.getElementById('f').contentDocument,src=d&&d.getElementById('wbprobe');
 var p=document.createElement('pre');p.id='wbprobe';p.textContent=src?src.textContent:JSON.stringify({error:'frame probe missing'});document.body.appendChild(p);
},650)});</script></body></html>`;

const files = {
  '_probe.html': probe,
  '_probe_light.html': probeLight,
  '_frame.html': frame
};
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(site, name), content, 'utf8');

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function run(file, width, height, extra) {
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=4000', '--window-size=' + width + ',' + height,
    '--dump-dom'].concat(extra || []);
  const out = execFileSync(chrome, args.concat(['file:///' + path.join(site, file).replace(/\\/g, '/')]),
    { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = out.match(/<pre id="wbprobe">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error('probe did not run for ' + file);
  return JSON.parse(decode(m[1]));
}

const ok = [], fail = [];
const check = (cond, label) => (cond ? ok : fail).push(label);

const configs = [
  { name: '360px (iframe)', file: '_frame.html', w: 620, h: 1000, extra: ['--allow-file-access-from-files'] },
  { name: '768px',  file: '_probe.html', w: 768,  h: 900 },
  { name: '1280px', file: '_probe.html', w: 1280, h: 900 },
  { name: '1600px', file: '_probe.html', w: 1600, h: 900 },
  { name: 'light theme 1280px', file: '_probe_light.html', w: 1280, h: 900, light: true }
];

for (const c of configs) {
  let r;
  try { r = run(c.file, c.w, c.h, c.extra); }
  catch (e) { fail.push(`${c.name}: browser run failed — ${e.message}`); continue; }
  if (r.error) { fail.push(`${c.name}: ${r.error}`); continue; }
  const p = x => `${c.name}: ${x}`;
  check(r.sw <= r.iw + 1, p(`no horizontal scroll (viewport ${r.iw}, scrollWidth ${r.sw})`));
  check(r.off.length === 0, p(`no element past right edge${r.off.length ? ' — ' + r.off.join(', ') : ''}`));
  check(r.h1 === 1, p('exactly one h1'));
  check(r.rows >= 60 && r.rows <= 180, p(`initial list renders a full page of rows (got ${r.rows})`));
  check(r.afterLoad > r.rows, p(`load-more appends the next batch (${r.rows} -> ${r.afterLoad})`));
  check(r.loadmoreHidden === false, p('load-more control is visible for a long catalogue'));
  check(r.coverage === true, p('coverage total is shown next to the result count'));
  check(r.legal === true, p('legal / data-source section rendered'));
  check(r.filterChips >= 1, p(`typing a keyword surfaces a removable filter chip (got ${r.filterChips})`));
  check(r.cats === 12, p(`category tree has 12 entries (got ${r.cats})`));
  check(r.heroBars === 24, p(`hero chart has 24 real data bars (got ${r.heroBars})`));
  check(r.labels === true, p('every form control is labelled'));
  check(r.selected === 'total', p('initial tab is total'));
  check(r.tagHidden === true, p('tag panel hidden outside tag view'));
  check(r.theme === (c.light ? 'light' : 'dark'), p(`theme = ${c.light ? 'light' : 'dark'} (got ${r.theme})`));
  check(r.afterRising.rows >= 60 && r.afterRising.cats === 12 && r.afterRising.selected === 'rising',
    p('rising view keeps a full page + full category tree'));
  check(r.afterTags.cats === 12 && r.afterTags.tagHidden === false,
    p('tag view keeps category tree and reveals tag panel'));
  check(r.errs.length === 0, p(`no runtime errors${r.errs.length ? ' — ' + r.errs.join('; ') : ''}`));
  if (c.w >= 1280) check(r.toolbarRows === 1, p(`toolbar fits one row (got ${r.toolbarRows})`));
  if (c.light) {
    const bg = (r.bodyBg.match(/\d+/g) || []).map(Number);
    const fg = (r.bodyColor.match(/\d+/g) || []).map(Number);
    check(bg.length >= 3 && bg[0] > 220, p(`light theme has a light body background (got ${r.bodyBg})`));
    check(fg.length >= 3 && fg[0] < 80, p(`light theme has dark body text (got ${r.bodyColor})`));
  }
}

for (const name of Object.keys(files)) {
  try { fs.unlinkSync(path.join(site, name)); } catch (e) {}
}

console.log(`PASS (${ok.length})`);
ok.forEach(x => console.log('  ok  ' + x));
if (fail.length) {
  console.log(`FAIL (${fail.length})`);
  fail.forEach(x => console.log('  !!  ' + x));
  process.exit(1);
}
console.log('\nAll browser checks passed.');

/* Sharded-first-paint consistency check (headless Chrome, file://).
 *
 * The sidebar ships exact full-catalogue counts (DATA.idx) while the first
 * paint only loads repos-0.js. If a filtered view renders from the loaded
 * shards alone, the sidebar says "200" and the list says "43" — and a search
 * for a repo in a later chunk finds nothing. Verify that narrowing the list
 * completes the shards and re-renders with the full catalogue.
 *   node tests/shard-check.js
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
const probe = `<script>
window.addEventListener('load',function(){setTimeout(function(){
  var d=document,res={};
  res.initialChunks=(window.REPOS_CHUNKS||[]).filter(Boolean).length;
  res.initialRows=d.querySelectorAll('#list .repo').length;
  var ai=d.querySelector('#rail [data-cat="ai"]');
  res.aiRail=(ai&&(ai.textContent.match(/[0-9]+/)||[])[0])||'';
  if(ai) ai.click();
  setTimeout(function(){
    res.chunksAfter=(window.REPOS_CHUNKS||[]).filter(Boolean).length;
    var info=(d.getElementById('resultInfo')||{}).textContent||'';
    res.aiResult=(info.match(/共\\s*([0-9]+)\\s*个项目/)||[])[1]||'';
    res.info=info.replace(/\\s+/g,' ').trim().slice(0,120);
    res.errs=(window.__STASCOPE_ERRORS__||[]).length;
    var p=d.createElement('pre');p.id='shardprobe';p.textContent=JSON.stringify(res);d.body.appendChild(p);
  },1400);
},350)});
</script>`;
const file = path.join(site, '_shard.html');
fs.writeFileSync(file, index.replace('</body>', probe + '</body>'), 'utf8');

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
let r;
try {
  const out = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=9000', '--window-size=1440,900', '--dump-dom',
    'file:///' + file.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = out.match(/<pre id="shardprobe">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error('probe did not run');
  r = JSON.parse(decode(m[1]));
} catch (e) {
  console.error('  !! FAIL - browser run failed: ' + e.message);
  try { fs.unlinkSync(file); } catch (x) {}
  process.exit(1);
}
try { fs.unlinkSync(file); } catch (e) {}

const ok = [], fail = [];
const check = (cond, label) => (cond ? ok : fail).push(label);
check(r.initialChunks === 1, `first paint loads exactly one shard (got ${r.initialChunks})`);
check(r.initialRows >= 60, `first paint still renders a full page (got ${r.initialRows})`);
check(r.chunksAfter >= 9, `narrowing a category completes every shard (got ${r.chunksAfter})`);
check(!!r.aiRail && r.aiRail === r.aiResult,
  `sidebar count matches the filtered result (${r.aiRail} vs ${r.aiResult}) — info: ${r.info}`);
check(r.errs === 0, `no monitor events during the shard completion (got ${r.errs})`);

console.log(`PASS (${ok.length})`);
ok.forEach(x => console.log('  ok  ' + x));
if (fail.length) {
  console.log(`FAIL (${fail.length})`);
  fail.forEach(x => console.log('  !!  ' + x));
  process.exit(1);
}
console.log('\nAll shard consistency checks passed.');

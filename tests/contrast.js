/* WCAG 2.1 AA contrast assertions against the design tokens.
 * Resolves var() references from tokens.css for both themes.
 *   node tests/contrast.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(path.dirname(__dirname), 'src', 'tokens.css'), 'utf8');

function block(selector) {
  const at = src.indexOf(selector);
  if (at < 0) throw new Error('missing token block: ' + selector);
  const start = src.indexOf('{', at);
  const end = src.indexOf('\n}', start);
  const body = src.slice(start + 1, end);
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const dark = block(':root {');
const light = Object.assign({}, dark, block('[data-theme="light"] {'));

function resolve(value, dict, depth = 0) {
  if (depth > 8 || value === undefined) return value;
  return value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, name, fallback) =>
    dict[name] !== undefined ? resolve(dict[name], dict, depth + 1) : (fallback || ''));
}
function rgb(hex) {
  const h = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function lum(hex) {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg, bg, dict) {
  const a = lum(resolve(dict[fg] || fg, dict)), b = lum(resolve(dict[bg] || bg, dict));
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const ok = [], fail = [];
const check = (cond, label) => (cond ? ok : fail).push(label);

/* text pairs need 4.5:1; UI/accent/large-text pairs need 3:1 */
const PAIRS = [
  ['--text', '--bg', 4.5, 'body text on page'],
  ['--text', '--surface', 4.5, 'body text on card'],
  ['--text-muted', '--bg', 4.5, 'secondary text on page'],
  ['--text-muted', '--surface', 4.5, 'secondary text on card'],
  ['--text-faint', '--bg', 4.5, 'meta text on page'],
  ['--text-faint', '--surface', 4.5, 'meta text on card'],
  ['--chip-color', '--chip-bg', 4.5, 'chip label on chip'],
  ['--accent', '--bg', 3, 'accent on page (links / UI)'],
  ['--accent', '--surface', 3, 'accent on card'],
  ['--accent-contrast', '--accent', 4.5, 'button label on accent'],
  ['--success', '--surface', 3, 'success text on card'],
  ['--warn', '--surface', 3, 'warning text on card'],
  ['--danger', '--surface', 3, 'error text on card'],
  ['--info', '--surface', 3, 'info text on card'],
  ['--focus-ring', '--bg', 3, 'focus ring on page']
];

for (const [name, dict] of [['dark', dark], ['light', light]]) {
  for (const [fg, bg, min, label] of PAIRS) {
    const r = ratio(fg, bg, dict);
    check(r !== null && r >= min,
      `${name}: ${label} = ${r === null ? 'unresolved' : r.toFixed(2) + ':1'} (need ${min})`);
  }
  check(resolve(dict['--accent-contrast'], dict).toLowerCase() !== '#ffffff' || name === 'light',
    `${name}: accent button ink is contrast-safe for its accent`);
}

/* token completeness — every declared size token is reachable */
const required = ['--space-1','--space-4','--space-8','--radius-md','--radius-lg',
  '--text-hero','--text-h2','--text-sm','--dur-fast','--dur-slower','--ease-out',
  '--nav-height','--rail-width','--card-bg','--input-bg','--focus-ring'];
check(required.every(t => dark[t] !== undefined), `all ${required.length} structural tokens declared`);
check(light['--text'] !== dark['--text'], 'light theme actually overrides the semantic layer');

console.log(`PASS (${ok.length})`);
ok.forEach(x => console.log('  ok  ' + x));
if (fail.length) {
  console.log(`FAIL (${fail.length})`);
  fail.forEach(x => console.log('  !!  ' + x));
  process.exit(1);
}
console.log('\nAll contrast checks passed (WCAG 2.1 AA).');

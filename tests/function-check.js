#!/usr/bin/env node
/* Verifies the Cloudflare Pages Function /api/errors (functions/api/errors.js)
 * without a Workers runtime: imports the module through a data: URL, then
 * exercises onRequestPost / onRequestGet with stubbed Request/env/context,
 * including the real Pages EventContext shape (top-level waitUntil).
 * Run: node tests/function-check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'functions', 'api', 'errors.js');

let passed = 0, failed = 0;
function check(ok, label) {
  if (ok) { passed++; console.log('  ok - ' + label); }
  else { failed++; console.log('  !! FAIL - ' + label); }
}

function makeKV() {
  const m = new Map();
  return {
    map: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); },
  };
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('  !! FAIL - functions/api/errors.js missing');
    process.exit(1);
  }
  const src = fs.readFileSync(SRC, 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  check(typeof mod.onRequestPost === 'function' && typeof mod.onRequestGet === 'function',
    'exports onRequestPost and onRequestGet');

  const BASE = 'https://starscope-adb.pages.dev/api/errors';
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };

  const req = (body, headers = {}) => new Request(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://starscope-adb.pages.dev', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const run = async (body, headers) => mod.onRequestPost({ request: req(body, headers), env: envOf(), ctx });

  let kv;
  const envOf = () => ({ ERRORS_KV: kv });

  // 1. valid error record -> 204, one KV entry + daily counter
  kv = makeKV();
  pending.length = 0;
  let res = await run({ type: 'error', message: 'boom', stack: 'at x', view: 'total', page: '/', ua: 'test', t: '2026-11-14T05:00:00.000Z' });
  check(res.status === 204, 'valid error beacon -> 204');
  await Promise.all(pending);
  const keys = [...kv.map.keys()];
  check(keys.filter(k => k.startsWith('err:')).length === 1, 'error record persisted to KV');
  check(kv.map.get('cnt:2026-11-14') === '1', 'daily counter incremented');

  // 2. long message clamped, unknown fields dropped
  kv = makeKV(); pending.length = 0;
  res = await run({ type: 'error', message: 'x'.repeat(5000), secret: 'nope', view: 'total' });
  await Promise.all(pending);
  const stored = JSON.parse(kv.map.get([...kv.map.keys()].find(k => k.startsWith('err:'))));
  check(stored.message.length <= 600, 'message clamped to 600 chars');
  check(!('secret' in stored), 'unknown fields dropped');

  // 3. cross-origin -> 403, nothing written
  kv = makeKV(); pending.length = 0;
  res = await run({ type: 'error', message: 'x' }, { origin: 'https://evil.example' });
  check(res.status === 403, 'cross-origin beacon rejected (403)');
  await Promise.all(pending);
  check(kv.map.size === 0, 'nothing stored for cross-origin beacon');

  // 4. missing origin+referer -> 403
  res = await mod.onRequestPost({
    request: new Request(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"error","message":"x"}' }),
    env: envOf(), ctx,
  });
  check(res.status === 403, 'beacon without Origin/Referer rejected (403)');

  // 5. oversized body -> 413
  res = await run(JSON.stringify({ type: 'error', message: 'y'.repeat(9000) }));
  check(res.status === 413, 'body over 8 KiB rejected (413)');

  // 6. invalid JSON -> 400
  res = await run('not json at all');
  check(res.status === 400, 'invalid JSON rejected (400)');

  // 7. unknown type / event category -> 400
  res = await run({ type: 'telemetry', message: 'x' });
  check(res.status === 400, 'unknown record type rejected (400)');
  res = await run({ type: 'event', category: 'random' });
  check(res.status === 400, 'unknown event category rejected (400)');

  // 8. accepted event category -> 204
  kv = makeKV(); pending.length = 0;
  res = await run({ type: 'event', category: 'chunk-load-failed', detail: { chunk: 3 } });
  check(res.status === 204, 'known event category accepted (204)');
  await Promise.all(pending);
  check([...kv.map.keys()].some(k => k.startsWith('err:')), 'event record persisted');

  // 9. no KV binding -> still 204, no throw
  kv = undefined; pending.length = 0;
  res = await run({ type: 'error', message: 'graceful' });
  check(res.status === 204, 'missing KV binding degrades gracefully (204)');

  // 10. GET summary without KV
  res = await mod.onRequestGet({ env: {}, ctx });
  let body = await res.json();
  check(res.status === 200 && body.enabled === false, 'GET without KV -> {enabled:false}');

  // 11. GET summary with counters
  kv = makeKV();
  const today = new Date().toISOString().slice(0, 10);
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await kv.put('cnt:' + today, '4');
  await kv.put('cnt:' + yday, '3');
  res = await mod.onRequestGet({ env: { ERRORS_KV: kv }, ctx });
  body = await res.json();
  check(body.enabled === true && body.last24h === 7 && body.last7d === 7,
    'GET aggregates last-24h and last-7d counters');
  check(res.headers.get('cache-control') === 'no-store', 'GET responses are no-store');

  // 12. Real Pages EventContext: waitUntil is top-level, there is NO nested
  //     ctx. Regression guard for the 500 that appeared once KV was bound.
  kv = makeKV(); pending.length = 0;
  res = await mod.onRequestPost({
    request: req({ type: 'error', message: 'real context' }),
    env: envOf(),
    waitUntil: (p) => pending.push(p),
  });
  check(res.status === 204, 'real Pages EventContext (top-level waitUntil) -> 204');
  await Promise.all(pending);
  check([...kv.map.keys()].some(k => k.startsWith('err:')), 'real context still persists to KV');

  // 13. Storage failure degrades to 204 instead of turning a beacon into a 500.
  kv = { get: async () => { throw new Error('kv down'); }, put: async () => { throw new Error('kv down'); } };
  pending.length = 0;
  res = await mod.onRequestPost({
    request: req({ type: 'error', message: 'failing kv' }),
    env: envOf(),
    waitUntil: (p) => pending.push(p),
  });
  check(res.status === 204, 'KV write failure does not 500 the beacon');
  await Promise.all(pending);

  // 14. CI probes exercise the write path without inflating public counters.
  kv = makeKV(); pending.length = 0;
  res = await run({ type: 'event', category: 'online', page: 'ci-probe' });
  await Promise.all(pending);
  check(res.status === 204, 'ci-probe beacon -> 204');
  check([...kv.map.keys()].some(k => k.startsWith('err:')), 'ci-probe still exercises KV write');
  check([...kv.map.keys()].every(k => !k.startsWith('cnt:')), 'ci-probe does not inflate daily counters');

  console.log(failed ? `\nfunction-check: ${failed} FAILED, ${passed} passed` : `\nfunction-check: all ${passed} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

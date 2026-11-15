/* Starscope — Cloudflare Pages Function: /api/errors
 *
 * Same-origin sink for the runtime monitor (assets/monitor.js). The monitor
 * beacons JSON records here via navigator.sendBeacon; connect-src 'self' in
 * the strict CSP already permits it, so no policy change was needed.
 *
 * Behaviour:
 *  - POST only, same-origin enforced (Origin/Referer must match the host;
 *    real browsers always send at least one of them for a POST beacon).
 *  - Body capped at 8 KiB, fields whitelisted and clamped before storage.
 *  - Persisted into the ERRORS_KV namespace with a 30-day TTL plus one
 *    counter key per UTC day, when that binding exists. Without KV the
 *    endpoint still accepts the beacon (204) and logs it, so collection
 *    starts the moment the binding is attached — nothing to redeploy.
 *  - GET returns aggregate counts only (no messages, no URLs, no UAs), safe
 *    to expose publicly as a tiny health signal.
 */

const MAX_BODY_BYTES = 8192;
const MAX_FIELD = 600;
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const ALLOWED_TYPES = new Set(["error", "resource-error", "event"]);
const ALLOWED_EVENT_CATEGORIES = new Set([
  "chunk-load-failed",
  "tag-api-failed",
  "offline",
  "online",
]);

function clampString(value) {
  if (typeof value !== "string") return "";
  return value.length > MAX_FIELD ? value.slice(0, MAX_FIELD) : value;
}

function sanitize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = raw.type;
  if (!ALLOWED_TYPES.has(type)) return null;
  const rec = { type: type };
  if (type === "event") {
    if (!ALLOWED_EVENT_CATEGORIES.has(raw.category)) return null;
    rec.category = raw.category;
    const d = raw.detail;
    if (typeof d === "string") rec.detail = clampString(d);
    else if (d && typeof d === "object") {
      try { rec.detail = clampString(JSON.stringify(d)); } catch (e) { rec.detail = ""; }
    } else rec.detail = "";
  } else {
    rec.message = clampString(raw.message);
    rec.stack = clampString(raw.stack);
    rec.src = clampString(raw.src);
    rec.line = Number.isFinite(raw.line) ? raw.line : 0;
    if (!rec.message && !rec.stack && !rec.src) return null;
  }
  rec.view = clampString(raw.view) || "total";
  rec.page = clampString(raw.page);
  rec.ua = clampString(raw.ua);
  rec.t = clampString(raw.t) || new Date().toISOString();
  return rec;
}

function sameOrigin(request) {
  const host = new URL(request.url).host;
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host === host; } catch (e) { return false; }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try { return new URL(referer).host === host; } catch (e) { return false; }
  }
  return false;
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/* Pages Functions pass an EventContext with waitUntil() on the top-level
 * object. Some Workers-style wrappers and local harnesses expose it on a
 * nested ctx instead, so accept both shapes. */
function waitUntilOf(context) {
  const c = context || {};
  if (typeof c.waitUntil === "function") return c.waitUntil.bind(c);
  if (c.ctx && typeof c.ctx.waitUntil === "function") return c.ctx.waitUntil.bind(c.ctx);
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  let raw;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    raw = JSON.parse(text);
  } catch (e) {
    return new Response(null, { status: 400 });
  }
  const rec = sanitize(raw);
  if (!rec) return new Response(null, { status: 400 });

  const kv = env && env.ERRORS_KV;
  if (kv) {
    const key = "err:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
    const day = rec.t.slice(0, 10);
    // CI probes exercise the write path without inflating the public daily
    // error counters.
    const isProbe = rec.page === "ci-probe";
    const persist = (async () => {
      const writes = [
        kv.put(key, JSON.stringify(rec), { expirationTtl: TTL_SECONDS }),
      ];
      if (!isProbe) {
        writes.push(
          kv.get("cnt:" + day).then((v) =>
            kv.put("cnt:" + day, String((parseInt(v, 10) || 0) + 1), {
              expirationTtl: TTL_SECONDS,
            })
          )
        );
      }
      await Promise.all(writes);
    })().catch((e) => {
      // A storage failure must never turn a beacon into a 500.
      console.log("starscope-kv-write-failed " + String((e && e.message) || e));
    });
    const waitUntil = waitUntilOf(context);
    if (waitUntil) waitUntil(persist);
    else await persist; // no hook available: finish the writes before responding
  }
  // Always mirrored into Pages Functions logs, so even a binding-less deploy
  // keeps a queryable trail (dashboard → Functions → real-time logs).
  console.log("starscope-error " + JSON.stringify(rec));
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export async function onRequestGet({ env }) {
  const kv = env && env.ERRORS_KV;
  if (!kv) return jsonResponse({ enabled: false });
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  const counts = await Promise.all(days.map((d) => kv.get("cnt:" + d)));
  const perDay = {};
  let last7d = 0;
  days.forEach((d, i) => {
    const c = parseInt(counts[i], 10) || 0;
    perDay[d] = c;
    last7d += c;
  });
  const last24h = (perDay[days[0]] || 0) + (perDay[days[1]] || 0);
  return jsonResponse({ enabled: true, perDay: perDay, last24h: last24h, last7d: last7d });
}

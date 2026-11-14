/* Starscope — lightweight runtime monitor.
 *
 * Goals (Tier B):
 *  - Catch uncaught errors / rejected promises and surface them to the user
 *    as a non-blocking toast instead of failing silently.
 *  - Give the app a tiny event-reporting hook (window.STASCOPE_REPORT) for
 *    things that are not JS exceptions but still worth tracking: chunk load
 *    failures, tag-explorer API failures, online/offline transitions.
 *  - Beacon actionable events to a same-origin endpoint when
 *    window.__ERROR_REPORT_URL__ is set (the build points it at the Pages
 *    Function /api/errors when SITE_URL is configured). connect-src 'self'
 *    already permits it, so the strict CSP stays clean.
 *
 * File:// safe: no modules, no fetch at load time, no external resources.
 */
(function () {
  'use strict';
  var MAX_BUF = 20;     // ring buffer of recent events for in-page debugging
  var MAX_BEACON = 5;   // cap network beacons per page load to avoid spam
  var buf = [];
  var beaconCount = 0;
  window.__STASCOPE_ERRORS__ = buf;
  var reportUrl = window.__ERROR_REPORT_URL__ || '';

  function view() {
    try {
      var v = new URLSearchParams(location.search).get('view');
      return v || 'total';
    } catch (e) { return 'total'; }
  }

  /* Only errors and actionable events are worth a network beacon — the
   * offline/online transitions stay in the in-page buffer only. */
  function worthBeaconing(rec) {
    if (rec.type === 'event') {
      return rec.category === 'chunk-load-failed' || rec.category === 'tag-api-failed';
    }
    return true; /* 'error' and 'resource-error' */
  }

  function record(rec) {
    rec.t = new Date().toISOString();
    rec.view = view();
    rec.page = location.pathname;
    rec.ua = navigator.userAgent;
    buf.push(rec);
    if (buf.length > MAX_BUF) buf.shift();
    if (reportUrl && beaconCount < MAX_BEACON && worthBeaconing(rec)) {
      beaconCount++;
      try {
        var blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
        if (navigator.sendBeacon) navigator.sendBeacon(reportUrl, blob);
      } catch (e) { /* reporting must never throw */ }
    }
    return rec;
  }

  /* Public hook for app-level events (not exceptions). */
  window.STASCOPE_REPORT = function (category, detail) {
    try {
      var rec = { type: 'event', category: category, detail: detail || {} };
      record(rec);
      // Surface only the classes of event the user can act on.
      if (category === 'chunk-load-failed') {
        toast('部分数据分块加载失败，已显示已加载的部分。刷新可重试。');
      }
      return rec;
    } catch (e) { return null; }
  };

  function toast(msg) {
    try {
      var host = document.getElementById('toastHost');
      if (!host) {
        host = document.createElement('div');
        host.id = 'toastHost';
        host.setAttribute('role', 'alert');
        host.setAttribute('aria-live', 'assertive');
        host.setAttribute('aria-label', '提示与错误');
        document.body.appendChild(host);
      }
      var el = document.createElement('div');
      el.className = 'toast toast--err';
      var span = document.createElement('span');
      span.className = 'toast__msg';
      span.textContent = msg;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast__close';
      btn.setAttribute('aria-label', '关闭提示');
      btn.textContent = '×';
      el.appendChild(span);
      el.appendChild(btn);
      var close = function () {
        el.classList.add('toast--out');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 360);
      };
      btn.onclick = close;
      host.appendChild(el);
      setTimeout(close, 6000);
    } catch (e) { /* never break the app over a toast */ }
  }

  function onError(e) {
    try {
      // Resource load errors (img/script) have no .error; report the target.
      if (e && e.target && (e.target !== window) && e.target.src) {
        record({ type: 'resource-error', src: e.target.src, tag: e.target.tagName });
        return;
      }
      var err = e.error || e.reason || e;
      var rec = record({
        type: 'error',
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? String(err.stack).slice(0, 500) : '',
        src: e.filename || (e.target && e.target.src) || '',
        line: e.lineno || 0
      });
      toast('页面遇到一个问题：' + (rec.message || '未知错误') + '（已记录，不影响其余功能）');
    } catch (x) { /* must never throw */ }
  }

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', function (e) {
    onError({ error: (e && e.reason) || { message: 'unhandledrejection' } });
  });
  window.addEventListener('offline', function () { record({ type: 'event', category: 'offline', detail: {} }); });
  window.addEventListener('online', function () {
    record({ type: 'event', category: 'online', detail: {} });
    toast('网络已恢复。');
  });
})();

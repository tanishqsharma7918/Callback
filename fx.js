/* Callback v3 — fx: micro-interactions (design). Cheap and GPU-friendly; every effect is optional and guarded.
 *
 *  · Count-up numbers ([data-count], .kpi-v): from the previously shown value (sessionStorage), 900 ms easeOutExpo,
 *    tabular digits, final value in aria-label. Reduced motion → the final value, no animation.
 *  · Number tick: a KPI whose value changed since it was last shown gets a brief champagne tick.
 *  · Pointer spotlight on .card / .jcard (hover:hover + pointer:fine only): one delegated, rAF-throttled
 *    pointermove listener that writes --mx/--my on the hovered card only (CSS draws the glow + rim).
 *  · Magnetic buttons ([data-magnetic]; pointer:fine): translate ≤ 6 px toward the pointer via the CSS
 *    `translate` property (so :active scale still works); released by the CSS spring.
 *  · Pressed-glass rim energize: pointerdown on glass chrome brightens its specular rim for ~160 ms.
 *  · Route crossfade: View Transitions for sidebar / tab-bar navigation where supported; a short CSS enter
 *    (fade + 6 px rise) otherwise.
 *  · Scroll-linked header: .top gets .is-scrolled (glass + compact title) once the page scrolls.
 *  · Exit animations for drawer / modal / palette / scrim: when app.js removes one, a non-interactive clone
 *    (classes x-drawer / x-modal / x-palette / x-scrim, no ids) plays the exit and removes itself. The live DOM
 *    semantics are unchanged: `$('.modal')`, `#drawer` etc. are gone immediately, exactly as before.
 *
 *  API: CB.FX = { countUp(el, key?), scan(root?), reduced(), version }
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  const doc = document;
  const html = doc.documentElement;
  const mq = (q) => { try { return window.matchMedia(q); } catch (e) { return { matches: false }; } };
  const RM = mq('(prefers-reduced-motion: reduce)');
  const FINE = mq('(hover: hover) and (pointer: fine)');
  const reduced = () => !!RM.matches || html.classList.contains('reduce-motion');
  const raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (f) => setTimeout(f, 16);
  const caf = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
  const report = (e, where) => { try { if (CB.reportError) CB.reportError(e, { where: 'fx:' + where, silent: true }); } catch (x) { /* noop */ } };
  const guard = (where, fn) => function () { try { return fn.apply(this, arguments); } catch (e) { report(e, where); return undefined; } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ───────────────────────── count-up + tick ─────────────────────────
  const SKEY = 'callback.fx.counts';
  let seen = {};
  try { seen = JSON.parse(sessionStorage.getItem(SKEY) || '{}') || {}; } catch (e) { seen = {}; }
  const persist = () => { try { sessionStorage.setItem(SKEY, JSON.stringify(seen)); } catch (e) { /* private mode */ } };
  const anims = new WeakMap();
  const NUM_RE = /^(\s*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/;
  const fmtCache = {};
  const fmt = (v, dec) => {
    const k = dec;
    if (!fmtCache[k]) { try { fmtCache[k] = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); } catch (e) { fmtCache[k] = { format: (x) => x.toFixed(dec) }; } }
    return fmtCache[k].format(v);
  };
  /** Animate the first number in el's first text node. key identifies the metric across re-renders. */
  function countUp(el, key) {
    if (!el || el.nodeType !== 1) return;
    const tn = el.firstChild;
    if (!tn || tn.nodeType !== 3) return;
    const m = NUM_RE.exec(tn.nodeValue || '');
    if (!m) return;
    const raw = m[2].replace(/,/g, '');
    const to = parseFloat(raw);
    if (!isFinite(to)) return;
    const dec = (raw.split('.')[1] || '').length;
    key = key || el.getAttribute('data-count') || '';
    const label = (el.textContent || '').trim();
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', label);
    const from = key && typeof seen[key] === 'number' ? seen[key] : null;
    if (key) { seen[key] = to; persist(); }
    const prevAnim = anims.get(el);
    if (prevAnim) caf(prevAnim);
    if (from === to) return;
    if (from !== null) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
    if (reduced()) return;
    const start = from === null ? 0 : from;
    const pre = m[1], post = m[3];
    const t0 = performance.now(), D = from === null ? 900 : 700;
    const stepFn = (now) => {
      const t = Math.min(1, (now - t0) / D);
      const e = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
      tn.nodeValue = pre + fmt(start + (to - start) * e, dec) + post;
      if (t < 1) anims.set(el, raf(stepFn)); else anims.delete(el);
    };
    tn.nodeValue = pre + fmt(start, dec) + post;
    anims.set(el, raf(stepFn));
  }
  /** Find unprocessed counters under root and run them. */
  function scan(root) {
    root = root || doc.getElementById('view');
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-count]:not([data-fx-done]), .kpi-v:not([data-fx-done])').forEach((el) => {
      el.setAttribute('data-fx-done', '');
      countUp(el, el.getAttribute('data-count') || (el.closest('.kpi') && (el.closest('.kpi').querySelector('.kpi-l') || {}).textContent) || '');
    });
  }

  // ───────────────────────── pointer: spotlight + magnetic ─────────────────────────
  let lit = null, mag = null, px = 0, py = 0, tgt = null, queued = false;
  const frame = guard('pointer', () => {
    queued = false;
    const t = tgt && tgt.closest ? tgt : null;
    const card = t ? t.closest('.card, .jcard') : null;
    if (card !== lit) { if (lit) lit.classList.remove('is-lit'); lit = card; if (card) card.classList.add('is-lit'); }
    if (card) { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', (px - r.left).toFixed(0) + 'px'); card.style.setProperty('--my', (py - r.top).toFixed(0) + 'px'); }
    const m = t && !reduced() ? t.closest('[data-magnetic]') : null;
    if (m !== mag) { if (mag) mag.style.translate = ''; mag = m; }
    if (m) {
      const r = m.getBoundingClientRect();
      const dx = clamp((px - (r.left + r.width / 2)) * 0.25, -6, 6), dy = clamp((py - (r.top + r.height / 2)) * 0.25, -4, 4);
      m.style.translate = dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px';
    }
  });
  doc.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !FINE.matches) return;
    px = e.clientX; py = e.clientY; tgt = e.target;
    if (!queued) { queued = true; raf(frame); }
  }, { passive: true });
  const unlight = () => { tgt = null; if (!queued) { queued = true; raf(frame); } };
  doc.addEventListener('pointerleave', unlight, { passive: true });
  window.addEventListener('blur', unlight);

  // ───────────────────────── pressed glass energizes ─────────────────────────
  const GLASS = '.tabbar, .palette, .cal-panel, .modal, .search-btn';
  doc.addEventListener('pointerdown', guard('energize', (e) => {
    const g = e.target && e.target.closest ? e.target.closest(GLASS) : null;
    if (!g) return;
    g.classList.add('energize');
    setTimeout(() => g.classList.remove('energize'), 180);
  }), { passive: true, capture: true });

  // ───────────────────────── scroll-linked header ─────────────────────────
  let scrolled = null, sQueued = false;
  const onScroll = guard('scroll', () => {
    sQueued = false;
    const s = (window.scrollY || html.scrollTop || 0) > 8;
    if (s === scrolled) return;
    scrolled = s;
    const top = doc.querySelector('.top');
    if (top) top.classList.toggle('is-scrolled', s);
  });
  window.addEventListener('scroll', () => { if (!sQueued) { sQueued = true; raf(onScroll); } }, { passive: true });

  // ───────────────────────── route transitions ─────────────────────────
  let vt = false;
  const canVT = () => typeof doc.startViewTransition === 'function' && !reduced();
  doc.addEventListener('click', (e) => {
    if (!canVT() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest('#nav a[href^="#"], #tabbar a[href^="#"], a.brand[href^="#"]') : null;
    if (!a) return;
    const key = (a.getAttribute('href') || '').slice(1);
    if (!key || ('#' + key) === location.hash || (CB.App && CB.App.current === key && location.hash)) return;
    e.preventDefault();
    let done = null;
    const finished = new Promise((res) => { done = res; });
    const onHash = () => { window.removeEventListener('hashchange', onHash); setTimeout(done, 0); };
    try {
      vt = true;
      const t = doc.startViewTransition(() => { window.addEventListener('hashchange', onHash); location.hash = key; setTimeout(done, 450); return finished; });
      const end = () => { vt = false; };
      if (t && t.finished && t.finished.then) t.finished.then(end, end); else setTimeout(end, 600);
    } catch (err) { vt = false; location.hash = key; }
  }, true);
  const enter = guard('route', () => {
    const v = doc.getElementById('view');
    if (!v || vt || reduced()) return;
    v.classList.remove('route-in'); void v.offsetWidth; v.classList.add('route-in');
    clearTimeout(enter._t); enter._t = setTimeout(() => v.classList.remove('route-in'), 420);
  });

  // ───────────────────────── exit animations (ghost clones) ─────────────────────────
  const KINDS = ['drawer', 'modal', 'palette', 'scrim'];
  const ghostOf = guard('ghost', (n, parent) => {
    const kind = KINDS.find((k) => n.classList.contains(k));
    if (!kind) return;
    if (n.id && doc.getElementById(n.id)) return; // replaced by a fresh one (e.g. drawer re-open): no ghost
    if (kind === 'drawer' && doc.querySelector('.drawer')) return;
    const g = n.cloneNode(true);
    g.removeAttribute('id');
    g.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    g.querySelectorAll('[autofocus]').forEach((x) => x.removeAttribute('autofocus'));
    g.classList.remove(kind, 'energize');
    g.classList.add('x-' + kind);
    g.setAttribute('aria-hidden', 'true');
    g.removeAttribute('role');
    g.setAttribute('data-fx-ghost', '');
    try { g.inert = true; } catch (e) { /* old engines */ }
    (parent && parent.isConnected ? parent : doc.body).appendChild(g);
    const kill = () => { if (g.parentNode) g.parentNode.removeChild(g); };
    g.addEventListener('animationend', (ev) => { if (ev.target === g) kill(); });
    setTimeout(kill, 420);
  });
  const mo = new MutationObserver(guard('mutations', (recs) => {
    let viewChanged = false;
    for (const r of recs) {
      if (r.target && r.target.id === 'view') { viewChanged = true; continue; }
      if (reduced()) continue;
      for (const n of r.removedNodes) {
        if (n.nodeType === 1 && n.classList && !n.hasAttribute('data-fx-ghost')) ghostOf(n, r.target);
      }
    }
    if (viewChanged) scan();
  }));

  // ───────────────────────── "Reduce glass and motion" (Settings → Appearance) ─────────────────────────
  const applyReduce = (on) => { html.classList.toggle('reduce-glass', !!on); html.classList.toggle('reduce-motion', !!on); };
  try { applyReduce(localStorage.getItem('callback.reduceFx') === '1'); } catch (e) { /* storage blocked */ }
  doc.addEventListener('change', guard('reduce', (e) => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('[data-fx-reduce]')) return;
    try { localStorage.setItem('callback.reduceFx', t.checked ? '1' : '0'); } catch (x) { /* noop */ }
    applyReduce(t.checked);
    if (CB.UI && CB.UI.toast) CB.UI.toast(t.checked ? 'Glass and motion reduced' : 'Glass and motion restored');
  }));

  // ───────────────────────── wiring ─────────────────────────
  function boot() {
    try { mo.observe(doc.body, { childList: true }); } catch (e) { report(e, 'observe-body'); }
    const v = doc.getElementById('view');
    if (v) { try { mo.observe(v, { childList: true }); } catch (e) { report(e, 'observe-view'); } }
    if (CB.on) {
      CB.on('route', () => { enter(); scan(); onScroll(); });
    }
    scan();
    onScroll();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();

  CB.FX = { countUp, scan, reduced, version: 3 };
})();

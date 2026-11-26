/* Callback v3 — CB.GL: the one shared WebGL hub.  Owner: gl-hub.  Contract: docs/BUILD.md §2,
 * design: docs/research/premium-3d.md (recommendations 1–16, 21).
 *
 * WHY THIS EXISTS: iPhone Safari kills the tab with no warning (and no webglcontextlost) when the WebContent
 * process runs out of memory. v2 created a WebGLRenderer + PMREM per view with MSAA at DPR 2, plus probe contexts.
 * v3 has exactly ONE WebGLRenderer for the life of the app. It renders each view offscreen into its single hidden
 * GL canvas at viewport/scissor (0,0,w,h) and immediately drawImage()s the pixels into the view's own 2D <canvas>
 * ("render + blit"). So DOM stacking, sticky headers, modals and momentum scrolling all behave, and a view keeps its
 * last frame during context loss. No other file may create a WebGLRenderer or call getContext('webgl*').
 *
 * ─── API (exact; BUILD.md §2) ─────────────────────────────────────────────────────────────────────────────────
 * CB.GL.available()          → boolean. Lazily creates the hub (no probe contexts). false in Safe Mode / no WebGL.
 * CB.GL.tier()               → 'ultra'|'high'|'mid'|'low'|'safe'
 * CB.GL.setTier(t)           → force a tier (debug panel / settings). Locks automatic tier changes; the adaptive
 *                              pixel-ratio ladder keeps working. 'safe' = Safe Mode for this session only.
 * CB.GL.on(evt, fn)          → returns unsubscribe(). 'tier' fn(tier, quality) · 'lost' fn() · 'restored' fn()
 *                              After 'restored', re-bake YOUR render targets (env from CB.GL.env is handled for you).
 * CB.GL.THREE                → THREE (r128 global)
 * CB.GL.env(theme)           → shared PMREM studio texture for 'dark'|'light' (default: current theme). Baked once per
 *                              theme; after a context restore it is re-baked IN PLACE (same Texture object, so cached
 *                              references stay valid). null in Safe Mode. A view whose scene.environment is the
 *                              current theme's env is switched to the other theme's env automatically on theme change.
 * CB.GL.color(c)             → NEW THREE.Color converted sRGB→linear. c: 0xRRGGBB | '#hex' | 'rgb()' | any CSS colour |
 *                              a token name '--gold-300' (resolved from the current theme).
 * CB.GL.glowTexture()  CB.GL.dustTexture()  CB.GL.contactShadowTexture()
 *                            → shared, cached CanvasTextures. view.dispose() never disposes them; neither should you.
 * const view = CB.GL.view(hostEl, opts)   — never throws. In Safe Mode / without WebGL / without THREE the host shows
 *                              a static CSS poster (champagne orb + orbit, view.posterEl, view.safe === true), view.el
 *                              still exists (an empty 1×1 canvas) and every method is a harmless no-op. When 3D comes
 *                              back (enable3D) the same view object upgrades to live 3D by itself.
 *   opts: scene, camera          you build them with CB.GL.THREE
 *         update(dt, t, view)    called before each rendered frame; return true while animating. dt is clamped to
 *                                ≤ 0.1 s; t is this view's own animation clock (advances only while rendering, so
 *                                motion never jumps after idle). Returning true does NOT keep the loop alive by
 *                                itself: motion runs at native rate inside kick()/drag windows, at 30 fps for 4 s
 *                                after input (ambient), and stops (0 fps) otherwise. Start tweens with view.kick(ms).
 *         onResize(w, h, view)   CSS px size changed (a PerspectiveCamera's aspect is updated for you first)
 *         interactive: true      pointer/touch handled by you on view.el (hub sets touch-action:pan-y; false sets
 *                                pointer-events:none on the canvas so clicks reach the host)
 *         ambient: true          allow 30 fps ambient motion after input
 *         clearAlpha: 0          transparent by default
 *         poster: 'css'|'none'   CSS placeholder until the first frame (Safe Mode always shows the poster)
 *   view.el → the 2D canvas (absolutely fills host; inserted as host's first child)    view.host
 *   view.invalidate() → request one frame     view.kick(ms = 1000) → render at full rate for ms
 *   view.size → {w, h, dpr} (CSS px; effective device-pixel ratio)   view.project(vec3[, out]) → {x, y, visible} CSS px
 *   view.dispose() → frees that view's scene GPU resources (geometries / materials / textures it created, excluding
 *                    the shared env + hub textures), its canvas memory and observers. Idempotent.
 *   Views must never be torn down on data refresh: mutate your scene and call view.invalidate().
 *   Call view.dispose() when the host leaves for good (route change). A host detached ≥ 2 s without dispose
 *   hibernates (2D canvas → 1×1, scene GPU buffers released but re-uploadable) and wakes when re-attached; past 6
 *   hibernated views the oldest are disposed with a console warning (leak guard).
 *
 * ─── Additions (documented here; all optional) ────────────────────────────────────────────────────────────────
 * CB.GL.off(evt, fn)         → remove a listener (same as calling the function on() returned).
 * CB.GL.renderer             → the raw WebGLRenderer, or null before the hub exists and in Safe Mode (READ-ONLY use:
 *                              XR / compile / info). Never resize it, dispose it, or change tone mapping/encodings.
 * CB.GL.pause() / resume()   → stop / restart the hub loop while a WebXR session owns the renderer (call pause()
 *                              before renderer.xr.setSession, resume() after the session ends and setAnimationLoop
 *                              (null)). resume() restores pixel ratio 1, the hub buffer size, render target null and
 *                              scissor, then redraws every view; it stays paused while renderer.xr.isPresenting.
 * CB.GL.safeMode()           → true when 3D is off (Safe Mode). safeMode(true) turns 3D off and remembers it
 *                              (localStorage 'cb.gl.pref'); safeMode(false) === enable3D(). Safe Mode releases every
 *                              GPU resource and shrinks the buffer to 1×1 but KEEPS the one context, so turning 3D back
 *                              on never creates a second WebGL context.
 * CB.GL.enable3D()           → leave Safe Mode: clears the crash counter + preference, reuses (or, if it is gone,
 *                              recreates) the context, re-bakes env in place and upgrades every existing view from
 *                              poster to live 3D. Returns boolean (false when WebGL is unavailable). After a crash
 *                              the tier starts one step below the heuristic.
 * CB.GL.safeReason()         → null | 'crash' (crash-loop breaker) | 'user' | 'lost' (repeated context loss) |
 *                              'error' (repeated render errors) | 'nogl' (no WebGL / no THREE).
 * CB.GL.quality()            → {tier, dprCap, dpr, aa, dust 0..1, glow, maxGlow, shells, bloom, ambientFps, cap30,
 *                              reducedMotion}. Read it on mount and in on('tier').
 * CB.GL.theme()              → 'dark'|'light' (data-theme attribute, else prefers-color-scheme).
 * CB.GL.reducedMotion()      → boolean (prefers-reduced-motion): make camera moves instant; ambient is off.
 * CB.GL.stats()              → counters for tests / the debug panel: renders, ticks (hub rAF ticks), contexts created,
 *                              losses/restores/rebuilds, buffer, dpr, frame median/p90, memory, per-view mode
 *                              ('idle'|'ambient'|'native'|'offscreen'|'detached'|'poster') and frames.
 * CB.GL.debug(on)            → show/hide the QA panel (also ?debug=gl or #debug=gl or localStorage cb.gl.debug=1).
 * CB.GL.kit                  → shared art-direction helpers ("orrery in a black vitrine"); each returns NEW objects
 *                              that your scene owns (view.dispose() frees them):
 *     kit.metal({color='#DDBE82', roughness=.22, envMapIntensity=1.25})         champagne metal (MeshStandard)
 *     kit.lacquer({color='#0E0F12'})                                           black lacquer (MeshPhysical)
 *     kit.crystal({color='#141416', colorLight='#3A2C14', opacity=.2, frosted=false, rim='#E8D3A4', rimLight='#8C6A2E',
 *                  rimStrength=.45, rimPower=3.5, envMapIntensity=.9, side}) fake crystal + fresnel rim (theme-tracked)
 *     kit.rim(material, {color, power=3, strength=.8})                         add the fresnel rim to any Standard/Physical
 *     kit.glow({color, size=1, opacity}) → Sprite (additive on dark, normal on light; follows theme)
 *     kit.shadow({width=1, depth=.6, opacity=.42}) → contact-shadow plane (rotate/position it yourself)
 *     kit.dust({count=300, spread=[6,3,4], center=[0,0,0], size=.035, color, opacity=.55, focus=6, aperture=.18,
 *               drift=.05}) → Points with fake depth of field; count scaled by quality().dust automatically
 *     kit.lights(scene, {intensity=1}) → {hemi, key, rim} (hemisphere + key + warm rim; no shadow maps)
 * view opts additions: clearColor (0x000000), exposure (number | fn(theme); default .95 dark / 1.05 light),
 *   intro (ms of native-rate rendering after the first frame for entry choreography; default 1200, 0 = none),
 *   name (debug label), label (aria-label of the canvas), autoDispose (ms: dispose automatically once the host
 *   has been detached from the DOM that long; default off — detached views hibernate, see view.dispose()).
 * view additions: view.safe, view.frames, view.posterEl, view.scene / view.camera (settable).
 *
 * ─── Renderer contract (shared by every scene) ───────────────────────────────────────────────────────────────
 * r128, outputEncoding sRGB, ACESFilmic tone mapping (exposure per view), physicallyCorrectLights false (light
 * intensities as in premium-3d.md §7), no shadow maps, stencil off, no MSAA on iOS / touch devices, pixel ratio 1
 * (all sizing in device px by the hub). No transmission, no float render targets, no `flat` varyings.
 *
 * ─── Robustness ──────────────────────────────────────────────────────────────────────────────────────────────
 * Crash-loop breaker: localStorage 'cb.gl.boot' is incremented right before the renderer is created and reset to 0
 * after 10 s of stable rendering, on pagehide and when the page is hidden (re-armed to 1 when it is shown again) —
 * but only by a session that raised it, so a Safe Mode session never clears it by reloading. At boot 1 → start one
 * tier lower; ≥ 2 → Safe Mode with an "Enable 3D" control in each poster that is ≥ 220×140 px.
 * Context loss: preventDefault, stop, 4 s watchdog; on restore re-bake env in place, recompile, redraw, emit
 * 'restored'. Watchdog → rebuild the renderer once; a second failure or another loss within 60 s → Safe Mode.
 * Pacing: idle 0 fps; 30 fps ambient ≤ 4 s after input; native while dragging / kicked. Paused off-screen
 * (IntersectionObserver, 64 px margin) and while document.hidden. Adaptive pixel ratio from measured frame time
 * (ladder 2 → 1.75 → 1.5 → 1.25 → 1, then a tier down, then 30 fps cap; a steady 33 ms is treated as throttling).
 * prefers-reduced-motion: no intro, no ambient, hover gives one frame; only an active drag renders continuously.
 * Memory budget: 64 MB (48 MB standalone) on iOS, 192 MB elsewhere, for view canvases + GL buffer + env; over it,
 * every view's pixel ratio is scaled down. Buffer ≤ 3 MP on iOS. QA page: tools/gl-debug.html.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  if (CB.GL && CB.GL.__hub) return;

  // ───────────────────────── small utils ─────────────────────────
  const LS_BOOT = 'cb.gl.boot';
  const LS_PREF = 'cb.gl.pref';
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* private mode / quota */ } },
    del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* noop */ } },
  };
  const mql = (q) => { try { return window.matchMedia ? window.matchMedia(q) : null; } catch (e) { return null; } };
  const mm = (q) => { const m = mql(q); return !!(m && m.matches); };
  const onMQ = (q, fn) => { const m = mql(q); if (!m) return; if (m.addEventListener) m.addEventListener('change', fn); else if (m.addListener) m.addListener(fn); };
  const now = () => (window.performance && performance.now ? performance.now() : Date.now());
  const T3 = () => window.THREE;
  const warn = (...a) => { try { console.warn('[CB.GL]', ...a); } catch (e) { /* noop */ } };
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

  // ───────────────────────── platform + tiers ─────────────────────────
  const nav = window.navigator || {};
  const UA = nav.userAgent || '';
  const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const IS_STANDALONE = nav.standalone === true || mm('(display-mode: standalone)');
  const COARSE = mm('(pointer: coarse)');
  const TIERS = ['safe', 'low', 'mid', 'high', 'ultra'];
  const Q = {
    ultra: { dprCap: 2, dust: 1, glow: true, maxGlow: 64, shells: true, bloom: true },
    high: { dprCap: 2, dust: 0.75, glow: true, maxGlow: 32, shells: true, bloom: false },
    mid: { dprCap: 1.5, dust: 0.5, glow: true, maxGlow: 16, shells: true, bloom: false },
    low: { dprCap: 1.25, dust: 0, glow: true, maxGlow: 6, shells: false, bloom: false },
    safe: { dprCap: 1, dust: 0, glow: false, maxGlow: 0, shells: false, bloom: false },
  };
  const LADDER = [2, 1.75, 1.5, 1.25, 1];
  const AMBIENT_MS = 4000;
  const AMBIENT_FPS = 30;
  const WATCHDOG_MS = 4000;
  const STABLE_MS = 10000;
  const RELOSS_MS = 60000;
  const tierIdx = (t) => TIERS.indexOf(t);
  const lowerTier = (t) => TIERS[Math.max(1, tierIdx(t) - 1)];

  /** Starting tier from what Safari actually exposes (no deviceMemory, clamped cores, every GPU is "Apple GPU"). */
  function heuristicTier() {
    const dpr = window.devicePixelRatio || 1;
    const s = window.screen || {};
    const short = Math.min(s.width || window.innerWidth || 0, s.height || window.innerHeight || 0) || 9999;
    if (IS_IOS) {
      const phone = /iPhone|iPod/.test(UA) || short <= 480;
      if (!phone) return 'high'; // iPad: pixel ratio cap 2, no MSAA
      if (dpr >= 3) return 'high'; // iPhone 12+ class: cap 2, no MSAA (premium-3d T2)
      if (short <= 414) return 'low'; // SE / XR / 11 class
      return 'mid';
    }
    if (COARSE && nav.maxTouchPoints > 0) return 'mid'; // Android phones / tablets
    return (nav.hardwareConcurrency || 4) >= 8 ? 'ultra' : 'high';
  }

  // ───────────────────────── hub state ─────────────────────────
  const H = {
    renderer: null, canvas: null, gl: null, contexts: 0, aa: false, isGL2: false,
    bufW: 0, bufH: 0, shrink: false,
    tier: 'high', start: 'high', heuristic: 'high', reason: null, manual: false,
    dprStep: 0, budgetScale: 1, cap30: false, estBytes: 0,
    lost: false, lostAt: 0, restoredAt: 0, wd: 0, rebuilds: 0, losses: 0, restores: 0, armed: false, enabling: false, ticks: 0,
    paused: false, raf: 0, lastTick: 0, renderedLastTick: false, settleUntil: 0, tickErrors: 0,
    views: [], vid: 0, env: {}, shared: new Set(), tex: {}, dust: new Set(), glows: new Set(), crystals: new Set(),
    renders: 0, calls: 0, tris: 0, cpuMs: 0, bootAtLoad: 0, stableT: 0, lastTheme: '',
    reduced: mm('(prefers-reduced-motion: reduce)'), lastGlobalInput: 0, obs: false, io: null, ro: null,
    uScale: { value: 400 }, uTime: { value: 0 }, listeners: {}, sweepT: 0,
  };
  // adaptive-quality sampler (premium-3d rec 12)
  const S = { boot: [], refreshMs: 16.67, refreshKnown: false, throttled: false, win: [], cpu: [], hist: [],
    down: 0, up: 0, lastChange: 0, lastDir: 0, flips: 0, locked: false, med: 0, p90: 0 };

  H.heuristic = heuristicTier();
  H.bootAtLoad = parseInt(store.get(LS_BOOT) || '0', 10) || 0;
  (function initTier() {
    let t = H.heuristic;
    if (H.bootAtLoad === 1) { if (t === 'low') H.dprStep = LADDER.length - 1; else t = lowerTier(t); }
    H.tier = H.start = t;
    if (!T3() || !T3().WebGLRenderer || !window.WebGLRenderingContext) { H.tier = 'safe'; H.reason = 'nogl'; }
    else if (store.get(LS_PREF) === 'safe') { H.tier = 'safe'; H.reason = 'user'; }
    else if (H.bootAtLoad >= 2) { H.tier = 'safe'; H.reason = 'crash'; }
  })();

  // ───────────────────────── events ─────────────────────────
  function on(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    (H.listeners[evt] = H.listeners[evt] || []).push(fn);
    return () => off(evt, fn);
  }
  function off(evt, fn) { const a = H.listeners[evt]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  function emit(evt, a, b) {
    (H.listeners[evt] || []).slice().forEach((f) => { try { f(a, b); } catch (e) { warn('listener "' + evt + '" failed', e); } });
  }

  // ───────────────────────── theme / quality ─────────────────────────
  function theme() {
    const a = document.documentElement && document.documentElement.getAttribute('data-theme');
    if (a === 'light' || a === 'dark') return a;
    return mm('(prefers-color-scheme: light)') ? 'light' : 'dark';
  }
  function baseDpr() { return Math.min(window.devicePixelRatio || 1, (Q[H.tier] || Q.safe).dprCap, LADDER[H.dprStep]); }
  function quality() {
    const q = Q[H.tier] || Q.safe;
    return { tier: H.tier, dprCap: q.dprCap, dpr: baseDpr(), aa: H.aa, dust: q.dust, glow: q.glow, maxGlow: q.maxGlow,
      shells: q.shells, bloom: q.bloom && !IS_IOS, ambientFps: H.cap30 ? 30 : AMBIENT_FPS, cap30: H.cap30, reducedMotion: H.reduced };
  }

  // ───────────────────────── colour ─────────────────────────
  let normCtx = null;
  function cssColor(str) {
    // Normalise any CSS colour (tokens may be oklch()/color-mix()) through a 1×1 2D context.
    try {
      if (!normCtx) { const c = document.createElement('canvas'); c.width = c.height = 1; normCtx = c.getContext('2d'); }
      if (!normCtx) return str;
      normCtx.fillStyle = '#000';
      normCtx.fillStyle = str;
      return normCtx.fillStyle;
    } catch (e) { return str; }
  }
  function color(c) {
    const T = T3();
    let v = c;
    if (typeof v === 'string') {
      v = v.trim();
      const m = /^var\(\s*(--[\w-]+)/.exec(v);
      if (m) v = m[1];
      if (v.indexOf('--') === 0) {
        try { v = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); } catch (e) { v = ''; }
      }
      if (v && !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) v = cssColor(v);
    }
    if (!T) return { r: 1, g: 1, b: 1, isColor: false };
    const col = new T.Color(1, 1, 1);
    try {
      if (typeof v === 'number' || (v && v.isColor)) col.set(v);
      else if (typeof v === 'string' && v) {
        const rgb = /^rgba?\(([^)]+)\)/i.exec(v);
        if (rgb) { const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); col.setRGB((p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255); }
        else col.set(v);
      }
    } catch (e) { col.setRGB(1, 1, 1); }
    return col.convertSRGBToLinear();
  }

  // ───────────────────────── shared textures ─────────────────────────
  function canvasTex(key, size, draw) {
    if (H.tex[key]) return H.tex[key];
    const T = T3();
    if (!T) return null;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    if (g) { try { draw(g, size); } catch (e) { warn('texture draw failed', e); } }
    const t = new T.CanvasTexture(c);
    t.name = 'cbgl.' + key;
    t.needsUpdate = true;
    H.tex[key] = t;
    H.shared.add(t);
    return t;
  }
  function radial(g, s, stops) {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    stops.forEach((st) => gr.addColorStop(st[0], st[1]));
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }
  const glowTexture = () => canvasTex('glow', 128, (g, s) => radial(g, s, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,.55)'], [0.45, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']]));
  const dustTexture = () => canvasTex('dust', 64, (g, s) => radial(g, s, [[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,.85)'], [0.5, 'rgba(255,255,255,.22)'], [1, 'rgba(255,255,255,0)']]));
  const contactShadowTexture = () => canvasTex('shadow', 128, (g, s) => radial(g, s, [[0, 'rgba(0,0,0,.55)'], [0.35, 'rgba(0,0,0,.32)'], [0.7, 'rgba(0,0,0,.08)'], [1, 'rgba(0,0,0,0)']]));

  // ───────────────────────── renderer lifecycle ─────────────────────────
  function canRun() { return !!H.renderer && !H.lost && !H.paused && H.tier !== 'safe' && !document.hidden; }

  function armStability() {
    clearTimeout(H.stableT);
    H.stableT = setTimeout(() => { if (H.renderer && !H.lost && !document.hidden && H.tier !== 'safe') store.set(LS_BOOT, 0); }, STABLE_MS);
  }

  function createRenderer() {
    if (H.renderer) return true;
    if (H.tier === 'safe') return false;
    const T = T3();
    if (!T || !T.WebGLRenderer || !window.WebGLRenderingContext) { toSafe('nogl'); return false; }
    const canvas = document.createElement('canvas');
    canvas.className = 'cbgl-hub';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.tabIndex = -1;
    // Attached but invisible. Never display:none (Safari 17.0–17.3 slow drawImage path).
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;border:0;margin:0;padding:0';
    (document.body || document.documentElement).appendChild(canvas);
    const before = parseInt(store.get(LS_BOOT) || '0', 10) || 0;
    store.set(LS_BOOT, before + 1); // crash-loop breaker: raised while a 3D session is young
    H.armed = true; // this session owns the counter now (pagehide / hidden may clear it)
    H.aa = !IS_IOS && !COARSE && (H.tier === 'ultra' || H.tier === 'high');
    let r = null;
    const attrs = { alpha: true, depth: true, stencil: false, antialias: H.aa, premultipliedAlpha: true,
      preserveDrawingBuffer: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false };
    try {
      // We request THE context ourselves (exactly one getContext call when WebGL2 exists, and no console error
      // from three when WebGL is unavailable), then hand it to three. This is not a probe: it is the hub's context.
      let gl = null;
      const kinds = ['webgl2', 'webgl', 'experimental-webgl'];
      for (let i = 0; i < kinds.length && !gl; i++) { try { gl = canvas.getContext(kinds[i], attrs); } catch (e) { gl = null; } }
      if (!gl) throw new Error('no WebGL context');
      r = new T.WebGLRenderer(Object.assign({ canvas, context: gl }, attrs));
    } catch (e) {
      try { canvas.remove(); } catch (e2) { /* noop */ }
      store.set(LS_BOOT, before);
      H.armed = false;
      warn('WebGL unavailable (' + ((e && e.message) || e) + '): showing static posters');
      toSafe('nogl');
      return false;
    }
    try {
      r.setPixelRatio(1);
      r.outputEncoding = T.sRGBEncoding;
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = 1;
      r.physicallyCorrectLights = false;
      r.shadowMap.enabled = false;
      r.autoClear = true;
      r.setClearColor(0x000000, 0);
      r.setSize(64, 64, false);
    } catch (e) { warn('renderer setup', e); }
    H.renderer = r;
    H.canvas = canvas;
    H.gl = r.getContext();
    H.isGL2 = !!(r.capabilities && r.capabilities.isWebGL2);
    H.bufW = H.bufH = 64;
    H.contexts++;
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
    globalListeners();
    armStability();
    return true;
  }

  function disposeRenderer() {
    const r = H.renderer, c = H.canvas;
    H.renderer = null; H.canvas = null;
    const gl = H.gl; H.gl = null;
    clearTimeout(H.stableT);
    if (c) { c.removeEventListener('webglcontextlost', onLost); c.removeEventListener('webglcontextrestored', onRestored); }
    try { if (r) r.dispose(); } catch (e) { /* noop */ }
    try { if (r && gl && !gl.isContextLost()) r.forceContextLoss(); } catch (e) { /* noop */ }
    try { if (c) { c.width = c.height = 1; c.remove(); } } catch (e) { /* noop */ }
    Object.keys(H.env).forEach((k) => { H.env[k].ok = false; });
    H.bufW = H.bufH = 0;
  }

  /** Lazily start the hub. false in Safe Mode or when WebGL can't be created. */
  function ensureHub() {
    if (H.tier === 'safe') return false;
    if (H.renderer) return true;
    const ok = createRenderer();
    if (ok) { ensureObservers(); schedule(); }
    return ok;
  }

  /** Free every GPU resource the hub knows about while keeping the JS objects usable (three re-uploads on the
   *  next render). Used by Safe Mode so the one context can stay alive, empty, and be reused by enable3D(). */
  function releaseGPU() {
    const r = H.renderer;
    if (!r) return;
    H.views.forEach((V) => { try { freeScene(V.scene); } catch (e) { /* noop */ } V.compiled = false; });
    Object.keys(H.env).forEach((k) => { try { H.env[k].rt.dispose(); } catch (e) { /* noop */ } H.env[k].ok = false; });
    Object.keys(H.tex).forEach((k) => { try { H.tex[k].dispose(); } catch (e) { /* noop */ } });
    try { r.renderLists.dispose(); } catch (e) { /* noop */ }
    try { r.setRenderTarget(null); r.setSize(1, 1, false); H.bufW = H.bufH = 1; } catch (e) { /* noop */ }
  }

  function toSafe(reason) {
    const was = H.tier;
    H.reason = reason || H.reason || 'user';
    H.tier = 'safe';
    H.enabling = false;
    stopLoop();
    clearTimeout(H.wd); H.wd = 0;
    clearTimeout(H.stableT);
    // Keep the single context (1×1 buffer, no GPU resources) so "Enable 3D" never needs a second WebGL context.
    if (H.renderer) releaseGPU();
    H.views.forEach((V) => {
      V.shown = false; V.compiled = false; V.w = V.h = 0;
      if (V.el) { try { V.el.width = V.el.height = 1; V.ctx = null; } catch (e) { /* noop */ } }
      syncPoster(V);
    });
    if (was !== 'safe') emit('tier', 'safe', quality());
    debugRender();
  }

  function enable3D() {
    store.del(LS_PREF);
    store.set(LS_BOOT, 0);
    if (!T3() || !T3().WebGLRenderer || !window.WebGLRenderingContext) { H.reason = 'nogl'; syncAllPosters(); return false; }
    if (H.tier !== 'safe' && (H.renderer || H.enabling)) return true;
    const wasCrash = H.reason === 'crash' || H.reason === 'lost' || H.reason === 'error';
    const prevReason = H.reason;
    H.reason = null;
    H.tier = H.start = wasCrash ? lowerTier(H.heuristic) : H.heuristic;
    H.manual = false; H.cap30 = false; H.rebuilds = 0; H.restoredAt = 0;
    S.locked = false; S.flips = 0; S.lastDir = 0; S.down = S.up = 0; S.win.length = 0;
    if (H.renderer && (H.lost || isLost())) {
      // The kept context is lost. A WEBGL_lose_context loss restores in place (still one context); a real GPU
      // reset normally restores by itself. If nothing arrives within 1.5 s, replace the renderer.
      H.lost = true;
      H.enabling = true;
      try { H.renderer.forceContextRestore(); } catch (e) { /* not lost via the extension */ }
      clearTimeout(H.wd);
      H.wd = setTimeout(() => {
        H.wd = 0;
        if (!H.enabling) return;
        H.enabling = false;
        disposeRenderer();
        H.lost = false;
        if (createRenderer()) finishEnable(); else toSafe(prevReason === 'nogl' ? 'nogl' : 'lost');
      }, 1500);
      syncAllPosters();
      debugRender();
      return true;
    }
    H.lost = false;
    if (!H.renderer && !createRenderer()) return false;
    finishEnable();
    return true;
  }
  function finishEnable() {
    H.enabling = false;
    H.lost = false;
    if (!((parseInt(store.get(LS_BOOT) || '0', 10) || 0) > 0)) store.set(LS_BOOT, 1); // kept context: no createRenderer() increment
    H.armed = true;
    ensureObservers();
    rebakeEnvs();
    H.settleUntil = now() + 1000;
    H.views.forEach((V) => { V.shown = false; V.compiled = false; V.dirty = true; V.needsResize = true; V.lastResize = -1e9; V.failed = false; V.errors = 0; syncPoster(V); });
    armStability();
    emit('tier', H.tier, quality());
    schedule();
    debugRender();
  }

  function safeMode(onOff) {
    if (onOff === undefined) return H.tier === 'safe';
    if (onOff) { store.set(LS_PREF, 'safe'); toSafe('user'); return true; }
    return enable3D();
  }

  function setTier(t) {
    if (tierIdx(t) < 0) return H.tier;
    if (t === 'safe') { toSafe('user'); return H.tier; }
    if (H.tier === 'safe') { if (!enable3D()) return H.tier; }
    const prev = H.tier;
    H.manual = true;
    H.tier = t;
    if (tierIdx(t) < tierIdx(prev)) H.shrink = true;
    applyTier(prev);
    return H.tier;
  }

  /** Called after any tier change: resize views, dust counts, notify. */
  function applyTier(prev) {
    updateDust();
    resizeAll();
    H.settleUntil = now() + 1000;
    if (prev !== H.tier) emit('tier', H.tier, quality());
    debugRender();
  }

  // ───────────────────────── environment (PMREM, once per theme) ─────────────────────────
  function studioScene(th) {
    const T = T3();
    const dark = th !== 'light';
    const scene = new T.Scene();
    const trash = [];
    const add = (geo, mat, pos) => {
      trash.push(geo, mat);
      const m = new T.Mesh(geo, mat);
      if (pos) { m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); }
      scene.add(m);
    };
    // "Black vitrine" product studio: dark surround, a soft key, narrow strip boxes for crisp metal highlights,
    // a champagne rim behind. Values are linear HDR (PMREM bakes RGBE), so > 1 is fine.
    add(new T.BoxGeometry(24, 24, 24), new T.MeshBasicMaterial({ color: dark ? 0x060606 : 0x5a5853, side: T.BackSide }));
    const panel = (w, h, hex, k, pos) => add(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(hex).multiplyScalar(k), side: T.DoubleSide }), pos);
    panel(14, 14, dark ? '#24221f' : '#d9d5cc', dark ? 0.35 : 0.8, [0, 11, 0]); // ceiling wash (top-down gradient on metals)
    panel(5, 3.5, '#ffffff', dark ? 6.0 : 5.0, [-6, 7, 7]); // key softbox
    panel(1.6, 10, '#ffffff', dark ? 3.4 : 2.8, [9, 1, 4]); // right strip (vertical highlight line)
    panel(1.4, 10, '#fff6e6', dark ? 2.0 : 1.8, [-11, 0, -2]); // left strip
    panel(10, 2.5, '#E6CF9A', dark ? 3.2 : 2.4, [1, 4, -10]); // champagne rim
    panel(4, 4, '#dfe6f2', dark ? 0.8 : 1.2, [8, -2, 6]); // cool fill
    panel(16, 3, '#E6CF9A', dark ? 0.35 : 0.9, [0, -8, 1]); // warm floor bounce
    return { scene, trash };
  }
  function copyRT(src, dst) {
    const T = T3(), r = H.renderer;
    const mat = new T.ShaderMaterial({
      uniforms: { map: { value: src.texture } },
      vertexShader: 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D map;\nvarying vec2 vUv;\nvoid main(){ gl_FragColor = texture2D(map, vUv); }',
      depthTest: false, depthWrite: false, blending: T.NoBlending, toneMapped: false,
    });
    const geo = new T.PlaneGeometry(2, 2);
    const sc = new T.Scene();
    sc.add(new T.Mesh(geo, mat));
    dst.scissorTest = false;
    dst.viewport.set(0, 0, dst.width, dst.height);
    dst.scissor.set(0, 0, dst.width, dst.height);
    const prev = r.getRenderTarget();
    r.setRenderTarget(dst);
    r.render(sc, new T.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    r.setRenderTarget(prev);
    geo.dispose(); mat.dispose();
  }
  /** Bake the studio PMREM. With `reuse`, the result lands in that same render target (identity preserved). */
  function bakeEnv(th, reuse) {
    const T = T3(), r = H.renderer;
    const pm = new T.PMREMGenerator(r);
    if (reuse && typeof pm._allocateTargets === 'function') {
      const orig = pm._allocateTargets;
      pm._allocateTargets = function (tex) {
        const fresh = orig.call(this, tex);
        reuse.depthBuffer = fresh.depthBuffer;
        fresh.dispose();
        return reuse;
      };
    }
    const st = studioScene(th);
    let rt = null;
    const prevTarget = r.getRenderTarget();
    try { rt = pm.fromScene(st.scene, 0.04); } finally {
      try { pm.dispose(); } catch (e) { /* noop */ }
      st.trash.forEach((d) => { try { d.dispose(); } catch (e) { /* noop */ } });
      r.setRenderTarget(prevTarget);
    }
    if (reuse && rt !== reuse) { copyRT(rt, reuse); rt.dispose(); rt = reuse; }
    rt.texture.name = 'cbgl.env.' + th;
    return rt;
  }
  function env(name) {
    const th = name === 'light' || name === 'dark' ? name : theme();
    const e = H.env[th];
    if (!ensureHub() || H.lost) return e ? e.rt.texture : null;
    if (e && e.ok) return e.rt.texture;
    try {
      const rt = bakeEnv(th, e ? e.rt : null);
      H.env[th] = { rt, ok: true };
      H.shared.add(rt.texture);
      return rt.texture;
    } catch (err) { warn('environment bake failed', err); return e ? e.rt.texture : null; }
  }
  function rebakeEnvs() {
    if (!H.renderer) return;
    Object.keys(H.env).forEach((th) => {
      try { H.env[th].rt = bakeEnv(th, H.env[th].rt); H.env[th].ok = true; } catch (e) { warn('env re-bake failed', e); }
    });
  }

  // ───────────────────────── context loss ─────────────────────────
  function onLost(e) {
    if (e && e.preventDefault) e.preventDefault();
    const t = now();
    H.lost = true; H.losses++;
    if (H.tier === 'safe') { debugRender(); return; } // the kept, empty context: nothing to recover
    stopLoop();
    clearTimeout(H.stableT);
    emit('lost');
    if (H.restoredAt && t - H.restoredAt < RELOSS_MS) { warn('context lost again within 60 s → Safe Mode'); toSafe('lost'); return; }
    H.lostAt = t;
    clearTimeout(H.wd);
    H.wd = setTimeout(watchdog, WATCHDOG_MS);
    debugRender();
  }
  function afterRecovery() {
    H.lost = false;
    H.restoredAt = now();
    H.restores++;
    try { rebakeEnvs(); } catch (e) { warn('re-bake', e); }
    H.views.forEach((V) => { V.compiled = false; V.dirty = true; });
    H.settleUntil = now() + 1000;
    armStability();
    emit('restored');
    schedule();
    debugRender();
  }
  function onRestored() {
    clearTimeout(H.wd); H.wd = 0;
    if (H.enabling) { finishEnable(); return; }
    if (H.tier === 'safe') { H.lost = false; debugRender(); return; } // stay in Safe Mode until Enable 3D
    afterRecovery();
  }
  function watchdog() {
    H.wd = 0;
    if (!H.lost) return;
    H.rebuilds++;
    disposeRenderer();
    if (H.rebuilds > 1) { toSafe('lost'); return; }
    warn('context was not restored within 4 s → rebuilding the renderer once');
    if (!createRenderer()) return;
    afterRecovery();
  }

  // ───────────────────────── views ─────────────────────────
  function ensureObservers() {
    if (H.obs) return;
    H.obs = true;
    if ('IntersectionObserver' in window) {
      H.io = new IntersectionObserver(onIO, { rootMargin: '64px' });
      H.views.forEach((V) => { if (V.host) H.io.observe(V.host); });
    }
    if ('ResizeObserver' in window) {
      H.ro = new ResizeObserver(onRO);
      H.views.forEach((V) => { if (V.host) H.ro.observe(V.host); });
    }
  }
  const viewsOf = (host) => H.views.filter((V) => V.host === host);
  function onIO(entries) {
    const t = now();
    entries.forEach((en) => {
      viewsOf(en.target).forEach((V) => {
        V.visible = en.isIntersecting;
        const connected = en.target.isConnected;
        if (!connected) { if (!V.detachedAt) V.detachedAt = t; armSweep(); }
        else {
          V.detachedAt = 0;
          if (!V.posChecked) checkPos(V);
          if (V.hibernated) wake(V);
        }
      });
    });
    schedule();
  }
  function onRO(entries) {
    entries.forEach((en) => viewsOf(en.target).forEach((V) => { V.needsResize = true; }));
    schedule();
  }
  function armSweep() { if (!H.sweepT) H.sweepT = setTimeout(sweep, 2000); }
  const MAX_HIBERNATED = 6;
  /** Every 2 s while views exist: a host detached for ≥ 2 s hibernates (2D canvas freed, its scene's GPU buffers
   *  released but re-uploadable); re-attaching wakes it. autoDispose disposes for good. Leak guard: callers must
   *  dispose() views whose host is gone for good; past 6 hibernated views the oldest are disposed. */
  function sweep() {
    H.sweepT = 0;
    const t = now();
    const hib = [];
    H.views.slice().forEach((V) => {
      if (V.disposed) return;
      if (V.host && V.host.isConnected) { V.detachedAt = 0; if (V.hibernated) wake(V); return; }
      if (!V.detachedAt) V.detachedAt = t;
      const age = t - V.detachedAt;
      if (V.opts.autoDispose > 0 && age >= V.opts.autoDispose) { disposeView(V); return; }
      if (age >= 2000 && !V.hibernated) hibernate(V);
      if (V.hibernated) hib.push(V);
    });
    if (hib.length > MAX_HIBERNATED) {
      hib.sort((a, b) => a.detachedAt - b.detachedAt).slice(0, hib.length - MAX_HIBERNATED).forEach((V) => {
        warn('view "' + V.name + '" was detached and never disposed; disposing it (call view.dispose() when its host goes away)');
        disposeView(V);
      });
    }
    if (H.views.length) armSweep();
  }
  function hibernate(V) {
    V.hibernated = true; V.shown = false; V.w = V.h = 0; V.ctx = null;
    try { V.el.width = V.el.height = 1; } catch (e) { /* noop */ }
    try { if (H.renderer && !H.lost) freeScene(V.scene); } catch (e) { /* noop */ }
    V.compiled = false;
    syncPoster(V, true);
    debugRender();
  }
  function wake(V) {
    V.hibernated = false; V.detachedAt = 0; V.needsResize = true; V.lastResize = -1e9; V.dirty = true; V.compiled = false;
    if (!V.posChecked) checkPos(V);
    syncPoster(V);
    schedule();
  }
  function checkPos(V) {
    V.posChecked = true;
    try {
      if (getComputedStyle(V.host).position === 'static') { V.host.style.position = 'relative'; V.setPos = true; }
    } catch (e) { /* noop */ }
  }

  function makePoster(V) {
    const p = document.createElement('div');
    p.className = 'cbgl-poster';
    p.innerHTML = '<div class="cbgl-art" aria-hidden="true"><i class="cbgl-halo"></i><i class="cbgl-ring cbgl-ring-b"></i>' +
      '<i class="cbgl-ring cbgl-glass"></i><i class="cbgl-floor"></i><i class="cbgl-orb"></i><i class="cbgl-ring cbgl-ring-f"></i>' +
      '<i class="cbgl-moon"></i></div>';
    V.poster = p;
    return p;
  }
  const ENABLE_TITLES = {
    crash: '3D was paused after the app closed unexpectedly. Turn it back on.',
    lost: '3D was paused because the graphics processor reset. Turn it back on.',
    error: '3D was paused after a rendering error. Turn it back on.',
    user: '3D views are off. Turn them back on.',
  };
  function syncPoster(V, instant) {
    const p = V.poster, el = V.el;
    if (!p || !el) return;
    const safe = H.tier === 'safe' || V.failed;
    if (instant) { p.classList.add('is-instant'); el.classList.add('is-instant'); }
    p.classList.toggle('is-safe', safe);
    el.classList.toggle('is-on', !safe && V.shown);
    p.classList.toggle('is-off', !safe && (V.shown || V.opts.poster === 'none'));
    const reason = V.failed && H.tier !== 'safe' ? null : H.reason;
    const wantBtn = H.tier === 'safe' && !!ENABLE_TITLES[reason];
    if (wantBtn && !V.enableBtn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cbgl-enable';
      b.textContent = 'Enable 3D';
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); enable3D(); });
      p.appendChild(b);
      V.enableBtn = b;
    } else if (!wantBtn && V.enableBtn) { V.enableBtn.remove(); V.enableBtn = null; }
    if (V.enableBtn) V.enableBtn.title = ENABLE_TITLES[reason] || '';
    if (instant) requestAnimationFrame(() => { p.classList.remove('is-instant'); el.classList.remove('is-instant'); });
  }
  function syncAllPosters() { H.views.forEach((V) => syncPoster(V)); }

  function view(host, opts) {
    opts = opts || {};
    const V = {
      id: ++H.vid, host: host && host.nodeType === 1 ? host : null, opts, scene: opts.scene || null, camera: opts.camera || null,
      name: String(opts.name || 'view ' + (H.vid)), el: null, ctx: null, poster: null, enableBtn: null,
      cssW: 0, cssH: 0, w: 0, h: 0, dpr: 1, size: { w: 0, h: 0, dpr: 1 },
      dirty: true, kickUntil: 0, ambientUntil: 0, pointerDown: false, animating: true,
      visible: true, time: 0, lastRender: 0, frames: 0, errors: 0, failed: false,
      compiled: false, shown: false, needsResize: true, lastResize: -1e9, disposed: false,
      detachedAt: 0, hibernated: false, setPos: false, posChecked: false,
      interactive: opts.interactive !== false, ambient: opts.ambient !== false,
      clearAlpha: opts.clearAlpha == null ? 0 : +opts.clearAlpha, clearColor: opts.clearColor == null ? 0x000000 : opts.clearColor,
      listeners: [],
    };
    const api = {
      host: V.host,
      size: V.size,
      get el() { return V.el; },
      get safe() { return H.tier === 'safe' || V.failed; },
      get frames() { return V.frames; },
      get posterEl() { return V.poster; },
      get scene() { return V.scene; },
      set scene(s) { V.scene = s || null; V.compiled = false; V.dirty = true; schedule(); },
      get camera() { return V.camera; },
      set camera(c) { V.camera = c || null; V.compiled = false; V.needsResize = true; V.dirty = true; schedule(); },
      invalidate() { if (V.disposed) return; V.dirty = true; schedule(); },
      kick(ms) {
        if (V.disposed) return;
        const d = ms == null ? 1000 : Math.max(0, +ms || 0);
        V.kickUntil = Math.max(V.kickUntil, now() + d);
        V.animating = true;
        schedule();
      },
      project(p, out) {
        const o = out || {};
        o.x = 0; o.y = 0; o.visible = false;
        const T = T3();
        if (!T || !V.camera || !p) return o;
        if (!V.size.w && V.host) { V.size.w = V.host.clientWidth; V.size.h = V.host.clientHeight; }
        const v = H.tmpV || (H.tmpV = new T.Vector3());
        v.set(+p.x || 0, +p.y || 0, +p.z || 0);
        try { V.camera.updateMatrixWorld(); v.project(V.camera); } catch (e) { return o; }
        o.x = ((v.x + 1) / 2) * V.size.w;
        o.y = ((1 - v.y) / 2) * V.size.h;
        o.visible = v.z > -1 && v.z < 1 && v.x >= -1.02 && v.x <= 1.02 && v.y >= -1.02 && v.y <= 1.02;
        return o;
      },
      dispose() { disposeView(V); },
    };
    V.view = api;
    try {
      injectCSS();
      const el = document.createElement('canvas');
      el.className = 'cbgl-view';
      el.width = el.height = 1;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', String(opts.label || '3D view'));
      if (!V.interactive) el.classList.add('is-static');
      else el.style.touchAction = 'pan-y';
      V.el = el;
      makePoster(V);
      if (V.host) {
        if (V.host.isConnected) checkPos(V);
        V.host.insertBefore(el, V.host.firstChild);
        V.host.insertBefore(V.poster, el);
      }
      if (V.interactive) {
        const add = (ev, fn) => { el.addEventListener(ev, fn, { passive: true }); V.listeners.push([ev, fn]); };
        add('pointerdown', () => { V.pointerDown = true; viewInput(V, 0); });
        add('pointermove', () => { viewInput(V, V.pointerDown ? 0 : 250); });
        add('wheel', () => { viewInput(V, 400); });
      }
    } catch (e) { warn('view DOM setup failed', e); }
    if (!V.host) { V.disposed = true; return api; } // nothing to draw into: inert view, never throws
    H.views.push(V);
    armSweep();
    globalListeners();
    if (H.tier !== 'safe') ensureHub();
    if (H.obs) {
      if (H.io) { V.visible = false; H.io.observe(V.host); }
      if (H.ro) H.ro.observe(V.host);
    }
    V.ambientUntil = now() + AMBIENT_MS;
    syncPoster(V);
    schedule();
    return api;
  }

  function viewInput(V, kickMs) {
    const t = now();
    V.animating = true;
    if (V.ambient && !H.reduced) V.ambientUntil = t + AMBIENT_MS;
    // Reduced motion: hover / wheel give one frame (render on demand); only an active drag renders continuously.
    if (kickMs) { if (H.reduced) V.dirty = true; else V.kickUntil = Math.max(V.kickUntil, t + kickMs); }
    schedule();
  }

  /** keepRefs: only free GPU memory (Safe Mode); the scene stays usable and kit objects stay theme-tracked. */
  function disposeScene(root, keepRefs) {
    const T = T3();
    if (!root || !T) return;
    const seenM = new Set(), seenG = new Set();
    const tex = (t) => { if (t && t.isTexture && !H.shared.has(t)) { try { t.dispose(); } catch (e) { /* noop */ } } };
    const mat = (m) => {
      if (!m || seenM.has(m)) return;
      seenM.add(m);
      if (!keepRefs) H.crystals.delete(m);
      Object.keys(m).forEach((k) => tex(m[k]));
      if (m.uniforms) Object.keys(m.uniforms).forEach((k) => { const u = m.uniforms[k]; if (u) tex(u.value); });
      try { m.dispose(); } catch (e) { /* noop */ }
    };
    root.traverse((o) => {
      // r128 sprites share ONE module-level geometry: freeing it per view only makes the other views re-upload it.
      const skipG = o.isSprite && H.tier !== 'safe';
      if (o.geometry && o.geometry.dispose && !skipG && !seenG.has(o.geometry)) { seenG.add(o.geometry); try { o.geometry.dispose(); } catch (e) { /* noop */ } }
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mat);
      if (!keepRefs && o.isPoints) H.dust.delete(o);
      if (!keepRefs && o.isSprite) H.glows.delete(o);
    });
    if (root.isScene) { tex(root.background); tex(root.environment); }
  }

  function freeScene(root) { disposeScene(root, true); }

  function disposeView(V) {
    if (V.disposed) return;
    V.disposed = true;
    const i = H.views.indexOf(V);
    if (i >= 0) H.views.splice(i, 1);
    if (V.host && !viewsOf(V.host).length) {
      try { if (H.io) H.io.unobserve(V.host); if (H.ro) H.ro.unobserve(V.host); } catch (e) { /* noop */ }
      if (V.setPos) { try { V.host.style.position = ''; } catch (e) { /* noop */ } }
    }
    V.listeners.forEach((l) => { try { V.el.removeEventListener(l[0], l[1]); } catch (e) { /* noop */ } });
    V.listeners = [];
    try { disposeScene(V.scene); } catch (e) { warn('dispose scene', e); }
    try { if (H.renderer) H.renderer.renderLists.dispose(); } catch (e) { /* noop */ }
    try { if (V.el) { V.el.width = V.el.height = 1; V.el.remove(); } } catch (e) { /* noop */ }
    try { if (V.poster) V.poster.remove(); } catch (e) { /* noop */ }
    V.ctx = null; V.scene = null; V.camera = null;
    debugRender();
  }

  // ───────────────────────── sizing + memory budget ─────────────────────────
  function deviceSize(cw, ch) {
    let dpr = baseDpr() * H.budgetScale;
    let w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    const maxPx = IS_IOS ? 3.0e6 : 8.4e6;
    if (w * h > maxPx) { const s = Math.sqrt(maxPx / (w * h)); dpr *= s; w = Math.floor(cw * dpr); h = Math.floor(ch * dpr); }
    if (w > 4096 || h > 4096) { const s = 4096 / Math.max(w, h); dpr *= s; w = Math.floor(cw * dpr); h = Math.floor(ch * dpr); }
    return { w: Math.max(0, w), h: Math.max(0, h), dpr };
  }
  function budgetLimit() { return (IS_IOS ? (IS_STANDALONE ? 48 : 64) : 192) * 1048576; }
  /** Keep view canvases + GL buffer + env under budget by scaling every view's pixel ratio. */
  function updateBudget() {
    const d = baseDpr();
    let sum = 0, maxPx = 0;
    H.views.forEach((V) => {
      if (V.disposed || V.hibernated || V.failed) return;
      const px = V.cssW * V.cssH * d * d;
      sum += px; if (px > maxPx) maxPx = px;
    });
    const envB = Object.keys(H.env).length * 2.4e6 + 0.4e6;
    const perS2 = sum * 4 + maxPx * 8 * (H.aa ? 5 : 1);
    const lim = budgetLimit();
    let s = 1;
    if (perS2 > 0 && perS2 + envB > lim) s = Math.sqrt(Math.max(0.05 * lim, lim - envB) / perS2);
    s = Math.max(0.5, Math.min(1, s));
    const changed = Math.abs(s - H.budgetScale) > 0.02;
    if (changed) H.budgetScale = s;
    return changed;
  }
  function estimateBytes() {
    let b = (H.bufW * H.bufH * 8) * (H.aa ? 5 : 1);
    H.views.forEach((V) => { b += V.w * V.h * 4; });
    b += Object.keys(H.env).length * 2.4e6 + 0.4e6;
    H.estBytes = b;
    return b;
  }
  function resizeAll() { H.views.forEach((V) => { V.needsResize = true; V.lastResize = -1e9; }); schedule(); }
  function applyResize(V, t) {
    V.needsResize = false;
    V.lastResize = t;
    const host = V.host;
    if (!host) return;
    if (!V.posChecked && host.isConnected) checkPos(V);
    const cw = host.clientWidth | 0, ch = host.clientHeight | 0;
    const changedCss = cw !== V.cssW || ch !== V.cssH;
    V.cssW = cw; V.cssH = ch;
    const d = deviceSize(cw, ch);
    if (d.w !== V.w || d.h !== V.h) {
      V.el.width = Math.max(1, d.w);
      V.el.height = Math.max(1, d.h);
      V.w = d.w; V.h = d.h;
      V.ctx = null;
      V.dirty = true;
    }
    V.dpr = d.dpr;
    V.size.w = cw; V.size.h = ch; V.size.dpr = Math.round(d.dpr * 1000) / 1000;
    if (changedCss && cw > 0 && ch > 0) {
      const cam = V.camera;
      if (cam && cam.isPerspectiveCamera) { cam.aspect = cw / ch; cam.updateProjectionMatrix(); }
      if (typeof V.opts.onResize === 'function') { try { V.opts.onResize(cw, ch, V.view); } catch (e) { warn('onResize', e); } }
      V.dirty = true;
      H.settleUntil = t + 1000;
    }
  }
  /** Grow the hub canvas to the largest active view (64 px buckets). Shrink only after a tier drop. */
  function ensureBuffer() {
    let mw = 1, mh = 1;
    H.views.forEach((V) => { if (!V.disposed && !V.failed && !V.hibernated) { if (V.w > mw) mw = V.w; if (V.h > mh) mh = V.h; } });
    let W = Math.min(4096, Math.ceil(mw / 64) * 64), Hh = Math.min(4096, Math.ceil(mh / 64) * 64);
    if (!H.shrink) { W = Math.max(W, H.bufW); Hh = Math.max(Hh, H.bufH); }
    H.shrink = false;
    if (W !== H.bufW || Hh !== H.bufH) {
      H.renderer.setSize(W, Hh, false);
      H.bufW = W; H.bufH = Hh;
      H.settleUntil = now() + 1000;
    }
  }

  // ───────────────────────── frame loop ─────────────────────────
  function schedule() {
    if (H.raf || !canRun()) return;
    H.raf = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (H.raf) cancelAnimationFrame(H.raf);
    H.raf = 0;
    H.lastTick = 0;
  }
  const RENDER = 1, WAIT = 2, IDLE = 0;
  function ambientGate() { return 1000 / AMBIENT_FPS - S.refreshMs / 2; }
  function decide(V, t) {
    const active = V.pointerDown || t < V.kickUntil;
    if (V.dirty || active) {
      if (H.cap30 && !V.dirty && t - V.lastRender < ambientGate()) return WAIT;
      return RENDER;
    }
    if (V.animating && V.ambient && !H.reduced && t < V.ambientUntil) return t - V.lastRender >= ambientGate() ? RENDER : WAIT;
    return IDLE;
  }
  function isLost() { try { return !!(H.gl && H.gl.isContextLost()); } catch (e) { return true; } }
  function tick(ts) {
    H.raf = 0;
    if (!canRun()) { H.lastTick = 0; return; }
    // The context can be gone before 'webglcontextlost' is dispatched: never render (or blit a blank buffer) then.
    if (isLost()) { H.lastTick = 0; return; }
    const t = ts || now();
    H.ticks++;
    if (H.lastTick) sample(t - H.lastTick, H.renderedLastTick, t);
    H.lastTick = t;
    let keep = false, rendered = 0, anyResized = false;
    const cpu0 = now();
    try {
      const todo = [];
      for (let i = 0; i < H.views.length; i++) {
        const V = H.views[i];
        if (V.disposed || V.failed || V.hibernated) continue;
        if (V.needsResize) {
          if (t - V.lastResize >= 120) { applyResize(V, t); anyResized = true; } else keep = true; // trailing debounce
        }
      }
      if (anyResized && updateBudget()) H.views.forEach((V) => { if (!V.disposed && !V.hibernated) applyResize(V, t); });
      for (let i = 0; i < H.views.length; i++) {
        const V = H.views[i];
        if (V.disposed || V.failed || V.hibernated || !V.visible || V.w < 1 || V.h < 1) continue;
        const d = decide(V, t);
        if (d === RENDER) { todo.push(V); keep = true; } else if (d === WAIT) keep = true;
      }
      if (todo.length) {
        ensureBuffer();
        H.calls = 0; H.tris = 0;
        for (let i = 0; i < todo.length; i++) if (renderView(todo[i], t)) rendered++;
      }
      H.tickErrors = 0;
    } catch (e) {
      warn('frame failed', e);
      if (++H.tickErrors >= 3) { toSafe('error'); return; }
    }
    const cpu = now() - cpu0;
    if (rendered) { H.cpuMs = cpu; S.cpu.push(cpu); if (S.cpu.length > 60) S.cpu.shift(); }
    H.renderedLastTick = rendered > 0;
    if (anyResized) estimateBytes();
    if (keep && canRun()) H.raf = requestAnimationFrame(tick);
    else H.lastTick = 0;
  }
  function renderView(V, t) {
    const r = H.renderer;
    const dt = V.lastRender ? Math.min(Math.max((t - V.lastRender) / 1000, 0), 0.1) : 1 / 60;
    V.time += dt;
    V.dirty = false;
    let anim = false;
    try {
      if (typeof V.opts.update === 'function') anim = !!V.opts.update(dt, V.time, V.view);
    } catch (e) { return fail(V, e); }
    V.animating = anim;
    if (!V.scene || !V.camera) return false;
    try {
      const cam = V.camera;
      if (!V.compiled) {
        r.compile(V.scene, cam);
        V.compiled = true;
        H.settleUntil = t + 1000;
      }
      H.uScale.value = cam.isPerspectiveCamera ? V.h / (2 * Math.tan((cam.fov * Math.PI) / 360)) : V.h / 2;
      H.uTime.value = V.time;
      const ex = V.opts.exposure;
      r.toneMappingExposure = typeof ex === 'function' ? +ex(theme()) || 1 : typeof ex === 'number' ? ex : theme() === 'light' ? 1.05 : 0.95;
      r.setRenderTarget(null);
      r.setViewport(0, 0, V.w, V.h);
      r.setScissor(0, 0, V.w, V.h);
      r.setScissorTest(true);
      r.setClearColor(V.clearColor, V.clearAlpha);
      r.render(V.scene, cam);
      if (isLost()) return false; // keep the view's last good frame
      H.calls += r.info.render.calls;
      H.tris += r.info.render.triangles;
      // Blit in the same task (no preserveDrawingBuffer). GL origin is bottom-left → source y = bufH - h.
      if (!V.ctx) V.ctx = V.el.getContext('2d', { alpha: true });
      if (!V.ctx) throw new Error('2D canvas unavailable (canvas memory cap)');
      V.ctx.globalCompositeOperation = 'copy';
      V.ctx.drawImage(H.canvas, 0, H.bufH - V.h, V.w, V.h, 0, 0, V.w, V.h);
    } catch (e) {
      if (isLost()) return false; // loss handler takes over
      return fail(V, e);
    }
    V.lastRender = t;
    V.frames++;
    H.renders++;
    V.errors = 0;
    if (!V.shown) {
      // Entry choreography starts when the first frame is actually on screen (compiles can take a while).
      V.shown = true;
      syncPoster(V);
      const t1 = now();
      if (!H.reduced) {
        const intro = V.opts.intro == null ? 1200 : +V.opts.intro || 0;
        if (intro) V.kickUntil = Math.max(V.kickUntil, t1 + intro);
        if (V.ambient) V.ambientUntil = Math.max(V.ambientUntil, t1 + AMBIENT_MS);
      }
    }
    return true;
  }
  function fail(V, e) {
    V.errors++;
    warn('view "' + V.name + '" failed to render', e);
    if (V.errors >= 2) { V.failed = true; V.shown = false; syncPoster(V); }
    else V.dirty = true;
    return false;
  }

  // ───────────────────────── adaptive quality ─────────────────────────
  function snapRefresh(ms) { return [8.33, 11.11, 16.67, 33.33].reduce((b, x) => (Math.abs(x - ms) < Math.abs(b - ms) ? x : b), 16.67); }
  function sample(delta, afterRender, t) {
    if (delta > 100 || delta <= 0 || document.hidden) return;
    // Refresh interval: only from ticks that followed a tick with (almost) no work, so a slow GPU is never
    // mistaken for a 30 Hz display (which would disable degrading).
    if (!S.refreshKnown && (!afterRender || H.cpuMs < 3)) {
      S.boot.push(delta);
      if (S.boot.length >= 20) { S.refreshMs = snapRefresh(median(S.boot)); S.refreshKnown = true; S.throttled = S.refreshMs > 30; }
    }
    if (!afterRender || t < H.settleUntil) return;
    S.win.push(delta);
    S.hist.push(delta); if (S.hist.length > 120) S.hist.shift();
    if (S.win.length >= 30) evaluate(t);
  }
  function evaluate(t) {
    const med = median(S.win), p90 = pct(S.win, 0.9);
    S.win.length = 0;
    S.med = med; S.p90 = p90;
    const cpuMed = median(S.cpu);
    // A steady ~33 ms with little CPU work is Low Power Mode / an uninteracted iframe: not GPU overload.
    if (Math.abs(med - 33.33) < 2.5 && p90 < 37 && cpuMed < 6) { S.throttled = true; S.refreshMs = 33.33; S.down = S.up = 0; return; }
    const T = S.refreshMs;
    if (med > 1.2 * T) { S.up = 0; if (++S.down >= 2) { S.down = 0; step(-1, t); } }
    else if (med < 1.05 * T && p90 < 1.3 * T) { S.down = 0; if (++S.up >= 4) { S.up = 0; step(1, t); } }
    else { S.down = 0; S.up = 0; }
  }
  function step(dir, t) {
    if (t - S.lastChange < 1500) return;
    if (S.locked && dir > 0) return;
    if (S.lastDir && dir !== S.lastDir && ++S.flips >= 3) { S.locked = true; if (dir > 0) return; }
    const q = Q[H.tier] || Q.safe;
    const eff = (s) => Math.min(window.devicePixelRatio || 1, q.dprCap, LADDER[s]);
    const prevTier = H.tier;
    let changed = false;
    if (dir < 0) {
      let s = H.dprStep;
      while (s < LADDER.length - 1 && eff(s) >= eff(H.dprStep) - 1e-3) s++;
      if (eff(s) < eff(H.dprStep) - 1e-3) { H.dprStep = s; changed = true; }
      else if (!H.manual && tierIdx(H.tier) > 1) { H.tier = lowerTier(H.tier); H.shrink = true; changed = true; }
      else if (!H.cap30) { H.cap30 = true; changed = true; }
    } else {
      if (H.cap30) { H.cap30 = false; changed = true; }
      else if (!H.manual && tierIdx(H.tier) < tierIdx(H.start)) { H.tier = TIERS[tierIdx(H.tier) + 1]; changed = true; }
      else if (H.dprStep > 0) {
        let s = H.dprStep;
        while (s > 0 && eff(s) <= eff(H.dprStep) + 1e-3) s--;
        if (eff(s) > eff(H.dprStep) + 1e-3) { H.dprStep = s; changed = true; }
      }
    }
    if (!changed) return;
    S.lastChange = t;
    S.lastDir = dir;
    applyTier(prevTier);
  }

  // ───────────────────────── kit (shared art direction) ─────────────────────────
  const DUST_VS = [
    'uniform float uScale;', 'uniform float uTime;', 'uniform float uFocus;', 'uniform float uAperture;', 'uniform float uDrift;',
    'attribute float aSize;', 'attribute vec3 aSeed;', 'varying float vA;',
    'void main() {',
    '  vec3 p = position + uDrift * vec3(sin(uTime * 0.21 + aSeed.x * 6.2831), sin(uTime * 0.17 + aSeed.y * 6.2831), cos(uTime * 0.19 + aSeed.z * 6.2831));',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  float coc = clamp(abs(-mv.z - uFocus) * uAperture, 0.0, 1.0);',
    '  gl_PointSize = min(64.0, aSize * (1.0 + 2.0 * coc) * uScale / max(0.05, -mv.z));',
    '  vA = mix(1.0, 0.22, coc);',
    '  gl_Position = projectionMatrix * mv;',
    '}'].join('\n');
  const DUST_FS = [
    'uniform vec3 uColor;', 'uniform float uOpacity;', 'varying float vA;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float soft = mix(0.08, 0.45, 1.0 - vA);',
    '  float a = (1.0 - smoothstep(0.5 - soft, 0.5, d)) * vA * uOpacity;',
    '  if (a < 0.003) discard;',
    '  gl_FragColor = linearToOutputTexel(vec4(uColor, a));',
    '}'].join('\n');
  function themed(o, darkHex, lightHex) { return { dark: o.color || darkHex, light: o.colorLight || o.color || lightHex }; }
  function updateDust() {
    const f = quality().dust;
    H.dust.forEach((p) => {
      const n = p.userData.cbDust ? p.userData.cbDust.count : 0;
      const k = Math.round(n * f);
      p.geometry.setDrawRange(0, k);
      p.visible = k > 0 && p.userData.cbDust.wanted !== false;
    });
  }
  function updateKitTheme() {
    const T = T3();
    if (!T) return;
    const th = theme();
    const dark = th !== 'light';
    H.dust.forEach((p) => {
      const d = p.userData.cbDust, m = p.material;
      if (!d || !m || !m.uniforms) return;
      m.uniforms.uColor.value.copy(color(d.colors[th]));
      m.blending = dark ? T.AdditiveBlending : T.NormalBlending;
      m.uniforms.uOpacity.value = d.opacity * (dark ? 1 : 0.38); // on ivory, motes must not read as specks
    });
    H.crystals.forEach((m) => {
      const d = m.userData.cbCrystal;
      if (!d) return;
      // Dark: reflections add light (ONE, 1-srcA). Light: normal blending so bronze edges read on ivory.
      m.blending = dark ? T.CustomBlending : T.NormalBlending;
      // Light: a warm smoked-quartz body so the ring reads on ivory (clear glass there is only a milky haze).
      if (m.userData.cbRim) { m.userData.cbRim.uRim.value.copy(color(d.rims[th])); m.userData.cbRim.uRimK.value = d.k * (dark ? 1 : 1.1); }
      if (d.bodies) m.color.copy(color(d.bodies[th]));
      m.opacity = d.opacity * (dark ? 1 : 0.8);
    });
    H.glows.forEach((s) => {
      const d = s.userData.cbGlow, m = s.material;
      if (!d || !m) return;
      m.color.copy(color(d.colors[th]));
      m.blending = dark ? T.AdditiveBlending : T.NormalBlending;
      m.opacity = d.opacity == null ? (dark ? 0.45 : 0.22) : d.opacity * (dark ? 1 : 0.5);
    });
  }
  const kit = {
    metal(o) {
      o = o || {};
      const T = T3(); if (!T) return null;
      return new T.MeshStandardMaterial({ color: color(o.color || '#DDBE82'), metalness: o.metalness == null ? 1 : o.metalness,
        roughness: o.roughness == null ? 0.22 : o.roughness, envMapIntensity: o.envMapIntensity == null ? 1.25 : o.envMapIntensity });
    },
    lacquer(o) {
      o = o || {};
      const T = T3(); if (!T) return null;
      return new T.MeshPhysicalMaterial({ color: color(o.color || '#0E0F12'), metalness: 0, roughness: o.roughness == null ? 0.12 : o.roughness,
        clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: o.envMapIntensity == null ? 1.1 : o.envMapIntensity });
    },
    crystal(o) {
      o = o || {};
      const T = T3(); if (!T) return null;
      // Fake crystal (r128 transmission is an alpha stub): near-black diffuse so only reflections + rim show, and
      // ONE / ONE_MINUS_SRC_ALPHA blending so reflections are not dimmed by opacity while the body darkens what's behind.
      const m = new T.MeshPhysicalMaterial({ color: color(o.color || '#141416'), metalness: 0, roughness: o.frosted ? 0.35 : 0.05,
        clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: o.opacity == null ? 0.2 : o.opacity,
        envMapIntensity: o.envMapIntensity == null ? 0.9 : o.envMapIntensity, depthWrite: false, side: o.side == null ? T.FrontSide : o.side,
        blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendEquation: T.AddEquation });
      const k = o.rimStrength == null ? 0.45 : o.rimStrength;
      if (o.rim !== false) kit.rim(m, { color: o.rim || '#E8D3A4', power: o.rimPower || 3.5, strength: k });
      m.userData.cbCrystal = { rims: { dark: o.rim || '#E8D3A4', light: o.rimLight || '#8C6A2E' }, k, opacity: m.opacity,
        bodies: { dark: o.color || '#141416', light: o.colorLight || o.color || '#3A2C14' } };
      H.crystals.add(m);
      updateKitTheme();
      return m;
    },
    rim(mat, o) {
      o = o || {};
      if (!mat || !T3()) return mat;
      const u = { uRim: { value: color(o.color || '#E8D3A4') }, uRimP: { value: o.power || 3 }, uRimK: { value: o.strength == null ? 0.8 : o.strength } };
      mat.userData.cbRim = u;
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.fragmentShader = 'uniform vec3 uRim;\nuniform float uRimP;\nuniform float uRimK;\n' + sh.fragmentShader
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n float rimF = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), uRimP);\n totalEmissiveRadiance += uRim * rimF * uRimK;')
          .replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', 'gl_FragColor = vec4( outgoingLight, clamp( diffuseColor.a + rimF * 0.35, 0.0, 1.0 ) );');
      };
      mat.customProgramCacheKey = () => 'cb-rim';
      mat.needsUpdate = true;
      return mat;
    },
    glow(o) {
      o = o || {};
      const T = T3(); if (!T) return null;
      const s = new T.Sprite(new T.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending }));
      s.userData.cbGlow = { colors: themed(o, '#E8D3A4', '#C29E5E'), opacity: o.opacity };
      const k = o.size || 1;
      s.scale.set(k, k, k);
      H.glows.add(s);
      updateKitTheme();
      return s;
    },
    shadow(o) {
      o = o || {};
      const T = T3(); if (!T) return null;
      const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true,
        depthWrite: false, toneMapped: false, opacity: o.opacity == null ? 0.42 : o.opacity }));
      m.rotation.x = -Math.PI / 2;
      m.scale.set(o.width || 1, o.depth || 0.6, 1);
      m.renderOrder = -1;
      return m;
    },
    dust(o) {
      o = o || {};
      const T = T3(); if (!T) return null;
      const n = Math.max(1, Math.min(2000, o.count || 300));
      const sp = o.spread || [6, 3, 4], c = o.center || [0, 0, 0];
      const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n * 3);
      const base = o.size || 0.035;
      for (let i = 0; i < n; i++) {
        pos[i * 3] = c[0] + (Math.random() - 0.5) * sp[0];
        pos[i * 3 + 1] = c[1] + (Math.random() - 0.5) * sp[1];
        pos[i * 3 + 2] = c[2] + (Math.random() - 0.5) * sp[2];
        size[i] = base * (0.45 + Math.random() * 0.9);
        seed[i * 3] = Math.random(); seed[i * 3 + 1] = Math.random(); seed[i * 3 + 2] = Math.random();
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('aSize', new T.BufferAttribute(size, 1));
      g.setAttribute('aSeed', new T.BufferAttribute(seed, 3));
      const m = new T.ShaderMaterial({
        uniforms: { uScale: H.uScale, uTime: H.uTime, uFocus: { value: o.focus || 6 }, uAperture: { value: o.aperture == null ? 0.18 : o.aperture },
          uDrift: { value: o.drift == null ? 0.05 : o.drift }, uColor: { value: color('#E8D3A4') }, uOpacity: { value: o.opacity == null ? 0.55 : o.opacity } },
        vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      });
      const p = new T.Points(g, m);
      p.frustumCulled = false;
      p.renderOrder = 2;
      p.userData.cbDust = { count: n, colors: themed(o, '#E8D3A4', '#8C6A2E'), opacity: o.opacity == null ? 0.55 : o.opacity };
      H.dust.add(p);
      updateDust();
      updateKitTheme();
      return p;
    },
    lights(scene, o) {
      o = o || {};
      const T = T3(); if (!T || !scene) return null;
      const k = o.intensity == null ? 1 : o.intensity;
      const hemi = new T.HemisphereLight(0xffffff, color('#2a2f38'), 0.3 * k);
      const key = new T.DirectionalLight(0xffffff, 0.6 * k);
      key.position.set(-3, 4, 5);
      const rim = new T.DirectionalLight(color('#FFE6C4'), 0.6 * k);
      rim.position.set(3, 2, -4);
      scene.add(hemi, key, rim);
      return { hemi, key, rim };
    },
  };

  // ───────────────────────── global listeners ─────────────────────────
  let globalsOn = false;
  function onTheme() {
    const th = theme();
    if (th === H.lastTheme) return;
    const prev = H.lastTheme;
    H.lastTheme = th;
    updateKitTheme();
    // Scenes lit by the shared studio env follow the theme by themselves (swap, never re-bake).
    const old = H.env[prev] && H.env[prev].rt.texture;
    H.views.forEach((V) => {
      V.dirty = true;
      if (old && V.scene && V.scene.environment === old) { const n = env(th); if (n) V.scene.environment = n; }
    });
    schedule();
  }
  function globalListeners() {
    if (globalsOn) return;
    globalsOn = true;
    H.lastTheme = theme();
    const opt = { passive: true, capture: true };
    const onInput = () => {
      const t = now();
      if (t - H.lastGlobalInput < 150 || H.reduced) return;
      H.lastGlobalInput = t;
      let any = false;
      H.views.forEach((V) => { if (V.visible && V.ambient && V.animating && !V.disposed) { V.ambientUntil = t + AMBIENT_MS; any = true; } });
      if (any) schedule();
    };
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((ev) => window.addEventListener(ev, onInput, opt));
    const onUp = () => {
      const t = now();
      H.views.forEach((V) => { if (V.pointerDown) { V.pointerDown = false; V.kickUntil = Math.max(V.kickUntil, t + 400); } });
      schedule();
    };
    window.addEventListener('pointerup', onUp, opt);
    window.addEventListener('pointercancel', onUp, opt);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Hidden by the user is not a crash. Only a session that raised the counter may clear it: a Safe Mode
        // session (boot ≥ 2, no renderer) must keep it, or every reload would allow two more crashes.
        if (H.armed) store.set(LS_BOOT, 0);
        clearTimeout(H.stableT);
        stopLoop();
        return;
      }
      if (H.renderer && H.tier !== 'safe') { store.set(LS_BOOT, 1); armStability(); }
      requestAnimationFrame(() => {
        if (!H.renderer || H.lost) return;
        try { if (H.gl && H.gl.isContextLost()) return; } catch (e) { return; }
        H.settleUntil = now() + 1000;
        H.views.forEach((V) => { V.dirty = true; });
        schedule();
      });
    });
    window.addEventListener('pagehide', () => { if (H.armed) store.set(LS_BOOT, 0); });
    window.addEventListener('pageshow', (e) => {
      if (e && e.persisted && H.renderer && H.tier !== 'safe') { store.set(LS_BOOT, 1); armStability(); H.views.forEach((V) => { V.dirty = true; }); schedule(); }
    });
    let lastDpr = window.devicePixelRatio || 1;
    window.addEventListener('resize', () => {
      const d = window.devicePixelRatio || 1;
      if (d !== lastDpr) { lastDpr = d; resizeAll(); }
      if (!H.ro) resizeAll();
    }, { passive: true });
    onMQ('(prefers-color-scheme: dark)', onTheme);
    onMQ('(prefers-reduced-motion: reduce)', () => { H.reduced = mm('(prefers-reduced-motion: reduce)'); });
    if (typeof CB.on === 'function') { try { CB.on('theme', onTheme); } catch (e) { /* noop */ } }
    try {
      new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) { /* noop */ }
  }

  // ───────────────────────── CSS (poster + view canvas) ─────────────────────────
  const CSS = [
    '.cbgl-view{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transform:scale(.96);transform-origin:50% 55%;',
    'transition:opacity .6s cubic-bezier(.2,.8,.2,1),transform .6s cubic-bezier(.2,.8,.2,1);border-radius:inherit;outline:none;',
    '-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
    '.cbgl-view.is-on{opacity:1;transform:none}',
    '.cbgl-view.is-static{pointer-events:none}',
    '.cbgl-view.is-instant,.cbgl-poster.is-instant{transition:none!important}',
    '.cbgl-poster{--cbgl-ring:rgba(216,186,126,.30);--cbgl-ring-f:rgba(232,211,164,.62);--cbgl-glass:rgba(255,250,240,.10);',
    '--cbgl-halo:rgba(216,186,126,.11);--cbgl-floor:rgba(0,0,0,.6);--cbgl-orb-edge:#17120A;',
    'position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none;display:grid;place-items:center;',
    'container-type:size;transition:opacity .6s cubic-bezier(.2,.8,.2,1),visibility 0s linear 0s}',
    '.cbgl-poster.is-off{opacity:0;visibility:hidden;transition:opacity .6s cubic-bezier(.2,.8,.2,1),visibility 0s linear .6s}',
    '.cbgl-poster.is-safe{z-index:1}',
    '.cbgl-art{position:relative;width:120px;height:120px;width:min(64cqw,64cqh);height:min(64cqw,64cqh)}',
    '.cbgl-art i{position:absolute;display:block;border-radius:50%}',
    '.cbgl-halo{inset:-30%;background:radial-gradient(closest-side,var(--cbgl-halo),transparent 72%)}',
    '.cbgl-ring{left:2%;right:2%;top:42%;height:22%;border:1px solid var(--cbgl-ring);transform:rotate(-11deg)}',
    '.cbgl-ring-f{border-color:transparent transparent var(--cbgl-ring-f) transparent}',
    '.cbgl-glass.cbgl-ring{left:14%;right:14%;top:20%;height:64%;border:2px solid var(--cbgl-glass);transform:rotate(58deg) scaleY(.36);',
    'box-shadow:inset 0 0 10px rgba(255,250,240,.05),0 0 14px rgba(216,186,126,.06)}',
    '.cbgl-orb{left:32%;top:30%;width:36%;height:36%;background:radial-gradient(circle at 34% 28%,#FFF9EA 0,#F3E3B9 7%,#D8BA7E 28%,#A07E44 55%,#5E4825 78%,var(--cbgl-orb-edge) 100%);',
    'box-shadow:inset 0 -5px 12px rgba(0,0,0,.35),inset 0 2px 3px rgba(255,250,240,.35),0 0 32px rgba(216,186,126,.14)}',
    '.cbgl-moon{left:13%;top:57%;width:5.5%;height:5.5%;background:radial-gradient(circle at 35% 30%,#F5EAD0,#C29E5E 60%,#7A5F33);',
    'box-shadow:0 0 10px rgba(216,186,126,.5)}',
    '.cbgl-floor{left:22%;right:22%;top:76%;height:9%;background:radial-gradient(closest-side,var(--cbgl-floor),transparent)}',
    '.cbgl-enable{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);pointer-events:auto;cursor:pointer;z-index:2;',
    'display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:0 14px;border-radius:999px;',
    'font:500 10.5px/1 var(--f-mono,"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace);letter-spacing:.08em;text-transform:uppercase;',
    'color:var(--gold-300,#D8BA7E);background:rgba(19,19,18,.72);border:1px solid var(--gold-line,rgba(216,186,126,.35));',
    'box-shadow:inset 0 1px 0 rgba(255,250,240,.08);transition:background .12s,border-color .12s,transform .12s;-webkit-tap-highlight-color:transparent}',
    '.cbgl-enable::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.75}',
    '.cbgl-enable:hover{background:rgba(216,186,126,.12);border-color:rgba(216,186,126,.6)}',
    '.cbgl-enable:active{transform:translateX(-50%) scale(.97)}',
    '.cbgl-enable:focus-visible{outline:none;box-shadow:0 0 0 2px var(--bg-0,#0A0A09),0 0 0 4px rgba(216,186,126,.65)}',
    '@media (pointer:coarse){.cbgl-enable{min-height:44px;padding:0 18px}}',
    '@container (max-width:219px){.cbgl-enable{display:none}}',
    '@container (max-height:139px){.cbgl-enable{display:none}}',
    '@media (prefers-reduced-motion:reduce){.cbgl-view{transform:none;transition:opacity .12s linear}.cbgl-poster{transition:opacity .12s linear}}',
    // light theme ("Ivory & Bronze")
    ':root[data-theme="light"] .cbgl-poster{--cbgl-ring:rgba(134,102,43,.30);--cbgl-ring-f:rgba(134,102,43,.62);--cbgl-glass:rgba(40,32,18,.10);',
    '--cbgl-halo:rgba(205,174,114,.18);--cbgl-floor:rgba(40,32,18,.28);--cbgl-orb-edge:#4A3A1E}',
    ':root[data-theme="light"] .cbgl-enable{color:#86662B;background:rgba(255,254,251,.85);border-color:rgba(134,102,43,.35);box-shadow:0 1px 2px rgba(40,32,18,.06)}',
    '@media (prefers-color-scheme:light){:root:not([data-theme="dark"]) .cbgl-poster{--cbgl-ring:rgba(134,102,43,.30);--cbgl-ring-f:rgba(134,102,43,.62);',
    '--cbgl-glass:rgba(40,32,18,.10);--cbgl-halo:rgba(205,174,114,.18);--cbgl-floor:rgba(40,32,18,.28);--cbgl-orb-edge:#4A3A1E}',
    ':root:not([data-theme="dark"]) .cbgl-enable{color:#86662B;background:rgba(255,254,251,.85);border-color:rgba(134,102,43,.35)}}',
    // debug panel
    '.cbgl-dbg{position:fixed;left:12px;bottom:12px;z-index:2147483000;width:340px;max-width:calc(100vw - 24px);padding:10px 12px;',
    'border-radius:12px;background:rgba(10,10,9,.9);color:#F2EEE6;border:1px solid rgba(216,186,126,.35);',
    'font:11px/1.45 var(--f-mono,"Geist Mono",ui-monospace,Menlo,monospace);box-shadow:0 24px 60px -20px rgba(0,0,0,.6)}',
    '.cbgl-dbg b{color:#D8BA7E;font-weight:600}.cbgl-dbg pre{margin:6px 0;white-space:pre-wrap;font:inherit}',
    '.cbgl-dbg .cbgl-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}',
    '.cbgl-dbg button{font:inherit;color:#F2EEE6;background:#20201E;border:1px solid rgba(255,244,225,.16);border-radius:6px;padding:3px 7px;cursor:pointer}',
    '.cbgl-dbg button.on{border-color:#D8BA7E;color:#D8BA7E}',
    '.cbgl-dbg header{display:flex;justify-content:space-between;align-items:center;gap:8px;position:static;margin:0;padding:0;background:none;border:0;height:auto;min-height:0}',
  ].join('\n');
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return;
    cssDone = true;
    try {
      if (typeof CB.css === 'function') { CB.css('gl', CSS); return; }
      const s = document.createElement('style');
      s.setAttribute('data-cb', 'gl');
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { warn('css', e); }
  }

  // ───────────────────────── stats + debug panel (?debug=gl) ─────────────────────────
  function viewMode(V, t) {
    if (H.tier === 'safe' || V.failed) return 'poster';
    if (V.hibernated) return 'detached';
    if (!V.visible) return 'offscreen';
    if (V.pointerDown || t < V.kickUntil) return 'native';
    if (V.animating && V.ambient && !H.reduced && t < V.ambientUntil) return 'ambient';
    return 'idle';
  }
  function stats() {
    const t = now();
    const r = H.renderer;
    const mem = r ? { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: (r.info.programs || []).length } : { geometries: 0, textures: 0, programs: 0 };
    return {
      tier: H.tier, start: H.start, heuristic: H.heuristic, reason: H.reason, manual: H.manual, bootAtLoad: H.bootAtLoad,
      boot: parseInt(store.get(LS_BOOT) || '0', 10) || 0, contexts: H.contexts, webgl2: H.isGL2, aa: H.aa, lost: H.lost,
      losses: H.losses, restores: H.restores, rebuilds: H.rebuilds, paused: H.paused, ios: IS_IOS, standalone: IS_STANDALONE,
      dpr: baseDpr(), dprStep: H.dprStep, budgetScale: H.budgetScale, cap30: H.cap30, buffer: { w: H.bufW, h: H.bufH },
      refreshMs: S.refreshMs, throttled: S.throttled, frameMedian: S.med, frameP90: S.p90, cpuMs: H.cpuMs, locked: S.locked,
      renders: H.renders, ticks: H.ticks, calls: H.calls, triangles: H.tris, memory: mem, estMB: Math.round(estimateBytes() / 1048576 * 10) / 10,
      budgetMB: Math.round(budgetLimit() / 1048576),
      views: H.views.map((V) => ({ name: V.name, w: V.w, h: V.h, css: [V.cssW, V.cssH], dpr: V.size.dpr, frames: V.frames, mode: viewMode(V, t), visible: V.visible })),
    };
  }
  let dbg = null, dbgT = 0, dbgLastRenders = 0, dbgLastT = 0;
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function debugRender() {
    if (!dbg) return;
    const s = stats();
    const t = now();
    const rps = dbgLastT ? Math.round(((s.renders - dbgLastRenders) * 1000) / (t - dbgLastT)) : 0;
    dbgLastRenders = s.renders; dbgLastT = t;
    const L = [];
    L.push('tier <b>' + s.tier + '</b>  start ' + s.start + '  heur ' + s.heuristic + (s.reason ? '  reason ' + s.reason : '') + (s.manual ? '  (manual)' : ''));
    L.push('ctx ' + s.contexts + (s.webgl2 ? ' webgl2' : ' webgl1') + '  aa ' + (s.aa ? 'on' : 'off') + '  lost ' + (s.lost ? 'YES' : 'no') + '  boot ' + s.boot + ' (load ' + s.bootAtLoad + ')');
    L.push('dpr ' + s.dpr.toFixed(2) + ' ×' + s.budgetScale.toFixed(2) + '  buf ' + s.buffer.w + '×' + s.buffer.h + (s.cap30 ? '  cap30' : '') + (s.locked ? '  locked' : ''));
    L.push('frame med ' + s.frameMedian.toFixed(1) + ' p90 ' + s.frameP90.toFixed(1) + ' ms  refresh ' + s.refreshMs.toFixed(1) + (s.throttled ? ' (throttled)' : '') + '  cpu ' + s.cpuMs.toFixed(1));
    L.push('renders/s ' + rps + '  calls ' + s.calls + '  tris ' + s.triangles);
    L.push('mem geo ' + s.memory.geometries + '  tex ' + s.memory.textures + '  prog ' + s.memory.programs + '  est ' + s.estMB + ' / ' + s.budgetMB + ' MB');
    s.views.forEach((v) => L.push(' · ' + esc(v.name) + '  ' + v.w + '×' + v.h + ' @' + v.dpr + '  ' + v.mode + '  f' + v.frames));
    dbg.querySelector('pre').innerHTML = L.join('\n');
    dbg.querySelectorAll('[data-tier]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tier') === s.tier));
  }
  function debug(onOff) {
    if (onOff === false) { if (dbg) { dbg.remove(); dbg = null; clearInterval(dbgT); } store.del('cb.gl.debug'); return false; }
    if (dbg) return true;
    injectCSS();
    dbg = document.createElement('div');
    dbg.className = 'cbgl-dbg';
    dbg.innerHTML = '<header><b>CB.GL</b><button type="button" data-x aria-label="Close">close</button></header><pre></pre>' +
      '<div class="cbgl-row">' + ['ultra', 'high', 'mid', 'low', 'safe'].map((t) => '<button type="button" data-tier="' + t + '">' + t + '</button>').join('') + '</div>' +
      '<div class="cbgl-row"><button type="button" data-a="lose">lose ctx</button><button type="button" data-a="restore">restore</button>' +
      '<button type="button" data-a="enable">enable 3D</button><button type="button" data-a="b0">boot=0</button><button type="button" data-a="b1">boot=1</button>' +
      '<button type="button" data-a="b2">boot=2</button></div>';
    dbg.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-x')) { debug(false); return; }
      const t = b.getAttribute('data-tier');
      if (t) setTier(t);
      const a = b.getAttribute('data-a');
      try {
        if (a === 'lose' && H.renderer) H.renderer.forceContextLoss();
        if (a === 'restore' && H.renderer) H.renderer.forceContextRestore();
        if (a === 'enable') enable3D();
        if (a && a.charAt(0) === 'b') store.set(LS_BOOT, a.slice(1)); // applies at next launch
      } catch (err) { warn('debug action', err); }
      debugRender();
    });
    (document.body || document.documentElement).appendChild(dbg);
    dbgT = setInterval(debugRender, 500);
    debugRender();
    return true;
  }
  function wantDebug() {
    try { if (/(^|[?&#])debug=gl\b/.test((location.search || '') + '#' + (location.hash || '').replace(/^#/, ''))) return true; } catch (e) { /* noop */ }
    return store.get('cb.gl.debug') === '1';
  }

  // ───────────────────────── public API ─────────────────────────
  const API = {
    __hub: true,
    available() { return ensureHub(); },
    tier() { return H.tier; },
    setTier,
    on,
    off,
    get THREE() { return window.THREE; },
    env,
    color,
    glowTexture,
    dustTexture,
    contactShadowTexture,
    view,
    // additions
    get renderer() { return H.tier === 'safe' ? null : H.renderer; },
    pause() { H.paused = true; stopLoop(); },
    resume() {
      if (!H.paused) return;
      H.paused = false;
      const r = H.renderer;
      if (r) {
        try {
          if (r.xr && r.xr.isPresenting) { H.paused = true; return; }
          r.setRenderTarget(null);
          r.setPixelRatio(1);
          r.setSize(H.bufW || 64, H.bufH || 64, false);
          r.setScissorTest(false);
        } catch (e) { warn('resume', e); }
      }
      H.settleUntil = now() + 1000;
      H.views.forEach((V) => { V.dirty = true; });
      schedule();
    },
    safeMode,
    enable3D,
    safeReason() { return H.tier === 'safe' ? H.reason : null; },
    quality,
    theme,
    reducedMotion() { return H.reduced; },
    stats,
    debug,
    kit,
  };
  CB.GL = API;

  if (wantDebug()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => debug(true));
    else debug(true);
  }
})();

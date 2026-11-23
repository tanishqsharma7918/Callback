/* Callback — 3D visualizations (Three.js r128 through the global THREE; no addons).
 *
 *   CB.Viz3D.available()                    → boolean (THREE present + WebGL context can be created)
 *   CB.Viz3D.createFunnel(container, opts)  → { update(stages, dropoffs, theme), destroy() } | null
 *   CB.Viz3D.createGalaxy(container, opts)  → { update(points, theme), destroy() } | null
 *
 * Each viz draws into a transparent WebGL canvas plus an absolutely-positioned HTML overlay
 * (labels, ticks, tooltip) inside `container`. Frames are rendered only while the container is
 * on screen and the document is visible. With prefers-reduced-motion the scene is static
 * (no auto-rotation, no particle motion) and renders on demand; it stays draggable.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});

  // ───────── constants & small helpers ─────────
  const DEFAULT_THEME = { fg: '#14171f', muted: '#6b7280', grid: '#d9dce3', surface: '#ffffff', accent: '#c9a400' };
  const DROP = [
    { key: 'rejected', label: 'rejected', color: '#e34948' },
    { key: 'ghosted', label: 'ghosted', color: '#5d6470' },
    { key: 'withdrawn', label: 'withdrawn', color: '#a39e93' },
  ];
  const KNOCK_COLOR = '#e34948';
  const DEG = Math.PI / 180;
  const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const nowMs = () => (window.performance && performance.now ? performance.now() : Date.now());
  const isColor = (c) => typeof c === 'string' && COLOR_RE.test(c.trim());
  const num = (v, d) => {
    const n = typeof v === 'number' ? v : v === null || v === undefined || v === '' ? NaN : +v;
    return isFinite(n) ? n : d === undefined ? 0 : d;
  };
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function normTheme(t, prev) {
    const base = prev || DEFAULT_THEME;
    const o = {};
    for (const k in DEFAULT_THEME) o[k] = t && isColor(t[k]) ? t[k].trim() : base[k];
    return o;
  }
  function colorOf(css) {
    const c = new THREE.Color();
    if (isColor(css)) c.setStyle(css.trim());
    return c;
  }
  function rgba(css, a) {
    const c = colorOf(css);
    return 'rgba(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255) + ',' + a + ')';
  }
  function luminance(css) {
    const c = colorOf(css);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  }
  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  // ───────── availability (WebGL probe cached; THREE checked live so a lazy load still works) ─────────
  let glProbe = null;
  function available() {
    if (typeof THREE === 'undefined' || !THREE.WebGLRenderer) return false;
    if (glProbe === null) {
      glProbe = false;
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
        if (gl) {
          glProbe = true;
          const lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        }
      } catch (e) {
        glProbe = false;
      }
    }
    return glProbe;
  }

  // ───────── shared stylesheet (ref-counted) ─────────
  const CSS = [
    '.cb3d-canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:pan-y;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;outline:none;cursor:grab}',
    '.cb3d-canvas.is-drag{cursor:grabbing}',
    '.cb3d-canvas.is-hot{cursor:pointer}',
    '.cb3d-ov{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;overflow:hidden;font:500 12px Inter,system-ui,sans-serif;color:var(--cb3d-fg);-webkit-font-smoothing:antialiased;-webkit-user-select:none;user-select:none;text-align:left;letter-spacing:normal}',
    '.cb3d-ov *{box-sizing:border-box}',
    '.cb3d-chip{position:absolute;left:0;top:0;display:flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:6px;background:var(--cb3d-panel);border:1px solid var(--cb3d-line);color:var(--cb3d-fg);white-space:nowrap;line-height:18px;font-variant-numeric:tabular-nums;transition:opacity .2s ease,border-color .15s ease;will-change:transform}',
    '.cb3d-chip.is-pick{pointer-events:auto;cursor:pointer}',
    '.cb3d-chip.is-hot{border-color:var(--cb3d-muted)}',
    '.cb3d-chip:focus-visible{outline:2px solid var(--cb3d-accent);outline-offset:1px}',
    '.cb3d-chip b{font-weight:700;flex:none}',
    '.cb3d-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none}',
    '.cb3d-nm{overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}',
    '.cb3d-mu{color:var(--cb3d-muted);flex:none}',
    '.cb3d-sep{color:var(--cb3d-muted);flex:none}',
    '.cb3d-lead{position:absolute;left:0;top:0;height:1px;width:10px;background:var(--cb3d-lead);transform-origin:0 0;transition:opacity .2s ease}',
    '.cb3d-tick{position:absolute;left:0;top:0;font-size:11px;line-height:14px;color:var(--cb3d-muted);white-space:nowrap;font-variant-numeric:tabular-nums;text-shadow:0 0 2px var(--cb3d-surface),0 0 4px var(--cb3d-surface),0 0 6px var(--cb3d-surface);transition:opacity .2s ease}',
    '.cb3d-tick.is-title{color:var(--cb3d-fg);font-weight:600}',
    '.cb3d-off{opacity:0 !important;pointer-events:none !important}',
    '.cb3d-tip{position:absolute;left:0;top:0;max-width:240px;padding:8px 10px;border-radius:9px;background:var(--cb3d-tip);border:1px solid var(--cb3d-line);color:var(--cb3d-fg);box-shadow:0 8px 24px var(--cb3d-shadow);line-height:1.45;opacity:0;transition:opacity .12s ease;white-space:normal;font-variant-numeric:tabular-nums}',
    '.cb3d-tip.is-on{opacity:1}',
    '.cb3d-tip b{font-weight:700}',
    '.cb3d-t1{font-weight:700}',
    '.cb3d-t2{color:var(--cb3d-muted)}',
    '.cb3d-row{display:flex;align-items:center;gap:6px}',
    '.cb3d-msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 12px;border-radius:9px;background:var(--cb3d-panel);border:1px solid var(--cb3d-line);color:var(--cb3d-muted);white-space:nowrap}',
    '.cb3d-legend{position:absolute;right:10px;top:8px;display:flex;align-items:center;gap:10px;font-size:11px;line-height:14px;color:var(--cb3d-muted);white-space:nowrap;text-shadow:0 0 3px var(--cb3d-surface),0 0 5px var(--cb3d-surface)}',
    '.cb3d-legend.is-col{top:auto;bottom:8px;flex-direction:column;align-items:flex-start;gap:2px}',
    '.cb3d-legend span{display:inline-flex;align-items:center;gap:4px}',
  ].join('\n');
  let styleRefs = 0;
  let styleEl = null;
  function retainStyle() {
    if (styleRefs++ === 0) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-cb-viz3d', '');
      styleEl.textContent = CSS;
      (document.head || document.documentElement).appendChild(styleEl);
    }
  }
  function releaseStyle() {
    styleRefs = Math.max(0, styleRefs - 1);
    if (styleRefs === 0 && styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  }

  // ───────── shared GPU helpers ─────────
  function dotTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,1)');
    grd.addColorStop(0.78, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function circleGeometry(seg) {
    const p = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      p.push(Math.cos(a), 0, Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    return g;
  }
  function segmentsGeometry(arr) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return g;
  }
  function addLights(scene) {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa0aa, 0.72);
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(3.5, 1.5, -4);
    scene.add(hemi, key, rim);
    return { hemi, key, rim };
  }

  // ═════════ Stage: renderer, camera rig, pointer input, overlay, lifecycle ═════════
  function createStage(container, cfg) {
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    retainStyle();
    let posPatched = false;
    const prevPosition = container.style.position;
    try {
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
        posPatched = true;
      }
    } catch (e) { /* detached container */ }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    } catch (e) {
      if (posPatched) container.style.position = prevPosition;
      releaseStyle();
      throw e;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const canvas = renderer.domElement;
    canvas.className = 'cb3d-canvas';
    canvas.setAttribute('role', 'img');
    const overlay = el('div', 'cb3d-ov');
    container.appendChild(canvas);
    container.appendChild(overlay);
    const tip = el('div', 'cb3d-tip', overlay);
    tip.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(cfg.fov, 1, 0.05, 60);
    const pivot = new THREE.Group();
    scene.add(pivot);
    const target = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmpV = new THREE.Vector3();
    const disposables = new Set();

    let w = 0, h = 0, raf = 0, lastT = 0, destroyed = false;
    let visible = typeof IntersectionObserver === 'undefined';
    let vYaw = 0, vPitch = 0, swayT = 0;
    let lastInteract = nowMs() - 3000 + (cfg.autoDelay || 0);
    let tipW = 0, tipH = 0, tipHTML = '';
    const pointers = new Map();
    let drag = null, pinch = null, hoverDirty = false, rigMoved = true;
    const ptr = { x: 0, y: 0, inside: false };

    const S = {
      renderer, scene, camera, pivot, canvas, overlay, target, raycaster,
      yaw: cfg.yaw || 0, pitch: cfg.pitch || 0.3, zoom: 1, zoomT: 1, baseDist: 5, offsetX: 0, pxScale: 300,
      reduced: !!(mq && mq.matches),
      theme: normTheme(cfg.theme), dark: false,
      hooks: {}, ptr,
      get w() { return w; },
      get h() { return h; },
      track(o) { if (o) disposables.add(o); return o; },
      kick, project, showTip, hideTip, placeTip, moveTip, tipSize, rayAt, setCursor, destroy, applyThemeVars, resize,
      dragging: () => !!(drag && drag.moved),
      interacted() { lastInteract = nowMs(); swayT = 0; },
    };

    // ── theme → CSS variables on the overlay ──
    function applyThemeVars(theme) {
      S.theme = normTheme(theme, S.theme);
      const t = S.theme;
      S.dark = luminance(t.surface) < 0.4;
      const st = overlay.style;
      st.setProperty('--cb3d-fg', t.fg);
      st.setProperty('--cb3d-muted', t.muted);
      st.setProperty('--cb3d-surface', t.surface);
      st.setProperty('--cb3d-accent', t.accent);
      st.setProperty('--cb3d-panel', rgba(t.surface, 0.86));
      st.setProperty('--cb3d-tip', rgba(t.surface, 0.95));
      st.setProperty('--cb3d-line', t.grid);
      st.setProperty('--cb3d-lead', rgba(t.muted, 0.45));
      st.setProperty('--cb3d-shadow', S.dark ? 'rgba(0,0,0,.45)' : 'rgba(16,24,40,.12)');
    }
    applyThemeVars(cfg.theme);

    // ── projection & picking helpers ──
    function project(v, out) {
      tmpV.copy(v).project(camera);
      out.x = (tmpV.x + 1) * 0.5 * w;
      out.y = (1 - tmpV.y) * 0.5 * h;
      out.ok = tmpV.z > -1 && tmpV.z < 1;
      return out;
    }
    function rayAt(x, y) {
      ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster;
    }
    function setCursor(hot) {
      canvas.classList.toggle('is-hot', !!hot);
    }

    // ── tooltip ──
    function showTip(html) {
      if (html !== tipHTML) {
        tipHTML = html;
        tip.innerHTML = html;
        tipW = tip.offsetWidth;
        tipH = tip.offsetHeight;
      }
      tip.classList.add('is-on');
    }
    function hideTip() {
      tip.classList.remove('is-on');
    }
    function tipSize() {
      if (!tipW) { tipW = tip.offsetWidth; tipH = tip.offsetHeight; }
      return { w: tipW, h: tipH };
    }
    function moveTip(x, y) {
      x = clamp(x, 6, Math.max(6, w - tipW - 6));
      y = clamp(y, 6, Math.max(6, h - tipH - 6));
      tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    }
    function placeTip(ax, ay) {
      tipSize();
      let x = ax + 14, y = ay - tipH - 12;
      if (x + tipW > w - 6) x = ax - 14 - tipW;
      if (x < 6) x = Math.max(6, Math.min(w - tipW - 6, ax - tipW / 2));
      if (y < 6) y = ay + 16;
      if (y + tipH > h - 6) y = Math.max(6, h - 6 - tipH);
      tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    }

    // ── camera rig ──
    function placeCamera() {
      const d = S.baseDist * S.zoom;
      camera.position.set(target.x, target.y + Math.sin(S.pitch) * d, target.z + Math.cos(S.pitch) * d);
      camera.lookAt(target);
      pivot.rotation.y = S.yaw;
      camera.updateMatrixWorld();
      pivot.updateMatrixWorld();
    }
    function rigStep(dt, t) {
      let moving = false;
      if (!drag) {
        if (vYaw !== 0 || vPitch !== 0) {
          S.yaw += vYaw * dt;
          S.pitch += vPitch * dt;
          vYaw *= Math.exp(-dt * 3.2);
          vPitch *= Math.exp(-dt * 6);
          if (Math.abs(vYaw) < 0.004) vYaw = 0;
          if (Math.abs(vPitch) < 0.004) vPitch = 0;
          moving = true;
        }
        const idle = t - lastInteract;
        if (!S.reduced && !S.holdAuto && idle > 3000) {
          const ramp = clamp((idle - 3000) / 1500, 0, 1);
          if (cfg.auto === 'sway') {
            swayT += dt * ramp;
            S.yaw += cfg.swayAmp * cfg.swayW * Math.cos(cfg.swayW * swayT) * ramp * dt;
          } else {
            S.yaw += cfg.autoSpeed * ramp * dt;
          }
          moving = true;
        }
      }
      if (S.pitch < cfg.minPitch) { S.pitch = cfg.minPitch; vPitch = 0; }
      if (S.pitch > cfg.maxPitch) { S.pitch = cfg.maxPitch; vPitch = 0; }
      if (Math.abs(S.zoomT - S.zoom) > 1e-4) {
        S.zoom = lerp(S.zoom, S.zoomT, 1 - Math.exp(-dt * 14));
        moving = true;
      } else S.zoom = S.zoomT;
      if (S.yaw > Math.PI * 4 || S.yaw < -Math.PI * 4) S.yaw %= Math.PI * 2;
      placeCamera();
      return moving;
    }

    // ── loop ──
    function canRun() {
      return !destroyed && visible && !document.hidden && w > 0 && h > 0;
    }
    function kick() {
      if (!raf && canRun()) raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastT = 0;
    }
    function frame(t) {
      raf = 0;
      if (!canRun()) { lastT = 0; return; }
      const dt = lastT ? clamp((t - lastT) / 1000, 0, 0.1) : 1 / 60;
      lastT = t;
      const tNow = nowMs();
      const moving = rigStep(dt, tNow) || rigMoved;
      rigMoved = false;
      if (ptr.inside && !drag && (hoverDirty || moving) && S.hooks.hover) S.hooks.hover(ptr.x, ptr.y);
      hoverDirty = false;
      const active = S.hooks.frame ? S.hooks.frame(dt, tNow) : false;
      renderer.render(scene, camera);
      if (S.hooks.post) S.hooks.post(tNow);
      if (!S.reduced || moving || active || drag) raf = requestAnimationFrame(frame);
      else lastT = 0;
    }

    // ── size ──
    function resize() {
      if (destroyed) return;
      const nw = Math.round(container.clientWidth), nh = Math.round(container.clientHeight);
      if (!nw || !nh) { w = nw; h = nh; stop(); return; }
      w = nw;
      h = nh;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const L = S.hooks.layout ? S.hooks.layout(w, h) : null;
      if (L) {
        S.baseDist = L.dist;
        if (L.target) target.copy(L.target);
        S.offsetX = L.offsetX || 0;
      }
      if (S.offsetX) camera.setViewOffset(w, h, S.offsetX, 0, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      S.pxScale = (renderer.getPixelRatio() * h) / (2 * Math.tan((camera.fov * DEG) / 2));
      placeCamera();
      rigMoved = true;
      kick();
    }

    // ── pointer input ──
    function local(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      S.interacted();
      if (pointers.size === 1) {
        drag = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: nowMs(), tm: nowMs(), moved: false, type: e.pointerType };
        vYaw = 0;
        vPitch = 0;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: S.zoomT };
        if (drag) drag.moved = true;
      }
      kick();
    }
    function onMove(e) {
      const p = local(e);
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, p);
        S.interacted();
        if (pinch && pointers.size >= 2) {
          const [a, b] = Array.from(pointers.values());
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          S.zoomT = clamp((pinch.z0 * pinch.d0) / d, cfg.zoomMin, cfg.zoomMax);
        } else if (drag && drag.id === e.pointerId) {
          const dx = p.x - drag.x, dy = p.y - drag.y;
          if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) >= 6) {
            drag.moved = true;
            canvas.classList.add('is-drag');
            if (S.hooks.dragStart) S.hooks.dragStart();
          }
          if (drag.moved) {
            const k = (Math.PI * 1.15) / Math.max(320, w);
            const t = nowMs();
            const dtm = Math.max(1, t - drag.tm) / 1000;
            const dYaw = dx * k, dPitch = dy * k * 0.6;
            S.yaw += dYaw;
            S.pitch = clamp(S.pitch + dPitch, cfg.minPitch, cfg.maxPitch);
            vYaw = lerp(vYaw, dYaw / dtm, 0.45);
            vPitch = lerp(vPitch, dPitch / dtm, 0.45);
            drag.tm = t;
          }
          drag.x = p.x;
          drag.y = p.y;
        }
        kick();
        return;
      }
      if (e.pointerType === 'mouse' && !drag) {
        ptr.x = p.x;
        ptr.y = p.y;
        ptr.inside = true;
        hoverDirty = true;
        kick();
      }
    }
    function endPointer(e, cancelled) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (pointers.size < 2) pinch = null;
      if (drag && drag.id === e.pointerId) {
        const d = drag;
        drag = null;
        canvas.classList.remove('is-drag');
        if (cancelled) {
          vYaw = 0;
          vPitch = 0;
        } else if (!d.moved && nowMs() - d.t0 < 700) {
          if (S.hooks.tap) S.hooks.tap(d.x0, d.y0, d.type);
        } else if (nowMs() - d.tm > 90) {
          vYaw = 0;
          vPitch = 0;
        } else {
          vYaw = clamp(vYaw, -6, 6);
          vPitch = clamp(vPitch, -3, 3);
        }
        if (e.pointerType === 'mouse') {
          const p = local(e);
          ptr.x = p.x;
          ptr.y = p.y;
          hoverDirty = true;
        }
      }
      if (pointers.size === 0) drag = null;
      S.interacted();
      kick();
    }
    const onUp = (e) => endPointer(e, false);
    const onCancel = (e) => endPointer(e, true);
    function onLeave(e) {
      if (e.pointerType !== 'mouse') return;
      ptr.inside = false;
      if (S.hooks.leave) S.hooks.leave();
      kick();
    }
    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return; // never hijack page scroll
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      S.zoomT = clamp(S.zoomT * Math.exp(clamp(dy, -60, 60) * 0.01), cfg.zoomMin, cfg.zoomMax);
      S.interacted();
      kick();
    }
    const onCtx = (e) => { if (drag && drag.moved) e.preventDefault(); };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onCtx);

    // ── visibility, size, motion preference ──
    let io = null, ro = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        const en = entries[entries.length - 1];
        visible = !!(en && en.isIntersecting);
        if (visible) kick();
        else stop();
      });
      io.observe(container);
    }
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => resize());
      ro.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }
    const onVis = () => (document.hidden ? stop() : kick());
    document.addEventListener('visibilitychange', onVis);
    const onMotion = () => {
      S.reduced = !!(mq && mq.matches);
      if (S.hooks.motion) S.hooks.motion();
      rigMoved = true;
      kick();
    };
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onMotion);
      else if (mq.addListener) mq.addListener(onMotion);
    }

    // ── teardown ──
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener('change', onMotion);
        else if (mq.removeListener) mq.removeListener(onMotion);
      }
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onCtx);
      if (S.hooks.dispose) {
        try { S.hooks.dispose(); } catch (e) { /* ignore */ }
      }
      scene.traverse((o) => {
        if (o.geometry) disposables.add(o.geometry);
        if (o.isInstancedMesh) disposables.add(o);
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          disposables.add(m);
          if (m.map) disposables.add(m.map);
          if (m.uniforms) Object.keys(m.uniforms).forEach((k) => { const v = m.uniforms[k].value; if (v && v.isTexture) disposables.add(v); });
        });
      });
      disposables.forEach((d) => { try { d.dispose(); } catch (e) { /* ignore */ } });
      disposables.clear();
      try { renderer.renderLists.dispose(); } catch (e) { /* ignore */ }
      try { renderer.dispose(); } catch (e) { /* ignore */ }
      try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      canvas.remove();
      overlay.remove();
      pointers.clear();
      if (posPatched) container.style.position = prevPosition;
      releaseStyle();
      S.hooks = {};
    }

    S.start = () => resize();
    return S;
  }

  // ───────── overlay label helpers ─────────
  function makeLabel(parent, cls, html) {
    const e = el('div', cls, parent);
    if (html !== undefined) e.innerHTML = html;
    return { el: e, w: 0, h: 0, x: NaN, y: NaN, on: true, prio: 0 };
  }
  function measure(L) {
    L.w = L.el.offsetWidth;
    L.h = L.el.offsetHeight;
    return L.w > 0;
  }
  function moveLabel(L, x, y) {
    x = Math.round(x * 2) / 2;
    y = Math.round(y * 2) / 2;
    if (x !== L.x || y !== L.y) {
      L.x = x;
      L.y = y;
      L.el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }
  }
  function showLabel(L, on) {
    if (L.on !== on) {
      L.on = on;
      L.el.classList.toggle('cb3d-off', !on);
      if (L.el.hasAttribute('tabindex')) L.el.tabIndex = on ? 0 : -1;
    }
  }
  /** Greedy collision pass: higher prio keeps its place; overlapping lower-prio items are hidden. */
  function resolveOverlaps(items, pad) {
    const kept = [];
    items.sort((a, b) => b.prio - a.prio);
    for (const it of items) {
      if (!it.want) { it.ok = false; continue; }
      let hit = false;
      for (const k of kept) {
        if (it.x < k.x + k.w + pad && it.x + it.w + pad > k.x && it.y < k.y + k.h + pad && it.y + it.h + pad > k.y) { hit = true; break; }
      }
      it.ok = !hit;
      if (it.ok) kept.push(it);
    }
  }

  // ═════════ Funnel — "Pipeline Tower" ═════════
  const TIER_H = 0.22;
  const TIER_GAP = 0.09;
  const MIN_R = 0.18;
  const FLOOR_R = 1.08;
  const PITCH0 = 0.3;
  const FLOOR_Y = -0.14;
  const BAND_H = 0.016;
  const MAX_P = 600;

  function normStages(stages) {
    return (Array.isArray(stages) ? stages : []).filter(Boolean).map((s, i) => ({
      key: String(s.key === undefined ? i : s.key),
      label: String(s.label === undefined || s.label === null ? s.key : s.label),
      color: isColor(s.color) ? s.color.trim() : '#7c8799',
      count: Math.max(0, Math.round(num(s.count))),
    }));
  }
  function normDrops(d) {
    d = d || {};
    return DROP.map((x) => Math.max(0, Math.round(num(d[x.key]))));
  }

  function createFunnel(container, opts) {
    if (!container || !available()) return null;
    opts = opts || {};
    let S;
    try {
      S = createStage(container, {
        fov: 30, yaw: 0.35, pitch: PITCH0, minPitch: 0.04, maxPitch: 0.62,
        auto: 'spin', autoSpeed: 6 * DEG, zoomMin: 0.7, zoomMax: 1.6,
        theme: opts.theme, autoDelay: 900,
      });
    } catch (e) {
      console.warn('[Viz3D] WebGL renderer unavailable:', e && e.message);
      return null;
    }
    try {
      return buildFunnel(S, opts);
    } catch (e) {
      console.warn('[Viz3D] funnel failed:', e);
      S.destroy();
      return null;
    }
  }

  function buildFunnel(S, opts) {
    const { scene, pivot, camera } = S;
    const onPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    const lights = addLights(scene);

    // shared geometry
    const geoCyl = S.track(new THREE.CylinderGeometry(1, 1, TIER_H, 48, 1, false));
    const geoBand = S.track(new THREE.CylinderGeometry(1.006, 1.006, BAND_H, 48, 1, true));
    const geoCircle = S.track(circleGeometry(48));

    // floor: translucent disc + polar grid (spokes make rotation readable) + central axis
    const floorMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_R, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.renderOrder = -3;
    pivot.add(floor);
    const polar = [];
    [0.42, 0.8, FLOOR_R].forEach((r) => {
      for (let i = 0; i < 64; i++) {
        const a0 = (i / 64) * Math.PI * 2, a1 = ((i + 1) / 64) * Math.PI * 2;
        polar.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      }
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      polar.push(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, Math.cos(a) * FLOOR_R, 0, Math.sin(a) * FLOOR_R);
    }
    const polarMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false });
    const polarLines = new THREE.LineSegments(segmentsGeometry(polar), polarMat);
    polarLines.position.y = FLOOR_Y + 0.001;
    polarLines.renderOrder = -2;
    pivot.add(polarLines);
    const axisMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, FLOOR_Y, 0, 0, 2, 0], 3));
    const axis = new THREE.Line(axisGeo, axisMat);
    axis.renderOrder = -1;
    pivot.add(axis);

    const tower = new THREE.Group();
    pivot.add(tower);

    // particles (custom points shader using a round canvas sprite; per-particle color/alpha/size)
    const sprite = S.track(dotTexture());
    const pPos = new Float32Array(MAX_P * 3);
    const pCol = new Float32Array(MAX_P * 3);
    const pAlpha = new Float32Array(MAX_P);
    const pSize = new Float32Array(MAX_P);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const pMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: sprite }, uScale: { value: 300 }, uFade: { value: 1 } },
      vertexShader: [
        'attribute float aSize;',
        'attribute float aAlpha;',
        'attribute vec3 aColor;',
        'uniform float uScale;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main() {',
        '  vColor = aColor;',
        '  vAlpha = aAlpha;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = aAlpha > 0.004 ? max(1.5, aSize * uScale / -mv.z) : 0.0;',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap;',
        'uniform float uFade;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main() {',
        '  float a = texture2D(uMap, gl_PointCoord).a * vAlpha * uFade;',
        '  if (a < 0.06) discard;',
        '  gl_FragColor = vec4(vColor, a);',
        '}',
      ].join('\n'),
      transparent: true,
      depthWrite: true,
    });
    const points = new THREE.Points(pGeo, pMat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    pivot.add(points);

    // particle state
    const pState = new Uint8Array(MAX_P); // 0 dead, 1 falling in stream, 2 dropping out
    const pVx = new Float32Array(MAX_P), pVy = new Float32Array(MAX_P), pVz = new Float32Array(MAX_P);
    const pAge = new Float32Array(MAX_P), pLife = new Float32Array(MAX_P);
    const pAng = new Float32Array(MAX_P), pRad = new Float32Array(MAX_P), pSpd = new Float32Array(MAX_P);
    const pNext = new Int16Array(MAX_P), pKind = new Uint8Array(MAX_P);
    const palette = [new THREE.Color(), new THREE.Color(DROP[0].color), new THREE.Color(DROP[1].color), new THREE.Color(DROP[2].color), new THREE.Color()];
    let spawnAcc = 0, spawnRate = 0, cursor = 0;

    // overlay: labels + optional legend
    const labelLayer = el('div', '', S.overlay);
    const legend = el('div', 'cb3d-legend', S.overlay);
    legend.setAttribute('aria-hidden', 'true');

    // model state
    let stages = [];
    let drops = [0, 0, 0];
    let tiers = [];
    let H = 0;
    let hot = -1, hotSrc = '';
    const tmp = new THREE.Vector3();
    const right = new THREE.Vector3();
    const P = { x: 0, y: 0, ok: true };
    const P2 = { x: 0, y: 0, ok: true };
    const screen = []; // per tier projected {cx, cy, ax, hh}
    let narrow = false;
    let colMaxW = 200;
    let leadGap = 18;
    let legendW = 0, legendH = 0;
    function measureLegend() {
      legendW = legend.offsetWidth;
      legendH = legend.offsetHeight;
    }

    function tierY(i) {
      return H - TIER_H / 2 - i * (TIER_H + TIER_GAP);
    }
    function radiusFor(c, max) {
      return max > 0 ? Math.max(MIN_R, Math.sqrt(c / max)) : MIN_R;
    }
    function stackHeight(n) {
      return n > 0 ? n * TIER_H + (n - 1) * TIER_GAP : 0.6;
    }

    function disposeTier(t) {
      tower.remove(t.group);
      t.mats.forEach((m) => m.dispose());
      t.chip.el.remove();
      t.lead.remove();
    }

    function chipHTML(i) {
      const s = stages[i];
      const prev = i > 0 ? stages[i - 1].count : 0;
      const name = narrow ? shortName(s) : s.label;
      const sep = narrow ? '' : '<span class="cb3d-sep">·</span>';
      let html = '<span class="cb3d-dot" style="background:' + esc(s.color) + '"></span><span class="cb3d-nm">' + esc(name) + '</span>' + sep + '<b>' + s.count + '</b>';
      if (i > 0) html += sep + '<span class="cb3d-mu">' + (prev > 0 ? Math.round((s.count / prev) * 100) + '%' : '—') + '</span>';
      return html;
    }
    function shortName(s) {
      const st = CB.STAGE && CB.STAGE[s.key];
      return st && st.short && st.label === s.label ? st.short : s.label;
    }

    function rebuild(animate) {
      tiers.forEach(disposeTier);
      tiers = [];
      const n = stages.length;
      H = stackHeight(n);
      const max = stages.reduce((m, s) => Math.max(m, s.count), 0);
      const t0 = nowMs();
      stages.forEach((s, i) => {
        const col = new THREE.Color(s.color);
        const mk = (side, opacity) => new THREE.MeshStandardMaterial({
          color: col, emissive: col, emissiveIntensity: 0.15, roughness: 0.35, metalness: 0.1,
          transparent: true, opacity, side, depthWrite: false,
        });
        const backMat = mk(THREE.BackSide, 0.3);
        const frontMat = mk(THREE.FrontSide, 0.55);
        const bandMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1, side: THREE.DoubleSide });
        const ringMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.75 });
        const group = new THREE.Group();
        const back = new THREE.Mesh(geoCyl, backMat);
        back.renderOrder = 1;
        const front = new THREE.Mesh(geoCyl, frontMat);
        front.renderOrder = 3;
        front.userData.tier = i;
        const band = new THREE.Mesh(geoBand, bandMat);
        band.position.y = TIER_H / 2 - BAND_H / 2;
        band.renderOrder = 0;
        const ring = new THREE.LineLoop(geoCircle, ringMat);
        ring.position.y = -TIER_H / 2;
        ring.renderOrder = 0;
        group.add(back, front, band, ring);
        group.position.y = tierY(i);
        tower.add(group);

        const chip = makeLabel(labelLayer, 'cb3d-chip is-pick', chipHTML(i));
        chip.el.setAttribute('role', 'button');
        chip.el.setAttribute('tabindex', '0');
        const lead = el('div', 'cb3d-lead', labelLayer);
        const r = radiusFor(s.count, max);
        const T = {
          key: s.key, index: i, group, front, back, band, ring, chip, lead,
          mats: [backMat, frontMat, bandMat, ringMat],
          rFrom: r, rTo: r, rNow: r, tStart: t0,
          appear: animate && !S.reduced ? 0 : 1, appearDelay: i * 55, hv: 0, empty: s.count === 0,
        };
        bindChip(T);
        tiers.push(T);
      });
      S.appearStart = 0; // entrance clock starts on the first rendered frame
      resetParticles();
      tiers.forEach((t) => measure(t.chip));
      axisGeo.attributes.position.setY(1, H + 0.3);
      axisGeo.attributes.position.needsUpdate = true;
      axisGeo.computeBoundingSphere();
      hot = -1;
      S.hideTip();
    }

    function bindChip(T) {
      const e = T.chip.el;
      e.addEventListener('pointerenter', (ev) => {
        if (ev.pointerType === 'mouse') setHot(T.index, 'chip');
      });
      e.addEventListener('pointerleave', (ev) => {
        if (ev.pointerType === 'mouse' && hotSrc === 'chip') setHot(-1);
      });
      e.addEventListener('click', () => {
        if (T.index < tiers.length) {
          setHot(T.index, 'tap');
          if (onPick) onPick(T.key);
        }
      });
      e.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          if (onPick) onPick(T.key);
        }
      });
      e.addEventListener('focus', () => {
        let kb = true;
        try { kb = e.matches(':focus-visible'); } catch (err) { /* older Safari */ }
        if (kb) setHot(T.index, 'tap');
      });
      e.addEventListener('blur', () => { if (hotSrc === 'tap') setHot(-1); });
    }

    function tipHTML(i) {
      const s = stages[i];
      const prev = i > 0 ? stages[i - 1] : null;
      const next = i < stages.length - 1 ? stages[i + 1] : null;
      let html = '<div class="cb3d-row"><span class="cb3d-dot" style="background:' + esc(s.color) + '"></span><span class="cb3d-t1">' + esc(s.label) + '</span></div>';
      html += '<div><b>' + s.count + '</b> ' + (s.count === 1 ? 'application' : 'applications') + '</div>';
      if (prev) html += '<div class="cb3d-t2">' + (prev.count > 0 ? Math.round((s.count / prev.count) * 100) + '% of ' + esc(prev.label) : 'None reached ' + esc(prev.label)) + '</div>';
      else html += '<div class="cb3d-t2">Top of the pipeline</div>';
      if (next && s.count > next.count) html += '<div class="cb3d-t2">' + (s.count - next.count) + ' didn’t reach ' + esc(next.label) + '</div>';
      return html;
    }

    function setHot(i, src) {
      if (i < 0 || i >= tiers.length) {
        if (hot !== -1) {
          tiers[hot] && tiers[hot].chip.el.classList.remove('is-hot');
          hot = -1;
          hotSrc = '';
          S.hideTip();
          S.setCursor(false);
          S.holdAuto = false;
        }
        S.kick();
        return;
      }
      if (hot !== i) {
        if (tiers[hot]) tiers[hot].chip.el.classList.remove('is-hot');
        hot = i;
        tiers[i].chip.el.classList.add('is-hot');
      }
      hotSrc = src;
      S.holdAuto = src === 'canvas' || src === 'chip';
      S.setCursor(src === 'canvas');
      S.showTip(tipHTML(i));
      S.kick();
    }

    /** Tiers overlap on screen (a wider tier above hangs over the next one), so among every tier
     *  under the pointer — ray hits through the glass plus each tier's screen band — pick the one
     *  whose vertical centre (where its label points) is closest. Thin tiers get a touch-size band. */
    function pick(x, y, type) {
      if (!tiers.length) return -1;
      const cand = new Set();
      S.rayAt(x, y).intersectObjects(tiers.map((t) => t.front), false).forEach((hh) => cand.add(hh.object.userData.tier));
      const minHalf = type === 'touch' || type === 'pen' ? 24 : 12;
      for (let i = 0; i < screen.length; i++) {
        const s = screen[i];
        if (!s) continue;
        const half = Math.max(minHalf, s.ax - s.cx) + 6;
        if (Math.abs(x - s.cx) <= half && Math.abs(y - s.cy) <= Math.max(s.hh + s.eh, minHalf / 2) + 4) cand.add(i);
      }
      let best = -1, bestD = Infinity;
      cand.forEach((i) => {
        const s = screen[i];
        const d = s ? Math.abs(y - s.cy) : 0;
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    }
    /** Tooltip sits over the tower, above the hovered tier (below it when there is no room). */
    function placeFunnelTip(i) {
      const s = screen[i];
      if (!s) return;
      const sz = S.tipSize();
      const x = s.cx - sz.w / 2;
      let y = s.cy - s.hh - s.eh - sz.h - 10;
      if (y < 6) y = s.cy + s.hh + s.eh + 10;
      S.moveTip(x, y);
    }

    // ── particles ──
    function exitProb(i) {
      if (i >= stages.length - 1) return 0;
      const c = stages[i].count, n = stages[i + 1].count;
      return c > 0 ? clamp(1 - n / c, 0, 1) : 1;
    }
    let exitP = [];
    function refreshFlow() {
      exitP = stages.map((s, i) => exitProb(i));
      const top = stages.length ? stages[0].count : 0;
      spawnRate = top > 0 ? clamp(4 + top * 0.45, 5, 36) : 0;
    }
    function streamR(y) {
      const n = tiers.length;
      if (!n) return 0.05;
      const step = TIER_H + TIER_GAP;
      const f = (tierY(0) - y) / step;
      if (f <= 0) return tiers[0].rNow * 0.42;
      if (f >= n - 1) return tiers[n - 1].rNow * 0.42;
      const i = Math.floor(f);
      return lerp(tiers[i].rNow, tiers[i + 1].rNow, f - i) * 0.42;
    }
    function pickDropKind() {
      const total = drops[0] + drops[1] + drops[2];
      if (!total) return 4;
      let r = Math.random() * total;
      for (let k = 0; k < 3; k++) {
        r -= drops[k];
        if (r < 0) return k + 1;
      }
      return 3;
    }
    function spawn() {
      for (let n = 0; n < MAX_P; n++) {
        const i = (cursor + n) % MAX_P;
        if (pState[i] === 0) {
          cursor = (i + 1) % MAX_P;
          pState[i] = 1;
          pAge[i] = 0;
          pAng[i] = Math.random() * Math.PI * 2;
          pRad[i] = Math.sqrt(Math.random());
          pSpd[i] = 0.5 * (0.85 + Math.random() * 0.3);
          pNext[i] = 0;
          pKind[i] = 0;
          pPos[i * 3 + 1] = H + 0.24;
          pSize[i] = 0.04;
          return;
        }
      }
    }
    function step(dt) {
      if (spawnRate > 0) {
        spawnAcc += spawnRate * dt;
        while (spawnAcc >= 1) { spawnAcc -= 1; spawn(); }
      }
      let alive = 0;
      const nT = tiers.length;
      for (let i = 0; i < MAX_P; i++) {
        const st = pState[i];
        if (!st) { pAlpha[i] = 0; continue; }
        alive++;
        const o = i * 3;
        pAge[i] += dt;
        if (st === 1) {
          let y = pPos[o + 1] - pSpd[i] * dt;
          pAng[i] += dt * 0.7;
          const sr = streamR(y) * pRad[i];
          pPos[o] = Math.cos(pAng[i]) * sr;
          pPos[o + 2] = Math.sin(pAng[i]) * sr;
          pPos[o + 1] = y;
          while (pNext[i] < nT && y <= tierY(pNext[i])) {
            if (Math.random() < exitP[pNext[i]]) {
              pState[i] = 2;
              pKind[i] = pickDropKind();
              const a = Math.random() * Math.PI * 2, sp = 0.85 + Math.random() * 0.45;
              pVx[i] = Math.cos(a) * sp;
              pVz[i] = Math.sin(a) * sp;
              pVy[i] = 0.1 + Math.random() * 0.1;
              pAge[i] = 0;
              pLife[i] = 1.8 + Math.random() * 0.8;
              pSize[i] = 0.07;
              break;
            }
            pNext[i]++;
          }
          if (pState[i] === 1) {
            let a = Math.min(1, pAge[i] / 0.35) * 0.9;
            if (y < FLOOR_Y + 0.16) a *= clamp((y - FLOOR_Y) / 0.16, 0, 1);
            pAlpha[i] = a;
            if (y <= FLOOR_Y) { pState[i] = 0; pAlpha[i] = 0; }
          }
        } else {
          pVy[i] -= 0.7 * dt;
          const drag = Math.exp(-dt * 0.35);
          pVx[i] *= drag;
          pVz[i] *= drag;
          pPos[o] += pVx[i] * dt;
          pPos[o + 1] += pVy[i] * dt;
          pPos[o + 2] += pVz[i] * dt;
          const k = pAge[i] / pLife[i];
          let a = 0.95 * Math.pow(1 - clamp(k, 0, 1), 1.3);
          if (pPos[o + 1] < FLOOR_Y + 0.1) a *= clamp((pPos[o + 1] - FLOOR_Y) / 0.1, 0, 1);
          pAlpha[i] = a;
          if (k >= 1 || pPos[o + 1] <= FLOOR_Y) { pState[i] = 0; pAlpha[i] = 0; }
        }
      }
      return alive;
    }
    function writeColors() {
      for (let i = 0; i < MAX_P; i++) {
        if (!pState[i]) continue;
        const c = palette[pKind[i]];
        pCol[i * 3] = c.r;
        pCol[i * 3 + 1] = c.g;
        pCol[i * 3 + 2] = c.b;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.aColor.needsUpdate = true;
      pGeo.attributes.aAlpha.needsUpdate = true;
      pGeo.attributes.aSize.needsUpdate = true;
    }
    function resetParticles() {
      pState.fill(0);
      pAlpha.fill(0);
      spawnAcc = 0;
    }
    /** Run the flow forward so it is already in steady state when first seen. */
    function warm(seconds) {
      for (let k = 0, n = Math.round(seconds * 30); k < n; k++) step(1 / 30);
      writeColors();
    }
    /** Reduced motion: show a frozen, representative snapshot of the flow. */
    function presimulate() {
      resetParticles();
      warm(6);
    }

    // ── theme ──
    function applyTheme(theme) {
      S.applyThemeVars(theme);
      const t = S.theme;
      floorMat.color.set(t.grid);
      floorMat.opacity = S.dark ? 0.55 : 0.5;
      polarMat.color.set(t.muted);
      polarMat.opacity = S.dark ? 0.3 : 0.26;
      axisMat.color.set(t.muted);
      palette[0].set(t.fg);
      palette[4].set(t.muted);
      lights.hemi.intensity = S.dark ? 0.8 : 0.72;
      lights.hemi.groundColor.set(S.dark ? 0x40444c : 0x9aa0aa);
      tiers.forEach((T) => T.chip.el.style && measure(T.chip));
      writeColors();
    }

    // ── layout: reserve a label column on the right; fit the tower in what is left ──
    // Size the label column to the widest label, then fit tower + column and centre them together.
    S.hooks.layout = (w, h) => {
      const wasNarrow = narrow;
      narrow = w < 480;
      if (wasNarrow !== narrow) tiers.forEach((T) => { T.chip.el.innerHTML = chipHTML(T.index); measure(T.chip); });
      let labelW = 0;
      tiers.forEach((T) => { if (!T.chip.w) measure(T.chip); labelW = Math.max(labelW, T.chip.w); });
      labelW = clamp(Math.ceil((labelW || 110) / 8) * 8, 72, Math.round(w * 0.55));
      leadGap = narrow ? 12 : 18;
      const margin = narrow ? 6 : 14;
      const tanH = Math.tan((camera.fov * DEG) / 2);
      const stack = Math.max(H, stackHeight(8) * 0.75);
      const needH = stack * Math.cos(PITCH0) + 2 * FLOOR_R * Math.sin(PITCH0) + 0.4;
      const ppuH = (h * 0.95) / needH;
      const ppuW = (w - labelW - leadGap - 2 * margin) / (FLOOR_R + 1.04);
      const ppu = Math.max(24, Math.min(ppuH, ppuW));
      const total = (FLOOR_R + 1) * ppu + leadGap + labelW;
      const towerX = (w - total) / 2 + FLOOR_R * ppu;
      legend.classList.toggle('is-col', w < 520);
      measureLegend();
      return {
        dist: h / (2 * tanH * ppu),
        target: new THREE.Vector3(0, (FLOOR_Y - FLOOR_R * Math.sin(PITCH0) + H + 0.24) / 2, 0),
        offsetX: Math.round(w / 2 - towerX),
      };
    };

    S.hooks.hover = (x, y) => {
      if (hotSrc === 'chip') return;
      const i = pick(x, y, 'mouse');
      if (i >= 0) { if (i !== hot || hotSrc !== 'canvas') setHot(i, 'canvas'); }
      else if (hotSrc === 'canvas' || hotSrc === 'tap') setHot(-1);
    };
    S.hooks.leave = () => { if (hotSrc === 'canvas') setHot(-1); };
    S.hooks.dragStart = () => { if (hotSrc !== 'chip') setHot(-1); };
    S.hooks.tap = (x, y, type) => {
      const i = pick(x, y, type);
      if (i >= 0) {
        setHot(i, type === 'mouse' ? 'canvas' : 'tap');
        if (onPick) onPick(tiers[i].key);
      } else setHot(-1);
    };
    S.hooks.motion = () => {
      if (S.reduced) {
        tiers.forEach((T) => { T.appear = 1; T.rNow = T.rTo; T.rFrom = T.rTo; });
        presimulate();
      }
    };

    S.hooks.frame = (dt, t) => {
      let active = false;
      const dark = S.dark;
      if (!S.appearStart) S.appearStart = t;
      for (const T of tiers) {
        // entrance
        if (T.appear < 1) {
          T.appear = S.reduced ? 1 : clamp((t - S.appearStart - T.appearDelay) / 520, 0, 1);
          active = true;
        }
        // radius tween
        if (T.rNow !== T.rTo) {
          const k = S.reduced ? 1 : (t - T.tStart) / 600;
          T.rNow = k >= 1 ? T.rTo : lerp(T.rFrom, T.rTo, easeOut(k));
          active = true;
        }
        // hover
        const hvT = T.index === hot ? 1 : 0;
        if (T.hv !== hvT) {
          T.hv = S.reduced ? hvT : Math.abs(hvT - T.hv) < 0.01 ? hvT : lerp(T.hv, hvT, 1 - Math.exp(-dt * 14));
          active = true;
        }
        const e = easeOut(T.appear);
        const hs = 1 + 0.04 * T.hv;
        const rr = T.rNow * (0.35 + 0.65 * e) * hs;
        T.group.scale.set(rr, Math.max(0.001, e) * hs, rr);
        T.group.position.y = tierY(T.index) - (1 - e) * 0.3;
        const glass = T.empty ? 0.4 : 1;
        T.mats[0].opacity = (dark ? 0.32 : 0.28) * e * glass;
        T.mats[1].opacity = (dark ? 0.58 : 0.55) * e * glass;
        T.mats[2].opacity = e;
        T.mats[3].opacity = 0.75 * e;
        const em = (dark ? 0.3 : 0.12) + 0.42 * T.hv;
        T.mats[0].emissiveIntensity = em;
        T.mats[1].emissiveIntensity = em;
      }
      pMat.uniforms.uFade.value = S.reduced ? 1 : clamp((t - S.appearStart - 450) / 500, 0, 1);
      if (!S.reduced) {
        step(dt);
        writeColors();
        active = true;
      }
      return active;
    };

    S.hooks.post = () => {
      const w = S.w, h = S.h;
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      right.y = 0;
      right.normalize();
      let colX = 0;
      for (const T of tiers) {
        const y = T.group.position.y;
        const r = T.group.scale.x;
        S.project(tmp.set(0, y, 0), P);
        const cx = P.x, cy = P.y;
        S.project(tmp.set(right.x * r, y, right.z * r), P2);
        const ax = P2.x;
        S.project(tmp.set(0, y + TIER_H / 2, 0), P);
        const hh = Math.abs(cy - P.y);
        S.project(tmp.set(0, y, r), P);
        screen[T.index] = { cx, cy, ax, ay: P2.y, hh, eh: Math.abs(P.y - cy) };
        colX = Math.max(colX, ax);
      }
      screen.length = tiers.length;
      colX = Math.min(colX + leadGap, w - 70);
      const maxW = Math.max(60, w - colX - 6);
      if (maxW !== colMaxW) {
        colMaxW = maxW;
        tiers.forEach((T) => { T.chip.el.style.maxWidth = maxW + 'px'; });
      }
      const items = tiers.map((T) => {
        const s = screen[T.index];
        if (!T.chip.w) measure(T.chip);
        return { T, x: colX, y: s.ay - (T.chip.h || 20) / 2, w: Math.min(T.chip.w, maxW), h: T.chip.h || 20, prio: T.index === hot ? 1e6 : tiers.length - T.index, want: T.appear > 0.55 };
      });
      resolveOverlaps(items, 1);
      if (legend.firstChild) {
        if (!legendW) measureLegend();
        const lx = w - 10 - legendW, ly = legend.classList.contains('is-col') ? h - 8 - legendH : 8;
        const clash = items.some((it) => it.ok && it.x < lx + legendW + 4 && it.x + it.w + 4 > lx && it.y < ly + legendH + 4 && it.y + it.h + 4 > ly);
        legend.classList.toggle('cb3d-off', clash);
      }
      for (const it of items) {
        const T = it.T, s = screen[T.index];
        moveLabel(T.chip, it.x, it.y);
        showLabel(T.chip, it.ok);
        const lx = s.ax + 4, lw = Math.max(0, colX - 4 - lx);
        const tf = 'translate(' + Math.round(lx) + 'px,' + Math.round(s.ay) + 'px) scaleX(' + (lw / 10).toFixed(2) + ')';
        if (tf !== T.leadTf) { T.leadTf = tf; T.lead.style.transform = tf; }
        T.lead.classList.toggle('cb3d-off', !it.ok || lw < 4);
      }
      // tooltip
      if (hot >= 0 && screen[hot]) placeFunnelTip(hot);
      pMat.uniforms.uScale.value = S.pxScale;
    };

    function setLegend() {
      const total = drops[0] + drops[1] + drops[2];
      legend.innerHTML = total ? DROP.map((d, k) => (drops[k] ? '<span><span class="cb3d-dot" style="background:' + d.color + '"></span>' + drops[k] + ' ' + d.label + '</span>' : '')).join('') : '';
      measureLegend();
    }
    function setAria() {
      S.canvas.setAttribute('aria-label', 'Pipeline tower: ' + stages.map((s) => s.label + ' ' + s.count).join(', ') + (drops[0] + drops[1] + drops[2] ? '. Closed: ' + DROP.map((d, k) => drops[k] + ' ' + d.label).join(', ') : ''));
    }

    // ── public API ──
    function update(newStages, newDrops, theme) {
      if (!S.hooks.frame) return;
      const ns = newStages === null || newStages === undefined ? stages : normStages(newStages);
      if (newDrops) drops = normDrops(newDrops);
      const sameKeys = ns.length === tiers.length && ns.every((s, i) => s.key === tiers[i].key);
      if (theme) S.applyThemeVars(theme);
      const rebuilt = !sameKeys;
      if (!sameKeys) {
        stages = ns;
        rebuild(false);
      } else {
        const max = ns.reduce((m, s) => Math.max(m, s.count), 0);
        const t0 = nowMs();
        stages = ns;
        tiers.forEach((T, i) => {
          const s = ns[i];
          T.rFrom = T.rNow;
          T.rTo = radiusFor(s.count, max);
          T.tStart = t0;
          T.empty = s.count === 0;
          const col = new THREE.Color(s.color);
          T.mats.forEach((m) => { m.color.copy(col); if (m.emissive) m.emissive.copy(col); });
          T.chip.el.innerHTML = chipHTML(i);
          measure(T.chip);
        });
        if (hot >= 0) S.showTip(tipHTML(hot));
      }
      refreshFlow();
      applyTheme(theme);
      setLegend();
      setAria();
      if (S.reduced) presimulate();
      else if (rebuilt) warm(3);
      S.resize();
    }

    // initial build
    stages = normStages(opts.stages);
    drops = normDrops(opts.dropoffs);
    rebuild(true);
    refreshFlow();
    applyTheme(opts.theme);
    setLegend();
    setAria();
    if (S.reduced) presimulate();
    else warm(3);
    S.start();

    return {
      update,
      destroy() {
        tiers.forEach((T) => { T.chip.el.remove(); T.lead.remove(); });
        tiers = [];
        S.destroy();
      },
    };
  }

  // ═════════ Galaxy — "Opportunity Space" ═════════
  const R_MIN = 0.025;
  const R_MAX = 0.06;

  function normPoints(points) {
    return (Array.isArray(points) ? points : []).filter(Boolean).slice(0, 800).map((p, i) => ({
      id: p.id === undefined ? i : p.id,
      label: String(p.label === undefined || p.label === null ? '' : p.label),
      sub: String(p.sub === undefined || p.sub === null ? '' : p.sub),
      x: clamp(num(p.x), 0, 100),
      y: clamp(num(p.y), 0, 1),
      z: Math.max(0, num(p.z)),
      size: clamp(num(p.size, 0.5), 0, 1),
      color: isColor(p.color) ? p.color.trim() : '#7c8799',
      knocked: !!p.knocked,
      statusLabel: String(p.statusLabel === undefined || p.statusLabel === null ? '' : p.statusLabel),
    }));
  }

  function createGalaxy(container, opts) {
    if (!container || !available()) return null;
    opts = opts || {};
    let S;
    try {
      S = createStage(container, {
        fov: 32, yaw: 0.5, pitch: 0.4, minPitch: 0.02, maxPitch: 1.25,
        auto: 'sway', swayAmp: 0.36, swayW: (Math.PI * 2) / 26,
        zoomMin: 0.75, zoomMax: 1.6, theme: opts.theme, autoDelay: 600,
      });
    } catch (e) {
      console.warn('[Viz3D] WebGL renderer unavailable:', e && e.message);
      return null;
    }
    try {
      return buildGalaxy(S, opts);
    } catch (e) {
      console.warn('[Viz3D] galaxy failed:', e);
      S.destroy();
      return null;
    }
  }

  function buildGalaxy(S, opts) {
    const { scene, pivot, camera } = S;
    const onPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    const lights = addLights(scene);
    const X = (v) => clamp(v, 0, 100) / 100 - 0.5;

    // floor fill + grid
    const floorMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.5;
    floor.renderOrder = -3;
    pivot.add(floor);
    const g = [];
    for (let i = 0; i <= 10; i++) {
      const v = i / 10 - 0.5;
      g.push(v, -0.5, -0.5, v, -0.5, 0.5, -0.5, -0.5, v, 0.5, -0.5, v);
    }
    const gridMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
    const grid = new THREE.LineSegments(segmentsGeometry(g), gridMat);
    grid.renderOrder = -2;
    pivot.add(grid);
    // faint cube edges for depth: three verticals (the fourth is the Y axis) + the top square
    const edges = [
      0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
    ];
    const boxMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    const box = new THREE.LineSegments(segmentsGeometry(edges), boxMat);
    box.renderOrder = -2;
    pivot.add(box);
    // axes + tick marks. Origin of X (ATS) and Z (days) is the front-left floor corner;
    // Y (chance) rises from the back-left corner so it never crosses in front of the data.
    const ax = [-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5];
    [0, 0.5, 1].forEach((f) => {
      const v = f - 0.5;
      ax.push(v, -0.5, 0.5, v, -0.5, 0.53); // x ticks
      ax.push(-0.5, v, -0.5, -0.53, v, -0.5); // y ticks
      ax.push(-0.5, -0.5, 0.5 - f, -0.53, -0.5, 0.5 - f); // z ticks
    });
    const axisMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false });
    const axes = new THREE.LineSegments(segmentsGeometry(ax), axisMat);
    axes.renderOrder = -1;
    pivot.add(axes);

    // screening threshold plane at ATS 75
    const thrX = X(75);
    const planeMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
    plane.rotation.y = Math.PI / 2;
    plane.position.x = thrX;
    plane.renderOrder = 4;
    pivot.add(plane);
    const planeEdgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false });
    const planeEdge = new THREE.LineLoop(segmentsGeometry([thrX, -0.5, -0.5, thrX, 0.5, -0.5, thrX, 0.5, 0.5, thrX, -0.5, 0.5]), planeEdgeMat);
    planeEdge.renderOrder = 4;
    pivot.add(planeEdge);

    // points
    const geoIco = S.track(new THREE.IcosahedronGeometry(1, 1));
    const geoOct = S.track(new THREE.OctahedronGeometry(1, 0));
    const glow = { value: 0.2 };
    const pointMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.05 });
    pointMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = glow;
      shader.fragmentShader = 'uniform float uGlow;\n' + shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uGlow;'
      );
    };
    pointMat.customProgramCacheKey = () => 'cb3d-point-glow';
    const knockMat = new THREE.MeshBasicMaterial({ color: KNOCK_COLOR, wireframe: true, transparent: true, opacity: 0.95 });
    let cap = 0;
    let meshN = null, meshK = null;
    function ensureCapacity(n) {
      if (n <= cap && meshN) return;
      cap = Math.max(32, Math.pow(2, Math.ceil(Math.log2(Math.max(1, n)))));
      [meshN, meshK].forEach((m) => { if (m) { pivot.remove(m); m.dispose(); } });
      meshN = new THREE.InstancedMesh(geoIco, pointMat, cap);
      meshN.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      meshK = new THREE.InstancedMesh(geoOct, knockMat, cap);
      [meshN, meshK].forEach((m) => {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.count = 0;
        pivot.add(m);
      });
      meshK.renderOrder = 1;
    }
    // drop-lines to the floor
    const dropMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false });
    let dropLines = null;
    // hover halo (billboarded ring)
    const haloMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.75, depthTest: false, depthWrite: false });
    const halo = new THREE.LineLoop(S.track(circleGeometry(40)), haloMat);
    halo.renderOrder = 10;
    halo.visible = false;
    scene.add(halo);

    // overlay labels
    const tickLayer = el('div', '', S.overlay);
    const thrLabel = makeLabel(tickLayer, 'cb3d-chip', '');
    const msg = el('div', 'cb3d-msg', S.overlay);
    msg.textContent = 'No applications to plot yet';
    msg.style.display = 'none';
    let ticks = [];

    // state
    let pts = [];
    let yMax = 0.6, zMax = 60, zOver = false, density = 1;
    let idxN = [], idxK = [];
    let hot = -1, hotSrc = '';
    let hv = new Float32Array(0);
    let appearStart = 0; // set on the first rendered frame
    let appearing = !S.reduced;
    const tmp = new THREE.Vector3();
    const P = { x: 0, y: 0, ok: true };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const sc = new THREE.Vector3();
    const tmpC = new THREE.Color();

    const Y = (v) => clamp(v / yMax, 0, 1) - 0.5;
    const Z = (d) => 0.5 - clamp(d / zMax, 0, 1);

    function buildTicks() {
      ticks.forEach((t) => t.el.remove());
      ticks = [];
      const add = (x, y, z, text, prio, title) => {
        const L = makeLabel(tickLayer, 'cb3d-tick' + (title ? ' is-title' : ''));
        L.el.textContent = text;
        L.anchor = new THREE.Vector3(x, y, z);
        L.prio = prio;
        ticks.push(L);
      };
      const pctT = (v) => Math.round(v * 100) + '%';
      [0, 50, 100].forEach((v, i) => add(X(v), -0.5, 0.59, String(v), i === 1 ? 4 : 5, false));
      add(X(75), -0.5, 0.77, 'ATS score', 9, true);
      [0, yMax / 2, yMax].forEach((v, i) => add(-0.565, Y(v), -0.565, pctT(v), i === 0 ? 2 : 5, false));
      add(-0.5, 0.5 + 0.13, -0.5, 'Chance', 9, true);
      [0, zMax / 2, zMax].forEach((v, i) => add(-0.6, -0.5, Z(v), i === 2 && zOver ? v + '+' : String(Math.round(v)), i === 0 ? 1 : 4, false));
      add(-0.76, -0.5, 0, 'Days', 8, true);
      ticks.forEach(measure);
      thrLabel.el.innerHTML = '<span class="cb3d-dot" style="background:var(--cb3d-accent)"></span><span>Recruiter threshold 75</span>';
      thrLabel.anchor = new THREE.Vector3(thrX, 0.5 + 0.07, -0.3);
      thrLabel.prio = 7;
      measure(thrLabel);
    }

    function rebuildPoints() {
      const n = pts.length;
      const maxY = pts.reduce((m, p) => Math.max(m, p.y), 0);
      const maxZ = pts.reduce((m, p) => Math.max(m, p.z), 0);
      yMax = clamp(Math.ceil(Math.max(0.6, maxY) * 10 - 1e-6) / 10, 0.6, 1);
      zMax = clamp(Math.ceil(Math.max(60, maxZ) / 30 - 1e-6) * 30, 60, 120);
      zOver = maxZ > zMax;
      ensureCapacity(n);
      idxN = [];
      idxK = [];
      density = clamp(Math.sqrt(80 / Math.max(1, n)), 0.5, 1); // shrink marks when the cube gets crowded
      pts.forEach((p, i) => {
        p.pos = new THREE.Vector3(X(p.x), Y(p.y), Z(p.z));
        p.r = (R_MIN + p.size * (R_MAX - R_MIN)) * density;
        p.phase = (i * 2.399) % (Math.PI * 2);
        p.stagger = ((p.x / 100) * 260 + (i % 7) * 20) | 0;
        if (p.knocked) { p.slot = idxK.length; idxK.push(i); } else { p.slot = idxN.length; idxN.push(i); meshN.setColorAt(p.slot, tmpC.set(p.color)); }
      });
      meshN.count = idxN.length;
      meshK.count = idxK.length;
      if (meshN.instanceColor) meshN.instanceColor.needsUpdate = true;
      hv = new Float32Array(n);
      hot = -1;
      hotSrc = '';
      S.hideTip();
      halo.visible = false;
      // drop-lines
      if (dropLines) { pivot.remove(dropLines); dropLines.geometry.dispose(); }
      const pos = new Float32Array(n * 6), col = new Float32Array(n * 6);
      pts.forEach((p, i) => {
        pos.set([p.pos.x, p.pos.y, p.pos.z, p.pos.x, -0.5, p.pos.z], i * 6);
        tmpC.set(p.knocked ? KNOCK_COLOR : p.color);
        col.set([tmpC.r, tmpC.g, tmpC.b, tmpC.r, tmpC.g, tmpC.b], i * 6);
      });
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      dg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      dropLines = new THREE.LineSegments(dg, dropMat);
      dropLines.frustumCulled = false;
      dropLines.renderOrder = -1;
      dropLines.visible = n > 0;
      pivot.add(dropLines);
      msg.style.display = n ? 'none' : '';
      writeInstances(nowMs());
      buildTicks();
      S.canvas.setAttribute('aria-label', n ? 'Opportunity space: ' + n + ' application' + (n === 1 ? '' : 's') + ' plotted by ATS score, interview chance and days since applied' + (idxK.length ? '; ' + idxK.length + ' ATS knockout' + (idxK.length === 1 ? '' : 's') : '') : 'Opportunity space: no applications to plot yet');
    }

    function writeInstances(t) {
      let still = false;
      const spinT = S.reduced ? 0 : t / 1000;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let a = 1;
        if (appearing) {
          a = easeOut((t - appearStart - p.stagger) / 520);
          if (a < 1) still = true;
        }
        const s = p.r * Math.max(0.001, a) * (1 + 0.6 * hv[i]);
        if (p.knocked) {
          eul.set(0.5, p.phase + spinT * 0.8, 0.3);
          q.setFromEuler(eul);
          sc.set(s * 1.15, s * 1.15, s * 1.15);
          m4.compose(p.pos, q, sc);
          meshK.setMatrixAt(p.slot, m4);
        } else {
          q.identity();
          sc.set(s, s, s);
          m4.compose(p.pos, q, sc);
          meshN.setMatrixAt(p.slot, m4);
        }
      }
      if (meshN) meshN.instanceMatrix.needsUpdate = true;
      if (meshK) meshK.instanceMatrix.needsUpdate = true;
      if (appearing && !still) appearing = false;
    }

    function fmtDays(d) {
      d = Math.round(d);
      return d === 1 ? '1 day' : d + ' days';
    }
    function tipHTML(i) {
      const p = pts[i];
      let html = '<div class="cb3d-t1">' + esc(p.label || 'Untitled') + '</div>';
      if (p.sub) html += '<div class="cb3d-t2">' + esc(p.sub) + '</div>';
      if (p.statusLabel) html += '<div class="cb3d-row"><span class="cb3d-dot" style="background:' + esc(p.color) + '"></span>' + esc(p.statusLabel) + '</div>';
      html += '<div>ATS <b>' + Math.round(p.x) + '</b> · ' + Math.round(p.y * 100) + '% chance · ' + fmtDays(p.z) + '</div>';
      if (p.knocked) html += '<div class="cb3d-row"><span class="cb3d-dot" style="background:' + KNOCK_COLOR + '"></span>ATS knockout — likely auto-rejected</div>';
      return html;
    }

    function setHot(i, src) {
      if (i < 0 || i >= pts.length) {
        if (hot !== -1) {
          hot = -1;
          hotSrc = '';
          S.hideTip();
          S.setCursor(false);
          halo.visible = false;
          S.holdAuto = false;
        }
        S.kick();
        return;
      }
      hot = i;
      hotSrc = src;
      S.holdAuto = true;
      S.setCursor(src === 'canvas');
      S.showTip(tipHTML(i));
      S.kick();
    }

    function pick(x, y, type) {
      if (!pts.length || !meshN) return -1;
      const ray = S.rayAt(x, y);
      const hits = ray.intersectObjects([meshN, meshK], false);
      for (const hit of hits) {
        const arr = hit.object === meshN ? idxN : idxK;
        if (hit.instanceId !== undefined && arr[hit.instanceId] !== undefined) return arr[hit.instanceId];
      }
      // screen-space fallback: small targets on touch
      const tol = type === 'touch' || type === 'pen' ? 22 : 8;
      const h = S.h;
      const tanH = Math.tan((camera.fov * DEG) / 2);
      let best = -1, bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const wp = pivot.localToWorld(tmp.copy(pts[i].pos));
        const dist = camera.position.distanceTo(wp);
        S.project(wp, P);
        const rpx = (pts[i].r * h) / (2 * tanH * dist);
        const d = Math.hypot(P.x - x, P.y - y) - rpx;
        if (d < tol && d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    // ── theme ──
    function applyTheme(theme) {
      S.applyThemeVars(theme);
      const t = S.theme;
      floorMat.color.set(t.grid);
      floorMat.opacity = S.dark ? 0.35 : 0.3;
      gridMat.color.set(t.grid);
      gridMat.opacity = S.dark ? 1 : 0.95;
      boxMat.color.set(t.grid);
      axisMat.color.set(t.muted);
      planeMat.color.set(t.accent);
      planeMat.opacity = S.dark ? 0.1 : 0.08;
      planeEdgeMat.color.set(t.accent);
      haloMat.color.set(t.fg);
      dropMat.opacity = (S.dark ? 0.45 : 0.35) * clamp(Math.sqrt(60 / Math.max(1, pts.length)), 0.4, 1);
      glow.value = S.dark ? 0.32 : 0.16;
      lights.hemi.intensity = S.dark ? 0.85 : 0.72;
      lights.hemi.groundColor.set(S.dark ? 0x40444c : 0x9aa0aa);
      ticks.forEach(measure);
      measure(thrLabel);
    }

    // ── hooks ──
    S.hooks.layout = (w, h) => {
      const tanH = Math.tan((camera.fov * DEG) / 2);
      const R = 0.86;
      const aspect = w / h;
      return { dist: Math.max(R / tanH, R / (tanH * aspect)) * 1.04, target: new THREE.Vector3(0, -0.04, 0), offsetX: 0 };
    };
    S.hooks.hover = (x, y) => {
      const i = pick(x, y, 'mouse');
      if (i >= 0) { if (i !== hot || hotSrc !== 'canvas') setHot(i, 'canvas'); }
      else if (hot >= 0) setHot(-1);
    };
    S.hooks.leave = () => { if (hotSrc === 'canvas') setHot(-1); };
    S.hooks.dragStart = () => setHot(-1);
    S.hooks.tap = (x, y, type) => {
      const i = pick(x, y, type);
      if (i >= 0) {
        setHot(i, type === 'mouse' ? 'canvas' : 'tap');
        if (onPick) onPick(pts[i].id);
      } else setHot(-1);
    };
    S.hooks.motion = () => { appearing = false; writeInstances(nowMs()); };

    S.hooks.frame = (dt, t) => {
      if (!appearStart) appearStart = t;
      let active = false, dirty = appearing;
      for (let i = 0; i < hv.length; i++) {
        const target = i === hot ? 1 : 0;
        if (hv[i] !== target) {
          hv[i] = S.reduced || Math.abs(target - hv[i]) < 0.01 ? target : lerp(hv[i], target, 1 - Math.exp(-dt * 16));
          dirty = true;
        }
      }
      if (!S.reduced && idxK.length) dirty = true;
      if (dirty) {
        writeInstances(t);
        active = true;
      }
      if (hot >= 0 && pts[hot]) {
        const p = pts[hot];
        pivot.localToWorld(halo.position.copy(p.pos));
        halo.quaternion.copy(camera.quaternion);
        halo.rotateX(Math.PI / 2);
        const s = p.r * (1 + 0.6 * hv[hot]) * 1.7;
        halo.scale.set(s, s, s);
        halo.visible = true;
      }
      return active || appearing;
    };

    S.hooks.post = () => {
      const w = S.w, h = S.h;
      const items = [];
      const all = ticks.concat([thrLabel]);
      for (const L of all) {
        if (!L.w) measure(L);
        const wp = pivot.localToWorld(tmp.copy(L.anchor));
        S.project(wp, P);
        const x = P.x - L.w / 2, y = P.y - L.h / 2;
        const inside = P.ok && x > -L.w / 2 && x + L.w < w + L.w / 2 && y > -4 && y + L.h < h + 4;
        items.push({ L, x, y, w: L.w, h: L.h, prio: L.prio, want: inside });
      }
      resolveOverlaps(items, 3);
      for (const it of items) {
        moveLabel(it.L, it.x, it.y);
        showLabel(it.L, it.ok);
      }
      if (hot >= 0 && pts[hot]) {
        S.project(pivot.localToWorld(tmp.copy(pts[hot].pos)), P);
        S.placeTip(P.x, P.y);
      }
    };

    // ── public API ──
    function update(points, theme) {
      if (!S.hooks.frame) return;
      if (theme) S.applyThemeVars(theme);
      if (points !== null && points !== undefined) {
        pts = normPoints(points);
        rebuildPoints();
      }
      applyTheme(theme);
      S.kick();
    }

    pts = normPoints(opts.points);
    applyTheme(opts.theme);
    rebuildPoints();
    applyTheme(opts.theme);
    S.start();

    return {
      update,
      destroy() {
        ticks.forEach((t) => t.el.remove());
        ticks = [];
        S.destroy();
      },
    };
  }

  CB.Viz3D = { available, createFunnel, createGalaxy };
})();

/* Callback — 3D visualizations (Three.js r128 through the global THREE; no addons).
 *
 *   CB.Viz3D.available() → boolean (THREE present + a WebGL context can be created)
 *
 *   CB.Viz3D.createFunnel(container, { stages, dropoffs, theme, onPick })
 *     → { update(stages, dropoffs, theme), destroy() } | null                       "Pipeline Tower"
 *
 *   CB.Viz3D.createGalaxy(container, { points, theme, thresholds, onSelect, onOpen, onPick })
 *     → { update(points, theme, opts), select(id), highlight(id|null), destroy() } | null   "Opportunity Space"
 *
 * Look: studio PMREM environment built from emissive softboxes (same recipe as mascot.js), ACES filmic
 * tone mapping, sRGB output, clearcoat physical materials, contact shadow — on a transparent canvas.
 * Cost: rendering runs only while the container is on screen and the page is visible. Ambient motion is
 * capped at 30 fps, interaction and tweens run at full rate, and the loop stops when nothing animates
 * (reduced motion, or the galaxy with auto-rotate off and 2 s without interaction).
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
  const CLOSED = ['rejected', 'ghosted', 'withdrawn'];
  const KNOCK_COLOR = '#e34948';
  const VERDICTS = {
    STRONG: ['Shortlist', '#0ca30c'],
    COMPETITIVE: ['Advance to review', '#eda100'],
    LONG_SHOT: ['Long shot', '#eb6834'],
    REJECTED: ['Auto-rejected', '#e34948'],
  };
  const VERDICT_ORDER = ['STRONG', 'COMPETITIVE', 'LONG_SHOT', 'REJECTED'];
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const nowMs = () => (window.performance && performance.now ? performance.now() : Date.now());
  const isColor = (c) => typeof c === 'string' && COLOR_RE.test(c.trim());
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const num = (v, d) => {
    const n = typeof v === 'number' ? v : v === null || v === undefined || v === '' ? NaN : +v;
    return isFinite(n) ? n : d === undefined ? 0 : d;
  };
  const esc = (s) => str(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function normTheme(t, prev) {
    const base = prev || DEFAULT_THEME;
    const o = {};
    for (const k in DEFAULT_THEME) o[k] = t && isColor(t[k]) ? t[k].trim() : base[k];
    return o;
  }
  /** CSS colour → THREE.Color holding the sRGB values (r128 has no colour management). */
  function colorOf(css) {
    const c = new THREE.Color();
    if (isColor(css)) c.setStyle(css.trim());
    return c;
  }
  /** CSS colour → linear THREE.Color, for materials rendered with sRGB output encoding. */
  function lin(css, out) {
    return (out || new THREE.Color()).copy(colorOf(css)).convertSRGBToLinear();
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

  const ICON = {
    minus: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    reset: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.3 8.6A4.8 4.8 0 1 0 4.9 4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.6 1.9v2.8h2.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    orbit: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><ellipse cx="8" cy="8" rx="6.2" ry="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

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
    '.cb3d-tip b,.cb3d-card b{font-weight:700}',
    '.cb3d-t1{font-weight:700}',
    '.cb3d-t2{color:var(--cb3d-muted)}',
    '.cb3d-row{display:flex;align-items:center;gap:6px;min-width:0}',
    '.cb3d-msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 12px;border-radius:9px;background:var(--cb3d-panel);border:1px solid var(--cb3d-line);color:var(--cb3d-muted);white-space:nowrap}',
    '.cb3d-legend{position:absolute;right:10px;top:8px;display:flex;align-items:center;gap:10px;font-size:11px;line-height:14px;color:var(--cb3d-muted);white-space:nowrap;text-shadow:0 0 3px var(--cb3d-surface),0 0 5px var(--cb3d-surface)}',
    '.cb3d-legend.is-col{top:auto;bottom:8px;flex-direction:column;align-items:flex-start;gap:2px}',
    '.cb3d-legend span{display:inline-flex;align-items:center;gap:4px}',
    // galaxy toolbar
    '.cb3d-bar{position:absolute;left:10px;top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;pointer-events:auto;max-width:calc(100% - 20px)}',
    '.cb3d-bar.is-phone{left:6px;right:6px;top:auto;bottom:6px;max-width:none;flex-wrap:nowrap;justify-content:center;overflow-x:auto;overflow-y:hidden;gap:6px;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x}',
    '.cb3d-bar.is-phone::-webkit-scrollbar{display:none}',
    '.cb3d-bar.is-phone .cb3d-grp-l{display:none}',
    '.cb3d-grp.is-vert{position:absolute;right:8px;top:8px;flex-direction:column;border-radius:18px;pointer-events:auto}',
    '.cb3d-grp.is-vert .cb3d-btn{width:32px;height:32px;min-width:32px;padding:0}',
    '.cb3d-grp.is-vert .cb3d-btn span{display:none}',
    '.cb3d-bar.is-hidden{visibility:hidden}',
    '.cb3d-grp{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:var(--cb3d-tip);border:1px solid var(--cb3d-line);flex:none;box-shadow:0 1px 2px var(--cb3d-shadow-s)}',
    '.cb3d-grp-l{padding:0 3px 0 7px;font-size:11px;color:var(--cb3d-muted);white-space:nowrap}',
    '.cb3d-ov .cb3d-btn{-webkit-appearance:none;appearance:none;margin:0;border:0;background:transparent;color:var(--cb3d-fg);font:600 12px/1 Inter,system-ui,sans-serif;height:26px;min-width:26px;padding:0 9px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;white-space:nowrap;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background-color .12s ease,color .12s ease;pointer-events:auto}',
    '.cb3d-ov .cb3d-btn.is-icon{padding:0;width:26px}',
    '.cb3d-ov .cb3d-btn:hover{background:var(--cb3d-hover)}',
    '.cb3d-ov .cb3d-btn[aria-pressed="true"],.cb3d-ov .cb3d-btn.is-solid{background:var(--cb3d-fg);color:var(--cb3d-surface)}',
    '.cb3d-ov .cb3d-btn.is-line{box-shadow:inset 0 0 0 1px var(--cb3d-line)}',
    '.cb3d-ov .cb3d-btn:focus{outline:none}',
    '.cb3d-ov .cb3d-btn:focus-visible{outline:2px solid var(--cb3d-accent);outline-offset:2px}',
    '.cb3d-bar.is-phone .cb3d-btn{height:32px;min-width:32px;padding:0 8px}',
    // galaxy selection card
    '.cb3d-card{position:absolute;right:10px;bottom:10px;width:300px;max-width:calc(100% - 20px);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;padding:10px 10px 10px 12px;border-radius:12px;background:var(--cb3d-tip);border:1px solid var(--cb3d-line);box-shadow:0 10px 30px var(--cb3d-shadow);pointer-events:auto;line-height:1.4;font-variant-numeric:tabular-nums;opacity:0;visibility:hidden;transform:translateY(6px);transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}',
    '.cb3d-card.is-on{opacity:1;visibility:visible;transform:none;transition:opacity .16s ease,transform .16s ease}',
    '.cb3d-card.is-phone{left:8px;right:8px;bottom:8px;width:auto;max-width:none}',
    '.cb3d-card-info{min-width:0;display:grid;gap:1px;align-content:start}',
    '.cb3d-card-info>div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cb3d-card-info>.cb3d-row{flex-wrap:wrap;white-space:normal;row-gap:0}',
    '.cb3d-card-h{display:flex;align-items:center;gap:6px;min-width:0;padding-right:2px}',
    '.cb3d-card-h .cb3d-t1{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
    '.cb3d-card-side{display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;gap:6px}',
    '.cb3d-card-acts{display:flex;flex-direction:column;gap:5px;align-items:stretch}',
    '.cb3d-card .cb3d-btn{height:28px}',
    '.cb3d-card.is-phone .cb3d-btn{height:32px}',
    // galaxy tags & key
    '.cb3d-tag{position:absolute;left:0;top:0;display:flex;align-items:center;gap:4px;height:18px;max-width:150px;padding:0 6px;border-radius:5px;background:var(--cb3d-panel);border:1px solid var(--cb3d-line);color:var(--cb3d-fg);font-size:11px;line-height:16px;white-space:nowrap;transition:opacity .2s ease;will-change:transform}',
    '.cb3d-tag.is-sel{height:21px;max-width:190px;font-size:12px;font-weight:700;border-color:var(--cb3d-fg);box-shadow:0 2px 8px var(--cb3d-shadow-s)}',
    '.cb3d-tag.is-hl{border-color:var(--cb3d-muted)}',
    '.cb3d-dq{display:inline-flex;align-items:center;height:15px;padding:0 4px;border-radius:4px;font-size:10px;font-weight:700;line-height:1;background:rgba(227,73,72,.14);box-shadow:inset 0 0 0 1px rgba(227,73,72,.6);color:var(--cb3d-fg);flex:none;letter-spacing:.02em}',
    '.cb3d-leader{position:absolute;left:0;top:0;height:1px;width:10px;background:var(--cb3d-fg);opacity:.55;transform-origin:0 50%}',
    '.cb3d-key{position:absolute;left:12px;bottom:8px;display:flex;flex-wrap:nowrap;gap:10px;max-width:calc(100% - 24px);overflow:hidden;font-size:11px;line-height:14px;color:var(--cb3d-muted);text-shadow:0 0 3px var(--cb3d-surface),0 0 5px var(--cb3d-surface)}',
    '.cb3d-key.is-clip{-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}',
    '.cb3d-bar.is-compact .cb3d-grp-l{display:none}',
    '.cb3d-key span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}',
    '.cb3d-ko{display:inline-block;width:7px;height:7px;transform:rotate(45deg);box-shadow:inset 0 0 0 1.5px #e34948;flex:none}',
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
  function radialTexture(stops, size) {
    size = size || 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach((s) => gr.addColorStop(s[0], s[1]));
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }
  function circleGeometry(seg, plane) {
    const p = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      if (plane === 'xy') p.push(Math.cos(a), Math.sin(a), 0);
      else p.push(Math.cos(a), 0, Math.sin(a));
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
  /** Studio environment from emissive softboxes (the mascot.js recipe), lighter backdrop for light themes. */
  function studioEnv(renderer, dark) {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const trash = [];
    const add = (geo, mat, pos) => {
      trash.push(geo, mat);
      const m = new THREE.Mesh(geo, mat);
      if (pos) { m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); }
      env.add(m);
    };
    add(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: dark ? 0x2a2f38 : 0x6d7480, side: THREE.BackSide }));
    const panel = (w, h, color, k, pos) => add(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }), pos);
    panel(9, 6, '#ffffff', 5.0, [-6, 7, 7]); // key softbox
    panel(7, 7, '#dbe6ff', 1.8, [9, 1.5, 3]); // cool fill
    panel(8, 3, '#ffd84a', 2.6, [1, 4, -10]); // warm brand rim
    panel(16, 3, '#ffffff', 1.1, [0, -8, 1]); // floor bounce
    panel(3, 10, '#ffffff', 2.2, [-11, 0, -2]); // strip light
    const rt = pm.fromScene(env, 0.035);
    pm.dispose();
    trash.forEach((d) => d.dispose());
    return rt;
  }
  function addLights(scene) {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4250, 0.35);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(-3, 4, 5);
    const rim = new THREE.DirectionalLight(0xffd36a, 0.7);
    rim.position.set(3, 2, -4);
    scene.add(hemi, key, rim);
    return { hemi, key, rim };
  }
  /** Lets a unit-radius lathe/torus take any outer radius `uR` without distorting fillets or tube. */
  function radialize(mat, uR, key, extra) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uR = uR;
      sh.vertexShader = 'uniform float uR;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\t{ float l = length(transformed.xz); if (l > 1e-4) transformed.xz *= max(0.0, uR + l - 1.0) / l; }'
      );
      if (extra) extra(sh);
    };
    mat.customProgramCacheKey = () => 'cb3d-radial-' + key;
    return mat;
  }

  // ═════════ Stage: renderer, camera rig, pointer input, overlay, frame pacing, lifecycle ═════════
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
    const ratioFor = (cw) => Math.min(window.devicePixelRatio || 1, cw && cw < 560 ? 1.5 : 2);
    renderer.setPixelRatio(ratioFor(container.clientWidth));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = cfg.exposure || 1;

    const canvas = renderer.domElement;
    canvas.className = 'cb3d-canvas';
    if (cfg.touchAction) canvas.style.touchAction = cfg.touchAction;
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
    const tmpF = new THREE.Vector3();
    const AXIS_Y = new THREE.Vector3(0, 1, 0);
    const disposables = new Set();

    let w = 0, h = 0, raf = 0, lastDraw = 0, destroyed = false, dirty = true, lastActive = false;
    let visible = typeof IntersectionObserver === 'undefined';
    let vYaw = 0, vPitch = 0, swayT = 0, tween = null;
    let lastInteract = nowMs() - 3000 + (cfg.autoDelay || 0);
    let tipW = 0, tipH = 0, tipHTML = '';
    const pointers = new Map();
    let drag = null, pinch = null, hoverDirty = false, rigMoved = true;
    let lastTap = { t: 0, x: 0, y: 0 };
    const ptr = { x: 0, y: 0, inside: false };
    let envRT = null, envDark = null;

    const S = {
      renderer, scene, camera, pivot, canvas, overlay, target, raycaster,
      yaw: cfg.yaw || 0, pitch: cfg.pitch || 0.3, zoom: 1, zoomT: 1, focus: new THREE.Vector3(),
      baseDist: 5, offsetX: 0, offsetY: 0,
      reduced: !!(mq && mq.matches), autoOn: cfg.auto !== 'none', busyUntil: 0, holdAuto: false,
      theme: normTheme(cfg.theme), dark: false,
      hooks: {}, ptr, cfg,
      get w() { return w; },
      get h() { return h; },
      track(o) { if (o) disposables.add(o); return o; },
      kick, project, showTip, hideTip, placeTip, moveTip, tipSize, rayAt, setCursor, destroy, applyThemeVars, resize, flyTo,
      dragging: () => !!(drag && drag.moved),
      interacted() { lastInteract = nowMs(); swayT = 0; },
      busy(ms) { S.busyUntil = Math.max(S.busyUntil, nowMs() + ms); kick(); },
    };

    // ── theme → CSS variables on the overlay + studio environment ──
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
      st.setProperty('--cb3d-hover', rgba(t.fg, 0.08));
      st.setProperty('--cb3d-line', t.grid);
      st.setProperty('--cb3d-lead', rgba(t.muted, 0.45));
      st.setProperty('--cb3d-shadow', S.dark ? 'rgba(0,0,0,.45)' : 'rgba(16,24,40,.12)');
      st.setProperty('--cb3d-shadow-s', S.dark ? 'rgba(0,0,0,.3)' : 'rgba(16,24,40,.06)');
      if (envDark !== S.dark) {
        try {
          const rt = studioEnv(renderer, S.dark);
          scene.environment = rt.texture;
          if (envRT) envRT.dispose();
          envRT = rt;
          envDark = S.dark;
        } catch (e) { /* environment is a nicety */ }
      }
      renderer.toneMappingExposure = (cfg.exposure || 1) * (S.dark ? 1.04 : 1);
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
    /** Ease the camera to {yaw, pitch, zoom, focus(Vector3, pivot space)}; user input cancels it. */
    function flyTo(to, ms, ease) {
      const t0 = nowMs();
      const tw = {
        t0, dur: S.reduced ? 1 : ms || 650, ease: ease === 'out' ? easeOut : easeInOut,
        yaw0: S.yaw, pitch0: S.pitch, zoom0: S.zoom, focus0: S.focus.clone(),
        yaw1: to.yaw === undefined ? S.yaw : to.yaw,
        pitch1: clamp(to.pitch === undefined ? S.pitch : to.pitch, cfg.minPitch, cfg.maxPitch),
        zoom1: clamp(to.zoom === undefined ? S.zoomT : to.zoom, cfg.zoomMin, cfg.zoomMax),
        focus1: to.focus ? to.focus.clone() : S.focus.clone(),
      };
      const d = ((((tw.yaw1 - tw.yaw0) % TAU) + TAU * 1.5) % TAU) - Math.PI; // shortest way round
      tw.yaw1 = tw.yaw0 + d;
      tween = tw;
      vYaw = 0;
      vPitch = 0;
      kick();
    }
    function placeCamera() {
      const d = S.baseDist * S.zoom;
      tmpF.copy(S.focus).applyAxisAngle(AXIS_Y, S.yaw);
      const tx = target.x + tmpF.x, ty = target.y + tmpF.y, tz = target.z + tmpF.z;
      camera.position.set(tx, ty + Math.sin(S.pitch) * d, tz + Math.cos(S.pitch) * d);
      camera.lookAt(tx, ty, tz);
      pivot.rotation.y = S.yaw;
      camera.updateMatrixWorld();
      pivot.updateMatrixWorld();
    }
    function rigStep(dt, t) {
      let moving = false;
      if (tween) {
        const k = clamp((t - tween.t0) / tween.dur, 0, 1), e = tween.ease(k);
        S.yaw = lerp(tween.yaw0, tween.yaw1, e);
        S.pitch = lerp(tween.pitch0, tween.pitch1, e);
        S.zoom = S.zoomT = lerp(tween.zoom0, tween.zoom1, e);
        S.focus.lerpVectors(tween.focus0, tween.focus1, e);
        if (k >= 1) tween = null;
        moving = true;
      } else if (!drag) {
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
        if (!S.reduced && S.autoOn && !S.holdAuto && idle > 3000) {
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
      if (!tween) {
        if (Math.abs(S.zoomT - S.zoom) > 1e-4) {
          S.zoom = lerp(S.zoom, S.zoomT, 1 - Math.exp(-dt * 12));
          moving = true;
        } else S.zoom = S.zoomT;
      }
      if (!tween && (S.yaw > Math.PI * 4 || S.yaw < -Math.PI * 4)) S.yaw %= TAU;
      placeCamera();
      return moving;
    }

    // ── loop: full rate while interacting/tweening, ≤30 fps ambient, stopped when idle ──
    function canRun() {
      return !destroyed && visible && !document.hidden && w > 0 && h > 0;
    }
    function kick() {
      dirty = true;
      if (!raf && canRun()) raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastDraw = 0;
    }
    function frame() {
      raf = 0;
      if (!canRun()) { lastDraw = 0; return; }
      const t = nowMs();
      const fast = !!drag || !!pinch || !!tween || vYaw !== 0 || vPitch !== 0 || Math.abs(S.zoomT - S.zoom) > 1e-4 || lastActive || t < S.busyUntil;
      if (!fast && !dirty && lastDraw && t - lastDraw < 32) {
        raf = requestAnimationFrame(frame);
        return;
      }
      dirty = false;
      const dt = lastDraw ? clamp((t - lastDraw) / 1000, 0, 0.1) : 1 / 60;
      lastDraw = t;
      const moving = rigStep(dt, t) || rigMoved;
      rigMoved = false;
      if (ptr.inside && !drag && (hoverDirty || moving) && S.hooks.hover) S.hooks.hover(ptr.x, ptr.y);
      hoverDirty = false;
      lastActive = S.hooks.frame ? !!S.hooks.frame(dt, t) : false;
      renderer.render(scene, camera);
      if (S.hooks.post) S.hooks.post(t);
      const ambient = !S.reduced && (S.hooks.ambient ? S.hooks.ambient() : false);
      const keep = t - lastInteract < (cfg.keepAlive || 0);
      if (fast || moving || lastActive || ambient || keep || drag) raf = requestAnimationFrame(frame);
      else lastDraw = 0;
    }

    // ── size ──
    function resize() {
      if (destroyed) return;
      const nw = Math.round(container.clientWidth), nh = Math.round(container.clientHeight);
      if (!nw || !nh) { w = nw; h = nh; stop(); return; }
      w = nw;
      h = nh;
      renderer.setPixelRatio(ratioFor(w));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const L = S.hooks.layout ? S.hooks.layout(w, h) : null;
      if (L) {
        S.baseDist = L.dist;
        if (L.target) target.copy(L.target);
        S.offsetX = L.offsetX || 0;
        S.offsetY = L.offsetY || 0;
      }
      if (S.offsetX || S.offsetY) camera.setViewOffset(w, h, S.offsetX, S.offsetY, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      placeCamera();
      rigMoved = true;
      kick();
    }

    // ── pointer input ──
    /** When the event happened (not when we got to it) — keeps tap/double-tap timing honest on a busy main thread. */
    function evTime(e) {
      const n = nowMs(), ts = e && e.timeStamp;
      return typeof ts === 'number' && ts > 0 && Math.abs(n - ts) < 10000 ? ts : n;
    }
    function local(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      S.interacted();
      tween = null;
      if (pointers.size === 1) {
        drag = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: evTime(e), tm: nowMs(), moved: false, type: e.pointerType };
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
          if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) >= (drag.type === 'mouse' ? 4 : 8)) {
            drag.moved = true;
            canvas.classList.add('is-drag');
            if (S.hooks.dragStart) S.hooks.dragStart();
          }
          if (drag.moved) {
            const k = (Math.PI * 1.15) / Math.max(320, w);
            const t = nowMs();
            const dtm = Math.max(1, t - drag.tm) / 1000;
            const dYaw = dx * k, dPitch = dy * k * (cfg.pitchGain || 0.6);
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
        } else if (!d.moved && evTime(e) - d.t0 < 700) {
          const t = evTime(e);
          if (S.hooks.doubleTap && t - lastTap.t < 340 && Math.hypot(d.x0 - lastTap.x, d.y0 - lastTap.y) < 30) {
            lastTap.t = 0;
            S.hooks.doubleTap(d.x0, d.y0, d.type);
          } else {
            lastTap = { t, x: d.x0, y: d.y0 };
            if (S.hooks.tap) S.hooks.tap(d.x0, d.y0, d.type);
          }
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
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel scrolls the page
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      tween = null;
      S.zoomT = clamp(S.zoomT * Math.exp(clamp(dy, -60, 60) * 0.01), cfg.zoomMin, cfg.zoomMax);
      S.interacted();
      kick();
    }
    const onCtx = (e) => { if (drag && drag.moved) e.preventDefault(); };
    const onGesture = (e) => e.preventDefault(); // Safari trackpad/touch pinch on the canvas only
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onCtx);
    if (cfg.touchAction === 'none') canvas.addEventListener('gesturestart', onGesture);

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
      canvas.removeEventListener('gesturestart', onGesture);
      if (S.hooks.dispose) {
        try { S.hooks.dispose(); } catch (e) { /* ignore */ }
      }
      scene.traverse((o) => {
        if (o.geometry && !o.isSprite) disposables.add(o.geometry); // sprite geometry is shared module-wide by three
        if (o.isInstancedMesh) disposables.add(o);
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          disposables.add(m);
          ['map', 'alphaMap', 'emissiveMap'].forEach((k) => { if (m[k]) disposables.add(m[k]); });
        });
      });
      disposables.forEach((d) => { try { d.dispose(); } catch (e) { /* ignore */ } });
      disposables.clear();
      if (envRT) envRT.dispose();
      scene.environment = null;
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
  function lineBetween(node, x0, y0, x1, y1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    node.style.transform = 'translate(' + x0.toFixed(1) + 'px,' + y0.toFixed(1) + 'px) rotate(' + ang.toFixed(4) + 'rad) scaleX(' + (len / 10).toFixed(3) + ')';
  }

  // ═════════ Funnel — "Pipeline Tower" ═════════
  const TIER_H = 0.22;
  const TIER_GAP = 0.09;
  const MIN_R = 0.18;
  const FLOOR_R = 1.08;
  const FLOOR_Y = -0.14;
  const PITCH0 = 0.3;
  const FILLET = 0.05;
  const TUBE_R = 0.045;
  const MAX_P = 300;
  const PR_STREAM = 0.02;
  const PR_DROP = 0.026;

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
  /** Unit-radius puck profile with filleted top and bottom edges. */
  function tierProfile() {
    const hh = TIER_H / 2, f = FILLET;
    const pts = [new THREE.Vector2(0, -hh), new THREE.Vector2(1 - f, -hh)];
    for (let i = 1; i <= 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(1 - f + f * Math.cos(a), -hh + f + f * Math.sin(a)));
    }
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(1 - f + f * Math.cos(a), hh - f + f * Math.sin(a)));
    }
    pts.push(new THREE.Vector2(0, hh));
    return pts;
  }

  function createFunnel(container, opts) {
    if (!container || !available()) return null;
    opts = opts || {};
    let S;
    try {
      S = createStage(container, {
        fov: 30, yaw: 0.35, pitch: PITCH0, minPitch: 0.04, maxPitch: 0.62,
        auto: 'spin', autoSpeed: 6 * DEG, zoomMin: 0.7, zoomMax: 1.6,
        theme: opts.theme, autoDelay: 1400, touchAction: 'pan-y', exposure: 1.02,
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
    addLights(scene);

    // shared geometry
    const geoTier = S.track(new THREE.LatheGeometry(tierProfile(), 48));
    const geoRim = S.track(new THREE.TorusGeometry(1, 0.011, 8, 72).rotateX(Math.PI / 2));
    const glowTex = S.track(radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]));
    const shadowTex = S.track(radialTexture([[0, 'rgba(0,0,0,0.7)'], [0.45, 'rgba(0,0,0,0.32)'], [1, 'rgba(0,0,0,0)']]));
    const floorTex = S.track(radialTexture([[0, 'rgba(255,255,255,1)'], [0.7, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]));

    // floor: glossy disc, faint polar grid (spokes make rotation readable), contact shadow, mirrored reflection
    const floorMat = new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_R, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.renderOrder = -4;
    pivot.add(floor);
    const polar = [];
    [0.55, FLOOR_R * 0.985].forEach((r) => {
      for (let i = 0; i < 64; i++) {
        const a0 = (i / 64) * TAU, a1 = ((i + 1) / 64) * TAU;
        polar.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      }
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      polar.push(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62, Math.cos(a) * FLOOR_R * 0.985, 0, Math.sin(a) * FLOOR_R * 0.985);
    }
    const polarMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
    const polarLines = new THREE.LineSegments(segmentsGeometry(polar), polarMat);
    polarLines.position.y = FLOOR_Y + 0.001;
    polarLines.renderOrder = -1;
    pivot.add(polarLines);
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = FLOOR_Y + 0.002;
    shadow.renderOrder = -2;
    pivot.add(shadow);
    const reflectRoot = new THREE.Group(); // mirrored about the floor plane
    reflectRoot.scale.y = -1;
    reflectRoot.position.y = 2 * FLOOR_Y;
    pivot.add(reflectRoot);

    const tower = new THREE.Group();
    pivot.add(tower);

    // central glass tube the flow runs down
    const tubeMat = new THREE.MeshPhysicalMaterial({
      color: 0xe8eef6, metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, transmission: 0.88,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.3,
    });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_R, TUBE_R, 1, 20, 1, true), tubeMat);
    tube.renderOrder = 2;
    tower.add(tube);

    // glossy flow beads — one InstancedMesh, shrink-to-fade
    const beadMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
    const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), beadMat, MAX_P);
    beads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3);
    beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    beads.instanceColor.setUsage(THREE.DynamicDrawUsage);
    beads.frustumCulled = false;
    beads.count = 0;
    pivot.add(beads);

    // particle state: 0 dead · 1 falling in tube · 2 rolling to the rim · 3 airborne · 4 fading on the floor
    const pSt = new Uint8Array(MAX_P), pKind = new Uint8Array(MAX_P), pTier = new Int16Array(MAX_P), pBounce = new Uint8Array(MAX_P);
    const pX = new Float32Array(MAX_P), pY = new Float32Array(MAX_P), pZ = new Float32Array(MAX_P);
    const pVx = new Float32Array(MAX_P), pVy = new Float32Array(MAX_P), pVz = new Float32Array(MAX_P);
    const pAng = new Float32Array(MAX_P), pRad = new Float32Array(MAX_P), pSpd = new Float32Array(MAX_P), pAge = new Float32Array(MAX_P), pR = new Float32Array(MAX_P);
    const palette = [new THREE.Color(), lin(DROP[0].color), lin(DROP[1].color), lin(DROP[2].color), new THREE.Color()];
    let spawnAcc = 0, spawnRate = 0, cursor = 0;
    const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();

    // overlay: labels + legend
    const labelLayer = el('div', '', S.overlay);
    const legend = el('div', 'cb3d-legend', S.overlay);
    legend.setAttribute('aria-hidden', 'true');

    // model state
    let stages = [];
    let drops = [0, 0, 0];
    let tiers = [];
    let H = 0;
    let hot = -1, hotSrc = '';
    let narrow = false;
    let colMaxW = 200;
    let leadGap = 18;
    let legendW = 0, legendH = 0;
    let dollyPending = !S.reduced;
    let exitP = [];
    const tmp = new THREE.Vector3();
    const right = new THREE.Vector3();
    const P = { x: 0, y: 0, ok: true };
    const P2 = { x: 0, y: 0, ok: true };
    const screen = [];

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
    function shortName(s) {
      const st = CB.STAGE && CB.STAGE[s.key];
      return st && st.short && st.label === s.label ? st.short : s.label;
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

    function disposeTier(t) {
      tower.remove(t.group);
      reflectRoot.remove(t.refl);
      t.mats.forEach((m) => m.dispose());
      t.chip.el.remove();
      t.lead.remove();
    }
    function glassMat(col, side, uR, transmission, opacity) {
      return radialize(new THREE.MeshPhysicalMaterial({
        color: col, emissive: col, emissiveIntensity: 0.06, metalness: 0, roughness: 0.08,
        clearcoat: 1, clearcoatRoughness: 0.04, transmission, transparent: true, opacity, side, depthWrite: false, envMapIntensity: 1.25,
      }), uR, 'glass');
    }
    /** Brushed steel tinted a little by the stage; darker steel on light pages so the rim still reads. */
    function rimColor(col) {
      return new THREE.Color(S.dark ? 0xcfd4dc : 0x8d949f).lerp(col, 0.18);
    }
    function reflMat(col, uR) {
      return radialize(new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }), uR, 'refl', (sh) => {
        sh.vertexShader = 'varying float vWY;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = 'varying float vWY;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= clamp(1.0 - (' + FLOOR_Y.toFixed(3) + ' - vWY) / 0.55, 0.0, 1.0);');
      });
    }

    function rebuild(animate) {
      tiers.forEach(disposeTier);
      tiers = [];
      const n = stages.length;
      H = stackHeight(n);
      const max = stages.reduce((m, s) => Math.max(m, s.count), 0);
      const t0 = nowMs();
      stages.forEach((s, i) => {
        const col = lin(s.color);
        const r = radiusFor(s.count, max);
        const uR = { value: r };
        const backMat = glassMat(col, THREE.BackSide, uR, 0.9, 1);
        const frontMat = glassMat(col, THREE.FrontSide, uR, 0.66, 1);
        const rimMat = radialize(new THREE.MeshStandardMaterial({ color: rimColor(col), metalness: 1, roughness: 0.3, envMapIntensity: 1.15, transparent: true, opacity: 1 }), uR, 'rim');
        const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
        const rMat = reflMat(col, uR);
        const group = new THREE.Group();
        const back = new THREE.Mesh(geoTier, backMat);
        back.renderOrder = 1;
        const front = new THREE.Mesh(geoTier, frontMat);
        front.renderOrder = 3;
        const rim = new THREE.Mesh(geoRim, rimMat);
        rim.position.y = TIER_H / 2 - FILLET;
        rim.renderOrder = 0;
        const glow = new THREE.Sprite(glowMat);
        glow.renderOrder = 2.5;
        group.add(back, front, rim, glow);
        group.position.y = tierY(i);
        tower.add(group);
        const refl = new THREE.Mesh(geoTier, rMat);
        refl.renderOrder = -3;
        reflectRoot.add(refl);

        const chip = makeLabel(labelLayer, 'cb3d-chip is-pick', chipHTML(i));
        chip.el.setAttribute('role', 'button');
        chip.el.setAttribute('tabindex', '0');
        const lead = el('div', 'cb3d-lead', labelLayer);
        const T = {
          key: s.key, index: i, col, group, back, front, rim, glow, refl, chip, lead, uR,
          mats: [backMat, frontMat, rimMat, glowMat, rMat],
          rFrom: r, rTo: r, rNow: r, tStart: t0, glowK: max > 0 ? Math.sqrt(s.count / max) : 0,
          appear: animate && !S.reduced ? 0 : 1, appearDelay: 120 + i * 60, hv: 0, empty: s.count === 0,
        };
        bindChip(T);
        tiers.push(T);
      });
      S.appearStart = 0; // entrance clock starts on the first rendered frame
      resetParticles();
      tiers.forEach((t) => measure(t.chip));
      const top = H + 0.3;
      tube.scale.y = top - FLOOR_Y;
      tube.position.y = (top + FLOOR_Y) / 2;
      hot = -1;
      S.hideTip();
    }

    function bindChip(T) {
      const e = T.chip.el;
      e.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') setHot(T.index, 'chip'); });
      e.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && hotSrc === 'chip') setHot(-1); });
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
          if (tiers[hot]) tiers[hot].chip.el.classList.remove('is-hot');
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
      S.busy(300);
    }

    /** Tiers overlap on screen (a wider tier above hangs over the next), so pick the tier under the
     *  pointer whose vertical centre — where its label points — is closest. Thin tiers get a touch band. */
    function pick(x, y, type) {
      if (!tiers.length) return -1;
      const minHalf = type === 'touch' || type === 'pen' ? 24 : 12;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < screen.length; i++) {
        const s = screen[i];
        if (!s) continue;
        const half = Math.max(minHalf, s.ax - s.cx) + 6;
        const dy = Math.abs(y - s.cy);
        if (Math.abs(x - s.cx) <= half && dy <= Math.max(s.hh + s.eh, minHalf / 2) + 4 && dy < bestD) { bestD = dy; best = i; }
      }
      return best;
    }
    function placeFunnelTip(i) {
      const s = screen[i];
      if (!s) return;
      const sz = S.tipSize();
      let y = s.cy - s.hh - s.eh - sz.h - 10;
      if (y < 6) y = s.cy + s.hh + s.eh + 10;
      S.moveTip(s.cx - sz.w / 2, y);
    }

    // ── flow simulation ──
    function exitProb(i) {
      if (i >= stages.length - 1) return 0;
      const c = stages[i].count, n = stages[i + 1].count;
      return c > 0 ? clamp(1 - n / c, 0, 1) : 1;
    }
    function refreshFlow() {
      exitP = stages.map((s, i) => exitProb(i));
      const top = stages.length ? stages[0].count : 0;
      spawnRate = top > 0 ? clamp(2 + top * 0.22, 3, 15) : 0;
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
        if (pSt[i] === 0) {
          cursor = (i + 1) % MAX_P;
          pSt[i] = 1;
          pKind[i] = 0;
          pAge[i] = 0;
          pAng[i] = Math.random() * TAU;
          pRad[i] = Math.random() * (TUBE_R - PR_STREAM - 0.004);
          pSpd[i] = 0.6 * (0.9 + Math.random() * 0.2);
          pTier[i] = 0;
          pBounce[i] = 0;
          pY[i] = H + 0.28;
          pR[i] = PR_STREAM;
          return;
        }
      }
    }
    function tierTopY(i) {
      const T = tiers[i];
      return (T ? T.group.position.y : tierY(i)) + TIER_H / 2;
    }
    function step(dt) {
      if (spawnRate > 0) {
        spawnAcc += spawnRate * dt;
        while (spawnAcc >= 1) { spawnAcc -= 1; spawn(); }
      }
      const nT = tiers.length;
      for (let i = 0; i < MAX_P; i++) {
        const st = pSt[i];
        if (!st) continue;
        pAge[i] += dt;
        if (st === 1) {
          const y = pY[i] - pSpd[i] * dt;
          pAng[i] += dt * 1.4;
          pX[i] = Math.cos(pAng[i]) * pRad[i];
          pZ[i] = Math.sin(pAng[i]) * pRad[i];
          pY[i] = y;
          while (pTier[i] < nT && y <= tierTopY(pTier[i])) {
            if (Math.random() < exitP[pTier[i]]) {
              pSt[i] = 2;
              pKind[i] = pickDropKind();
              pAng[i] = Math.random() * TAU;
              pRad[i] = TUBE_R + PR_DROP;
              pR[i] = PR_DROP;
              pAge[i] = 0;
              break;
            }
            pTier[i]++;
          }
          if (pSt[i] === 1 && y <= FLOOR_Y + PR_STREAM) { pSt[i] = 4; pAge[i] = 0; pVx[i] = pVz[i] = 0; }
        } else if (st === 2) {
          const T = tiers[pTier[i]];
          const R = T ? T.rNow * T.group.scale.x : 0.3;
          pRad[i] += dt * (0.55 + pAge[i] * 1.6);
          pX[i] = Math.cos(pAng[i]) * pRad[i];
          pZ[i] = Math.sin(pAng[i]) * pRad[i];
          pY[i] = tierTopY(pTier[i]) + PR_DROP;
          if (pRad[i] >= R - 0.01) {
            pSt[i] = 3;
            // horizontal speed chosen so the bead lands on the floor disc rather than off in space
            const fall = Math.max(0.2, pY[i] - FLOOR_Y);
            const tFall = (0.17 + Math.sqrt(0.03 + 6.4 * fall)) / 3.2;
            const sp = clamp((FLOOR_R - 0.1 - R) / tFall, 0.05, 0.45) + Math.random() * 0.08;
            pVx[i] = Math.cos(pAng[i]) * sp;
            pVz[i] = Math.sin(pAng[i]) * sp;
            pVy[i] = 0.12 + Math.random() * 0.1;
          }
        } else if (st === 3) {
          pVy[i] -= 3.2 * dt;
          pX[i] += pVx[i] * dt;
          pY[i] += pVy[i] * dt;
          pZ[i] += pVz[i] * dt;
          if (pY[i] <= FLOOR_Y + PR_DROP && pVy[i] < 0) {
            pY[i] = FLOOR_Y + PR_DROP;
            if (!pBounce[i]) {
              pBounce[i] = 1;
              pVy[i] = -pVy[i] * 0.4;
              pVx[i] *= 0.72;
              pVz[i] *= 0.72;
            } else {
              pSt[i] = 4;
              pAge[i] = 0;
            }
          }
          if (pX[i] * pX[i] + pZ[i] * pZ[i] > 9) pSt[i] = 0;
        } else {
          const k = Math.exp(-dt * 4);
          pVx[i] *= k;
          pVz[i] *= k;
          pX[i] += pVx[i] * dt;
          pZ[i] += pVz[i] * dt;
          if (pAge[i] > 0.5) pSt[i] = 0;
        }
      }
    }
    function writeBeads() {
      let n = 0;
      for (let i = 0; i < MAX_P; i++) {
        const st = pSt[i];
        if (!st) continue;
        let s = pR[i];
        if (st === 1) s *= Math.min(1, pAge[i] / 0.25);
        else if (st === 4) s *= Math.max(0, 1 - pAge[i] / 0.5);
        if (s <= 0.0005) continue;
        pv.set(pX[i], st === 4 ? FLOOR_Y + s : pY[i], pZ[i]);
        sv.set(s, s, s);
        m4.compose(pv, q0, sv);
        beads.setMatrixAt(n, m4);
        const c = palette[pKind[i]];
        beads.instanceColor.setXYZ(n, c.r, c.g, c.b);
        n++;
      }
      beads.count = n;
      beads.instanceMatrix.needsUpdate = true;
      beads.instanceColor.needsUpdate = true;
    }
    function resetParticles() {
      pSt.fill(0);
      spawnAcc = 0;
    }
    function warm(seconds) {
      for (let k = 0, n = Math.round(seconds * 30); k < n; k++) step(1 / 30);
      writeBeads();
    }
    function presimulate() {
      resetParticles();
      warm(6);
    }

    // ── theme ──
    function applyTheme(theme) {
      S.applyThemeVars(theme);
      const t = S.theme;
      lin(t.grid, floorMat.color);
      floorMat.opacity = S.dark ? 0.6 : 0.7;
      lin(t.muted, polarMat.color);
      polarMat.opacity = S.dark ? 0.26 : 0.2;
      shadowMat.opacity = S.dark ? 0.7 : 0.24;
      lin(S.dark ? '#eef1f6' : '#3a414e', palette[0]);
      lin(t.muted, palette[4]);
      // glass: more body colour and less env glare on light pages, where the background is already bright
      tiers.forEach((T) => {
        T.mats[0].transmission = S.dark ? 0.9 : 0.8;
        T.mats[1].transmission = S.dark ? 0.66 : 0.5;
        T.mats[0].envMapIntensity = T.mats[1].envMapIntensity = S.dark ? 1.25 : 1.0;
        T.mats[2].color.copy(rimColor(T.col));
      });
      tiers.forEach((T) => measure(T.chip));
      writeBeads();
    }

    // ── layout: label column sized to the widest label; tower + column centred together ──
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
      const needH = stack * Math.cos(PITCH0) + 2 * FLOOR_R * Math.sin(PITCH0) + 0.42;
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
        tiers.forEach((T) => { T.appear = 1; T.rNow = T.rTo; T.rFrom = T.rTo; T.uR.value = T.rTo; });
        presimulate();
      }
    };
    S.hooks.ambient = () => spawnRate > 0 || S.autoOn;

    S.hooks.frame = (dt, t) => {
      let active = false;
      if (!S.appearStart) S.appearStart = t;
      if (dollyPending) {
        dollyPending = false;
        S.flyTo({ zoom: 1 }, 1200, 'out');
      }
      const dark = S.dark;
      let maxR = 0;
      for (const T of tiers) {
        if (T.appear < 1) {
          T.appear = S.reduced ? 1 : clamp((t - S.appearStart - T.appearDelay) / 560, 0, 1);
          active = true;
        }
        if (T.rNow !== T.rTo) {
          const k = S.reduced ? 1 : (t - T.tStart) / 600;
          T.rNow = k >= 1 ? T.rTo : lerp(T.rFrom, T.rTo, easeOut(k));
          active = true;
        }
        const hvT = T.index === hot ? 1 : 0;
        if (T.hv !== hvT) {
          T.hv = S.reduced || Math.abs(hvT - T.hv) < 0.01 ? hvT : lerp(T.hv, hvT, 1 - Math.exp(-dt * 14));
          active = true;
        }
        const e = easeOut(T.appear);
        const hs = 1 + 0.04 * T.hv;
        const sxz = (0.55 + 0.45 * e) * hs;
        T.uR.value = T.rNow;
        T.group.scale.set(sxz, Math.max(0.001, e) * hs, sxz);
        T.group.position.y = tierY(T.index) - (1 - e) * 0.35;
        T.refl.position.copy(T.group.position);
        T.refl.scale.copy(T.group.scale);
        const glass = T.empty ? 0.45 : 1;
        T.mats[0].opacity = e * glass;
        T.mats[1].opacity = e * glass;
        T.mats[2].opacity = e;
        T.mats[3].opacity = T.empty ? 0 : (dark ? 0.55 : 0.42) * e * (1 + 0.4 * T.hv);
        T.glow.scale.setScalar((0.25 + 1.1 * T.glowK) * T.rNow * 1.25 * e + 0.0001);
        T.mats[4].opacity = (dark ? 0.16 : 0.2) * e * glass;
        const em = (dark ? 0.12 : 0.05) + 0.35 * T.hv;
        T.mats[0].emissiveIntensity = em;
        T.mats[1].emissiveIntensity = em;
        maxR = Math.max(maxR, T.rNow * sxz);
      }
      const sr = Math.max(0.5, maxR) * 2.1;
      shadow.scale.set(sr, sr, 1);
      if (!S.reduced) {
        step(dt);
        writeBeads();
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
        const r = T.rNow * T.group.scale.x;
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
      if (hot >= 0 && screen[hot]) placeFunnelTip(hot);
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
          T.glowK = max > 0 ? Math.sqrt(s.count / max) : 0;
          const col = lin(s.color);
          T.col = col;
          T.mats.forEach((m, k) => {
            if (k === 2) m.color.copy(rimColor(col));
            else m.color.copy(col);
            if (m.emissive) m.emissive.copy(col);
          });
          T.chip.el.innerHTML = chipHTML(i);
          measure(T.chip);
        });
        if (hot >= 0) S.showTip(tipHTML(hot));
        S.busy(700);
      }
      refreshFlow();
      applyTheme(theme);
      setLegend();
      setAria();
      if (S.reduced) presimulate();
      else if (rebuilt) warm(3);
      S.resize();
    }

    stages = normStages(opts.stages);
    drops = normDrops(opts.dropoffs);
    rebuild(true);
    refreshFlow();
    applyTheme(opts.theme);
    setLegend();
    setAria();
    if (S.reduced) presimulate();
    else {
      warm(3);
      S.zoom = S.zoomT = 1.42; // dolly-in starts from here on the first rendered frame
    }
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
    return (Array.isArray(points) ? points : []).filter(Boolean).slice(0, 800).map((p, i) => {
      const status = str(p.status);
      const st = CB.STAGE && CB.STAGE[status];
      const verdict = str(p.verdict).toUpperCase();
      const vd = VERDICTS[verdict];
      return {
        id: p.id === undefined ? i : p.id,
        label: str(p.label),
        sub: str(p.sub),
        x: clamp(num(p.x), 0, 100),
        y: clamp(num(p.y), 0, 1),
        z: Math.max(0, num(p.z)),
        size: clamp(num(p.size, 0.5), 0, 1),
        color: isColor(p.color) ? p.color.trim() : st ? st.color : '#7c8799',
        status,
        statusLabel: str(p.statusLabel) || (st ? st.label : ''),
        verdict,
        verdictLabel: str(p.verdictLabel) || (vd ? vd[0] : verdict ? verdict.charAt(0) + verdict.slice(1).toLowerCase().replace(/_/g, ' ') : ''),
        verdictColor: isColor(p.verdictColor) ? p.verdictColor.trim() : vd ? vd[1] : '#7c8799',
        knocked: !!p.knocked,
        active: typeof p.active === 'boolean' ? p.active : status ? CLOSED.indexOf(status) < 0 : true,
      };
    });
  }
  function normThresholds(t, prev) {
    t = t || {};
    const p = prev || { floor: 60, competitive: 75, chance: 0.2 };
    const floor = clamp(num(t.floor, p.floor), 0, 100);
    return { floor, competitive: clamp(num(t.competitive, p.competitive), floor, 100), chance: clamp(num(t.chance, p.chance), 0, 1) };
  }

  function createGalaxy(container, opts) {
    if (!container || !available()) return null;
    opts = opts || {};
    let touchDevice = false;
    try { touchDevice = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches); } catch (e) { /* ignore */ }
    let S;
    try {
      S = createStage(container, {
        fov: 32, yaw: 0.5, pitch: 0.4, minPitch: 0.02, maxPitch: 1.35, pitchGain: 0.8,
        auto: 'sway', swayAmp: 0.36, swayW: TAU / 26, zoomMin: 0.45, zoomMax: 1.8,
        theme: opts.theme, autoDelay: 600, keepAlive: 2000, touchAction: 'none', exposure: 1.0,
      });
    } catch (e) {
      console.warn('[Viz3D] WebGL renderer unavailable:', e && e.message);
      return null;
    }
    S.autoOn = !touchDevice;
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
    let onPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    let onOpen = typeof opts.onOpen === 'function' ? opts.onOpen : null;
    let onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;
    addLights(scene);
    const X = (v) => clamp(v, 0, 100) / 100 - 0.5;
    const YAW0 = S.yaw, PITCH_0 = S.pitch;

    // floor fill + grid + faint cube edges + axes
    const floorMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
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
    const gridMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    const grid = new THREE.LineSegments(segmentsGeometry(g), gridMat);
    grid.renderOrder = -2;
    pivot.add(grid);
    const edges = [
      0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
    ];
    const boxMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    const box = new THREE.LineSegments(segmentsGeometry(edges), boxMat);
    box.renderOrder = -2;
    pivot.add(box);
    // X (ATS) and Z (days) start at the front-left floor corner; Y (chance) rises at the back-left corner
    const ax = [-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5];
    [0, 0.5, 1].forEach((f) => {
      const v = f - 0.5;
      ax.push(v, -0.5, 0.5, v, -0.5, 0.53);
      ax.push(-0.5, v, -0.5, -0.53, v, -0.5);
      ax.push(-0.5, -0.5, 0.5 - f, -0.53, -0.5, 0.5 - f);
    });
    const axisMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    const axes = new THREE.LineSegments(segmentsGeometry(ax), axisMat);
    axes.renderOrder = -1;
    pivot.add(axes);
    // contact shadow under the cloud
    const shadowTex = S.track(radialTexture([[0, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]));
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    const cshadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), shadowMat);
    cshadow.rotation.x = -Math.PI / 2;
    cshadow.position.y = -0.499;
    cshadow.renderOrder = -2.5;
    pivot.add(cshadow);

    // context: cutoff plane, recruiter-review plane, "apply now" corner volume
    const planeGeo = S.track(new THREE.PlaneGeometry(1, 1));
    const mkPlane = () => {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const m = new THREE.Mesh(planeGeo, mat);
      m.rotation.y = Math.PI / 2;
      m.renderOrder = 4;
      const eMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
      const e = new THREE.LineLoop(segmentsGeometry([0, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5]), eMat);
      e.renderOrder = 4;
      pivot.add(m, e);
      return { m, e, mat, eMat };
    };
    const cutPlane = mkPlane();
    const revPlane = mkPlane();
    const zoneMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.04, depthWrite: false, side: THREE.FrontSide, toneMapped: false });
    const zone = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), zoneMat);
    zone.renderOrder = 3;
    const zoneEdgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false });
    const zoneEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), zoneEdgeMat);
    zoneEdges.renderOrder = 3;
    pivot.add(zone, zoneEdges);

    // points
    const geoSphere = S.track(new THREE.SphereGeometry(1, 22, 16));
    const geoOct = S.track(new THREE.OctahedronGeometry(1, 0));
    const glowU = { value: 0.06 };
    const pointMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.05 });
    pointMat.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = glowU;
      sh.fragmentShader = 'uniform float uGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
    };
    pointMat.customProgramCacheKey = () => 'cb3d-point-glow';
    const knockMat = new THREE.MeshBasicMaterial({ color: lin(KNOCK_COLOR), wireframe: true, transparent: true, opacity: 0.95, toneMapped: false });
    let cap = 0, meshN = null, meshK = null;
    function ensureCapacity(n) {
      if (n <= cap && meshN) return;
      cap = Math.max(32, Math.pow(2, Math.ceil(Math.log2(Math.max(1, n)))));
      [meshN, meshK].forEach((m) => { if (m) { pivot.remove(m); m.dispose(); } });
      meshN = new THREE.InstancedMesh(geoSphere, pointMat, cap);
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
    const dropMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
    let dropLines = null;
    // halos: selected (pulsing accent ring), highlighted (fg ring), hovered (thin fg ring)
    const ringGeo = S.track(new THREE.RingGeometry(0.82, 1, 48));
    const selMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const selRing = new THREE.Mesh(ringGeo, selMat);
    selRing.renderOrder = 20;
    selRing.visible = false;
    const hlMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const hlRing = new THREE.Mesh(ringGeo, hlMat);
    hlRing.renderOrder = 19;
    hlRing.visible = false;
    const hoverMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.75, depthTest: false, depthWrite: false, toneMapped: false });
    const hoverRing = new THREE.LineLoop(S.track(circleGeometry(40, 'xy')), hoverMat);
    hoverRing.renderOrder = 18;
    hoverRing.visible = false;
    scene.add(selRing, hlRing, hoverRing);

    // ── overlay ──
    const tickLayer = el('div', '', S.overlay);
    const tagLayer = el('div', '', S.overlay);
    const leader = el('div', 'cb3d-leader cb3d-off', tagLayer);
    const msg = el('div', 'cb3d-msg', S.overlay);
    msg.textContent = 'No applications to plot yet';
    msg.style.display = 'none';
    const key = el('div', 'cb3d-key', S.overlay);
    key.setAttribute('aria-hidden', 'true');
    const bar = el('div', 'cb3d-bar', S.overlay);
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '3D view controls');
    const card = el('div', 'cb3d-card', S.overlay);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Selected application');
    let ticks = [];
    const planeLabels = [];

    // ── state ──
    let pts = [];
    let yMax = 0.6, zMax = 60, zOver = false, density = 1;
    let idxN = [], idxK = [];
    let vis = new Float32Array(0), visT = new Uint8Array(0), hv = new Float32Array(0);
    let hot = -1, sel = -1, hl = -1;
    let colorMode = 'status', filter = 'all';
    let thr = normThresholds(opts.thresholds);
    let appearStart = 0, appearing = !S.reduced;
    let phone = false;
    let obstacles = [];
    let tags = [];
    let top5 = [];
    const tmp = new THREE.Vector3();
    const P = { x: 0, y: 0, ok: true };
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qI = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const sc = new THREE.Vector3();
    const tmpC = new THREE.Color();
    let scr = new Float32Array(0); // per point: x, y, projected radius (px), on-screen flag

    const Y = (v) => clamp(v / yMax, 0, 1) - 0.5;
    const Z = (d) => 0.5 - clamp(d / zMax, 0, 1);
    const colorFor = (p) => (colorMode === 'verdict' ? p.verdictColor : p.color);
    const passes = (p) => (filter === 'active' ? p.active : filter === 'knocked' ? p.knocked : true);
    const indexOfId = (id) => {
      if (id === null || id === undefined) return -1;
      for (let i = 0; i < pts.length; i++) if (pts[i].id === id || String(pts[i].id) === String(id)) return i;
      return -1;
    };

    // ── toolbar ──
    function mkBtn(parent, html, label, onClick, opt) {
      const b = el('button', 'cb3d-btn' + (opt && opt.icon ? ' is-icon' : '') + (opt && opt.cls ? ' ' + opt.cls : ''), parent);
      b.type = 'button';
      b.innerHTML = html;
      if (label) { b.setAttribute('aria-label', label); b.title = label; }
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
      return b;
    }
    const grpView = el('div', 'cb3d-grp', bar);
    mkBtn(grpView, ICON.minus, 'Zoom out', () => zoomBy(1.25), { icon: true });
    mkBtn(grpView, ICON.plus, 'Zoom in', () => zoomBy(0.8), { icon: true });
    mkBtn(grpView, ICON.reset, 'Reset view', () => resetView(), { icon: true });
    const autoBtn = mkBtn(grpView, ICON.orbit + '<span>Auto</span>', 'Auto-rotate', () => {
      S.autoOn = !S.autoOn;
      syncBar();
      S.interacted();
      S.kick();
    });
    function mkSeg(label, items, get, set) {
      const grp = el('div', 'cb3d-grp', bar);
      grp.setAttribute('role', 'group');
      grp.setAttribute('aria-label', label);
      el('span', 'cb3d-grp-l', grp).textContent = label;
      const btns = items.map(([v, text]) => {
        const b = mkBtn(grp, esc(text), '', () => { set(v); S.interacted(); });
        b.dataset.v = v;
        return b;
      });
      return { grp, btns, sync: () => btns.forEach((b) => b.setAttribute('aria-pressed', String(get() === b.dataset.v))) };
    }
    const segColor = mkSeg('Color', [['status', 'Status'], ['verdict', 'Verdict']], () => colorMode, (v) => setColorMode(v));
    const segShow = mkSeg('Show', [['all', 'All'], ['active', 'Active'], ['knocked', 'Knockouts']], () => filter, (v) => setFilter(v));
    function syncBar() {
      autoBtn.setAttribute('aria-pressed', String(!!S.autoOn));
      segColor.sync();
      segShow.sync();
    }
    function zoomBy(f) {
      S.zoomT = clamp(S.zoomT * f, S.cfg.zoomMin, S.cfg.zoomMax);
      S.interacted();
      S.kick();
    }
    function resetView() {
      S.flyTo({ yaw: YAW0, pitch: PITCH_0, zoom: 1, focus: new THREE.Vector3() }, 700);
      S.interacted();
    }

    // ── selection card ──
    function fmtDays(d) {
      d = Math.round(d);
      return d === 1 ? '1 day' : d + ' days';
    }
    const dq = '<span class="cb3d-dq" title="ATS knockout">✕ DQ</span>';
    function metricsLine(p) {
      return 'ATS <b>' + Math.round(p.x) + '</b> · ' + Math.round(p.y * 100) + '% chance · ' + fmtDays(p.z);
    }
    function renderCard() {
      if (sel < 0) {
        card.classList.remove('is-on');
        bar.classList.remove('is-hidden');
        computeObstacles();
        return;
      }
      const p = pts[sel];
      let statusRow = '';
      if (p.statusLabel) statusRow += '<span class="cb3d-dot" style="background:' + esc(p.color) + '"></span><span>' + esc(p.statusLabel) + '</span>';
      if (p.verdictLabel) statusRow += (statusRow ? '<span class="cb3d-sep">·</span>' : '') + '<span class="cb3d-dot" style="background:' + esc(p.verdictColor) + '"></span><span>' + esc(p.verdictLabel) + '</span>';
      card.innerHTML =
        '<div class="cb3d-card-info">' +
        '<div class="cb3d-card-h"><span class="cb3d-t1">' + esc(p.label || 'Untitled') + '</span>' + (p.knocked ? dq : '') + '</div>' +
        (p.sub ? '<div class="cb3d-t2">' + esc(p.sub) + '</div>' : '') +
        (statusRow ? '<div class="cb3d-row">' + statusRow + '</div>' : '') +
        '<div>' + metricsLine(p) + '</div>' +
        '</div><div class="cb3d-card-side"></div>';
      const side = card.querySelector('.cb3d-card-side');
      mkBtn(side, ICON.close, 'Close', () => setSelected(-1, { notify: true }), { icon: true });
      const acts = el('div', 'cb3d-card-acts', side);
      mkBtn(acts, 'Open', 'Open ' + (p.label || 'application'), () => openSel('overview'), { cls: 'is-solid' });
      mkBtn(acts, 'ATS report', 'ATS report for ' + (p.label || 'application'), () => openSel('ats'), { cls: 'is-line' });
      card.classList.add('is-on');
      bar.classList.toggle('is-hidden', phone);
      computeObstacles();
    }
    function openSel(tab) {
      if (sel < 0) return;
      const id = pts[sel].id;
      if (onOpen) onOpen(id, tab);
      else if (onPick) onPick(id);
    }
    card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); setSelected(-1, { notify: true }); } });

    // ── selection / highlight / hover ──
    function setSelected(i, o) {
      o = o || {};
      if (i >= 0 && !(i < pts.length)) i = -1;
      const changed = i !== sel;
      sel = i;
      renderCard();
      rebuildTags();
      if (i >= 0 && o.fly) {
        const p = pts[i];
        S.flyTo({ focus: p.pos.clone().multiplyScalar(0.75), zoom: Math.min(S.zoomT, 0.72) }, 750);
      }
      if (changed && o.notify !== false && onSelect) onSelect(i >= 0 ? pts[i].id : null);
      S.interacted();
      S.busy(400);
    }
    function setHighlight(i) {
      if (i === hl) return;
      hl = i;
      rebuildTags();
      S.interacted();
      S.busy(400);
    }
    function tipHTML(i) {
      const p = pts[i];
      let html = '<div class="cb3d-row"><span class="cb3d-t1">' + esc(p.label || 'Untitled') + '</span>' + (p.knocked ? dq : '') + '</div>';
      if (p.sub) html += '<div class="cb3d-t2">' + esc(p.sub) + '</div>';
      const c = colorMode === 'verdict' ? p.verdictColor : p.color;
      const lbl = colorMode === 'verdict' ? p.verdictLabel || p.statusLabel : p.statusLabel || p.verdictLabel;
      if (lbl) html += '<div class="cb3d-row"><span class="cb3d-dot" style="background:' + esc(c) + '"></span>' + esc(lbl) + '</div>';
      html += '<div>' + metricsLine(p) + '</div>';
      return html;
    }
    function setHover(i) {
      if (i === hot) return;
      hot = i;
      if (i < 0) {
        S.hideTip();
        S.setCursor(false);
        S.holdAuto = false;
      } else {
        S.holdAuto = true;
        S.setCursor(true);
        S.showTip(tipHTML(i));
      }
      S.busy(300);
    }

    /** Nearest visible point to (x, y) in screen space within `tol` px of its edge; nearer-to-camera wins ties. */
    function pick(x, y, tol) {
      if (!pts.length) return -1;
      projectAll();
      let best = -1, bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        if (!scr[i * 4 + 3] || visT[i] === 0) continue;
        const d = Math.max(0, Math.hypot(scr[i * 4] - x, scr[i * 4 + 1] - y) - scr[i * 4 + 2]);
        if (d <= tol && d < bestD - 0.5) { bestD = d; best = i; }
      }
      return best;
    }
    const camPos = new THREE.Vector3();
    function projectAll() {
      const h = S.h, tanH = Math.tan((camera.fov * DEG) / 2);
      camera.getWorldPosition(camPos);
      if (scr.length < pts.length * 4) scr = new Float32Array(pts.length * 4);
      for (let i = 0; i < pts.length; i++) {
        const wp = pivot.localToWorld(tmp.copy(pts[i].pos));
        const dist = camPos.distanceTo(wp);
        S.project(wp, P);
        scr[i * 4] = P.x;
        scr[i * 4 + 1] = P.y;
        scr[i * 4 + 2] = (pts[i].r * h) / (2 * tanH * dist);
        scr[i * 4 + 3] = P.ok ? 1 : 0;
      }
    }

    // ── data → scene ──
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
      [0, 50, 100].forEach((v, i) => add(X(v), -0.5, 0.59, String(v), i === 1 ? 40 : 50, false));
      add(X(75), -0.5, 0.77, 'ATS score', 120, true);
      [0, yMax / 2, yMax].forEach((v, i) => add(-0.565, Y(v), -0.565, pctT(v), i === 0 ? 20 : 50, false));
      add(-0.5, 0.5 + 0.13, -0.5, 'Chance', 120, true);
      [0, zMax / 2, zMax].forEach((v, i) => add(-0.6, -0.5, Z(v), i === 2 && zOver ? v + '+' : String(Math.round(v)), i === 0 ? 10 : 40, false));
      add(-0.76, -0.5, 0, 'Days', 110, true);
      ticks.forEach(measure);
    }
    function buildPlanes() {
      const fx = X(thr.floor), cx = X(thr.competitive);
      cutPlane.m.position.x = cutPlane.e.position.x = fx;
      revPlane.m.position.x = revPlane.e.position.x = cx;
      cutPlane.m.visible = cutPlane.e.visible = thr.floor > 0 && thr.floor < thr.competitive;
      const zx0 = cx, zx1 = 0.5, zy0 = Y(thr.chance), zy1 = 0.5;
      const ok = zx1 - zx0 > 0.01 && zy1 - zy0 > 0.01;
      zone.visible = zoneEdges.visible = ok;
      if (ok) {
        zone.scale.set(zx1 - zx0, zy1 - zy0, 1);
        zone.position.set((zx0 + zx1) / 2, (zy0 + zy1) / 2, 0);
        zoneEdges.scale.copy(zone.scale);
        zoneEdges.position.copy(zone.position);
      }
      planeLabels.forEach((L) => L.el.remove());
      planeLabels.length = 0;
      const mk = (html, anchor, prio, show, align) => {
        const L = makeLabel(tickLayer, 'cb3d-chip', html);
        L.anchor = anchor;
        L.prio = prio;
        L.show = show;
        L.align = align;
        measure(L);
        planeLabels.push(L);
      };
      const dot = (v) => '<span class="cb3d-dot" style="background:var(' + v + ')"></span>';
      // both plane labels sit on the back-top edge, growing away from each other; the zone label on the front-top edge
      mk(dot('--cb3d-muted') + '<span>Cutoff ' + Math.round(thr.floor) + '</span>', new THREE.Vector3(fx, 0.5 + 0.07, -0.5), 460, cutPlane.m.visible, 'end');
      mk(dot('--cb3d-accent') + '<span>Recruiter review ' + Math.round(thr.competitive) + '</span>', new THREE.Vector3(cx, 0.5 + 0.07, -0.5), 470, true, 'start');
      mk('<span>Apply now zone</span>', new THREE.Vector3((zx0 + zx1) / 2, 0.5 + 0.05, 0.5), 450, ok);
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
      density = clamp(Math.sqrt(80 / Math.max(1, n)), 0.5, 1);
      const oldVis = vis;
      vis = new Float32Array(n);
      visT = new Uint8Array(n);
      hv = new Float32Array(n);
      pts.forEach((p, i) => {
        p.pos = new THREE.Vector3(X(p.x), Y(p.y), Z(p.z));
        p.r = (R_MIN + p.size * (R_MAX - R_MIN)) * density;
        p.phase = (i * 2.399) % TAU;
        p.stagger = ((p.x / 100) * 260 + (i % 7) * 20) | 0;
        if (p.knocked) { p.slot = idxK.length; idxK.push(i); } else { p.slot = idxN.length; idxN.push(i); }
        visT[i] = passes(p) ? 1 : 0;
        vis[i] = oldVis.length === n ? oldVis[i] : visT[i];
      });
      meshN.count = idxN.length;
      meshK.count = idxK.length;
      if (dropLines) { pivot.remove(dropLines); dropLines.geometry.dispose(); }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, n) * 6), 3));
      dg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Math.max(1, n) * 6), 3));
      dropLines = new THREE.LineSegments(dg, dropMat);
      dropLines.frustumCulled = false;
      dropLines.renderOrder = -1;
      pivot.add(dropLines);
      msg.style.display = n ? 'none' : '';
      buildTicks();
      buildPlanes();
      applyColors();
      applyDropLines();
      computeTop5();
      writeInstances(nowMs());
      setAria();
    }
    function applyColors() {
      pts.forEach((p) => { if (!p.knocked) meshN.setColorAt(p.slot, lin(colorFor(p), tmpC)); });
      if (meshN.instanceColor) meshN.instanceColor.needsUpdate = true;
      if (dropLines) {
        const col = dropLines.geometry.attributes.color;
        pts.forEach((p, i) => {
          lin(p.knocked ? KNOCK_COLOR : colorFor(p), tmpC);
          col.setXYZ(i * 2, tmpC.r, tmpC.g, tmpC.b);
          col.setXYZ(i * 2 + 1, tmpC.r, tmpC.g, tmpC.b);
        });
        col.needsUpdate = true;
      }
      renderKey();
    }
    function applyDropLines() {
      if (!dropLines) return;
      const pos = dropLines.geometry.attributes.position;
      pts.forEach((p, i) => {
        pos.setXYZ(i * 2, p.pos.x, visT[i] ? p.pos.y : -0.5, p.pos.z);
        pos.setXYZ(i * 2 + 1, p.pos.x, -0.5, p.pos.z);
      });
      pos.needsUpdate = true;
      dropLines.visible = pts.length > 0;
    }
    function computeTop5() {
      top5 = pts.map((p, i) => i).filter((i) => visT[i]).sort((a, b) => pts[b].y - pts[a].y || pts[b].x - pts[a].x).slice(0, 5);
      rebuildTags();
    }
    function renderKey() {
      const seen = new Map();
      let anyKO = false;
      pts.forEach((p, i) => {
        if (!visT[i]) return;
        if (p.knocked) { anyKO = true; return; }
        const k = colorMode === 'verdict' ? p.verdict || '?' : p.status || p.statusLabel || '?';
        if (!seen.has(k)) seen.set(k, { label: colorMode === 'verdict' ? p.verdictLabel || 'No verdict' : p.statusLabel || 'Other', color: colorFor(p) });
      });
      const order = colorMode === 'verdict' ? VERDICT_ORDER : (CB.STAGES || []).map((s) => s.key);
      const keys = Array.from(seen.keys()).sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      key.innerHTML = keys.map((k) => '<span><span class="cb3d-dot" style="background:' + esc(seen.get(k).color) + '"></span>' + esc(seen.get(k).label) + '</span>').join('') + (anyKO ? '<span><i class="cb3d-ko"></i>Knockout</span>' : '');
      key.classList.toggle('is-clip', key.scrollWidth > key.clientWidth + 1);
      computeObstacles();
    }
    function setColorMode(m) {
      if (m !== 'status' && m !== 'verdict') return;
      colorMode = m;
      applyColors();
      rebuildTags();
      if (hot >= 0) S.showTip(tipHTML(hot));
      syncBar();
      S.busy(200);
    }
    function setFilter(f) {
      if (['all', 'active', 'knocked'].indexOf(f) < 0) return;
      filter = f;
      pts.forEach((p, i) => { visT[i] = passes(p) ? 1 : 0; });
      if (sel >= 0 && !visT[sel]) setSelected(-1, { notify: true });
      if (hot >= 0 && !visT[hot]) setHover(-1);
      applyDropLines();
      renderKey();
      computeTop5();
      syncBar();
      S.busy(500);
    }

    function writeInstances(t) {
      let still = false;
      const spin = S.reduced ? 0 : t / 1000;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let a = 1;
        if (appearing) {
          a = easeOut((t - appearStart - p.stagger) / 520);
          if (a < 1) still = true;
        }
        const boost = 1 + 0.55 * hv[i] + (i === sel ? 0.35 : 0) + (i === hl ? 0.45 : 0);
        const s = p.r * Math.max(0.0001, a * vis[i]) * boost;
        if (p.knocked) {
          eul.set(0.5, p.phase + spin * 0.8, 0.3);
          q.setFromEuler(eul);
          sc.setScalar(s * 1.15);
          m4.compose(p.pos, q, sc);
          meshK.setMatrixAt(p.slot, m4);
        } else {
          sc.setScalar(s);
          m4.compose(p.pos, qI, sc);
          meshN.setMatrixAt(p.slot, m4);
        }
      }
      if (meshN) meshN.instanceMatrix.needsUpdate = true;
      if (meshK) meshK.instanceMatrix.needsUpdate = true;
      if (appearing && !still) appearing = false;
    }

    // ── name tags (top 5 by chance + selected + highlighted) ──
    function tagHTML(p) {
      return '<span class="cb3d-dot" style="background:' + esc(p.knocked ? KNOCK_COLOR : colorFor(p)) + '"></span><span class="cb3d-nm">' + esc(p.label || 'Untitled') + '</span>' + (p.knocked ? '<span class="cb3d-dq">✕ DQ</span>' : '');
    }
    function rebuildTags() {
      tags.forEach((T) => T.el.remove());
      tags = [];
      const want = [];
      if (sel >= 0) want.push([sel, 'sel', 1e6]);
      if (hl >= 0 && hl !== sel) want.push([hl, 'hl', 9e5]);
      top5.forEach((i, r) => { if (i !== sel && i !== hl) want.push([i, '', 300 - r]); });
      want.forEach(([i, kind, prio]) => {
        const L = makeLabel(tagLayer, 'cb3d-tag' + (kind ? ' is-' + kind : ''), tagHTML(pts[i]));
        L.idx = i;
        L.kind = kind;
        L.prio = prio;
        measure(L);
        tags.push(L);
      });
    }

    // ── obstacles the overlap pass must avoid (toolbar, key, card) ──
    function rectOf(node) {
      if (!node || node.style.display === 'none' || node.classList.contains('is-hidden')) return null;
      const r = node.getBoundingClientRect(), o = S.overlay.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, prio: 1e9, want: true, fixed: true };
    }
    function computeObstacles() {
      obstacles = [rectOf(bar), phone ? rectOf(grpView) : null, key.firstChild ? rectOf(key) : null, sel >= 0 ? rectOf(card) : null].filter(Boolean);
    }

    function setAria() {
      const n = pts.length;
      S.canvas.setAttribute('aria-label', n ? 'Opportunity space: ' + n + ' application' + (n === 1 ? '' : 's') + ' plotted by ATS score, interview chance and days since applied' + (idxK.length ? '; ' + idxK.length + ' ATS knockout' + (idxK.length === 1 ? '' : 's') : '') : 'Opportunity space: no applications to plot yet');
    }

    // ── theme ──
    function applyTheme(theme) {
      S.applyThemeVars(theme);
      const t = S.theme;
      lin(t.grid, floorMat.color);
      floorMat.opacity = S.dark ? 0.35 : 0.3;
      lin(t.grid, gridMat.color);
      gridMat.opacity = S.dark ? 1 : 0.95;
      lin(t.grid, boxMat.color);
      lin(t.muted, axisMat.color);
      lin(t.muted, cutPlane.mat.color);
      lin(t.muted, cutPlane.eMat.color);
      cutPlane.mat.opacity = S.dark ? 0.07 : 0.05;
      lin(t.accent, revPlane.mat.color);
      lin(t.accent, revPlane.eMat.color);
      revPlane.mat.opacity = S.dark ? 0.1 : 0.08;
      lin(t.accent, zoneMat.color);
      lin(t.accent, zoneEdgeMat.color);
      zoneMat.opacity = S.dark ? 0.05 : 0.04;
      lin(t.accent, selMat.color);
      lin(t.fg, hlMat.color);
      lin(t.fg, hoverMat.color);
      shadowMat.opacity = S.dark ? 0.7 : 0.35;
      dropMat.opacity = (S.dark ? 0.5 : 0.4) * clamp(Math.sqrt(60 / Math.max(1, pts.length)), 0.4, 1);
      glowU.value = S.dark ? 0.12 : 0.04;
      ticks.forEach(measure);
      planeLabels.forEach(measure);
      tags.forEach(measure);
      computeObstacles();
    }

    // ── stage hooks ──
    S.hooks.layout = (w, h) => {
      phone = (window.innerWidth || w) <= 560 || w < 440;
      if (phone && grpView.parentNode !== S.overlay) S.overlay.insertBefore(grpView, bar);
      if (!phone && grpView.parentNode !== bar) bar.insertBefore(grpView, bar.firstChild);
      grpView.classList.toggle('is-vert', phone);
      bar.classList.toggle('is-phone', phone);
      card.classList.toggle('is-phone', phone);
      bar.classList.toggle('is-hidden', phone && sel >= 0);
      bar.classList.toggle('is-compact', !phone && w < 700);
      key.style.display = phone ? 'none' : '';
      key.classList.toggle('is-clip', key.scrollWidth > key.clientWidth + 1);
      const bh = bar.offsetHeight;
      const kh = phone || !key.firstChild ? 0 : key.offsetHeight + 10;
      const insetTop = phone ? 0 : 10 + bh;
      const insetBot = phone ? bh + 6 : kh;
      const avail = Math.max(80, h - insetTop - insetBot - 8);
      const tanH = Math.tan((camera.fov * DEG) / 2);
      const R = 0.86;
      computeObstacles();
      return {
        dist: Math.max((R * h) / (tanH * avail), R / (tanH * (w / h))) * 1.03,
        target: new THREE.Vector3(0, -0.04, 0),
        offsetY: Math.round((insetBot - insetTop) / 2),
      };
    };
    S.hooks.hover = (x, y) => {
      const i = pick(x, y, 10);
      setHover(i);
    };
    S.hooks.leave = () => setHover(-1);
    S.hooks.dragStart = () => setHover(-1);
    S.hooks.tap = (x, y, type) => {
      const i = pick(x, y, 24);
      if (type !== 'mouse') setHover(-1);
      setSelected(i, { notify: true });
    };
    S.hooks.doubleTap = () => resetView();
    S.hooks.motion = () => { appearing = false; writeInstances(nowMs()); };
    S.hooks.ambient = () => S.autoOn;

    S.hooks.frame = (dt, t) => {
      if (!appearStart) appearStart = t;
      let active = false, dirty = appearing;
      for (let i = 0; i < pts.length; i++) {
        const tv = visT[i];
        if (vis[i] !== tv) {
          vis[i] = S.reduced || Math.abs(tv - vis[i]) < 0.01 ? tv : lerp(vis[i], tv, 1 - Math.exp(-dt * 10));
          dirty = true;
        }
        const th = i === hot ? 1 : 0;
        if (hv[i] !== th) {
          hv[i] = S.reduced || Math.abs(th - hv[i]) < 0.01 ? th : lerp(hv[i], th, 1 - Math.exp(-dt * 16));
          dirty = true;
        }
      }
      if (dirty) active = true;
      if (!S.reduced && idxK.length) dirty = true;
      if (dirty) writeInstances(t);
      // halos
      const place = (ring, i, k) => {
        if (i < 0 || !pts[i] || !visT[i]) { ring.visible = false; return; }
        const p = pts[i];
        pivot.localToWorld(ring.position.copy(p.pos));
        ring.quaternion.copy(camera.quaternion);
        const boost = 1 + 0.55 * hv[i] + (i === sel ? 0.35 : 0) + (i === hl ? 0.45 : 0);
        const s = p.r * boost * k;
        ring.scale.set(s, s, s);
        ring.visible = true;
      };
      const pulse = S.reduced ? 1 : 1 + 0.12 * Math.sin(t / 1000 * 4.4);
      place(selRing, sel, 2.0 * pulse);
      selMat.opacity = S.reduced ? 0.9 : 0.62 + 0.3 * (0.5 + 0.5 * Math.sin(t / 1000 * 4.4));
      place(hlRing, hl, 1.85);
      place(hoverRing, hot !== sel ? hot : -1, 1.6);
      return active || appearing;
    };

    S.hooks.post = () => {
      const w = S.w, h = S.h;
      const items = obstacles.slice();
      const labelItems = [];
      for (const L of ticks.concat(planeLabels)) {
        if (!L.w) measure(L);
        const wp = pivot.localToWorld(tmp.copy(L.anchor));
        S.project(wp, P);
        const x = L.align === 'end' ? P.x - L.w + 6 : L.align === 'start' ? P.x - 6 : P.x - L.w / 2, y = P.y - L.h / 2;
        const inside = L.show !== false && P.ok && x > -L.w / 2 && x + L.w < w + L.w / 2 && y > -4 && y + L.h < h + 4;
        const it = { L, x, y, w: L.w, h: L.h, prio: L.prio, want: inside };
        items.push(it);
        labelItems.push(it);
      }
      if (tags.length) projectAll();
      let selItem = null;
      for (const T of tags) {
        if (!T.w) measure(T);
        const i = T.idx, px = scr[i * 4], py = scr[i * 4 + 1], pr = scr[i * 4 + 2] * (1 + (i === sel ? 0.35 : 0) + (i === hl ? 0.45 : 0));
        let x, y;
        if (T.kind === 'sel') {
          x = px + pr + 14;
          y = py - pr - T.h - 14;
          if (x + T.w > w - 4) x = px - pr - 14 - T.w;
          if (y < 4) y = py + pr + 14;
        } else {
          x = px - T.w / 2;
          y = py - pr - T.h - 4;
        }
        const it = { L: T, x, y, w: T.w, h: T.h, prio: T.prio, want: !!scr[i * 4 + 3] && vis[i] > 0.5 && x > -T.w * 0.5 && x < w - T.w * 0.5 && y > -4 && y < h - 4, px, py, pr };
        if (T.kind === 'sel') selItem = it;
        items.push(it);
        labelItems.push(it);
      }
      resolveOverlaps(items, 3);
      for (const it of labelItems) {
        moveLabel(it.L, it.x, it.y);
        showLabel(it.L, it.ok);
      }
      if (selItem && selItem.ok) {
        const left = selItem.x < selItem.px;
        const above = selItem.y < selItem.py;
        const ax0 = selItem.px + (left ? -1 : 1) * selItem.pr * 0.75, ay0 = selItem.py + (above ? -1 : 1) * selItem.pr * 0.75;
        const ax1 = left ? selItem.x + selItem.w : selItem.x, ay1 = above ? selItem.y + selItem.h : selItem.y;
        lineBetween(leader, ax0, ay0, ax1, ay1);
        leader.classList.remove('cb3d-off');
      } else leader.classList.add('cb3d-off');
      if (hot >= 0 && pts[hot]) {
        S.project(pivot.localToWorld(tmp.copy(pts[hot].pos)), P);
        S.placeTip(P.x, P.y);
      }
    };

    // ── public API ──
    function update(points, theme, o) {
      if (!S.hooks.frame) return;
      if (theme) S.applyThemeVars(theme);
      if (o) {
        if (o.thresholds) thr = normThresholds(o.thresholds, thr);
        if (typeof o.onSelect === 'function') onSelect = o.onSelect;
        if (typeof o.onOpen === 'function') onOpen = o.onOpen;
        if (typeof o.onPick === 'function') onPick = o.onPick;
      }
      if (points !== null && points !== undefined) {
        const selId = sel >= 0 ? pts[sel].id : null, hlId = hl >= 0 ? pts[hl].id : null;
        pts = normPoints(points);
        hot = -1;
        S.hideTip();
        rebuildPoints();
        sel = indexOfId(selId);
        if (sel >= 0 && !visT[sel]) sel = -1;
        hl = indexOfId(hlId);
        renderCard();
        rebuildTags();
        if (selId !== null && sel < 0 && onSelect) onSelect(null);
      } else if (o && o.thresholds) {
        buildPlanes();
      }
      applyTheme(theme);
      S.resize();
    }

    pts = normPoints(opts.points);
    applyTheme(opts.theme);
    rebuildPoints();
    syncBar();
    applyTheme(opts.theme);
    S.start();

    return {
      update,
      /** Select a point by id (or null to clear) and ease the camera to frame it. Returns false if unknown. */
      select(id) {
        if (!S.hooks.frame) return false;
        if (id === null || id === undefined) { setSelected(-1, { notify: true }); return true; }
        const i = indexOfId(id);
        if (i < 0) return false;
        if (!visT[i]) setFilter('all');
        setSelected(i, { fly: true, notify: true });
        return true;
      },
      /** Temporary emphasis driven from outside (e.g. hovering a table row); null clears it. */
      highlight(id) {
        if (!S.hooks.frame) return;
        setHighlight(id === null || id === undefined ? -1 : indexOfId(id));
      },
      destroy() {
        ticks.forEach((t) => t.el.remove());
        ticks = [];
        tags = [];
        S.destroy();
      },
    };
  }

  CB.Viz3D = { available, createFunnel, createGalaxy };
})();

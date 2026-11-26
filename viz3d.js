/* Callback v3 — 3D visualisations on the shared GL hub.  Owner: scenes.  Contract: docs/BUILD.md §2,
 * art direction: docs/research/premium-3d.md ("an orrery in a black vitrine").
 *
 *   CB.Viz3D.available() → boolean   CB.GL.available(): the ONE shared WebGL context. false in Safe Mode / without
 *                                    WebGL, so callers fall back to their 2D charts. No probe contexts.
 *
 *   CB.Viz3D.createFunnel(container, { stages, dropoffs, theme, onPick })
 *     → { update(stages, dropoffs, theme), destroy() } | null                       "Pipeline Tower"
 *
 *   CB.Viz3D.createGalaxy(container, { points, theme, thresholds, onSelect, onOpen, onPick })
 *     → { update(points, theme, opts), select(id), highlight(id|null), destroy() } | null   "Opportunity Space"
 *
 * Engine: this file never creates a WebGLRenderer, a PMREMGenerator or a probe context. Each scene is a CB.GL.view
 * (the hub renders offscreen and blits into a 2D canvas inside the host) lit by the hub's shared studio environment
 * (CB.GL.env) with every colour converted sRGB → linear. Pacing follows the hub: 0 fps idle, 30 fps ambient for at
 * most 4 s after input, native rate only while dragging or while a tween runs (view.kick). Data refreshes mutate the
 * scene in place (the view is never rebuilt); destroy() frees every GPU resource through view.dispose().
 *
 * Look — Pipeline Tower: jewel-tinted fake-crystal tiers (clearcoat + fresnel rim, champagne bezels) threaded on a
 * champagne spindle above a black-lacquer plinth with a champagne bezel and an engraved dial, gold glow sprites,
 * contact shadows, a disc-clipped mirror reflection, instanced glossy beads spiralling down the spindle while
 * drop-offs roll off the tiers and arc away, three depth layers of slow dust, depth fog.
 * Opportunity Space: jewel-ink instanced spheres in a lacquer-floored vitrine with an engraved champagne grid,
 * champagne threshold planes and "Apply now" zone, gold halo on the selection, depth fog, dust.
 * Narrow FOV (30–32°), pointer parallax on Mac (±3.5°), entry choreography: CSS poster → compile → first frame →
 * 600 ms cross-fade (hub) + an 8 % camera dolly (here). Labels, toolbar and cards are DOM overlays.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});

  // ───────── constants & small helpers ─────────
  const DEFAULT_THEME = { fg: '#F2EEE6', muted: '#8B867D', grid: '#34332F', surface: '#131312', accent: '#D8BA7E' };
  const DROP = [
    { key: 'rejected', label: 'rejected', color: '#D0656F' },
    { key: 'ghosted', label: 'ghosted', color: '#6A6966' },
    { key: 'withdrawn', label: 'withdrawn', color: '#9A8F80' },
  ];
  const CLOSED = ['rejected', 'ghosted', 'withdrawn'];
  let KNOCK_COLOR = '#D0656F';
  const VERDICTS = {
    STRONG: ['Shortlist', '#6FB58A'],
    COMPETITIVE: ['Advance to review', '#D8BA7E'],
    LONG_SHOT: ['Long shot', '#D98B5F'],
    REJECTED: ['Auto-rejected', '#D0656F'],
  };
  const VERDICT_ORDER = ['STRONG', 'COMPETITIVE', 'LONG_SHOT', 'REJECTED'];
  /** Scene palette per theme ("Obsidian & Champagne" / "Ivory & Bronze", luxury-ui.md). */
  const PAL = {
    dark: { metal: '#D9BC85', engrave: '#D8BA7E', lacquer: '#0C0C0B', bead: '#EEDDB4', glow: '#E8D3A4', rim: '#E8D3A4', axis: '#8B867D' },
    light: { metal: '#C4A36A', engrave: '#86662B', lacquer: '#D9D2C3', bead: '#8C6A2E', glow: '#C29E5E', rim: '#8C6A2E', axis: '#6B655A' },
  };
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
  let normCtx = null;
  /** A design token from :root as a plain CSS colour ('' when missing). Tokens may be oklch()/color-mix(), so they
   *  are normalised through a 1×1 2D context. */
  function cssVar(name) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (!v) return '';
      if (isColor(v)) return v;
      if (!normCtx) { const c = document.createElement('canvas'); c.width = c.height = 1; normCtx = c.getContext('2d'); }
      if (!normCtx) return '';
      normCtx.fillStyle = '#000';
      normCtx.fillStyle = v;
      const out = String(normCtx.fillStyle);
      return isColor(out) ? out : '';
    } catch (e) { return ''; }
  }
  const dropColor = (k) => cssVar('--st-' + DROP[k].key) || DROP[k].color;
  function mixHex(a, b, t) {
    const ca = colorOf(a), cb = colorOf(b);
    ca.lerp(cb, t);
    return '#' + ca.getHexString();
  }

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

  // ───────── availability: the shared hub decides (no probe contexts, no second renderer) ─────────
  function GLH() {
    return CB.GL && typeof CB.GL.view === 'function' && typeof CB.GL.available === 'function' ? CB.GL : null;
  }
  function available() {
    const G = GLH();
    if (!G || typeof THREE === 'undefined' || !THREE.Scene) return false;
    try { return !!G.available(); } catch (e) { return false; }
  }
  function safeQuality(G) {
    try { return (G && G.quality && G.quality()) || {}; } catch (e) { return {}; }
  }

  // ───────── shared stylesheet (ref-counted) ─────────
  const F_UI = "var(--f-ui,'Geist',Inter,system-ui,-apple-system,sans-serif)";
  const F_MONO = "var(--f-mono,'Geist Mono',ui-monospace,'SF Mono',Menlo,monospace)";
  const F_DISP = "var(--f-display,'Bodoni Moda',Didot,'Bodoni 72',Georgia,serif)";
  const EZ = 'cubic-bezier(.2,.8,.2,1)';
  const CSS = [
    '.cb3d-host{isolation:isolate}',
    '.cb3d-canvas{-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;outline:none;cursor:grab}',
    '.cb3d-canvas.is-drag{cursor:grabbing}',
    '.cb3d-canvas.is-hot{cursor:pointer}',
    // overlay: tokens with fallbacks so the scene reads right before and after the v3 stylesheet lands
    '.cb3d-ov{--cb3d-line:var(--line-2,rgba(128,120,104,.22));--cb3d-line-s:var(--line-1,rgba(128,120,104,.12));--cb3d-rim:var(--rim,rgba(255,250,240,.07));' +
      'position:absolute;left:0;top:0;right:0;bottom:0;z-index:2;pointer-events:none;overflow:hidden;font:450 12px/1.3 ' + F_UI + ';color:var(--cb3d-fg);' +
      '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;-webkit-user-select:none;user-select:none;text-align:left;letter-spacing:.003em;transition:opacity .4s ' + EZ + ',visibility 0s}',
    '.cb3d-ov.is-safe{opacity:0;visibility:hidden;transition:opacity .2s linear,visibility 0s linear .2s}',
    '.cb3d-ov *{box-sizing:border-box}',
    // tower labels
    '.cb3d-chip{position:absolute;left:0;top:0;display:flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 8px;border-radius:8px;background:var(--cb3d-panel);border:1px solid var(--cb3d-line);' +
      'box-shadow:inset 0 1px 0 var(--cb3d-rim),0 8px 18px -12px var(--cb3d-shadow);color:var(--cb3d-fg);white-space:nowrap;line-height:22px;font-variant-numeric:tabular-nums;' +
      'transition:opacity .3s ' + EZ + ',border-color .2s ease,background-color .2s ease;will-change:transform}',
    '.cb3d-chip.is-pick{pointer-events:auto;cursor:pointer}',
    '.cb3d-chip.is-hot{border-color:var(--cb3d-gold-line);background:var(--cb3d-tip)}',
    '.cb3d-chip:focus{outline:none}',
    '.cb3d-chip:focus-visible{box-shadow:0 0 0 2px var(--cb3d-surface),0 0 0 4px var(--cb3d-focus)}',
    '.cb3d-chip b{font:600 12px/1 ' + F_MONO + ';flex:none;letter-spacing:-.01em;color:var(--cb3d-fg)}',
    '.cb3d-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;box-shadow:0 0 0 1px var(--cb3d-dot-ring),inset 0 1px 1px rgba(255,255,255,.28)}',
    '.cb3d-nm{overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto;color:var(--cb3d-fg2)}',
    '.cb3d-mu{color:var(--cb3d-muted);flex:none;font:500 11px/1 ' + F_MONO + ';letter-spacing:-.01em}',
    '.cb3d-sep{color:var(--cb3d-muted);flex:none;opacity:.55}',
    '.cb3d-lead{position:absolute;left:0;top:0;height:1px;width:10px;background:linear-gradient(90deg,var(--cb3d-lead0),var(--cb3d-lead));transform-origin:0 0;transition:opacity .3s ' + EZ + '}',
    // axis ticks
    '.cb3d-tick{position:absolute;left:0;top:0;font:500 10.5px/14px ' + F_MONO + ';letter-spacing:-.01em;color:var(--cb3d-muted);white-space:nowrap;font-variant-numeric:tabular-nums;' +
      'text-shadow:0 0 2px var(--cb3d-surface),0 0 5px var(--cb3d-surface),0 0 9px var(--cb3d-surface);transition:opacity .3s ' + EZ + '}',
    '.cb3d-tick.is-title{font:600 9.5px/14px ' + F_UI + ';letter-spacing:.14em;text-transform:uppercase;color:var(--cb3d-fg2)}',
    '.cb3d-off{opacity:0 !important;pointer-events:none !important}',
    // tooltip
    '.cb3d-tip{position:absolute;left:0;top:0;max-width:250px;padding:9px 12px 10px;border-radius:11px;background:var(--cb3d-tip);border:1px solid var(--cb3d-line);' +
      'box-shadow:inset 0 1px 0 var(--cb3d-rim),0 22px 48px -22px var(--cb3d-shadow);color:var(--cb3d-fg2);line-height:1.5;opacity:0;transition:opacity .16s ease;white-space:normal;font-variant-numeric:tabular-nums}',
    '.cb3d-tip.is-on{opacity:1}',
    '.cb3d-tip b,.cb3d-card b{font-family:' + F_MONO + ';font-weight:600;color:var(--cb3d-fg);letter-spacing:-.01em}',
    '.cb3d-t1{font-weight:600;color:var(--cb3d-fg)}',
    '.cb3d-tip .cb3d-t1{font-size:12.5px}',
    '.cb3d-t2{color:var(--cb3d-muted)}',
    '.cb3d-row{display:flex;align-items:center;gap:6px;min-width:0}',
    '.cb3d-msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:10px 16px;border-radius:11px;background:var(--cb3d-panel);border:1px solid var(--cb3d-line);' +
      'box-shadow:inset 0 1px 0 var(--cb3d-rim);color:var(--cb3d-muted);white-space:nowrap}',
    '.cb3d-legend{position:absolute;right:10px;top:8px;display:flex;align-items:center;gap:12px;font-size:11px;line-height:14px;color:var(--cb3d-muted);white-space:nowrap;' +
      'font-variant-numeric:tabular-nums;text-shadow:0 0 3px var(--cb3d-surface),0 0 6px var(--cb3d-surface)}',
    '.cb3d-legend.is-col{top:auto;bottom:8px;flex-direction:column;align-items:flex-start;gap:3px}',
    '.cb3d-legend span{display:inline-flex;align-items:center;gap:5px}',
    // galaxy toolbar
    '.cb3d-bar{position:absolute;left:10px;top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;pointer-events:auto;max-width:calc(100% - 20px)}',
    '.cb3d-bar.is-phone{left:6px;right:6px;top:auto;bottom:6px;max-width:none;flex-wrap:nowrap;justify-content:center;overflow-x:auto;overflow-y:hidden;gap:6px;scrollbar-width:none;-webkit-overflow-scrolling:touch;touch-action:pan-x}',
    '.cb3d-bar.is-phone::-webkit-scrollbar{display:none}',
    '.cb3d-bar.is-phone .cb3d-grp-l{display:none}',
    '.cb3d-grp.is-vert{position:absolute;right:8px;top:8px;flex-direction:column;border-radius:20px;pointer-events:auto}',
    '.cb3d-grp.is-vert .cb3d-btn{width:34px;height:34px;min-width:34px;padding:0}',
    '.cb3d-grp.is-vert .cb3d-btn span{display:none}',
    '.cb3d-bar.is-hidden{visibility:hidden}',
    '.cb3d-grp{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:var(--cb3d-tip);border:1px solid var(--cb3d-line);flex:none;' +
      'box-shadow:inset 0 1px 0 var(--cb3d-rim),0 10px 24px -16px var(--cb3d-shadow)}',
    '.cb3d-grp-l{padding:0 4px 0 9px;font:600 9.5px/1 ' + F_UI + ';letter-spacing:.14em;text-transform:uppercase;color:var(--cb3d-muted);white-space:nowrap}',
    '.cb3d-ov .cb3d-btn{-webkit-appearance:none;appearance:none;margin:0;border:0;background:transparent;color:var(--cb3d-fg2);font:500 12px/1 ' + F_UI + ';height:26px;min-width:26px;padding:0 10px;' +
      'border-radius:999px;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;white-space:nowrap;touch-action:manipulation;-webkit-tap-highlight-color:transparent;' +
      'transition:background-color .15s ease,color .15s ease,box-shadow .15s ease;pointer-events:auto}',
    '.cb3d-ov .cb3d-btn.is-icon{padding:0;width:26px}',
    '.cb3d-ov .cb3d-btn:hover{background:var(--cb3d-hover);color:var(--cb3d-fg)}',
    '.cb3d-ov .cb3d-btn[aria-pressed="true"]{background:var(--cb3d-gold-soft);color:var(--cb3d-gold);box-shadow:inset 0 0 0 1px var(--cb3d-gold-line)}',
    '.cb3d-ov .cb3d-btn.is-solid{background:var(--cb3d-accent);color:var(--cb3d-gold-ink);font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 6px 16px -8px var(--cb3d-gold-line)}',
    '.cb3d-ov .cb3d-btn.is-solid:hover{background:var(--cb3d-accent-hi);color:var(--cb3d-gold-ink)}',
    '.cb3d-ov .cb3d-btn.is-line{box-shadow:inset 0 0 0 1px var(--cb3d-line)}',
    '.cb3d-ov .cb3d-btn.is-line:hover{box-shadow:inset 0 0 0 1px var(--cb3d-gold-line)}',
    '.cb3d-ov .cb3d-btn:focus{outline:none}',
    '.cb3d-ov .cb3d-btn:focus-visible{box-shadow:0 0 0 2px var(--cb3d-surface),0 0 0 4px var(--cb3d-focus)}',
    '.cb3d-ov .cb3d-btn:active{transform:translateY(.5px)}',
    '.cb3d-bar.is-phone .cb3d-btn{height:34px;min-width:34px;padding:0 10px}',
    // galaxy selection card
    '.cb3d-card{position:absolute;right:10px;bottom:10px;width:312px;max-width:calc(100% - 20px);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:12px 12px 12px 14px;' +
      'border-radius:14px;background:var(--cb3d-tip);border:1px solid var(--cb3d-line);box-shadow:inset 0 1px 0 var(--cb3d-rim),0 28px 64px -28px var(--cb3d-shadow);pointer-events:auto;' +
      'line-height:1.45;font-variant-numeric:tabular-nums;color:var(--cb3d-fg2);opacity:0;visibility:hidden;transform:translateY(8px) scale(.985);transform-origin:100% 100%;' +
      'transition:opacity .22s ' + EZ + ',transform .36s ' + EZ + ',visibility 0s linear .22s}',
    '.cb3d-card.is-on{opacity:1;visibility:visible;transform:none;transition:opacity .22s ' + EZ + ',transform .36s ' + EZ + '}',
    '.cb3d-card.is-phone{left:8px;right:8px;bottom:8px;width:auto;max-width:none}',
    '.cb3d-card-info{min-width:0;display:grid;gap:2px;align-content:start}',
    '.cb3d-card-info>div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.cb3d-card-info>.cb3d-row{flex-wrap:wrap;white-space:normal;row-gap:0}',
    '.cb3d-card-h{display:flex;align-items:center;gap:7px;min-width:0;padding-right:2px;margin-bottom:1px}',
    '.cb3d-card-h .cb3d-t1{font:500 17px/1.2 ' + F_DISP + ';letter-spacing:.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
    '.cb3d-card-side{display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;gap:8px}',
    '.cb3d-card-acts{display:flex;flex-direction:column;gap:6px;align-items:stretch}',
    '.cb3d-card .cb3d-btn{height:28px}',
    '.cb3d-card.is-phone .cb3d-btn{height:34px}',
    // galaxy name tags & key
    '.cb3d-tag{position:absolute;left:0;top:0;display:flex;align-items:center;gap:5px;height:20px;max-width:156px;padding:0 7px 0 6px;border-radius:6px;background:var(--cb3d-panel);' +
      'border:1px solid var(--cb3d-line-s);box-shadow:inset 0 1px 0 var(--cb3d-rim);color:var(--cb3d-fg2);font-size:11px;line-height:18px;white-space:nowrap;transition:opacity .3s ' + EZ + ';will-change:transform}',
    '.cb3d-tag.is-sel{height:23px;max-width:196px;font-size:12px;font-weight:600;color:var(--cb3d-fg);border-color:var(--cb3d-gold-line);box-shadow:inset 0 1px 0 var(--cb3d-rim),0 6px 16px -8px var(--cb3d-shadow)}',
    '.cb3d-tag.is-hl{border-color:var(--cb3d-line);color:var(--cb3d-fg)}',
    '.cb3d-dq{display:inline-flex;align-items:center;height:15px;padding:0 4px;border-radius:4px;font:600 9.5px/1 ' + F_MONO + ';background:var(--cb3d-ko-soft);' +
      'box-shadow:inset 0 0 0 1px var(--cb3d-ko-line);color:var(--cb3d-fg);flex:none;letter-spacing:.04em}',
    '.cb3d-leader{position:absolute;left:0;top:0;height:1px;width:10px;background:var(--cb3d-gold);opacity:.6;transform-origin:0 50%}',
    '.cb3d-key{position:absolute;left:12px;bottom:9px;display:flex;flex-wrap:nowrap;gap:12px;max-width:calc(100% - 24px);overflow:hidden;font-size:11px;line-height:14px;color:var(--cb3d-muted);' +
      'text-shadow:0 0 3px var(--cb3d-surface),0 0 6px var(--cb3d-surface)}',
    '.cb3d-key.is-clip{-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}',
    '.cb3d-bar.is-compact .cb3d-grp-l{display:none}',
    '.cb3d-key span{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}',
    '.cb3d-ko{display:inline-block;width:7px;height:7px;transform:rotate(45deg);box-shadow:inset 0 0 0 1.5px var(--cb3d-ko);flex:none}',
    '@media (prefers-reduced-motion:reduce){.cb3d-ov,.cb3d-ov *{transition-duration:.01s !important}}',
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
  /** One onBeforeCompile per material (r128 runs exactly one): optional radial resize of a unit-radius lathe/torus
   *  (uR — any outer radius without distorting fillets or tube), the fresnel rim of premium-3d.md §7 (brightens
   *  emissive and raises alpha at grazing angles) and extra patches. Uniform objects live in mat.userData.cb. */
  function shade(mat, o) {
    const U = {};
    if (o.uR) U.uR = o.uR;
    if (o.rim) {
      U.uRim = { value: new THREE.Color(1, 1, 1) };
      U.uRimP = { value: o.rim.power || 3 };
      U.uRimK = { value: o.rim.k === undefined ? 0.8 : o.rim.k };
      U.uRimA = { value: o.rim.alpha === undefined ? 0.35 : o.rim.alpha };
    }
    mat.userData.cb = U;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      if (U.uR) {
        sh.vertexShader = 'uniform float uR;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\n\t{ float l = length(transformed.xz); if (l > 1e-4) transformed.xz *= max(0.0, uR + l - 1.0) / l; }');
      }
      if (U.uRim) {
        sh.fragmentShader = 'uniform vec3 uRim;\nuniform float uRimP;\nuniform float uRimK;\nuniform float uRimA;\n' + sh.fragmentShader
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\tfloat rimF = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), uRimP);\n\ttotalEmissiveRadiance += uRim * rimF * uRimK;')
          .replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', 'gl_FragColor = vec4( outgoingLight, clamp( diffuseColor.a + rimF * uRimA, 0.0, 1.0 ) );');
      }
      if (o.extra) o.extra(sh);
    };
    mat.customProgramCacheKey = () => 'cb3d-' + o.key;
    return mat;
  }
  /** Fake crystal blending: on dark pages reflections add light (ONE, 1-srcA) while the body still darkens what is
   *  behind; on ivory plain alpha blending so the bronze edges read. */
  function crystalBlend(m, dark) {
    if (dark) {
      m.blending = THREE.CustomBlending;
      m.blendSrc = THREE.OneFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
      m.blendEquation = THREE.AddEquation;
    } else m.blending = THREE.NormalBlending;
  }
  /** Hemisphere + key + warm rim (premium-3d.md §7); the shared studio environment does most of the work. */
  function addLights(scene) {
    const hemi = new THREE.HemisphereLight(0xffffff, lin('#2a2f38'), 0.3);
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(-3, 4, 5);
    const rim = new THREE.DirectionalLight(lin('#FFE6C4'), 0.65);
    rim.position.set(3, 2, -4);
    scene.add(hemi, key, rim);
    return { hemi, key, rim };
  }
  /** Three depth layers of slow dust (far / mid / near, 150–400 motes after the tier scale) from the hub kit. */
  function addDust(parent, layers) {
    const G = GLH();
    const out = [];
    if (!G || !G.kit || typeof G.kit.dust !== 'function') return out;
    layers.forEach((L) => {
      try {
        const p = G.kit.dust(L);
        if (p) { parent.add(p); out.push(p); }
      } catch (e) { /* dust is a nicety */ }
    });
    return out;
  }

  // ═════════ Stage: hub view, camera rig, pointer input, overlay, pacing, lifecycle ═════════
  function createStage(container, cfg) {
    const G = GLH();
    if (!G) throw new Error('CB.GL is not loaded');
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
    container.classList.add('cb3d-host');

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0);
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
    const offs = [];

    let w = 0, h = 0, destroyed = false, rigMoved = true, firstFrame = true, autoTimer = 0, autoMoving = false;
    let vYaw = 0, vPitch = 0, swayT = 0, tween = null;
    let lastInteract = nowMs() - 3000 + (cfg.autoDelay || 0);
    let tipW = 0, tipH = 0, tipHTML = '';
    const pointers = new Map();
    let drag = null, pinch = null, hoverDirty = false;
    let lastTap = { t: 0, x: 0, y: 0 };
    const ptr = { x: 0, y: 0, inside: false };
    const par = { x: 0, y: 0, tx: 0, ty: 0 }; // pointer parallax (radians), critically damped
    const PAR_X = (cfg.parallax === undefined ? 3.5 : cfg.parallax) * DEG, PAR_Y = PAR_X * 0.6;

    const S = {
      scene, camera, pivot, canvas: null, overlay: null, view: null, target, raycaster,
      yaw: cfg.yaw || 0, pitch: cfg.pitch || 0.3, zoom: 1, zoomT: 1, focus: new THREE.Vector3(),
      baseDist: 5, offsetX: 0, offsetY: 0,
      reduced: !!(mq && mq.matches), autoOn: false, busyUntil: 0, holdAuto: false,
      theme: normTheme(cfg.theme), dark: true, pal: PAL.dark, quality: safeQuality(G),
      hooks: {}, ptr, cfg,
      get w() { return w; },
      get h() { return h; },
      track(o) { if (o) disposables.add(o); return o; },
      kick, project, showTip, hideTip, placeTip, moveTip, tipSize, rayAt, setCursor, destroy, applyThemeVars, resize, flyTo,
      dragging: () => !!(drag && drag.moved),
      interacted() { lastInteract = nowMs(); swayT = 0; },
      busy(ms) { S.busyUntil = Math.max(S.busyUntil, nowMs() + ms); if (view && !destroyed) view.kick(ms); },
      /** Explicit auto-orbit (galaxy toolbar): the user's choice, rendered at ≤ 30 fps while visible. */
      setAuto(on) {
        S.autoOn = !!on;
        if (!S.autoOn && autoTimer) { clearTimeout(autoTimer); autoTimer = 0; }
        kick();
      },
    };

    // ── the hub view: render + blit into a 2D canvas that the hub inserts as the host's first child ──
    const view = G.view(container, {
      scene, camera, update: frame, onResize: () => resize(), interactive: true, ambient: true, clearAlpha: 0, poster: 'css',
      intro: S.reduced ? 0 : 1400, name: cfg.name || 'viz3d', label: cfg.label || '3D chart',
    });
    S.view = view;
    const canvas = view.el;
    if (!canvas) {
      try { view.dispose(); } catch (e) { /* noop */ }
      container.classList.remove('cb3d-host');
      if (posPatched) container.style.position = prevPosition;
      releaseStyle();
      throw new Error('3D view could not be created');
    }
    S.canvas = canvas;
    canvas.classList.add('cb3d-canvas');
    if (cfg.touchAction) canvas.style.touchAction = cfg.touchAction;
    const overlay = el('div', 'cb3d-ov');
    container.appendChild(overlay);
    S.overlay = overlay;
    const tip = el('div', 'cb3d-tip', overlay);
    tip.setAttribute('aria-hidden', 'true');

    // ── theme → CSS variables on the overlay + the hub's shared studio environment ──
    function applyThemeVars(theme) {
      S.theme = normTheme(theme, S.theme);
      const t = S.theme;
      S.dark = luminance(t.surface) < 0.4;
      S.pal = S.dark ? PAL.dark : PAL.light;
      const d = S.dark;
      const gold = d ? t.accent : '#86662B'; // champagne text on obsidian, bronze text on ivory (luxury-ui.md)
      const st = overlay.style;
      st.setProperty('--cb3d-fg', t.fg);
      st.setProperty('--cb3d-fg2', mixHex(t.fg, t.surface, d ? 0.2 : 0.18));
      st.setProperty('--cb3d-muted', t.muted);
      st.setProperty('--cb3d-surface', t.surface);
      st.setProperty('--cb3d-accent', t.accent);
      st.setProperty('--cb3d-accent-hi', mixHex(t.accent, '#ffffff', 0.12));
      st.setProperty('--cb3d-gold', gold);
      st.setProperty('--cb3d-gold-ink', '#1B1509');
      st.setProperty('--cb3d-gold-soft', rgba(t.accent, d ? 0.13 : 0.16));
      st.setProperty('--cb3d-gold-line', rgba(t.accent, d ? 0.42 : 0.6));
      st.setProperty('--cb3d-focus', rgba(t.accent, 0.65));
      st.setProperty('--cb3d-panel', rgba(mixHex(t.surface, t.fg, d ? 0.03 : 0), d ? 0.84 : 0.9));
      st.setProperty('--cb3d-tip', rgba(mixHex(t.surface, t.fg, d ? 0.055 : 0), 0.97));
      st.setProperty('--cb3d-hover', rgba(t.fg, d ? 0.07 : 0.06));
      st.setProperty('--cb3d-lead', rgba(d ? t.accent : t.muted, d ? 0.5 : 0.55));
      st.setProperty('--cb3d-lead0', rgba(d ? t.accent : t.muted, 0.08));
      st.setProperty('--cb3d-dot-ring', d ? 'rgba(255,250,240,.14)' : 'rgba(40,32,18,.14)');
      st.setProperty('--cb3d-shadow', d ? 'rgba(0,0,0,.7)' : 'rgba(40,32,18,.26)');
      st.setProperty('--cb3d-ko', KNOCK_COLOR);
      st.setProperty('--cb3d-ko-soft', rgba(KNOCK_COLOR, 0.14));
      st.setProperty('--cb3d-ko-line', rgba(KNOCK_COLOR, 0.6));
      let env = null;
      try { env = G.env(d ? 'dark' : 'light'); } catch (e) { env = null; }
      scene.environment = env || null;
      // r128 applies fog after tone mapping + sRGB encoding, so the fog colour is the page colour as-is.
      scene.fog.color.copy(colorOf(t.surface));
      kick();
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
      if (!destroyed) view.kick(tw.dur + 120);
    }
    function placeCamera() {
      const d = S.baseDist * S.zoom;
      tmpF.copy(S.focus).applyAxisAngle(AXIS_Y, S.yaw);
      const tx = target.x + tmpF.x, ty = target.y + tmpF.y, tz = target.z + tmpF.z;
      const p = S.pitch + par.y, cp = Math.cos(p) * d;
      camera.position.set(tx + Math.sin(par.x) * cp, ty + Math.sin(p) * d, tz + Math.cos(par.x) * cp);
      camera.lookAt(tx, ty, tz);
      pivot.rotation.y = S.yaw;
      camera.updateMatrixWorld();
      pivot.updateMatrixWorld();
      scene.fog.density = cfg.fogK ? cfg.fogK / Math.max(0.5, d) : 0;
    }
    /** Advances the rig; returns true while something needs native-rate frames (tween, inertia, zoom, parallax). */
    function rigStep(dt, t) {
      let fast = false;
      autoMoving = false;
      if (tween) {
        const k = clamp((t - tween.t0) / tween.dur, 0, 1), e = tween.ease(k);
        S.yaw = lerp(tween.yaw0, tween.yaw1, e);
        S.pitch = lerp(tween.pitch0, tween.pitch1, e);
        S.zoom = S.zoomT = lerp(tween.zoom0, tween.zoom1, e);
        S.focus.lerpVectors(tween.focus0, tween.focus1, e);
        if (k >= 1) tween = null;
        fast = true;
      } else if (!drag) {
        if (vYaw !== 0 || vPitch !== 0) {
          S.yaw += vYaw * dt;
          S.pitch += vPitch * dt;
          vYaw *= Math.exp(-dt * 3.2);
          vPitch *= Math.exp(-dt * 6);
          if (Math.abs(vYaw) < 0.004) vYaw = 0;
          if (Math.abs(vPitch) < 0.004) vPitch = 0;
          fast = true;
        }
        const idle = t - lastInteract;
        if (!S.reduced && S.autoOn && !S.holdAuto && idle > 1200) {
          const ramp = clamp((idle - 1200) / 1500, 0, 1);
          if (cfg.auto === 'sway') {
            swayT += dt * ramp;
            S.yaw += cfg.swayAmp * cfg.swayW * Math.cos(cfg.swayW * swayT) * ramp * dt;
          } else {
            S.yaw += (cfg.autoSpeed || 0.04) * ramp * dt;
          }
          autoMoving = true;
        }
      }
      if (S.pitch < cfg.minPitch) { S.pitch = cfg.minPitch; vPitch = 0; }
      if (S.pitch > cfg.maxPitch) { S.pitch = cfg.maxPitch; vPitch = 0; }
      if (!tween) {
        if (Math.abs(S.zoomT - S.zoom) > 1e-4) {
          S.zoom = lerp(S.zoom, S.zoomT, 1 - Math.exp(-dt * 12));
          fast = true;
        } else S.zoom = S.zoomT;
      }
      // pointer parallax: critically damped, 1 - exp(-dt·6)
      const pk = S.reduced ? 1 : 1 - Math.exp(-dt * 6);
      if (Math.abs(par.tx - par.x) > 2e-4 || Math.abs(par.ty - par.y) > 2e-4) {
        par.x += (par.tx - par.x) * pk;
        par.y += (par.ty - par.y) * pk;
        fast = true;
      } else { par.x = par.tx; par.y = par.ty; }
      if (!tween && (S.yaw > Math.PI * 4 || S.yaw < -Math.PI * 4)) S.yaw %= TAU;
      placeCamera();
      return fast;
    }

    // ── per-frame: called by the hub right before it renders this view ──
    function autoTick() {
      autoTimer = 0;
      if (!destroyed && S.autoOn && !S.reduced) view.invalidate();
    }
    function frame(dt) {
      if (destroyed) return false;
      const t = nowMs();
      if (firstFrame) {
        firstFrame = false;
        if (S.hooks.first) S.hooks.first(t);
      }
      const fast = rigStep(dt, t);
      const moved = fast || autoMoving || rigMoved;
      rigMoved = false;
      if (ptr.inside && !drag && (hoverDirty || moved) && S.hooks.hover) S.hooks.hover(ptr.x, ptr.y);
      hoverDirty = false;
      const active = S.hooks.frame ? !!S.hooks.frame(dt, t) : false;
      if (S.hooks.post) S.hooks.post(t);
      if (fast || active || pinch) view.kick(160); // native rate only while something is actually moving
      if (S.autoOn && !S.reduced && !autoTimer) autoTimer = setTimeout(autoTick, 33); // explicit auto-orbit ≤ 30 fps
      return fast || active || autoMoving || (!S.reduced && !!(S.hooks.ambient && S.hooks.ambient()));
    }
    function kick() {
      if (!destroyed) view.invalidate();
    }

    // ── size: CSS px from the host; the hub owns the device-pixel buffer ──
    function resize() {
      if (destroyed) return;
      const nw = Math.round(container.clientWidth), nh = Math.round(container.clientHeight);
      w = nw;
      h = nh;
      if (!nw || !nh) return;
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
      const r = container.getBoundingClientRect(); // not the canvas: it scales .96→1 during the entry cross-fade
      return { x: e.clientX - r.left - (container.clientLeft || 0), y: e.clientY - r.top - (container.clientTop || 0) };
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
        if (!S.reduced && w > 0 && h > 0) {
          par.tx = clamp(p.x / w - 0.5, -0.5, 0.5) * 2 * PAR_X;
          par.ty = -clamp(p.y / h - 0.5, -0.5, 0.5) * 2 * PAR_Y;
        }
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
          view.kick(1800); // inertia glides at the native rate
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
      par.tx = 0;
      par.ty = 0;
      if (S.hooks.leave) S.hooks.leave();
      view.kick(600);
    }
    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel scrolls the page
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      tween = null;
      S.zoomT = clamp(S.zoomT * Math.exp(clamp(dy, -60, 60) * 0.01), cfg.zoomMin, cfg.zoomMax);
      S.interacted();
      view.kick(400);
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

    // ── motion preference, quality tier, Safe Mode, context restore ──
    const onMotion = () => {
      S.reduced = !!(mq && mq.matches);
      if (S.reduced) { par.tx = par.ty = par.x = par.y = 0; }
      if (S.hooks.motion) S.hooks.motion();
      rigMoved = true;
      kick();
    };
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onMotion);
      else if (mq.addListener) mq.addListener(onMotion);
    }
    const syncSafe = () => {
      const safe = !!view.safe;
      overlay.classList.toggle('is-safe', safe);
      if (!safe) resize();
    };
    const listen = (evt, fn) => {
      try {
        const off = G.on(evt, fn);
        if (typeof off === 'function') offs.push(off);
      } catch (e) { /* older hub */ }
    };
    listen('tier', () => {
      if (destroyed) return;
      S.quality = safeQuality(G);
      if (S.hooks.quality) { try { S.hooks.quality(S.quality); } catch (e) { /* noop */ } }
      syncSafe();
      kick();
    });
    listen('restored', () => { if (!destroyed) { syncSafe(); kick(); } });
    if (view.safe) overlay.classList.add('is-safe');

    // ── teardown ──
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = 0;
      offs.forEach((off) => { try { off(); } catch (e) { /* noop */ } });
      offs.length = 0;
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
      // InstancedMesh.dispose() releases instanceMatrix / instanceColor buffers (the hub frees geometry + materials).
      scene.traverse((o) => { if (o.isInstancedMesh) { try { o.dispose(); } catch (e) { /* ignore */ } } });
      disposables.forEach((d) => { try { d.dispose(); } catch (e) { /* ignore */ } });
      disposables.clear();
      try { view.dispose(); } catch (e) { /* ignore */ }
      scene.environment = null;
      overlay.remove();
      pointers.clear();
      container.classList.remove('cb3d-host');
      if (posPatched) container.style.position = prevPosition;
      releaseStyle();
      S.hooks = {};
    }

    S.start = () => resize();
    if (window.__cbVizDebug) (window.__cbVizStages = window.__cbVizStages || []).push(S); // test-only hook
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

  const SPINDLE_R = 0.017;
  const STREAM_R = 0.046; // beads spiral down the spindle at this radius
  const PLINTH_H = 0.075;

  function createFunnel(container, opts) {
    if (!container || !available()) return null;
    opts = opts || {};
    let S;
    try {
      S = createStage(container, {
        fov: 30, yaw: 0.35, pitch: PITCH0, minPitch: 0.04, maxPitch: 0.62,
        auto: 'none', zoomMin: 0.7, zoomMax: 1.6, theme: opts.theme, touchAction: 'pan-y',
        name: 'Pipeline Tower', label: 'Pipeline tower', fogK: 0.26, parallax: 3,
      });
    } catch (e) {
      console.warn('[Viz3D] 3D view unavailable:', e && e.message);
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
    const G = GLH();
    const onPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    addLights(scene);
    const glowTex = G.glowTexture ? G.glowTexture() : null;
    const shadowTex = G.contactShadowTexture ? G.contactShadowTexture() : null;

    // shared geometry (freed by view.dispose(); tiers only swap materials)
    const geoTier = new THREE.LatheGeometry(tierProfile(), 64);
    const geoRing = new THREE.TorusGeometry(1, 0.0085, 8, 96).rotateX(Math.PI / 2);
    const geoPlane = new THREE.PlaneGeometry(1, 1);

    // ── the vitrine: black-lacquer plinth, champagne bezel + engraved dial, contact shadows ──
    // champagne metal; shares the bezels' program (uR = 1 is the identity), so the scene compiles one program fewer
    const metalMat = shade(new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.24, envMapIntensity: 1.45 }), { uR: { value: 1 }, key: 'bezel' });
    const floorMat = new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.85, transparent: true, depthWrite: false });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(FLOOR_R, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.renderOrder = -6;
    const wallMat = new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(FLOOR_R, FLOOR_R * 0.965, PLINTH_H, 96, 1, true), wallMat);
    wall.position.y = FLOOR_Y - PLINTH_H / 2;
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(FLOOR_R, 0.012, 10, 160).rotateX(Math.PI / 2), metalMat);
    bezel.position.y = FLOOR_Y;
    const foot = new THREE.Mesh(new THREE.TorusGeometry(FLOOR_R * 0.965, 0.006, 6, 128).rotateX(Math.PI / 2), metalMat);
    foot.position.y = FLOOR_Y - PLINTH_H;
    pivot.add(floor, wall, bezel, foot);
    // engraved dial: two rings, 60 minute indices (every 5th longer) — rotation reads like a watch bezel
    const dial = [];
    [0.6, FLOOR_R * 0.9].forEach((r) => {
      for (let i = 0; i < 96; i++) {
        const a0 = (i / 96) * TAU, a1 = ((i + 1) / 96) * TAU;
        dial.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      }
    });
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU, r0 = FLOOR_R * (i % 5 ? 0.925 : 0.905), r1 = FLOOR_R * 0.965;
      dial.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1);
    }
    const polarMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false });
    const polarLines = new THREE.LineSegments(segmentsGeometry(dial), polarMat);
    polarLines.position.y = FLOOR_Y + 0.0015;
    polarLines.renderOrder = -4;
    pivot.add(polarLines);
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
    const shadow = new THREE.Mesh(geoPlane, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = FLOOR_Y + 0.003;
    shadow.renderOrder = -3;
    const plinthShadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    const plinthShadow = new THREE.Mesh(geoPlane, plinthShadowMat);
    plinthShadow.rotation.x = -Math.PI / 2;
    plinthShadow.position.y = FLOOR_Y - PLINTH_H - 0.004;
    plinthShadow.scale.set(FLOOR_R * 3.1, FLOOR_R * 3.1, 1);
    plinthShadow.renderOrder = -8;
    pivot.add(shadow, plinthShadow);
    const reflectRoot = new THREE.Group(); // mirrored about the floor plane; clipped to the disc in the shader
    reflectRoot.scale.y = -1;
    reflectRoot.position.y = 2 * FLOOR_Y;
    pivot.add(reflectRoot);

    const tower = new THREE.Group();
    pivot.add(tower);

    // champagne spindle with a finial (the beads spiral down it), a collar on the plinth, washers between tiers
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(SPINDLE_R, SPINDLE_R, 1, 20), metalMat);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.042, 28, 18), metalMat);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.092, 0.05, 48), metalMat);
    collar.position.y = FLOOR_Y + 0.025;
    const finialGlowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, toneMapped: false });
    const finialGlow = new THREE.Sprite(finialGlowMat);
    finialGlow.renderOrder = 6;
    tower.add(spindle, finial, collar, finialGlow);
    const washerMat = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.28, envMapIntensity: 1.35 });
    const MAX_W = 24;
    const washers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.058, 0.058, 0.012, 32), washerMat, MAX_W);
    washers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    washers.frustumCulled = false;
    washers.count = 0;
    tower.add(washers);

    // glossy flow beads — one InstancedMesh, shrink-to-fade
    const beadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.14, metalness: 0.25, envMapIntensity: 1.5 });
    const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), beadMat, MAX_P);
    beads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3);
    beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    beads.instanceColor.setUsage(THREE.DynamicDrawUsage);
    beads.frustumCulled = false;
    beads.count = 0;
    pivot.add(beads);

    // slow dust in three depth layers (scene space, so drags rotate the tower through it)
    const dustRoot = new THREE.Group();
    scene.add(dustRoot);
    const dust = addDust(dustRoot, [
      { count: 120, spread: [5.6, 3.2, 1.6], center: [0, 0, -2.0], size: 0.011, opacity: 0.5, drift: 0.04 },
      { count: 80, spread: [3.4, 2.8, 2.2], center: [0, 0, 0], size: 0.013, opacity: 0.5, drift: 0.05 },
      { count: 30, spread: [3.2, 2.4, 1.0], center: [0, 0, 2.3], size: 0.016, opacity: 0.32, drift: 0.06 },
    ]);

    // particle state: 0 dead · 1 falling down the spindle · 2 rolling to the rim · 3 airborne · 4 fading on the floor
    const pSt = new Uint8Array(MAX_P), pKind = new Uint8Array(MAX_P), pTier = new Int16Array(MAX_P), pBounce = new Uint8Array(MAX_P);
    const pX = new Float32Array(MAX_P), pY = new Float32Array(MAX_P), pZ = new Float32Array(MAX_P);
    const pVx = new Float32Array(MAX_P), pVy = new Float32Array(MAX_P), pVz = new Float32Array(MAX_P);
    const pAng = new Float32Array(MAX_P), pRad = new Float32Array(MAX_P), pSpd = new Float32Array(MAX_P), pAge = new Float32Array(MAX_P), pR = new Float32Array(MAX_P);
    const palette = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
    let dropCols = DROP.map((d) => d.color);
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
    let exitP = [];
    const tmp = new THREE.Vector3();
    const right = new THREE.Vector3();
    const P = { x: 0, y: 0, ok: true };
    const P2 = { x: 0, y: 0, ok: true };
    const screen = [];
    const cA = new THREE.Color(), cB = new THREE.Color();

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
    /** Fake crystal (premium-3d.md rec. 9): transparent clearcoat, near-black body, jewel-ink emissive, fresnel rim. */
    function crystalMat(side, uR) {
      return shade(new THREE.MeshPhysicalMaterial({
        color: 0x000000, emissive: 0x000000, emissiveIntensity: 0.16, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03,
        transparent: true, opacity: 0.28, side, depthWrite: false, envMapIntensity: 1.7,
      }), { uR, rim: { power: 6, k: 0.9, alpha: 0.35 }, key: 'tier' });
    }
    function bezelMat(uR) {
      return shade(new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.22, envMapIntensity: 1.5 }), { uR, key: 'bezel' });
    }
    const FY = FLOOR_Y.toFixed(4), FR = (FLOOR_R * 0.985).toFixed(4);
    /** Mirror image under the lacquer: fades with depth and is clipped to what is seen THROUGH the plinth top. */
    function reflMat(uR) {
      return shade(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }), {
        uR, key: 'refl',
        extra: (sh) => {
          sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' +
            '\t{ float dep = ' + FY + ' - vWP.y; diffuseColor.a *= clamp(1.0 - dep / 0.5, 0.0, 1.0);\n' +
            '\t  vec3 rd = vWP - cameraPosition; float ry = abs(rd.y) > 1e-4 ? rd.y : -1e-4;\n' +
            '\t  vec2 hit = cameraPosition.xz + rd.xz * ((' + FY + ' - cameraPosition.y) / ry);\n' +
            '\t  if (dot(hit, hit) > ' + FR + ' * ' + FR + ') discard; }');
        },
      });
    }
    /** Theme + ink → tier materials (body, rim, bezel, glow, reflection). */
    function colorTier(T) {
      const dark = S.dark, P = S.pal;
      const ink = T.col;
      const champ = lin(P.metal, cA);
      const [backM, frontM, bezM, glowM, reflM] = T.mats;
      [backM, frontM].forEach((m, k) => {
        m.color.copy(ink).multiplyScalar(dark ? 0.04 : 0.85);
        m.emissive.copy(ink);
        m.envMapIntensity = (dark ? 0.55 : 0.7) * (k ? 1 : 0.45);
        m.roughness = dark ? 0.06 : 0.1;
        m.userData.cb.uRim.value.copy(ink).lerp(champ, dark ? 0.3 : 0.3);
        m.userData.cb.uRimA.value = dark ? 0.22 : 0.45;
        crystalBlend(m, dark);
      });
      bezM.color.copy(champ).lerp(ink, 0.1);
      glowM.color.copy(lin(P.glow, cB)).lerp(ink, dark ? 0.3 : 0.55);
      glowM.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      reflM.color.copy(ink);
    }

    function rebuild(animate) {
      tiers.forEach(disposeTier);
      tiers = [];
      const n = stages.length;
      H = stackHeight(n);
      const max = stages.reduce((m, s) => Math.max(m, s.count), 0);
      const t0 = nowMs();
      const shells = S.quality.shells !== false;
      stages.forEach((s, i) => {
        const col = lin(s.color);
        const r = radiusFor(s.count, max);
        const uR = { value: r };
        const backMat = crystalMat(THREE.BackSide, uR);
        const frontMat = crystalMat(THREE.FrontSide, uR);
        const bzMat = bezelMat(uR);
        const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
        const rMat = reflMat(uR);
        const group = new THREE.Group();
        const back = new THREE.Mesh(geoTier, backMat);
        back.renderOrder = 1;
        back.visible = shells;
        const front = new THREE.Mesh(geoTier, frontMat);
        front.renderOrder = 3;
        const ringTop = new THREE.Mesh(geoRing, bzMat);
        ringTop.position.y = TIER_H / 2 - FILLET;
        const ringBot = new THREE.Mesh(geoRing, bzMat);
        ringBot.position.y = -(TIER_H / 2 - FILLET);
        const glow = new THREE.Sprite(glowMat);
        glow.renderOrder = 2;
        group.add(back, front, ringTop, ringBot, glow);
        group.position.y = tierY(i);
        tower.add(group);
        const refl = new THREE.Mesh(geoTier, rMat);
        refl.renderOrder = -5;
        reflectRoot.add(refl);

        const chip = makeLabel(labelLayer, 'cb3d-chip is-pick', chipHTML(i));
        chip.el.setAttribute('role', 'button');
        chip.el.setAttribute('tabindex', '0');
        const lead = el('div', 'cb3d-lead', labelLayer);
        const T = {
          key: s.key, index: i, col, group, back, front, glow, refl, chip, lead, uR,
          mats: [backMat, frontMat, bzMat, glowMat, rMat],
          rFrom: r, rTo: r, rNow: r, tStart: t0, glowK: max > 0 ? Math.sqrt(s.count / max) : 0,
          appear: animate && !S.reduced ? 0 : 1, appearDelay: 160 + i * 70, hv: 0, empty: s.count === 0,
        };
        colorTier(T);
        bindChip(T);
        tiers.push(T);
      });
      S.appearStart = 0; // entrance clock starts on the first rendered frame
      resetParticles();
      tiers.forEach((t) => measure(t.chip));
      const top = H + 0.3;
      spindle.scale.y = top - FLOOR_Y;
      spindle.position.y = (top + FLOOR_Y) / 2;
      finial.position.y = top + 0.03;
      finialGlow.position.y = top + 0.03;
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
          pRad[i] = STREAM_R + (Math.random() - 0.5) * 0.008;
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
              pRad[i] = STREAM_R + PR_DROP;
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
      const t = S.theme, P = S.pal, dark = S.dark;
      lin(P.lacquer, floorMat.color);
      lin(P.lacquer, wallMat.color);
      floorMat.envMapIntensity = dark ? 0.28 : 0.4;
      floorMat.roughness = dark ? 0.3 : 0.34;
      floorMat.clearcoat = dark ? 0.6 : 0.5;
      wallMat.envMapIntensity = dark ? 0.7 : 0.6;
      lin(P.metal, metalMat.color);
      lin(P.metal, washerMat.color);
      lin(P.engrave, polarMat.color);
      polarMat.opacity = dark ? 0.24 : 0.34;
      shadowMat.opacity = dark ? 0.6 : 0.22;
      plinthShadowMat.opacity = dark ? 0.7 : 0.34;
      lin(P.glow, finialGlowMat.color);
      finialGlowMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      dropCols = [0, 1, 2].map(dropColor);
      lin(P.bead, palette[0]);
      for (let k = 0; k < 3; k++) lin(dropCols[k], palette[k + 1]);
      lin(t.muted, palette[4]);
      tiers.forEach(colorTier);
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
    S.hooks.ambient = () => true; // beads, dust and glow breathe at ≤ 30 fps for 4 s after input, then the frame holds
    S.hooks.quality = (q) => {
      tiers.forEach((T) => { T.back.visible = q.shells !== false; });
      finialGlow.visible = q.glow !== false;
    };
    S.hooks.first = (t) => {
      S.appearStart = t;
      if (!S.reduced) S.flyTo({ zoom: 1 }, 1400, 'out'); // 8 % dolly-in under the hub's 600 ms cross-fade
      S.busy(1800);
    };

    const wq = new THREE.Quaternion(), wv = new THREE.Vector3(), ws = new THREE.Vector3(), wm = new THREE.Matrix4();
    S.hooks.frame = (dt, t) => {
      let active = false;
      if (!S.appearStart) S.appearStart = t;
      const dark = S.dark;
      const breathe = S.reduced ? 0 : Math.sin((t / 1000) * TAU * 0.25);
      const glowOn = S.quality.glow !== false;
      let maxR = 0, nW = 0;
      for (const T of tiers) {
        if (T.appear < 1) {
          T.appear = S.reduced ? 1 : clamp((t - S.appearStart - T.appearDelay) / 620, 0, 1);
          active = true;
        }
        if (T.rNow !== T.rTo) {
          const k = S.reduced ? 1 : (t - T.tStart) / 650;
          T.rNow = k >= 1 ? T.rTo : lerp(T.rFrom, T.rTo, easeOut(k));
          active = true;
        }
        const hvT = T.index === hot ? 1 : 0;
        if (T.hv !== hvT) {
          T.hv = S.reduced || Math.abs(hvT - T.hv) < 0.01 ? hvT : lerp(T.hv, hvT, 1 - Math.exp(-dt * 14));
          active = true;
        }
        const e = easeOut(T.appear);
        const hs = 1 + 0.035 * T.hv;
        const sxz = (0.55 + 0.45 * e) * hs;
        T.uR.value = T.rNow;
        T.group.scale.set(sxz, Math.max(0.001, e) * hs, sxz);
        T.group.position.y = tierY(T.index) - (1 - e) * 0.35;
        T.refl.position.copy(T.group.position);
        T.refl.scale.copy(T.group.scale);
        const glass = T.empty ? 0.45 : 1;
        const base = dark ? 0.22 : 0.42;
        const [backM, frontM, , glowM, reflM] = T.mats;
        frontM.opacity = base * e * glass;
        backM.opacity = base * 0.55 * e * glass;
        const em = ((dark ? 0.24 : 0.1) + 0.4 * T.hv) * glass;
        frontM.emissiveIntensity = em;
        backM.emissiveIntensity = em * 0.8;
        frontM.userData.cb.uRimK.value = (dark ? 1.0 : 0.8) + 0.9 * T.hv;
        glowM.opacity = T.empty || !glowOn ? 0 : (dark ? 0.28 : 0.12) * e * (0.9 + 0.1 * breathe) * (1 + 0.6 * T.hv);
        T.glow.scale.setScalar((0.25 + 0.6 * T.glowK) * T.rNow * e + 0.0001);
        reflM.opacity = (dark ? 0.2 : 0.14) * e * glass;
        // champagne washers above and below each tier, threaded on the spindle
        if (nW + 2 <= MAX_W) {
          const hy = (TIER_H / 2) * T.group.scale.y + 0.006;
          ws.set(e, 1, e);
          for (let s = -1; s <= 1; s += 2) {
            wv.set(0, T.group.position.y + s * hy, 0);
            wm.compose(wv, wq, ws);
            washers.setMatrixAt(nW++, wm);
          }
        }
        maxR = Math.max(maxR, T.rNow * sxz);
      }
      washers.count = nW;
      washers.instanceMatrix.needsUpdate = true;
      const sr = Math.max(0.5, maxR) * 2.3;
      shadow.scale.set(sr, sr, 1);
      const fg = (S.reduced ? 1 : 0.92 + 0.08 * breathe) * (dark ? 0.55 : 0.22);
      finialGlowMat.opacity = fg;
      finialGlow.scale.setScalar(0.42);
      dustRoot.position.copy(S.target);
      const focus = S.baseDist * S.zoom;
      for (let i = 0; i < dust.length; i++) { const u = dust[i].material.uniforms; if (u && u.uFocus) u.uFocus.value = focus; }
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
      legend.innerHTML = total ? DROP.map((d, k) => (drops[k] ? '<span><span class="cb3d-dot" style="background:' + esc(dropCols[k]) + '"></span>' + drops[k] + ' ' + d.label + '</span>' : '')).join('') : '';
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
          T.col = lin(s.color);
          T.chip.el.innerHTML = chipHTML(i);
          measure(T.chip);
        });
        if (hot >= 0) S.showTip(tipHTML(hot));
        S.busy(800);
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
      S.zoom = S.zoomT = 1.08; // the dolly-in starts from here on the first rendered frame
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
    let S;
    try {
      S = createStage(container, {
        fov: 32, yaw: 0.5, pitch: 0.4, minPitch: 0.02, maxPitch: 1.35, pitchGain: 0.8,
        auto: 'sway', swayAmp: 0.36, swayW: TAU / 26, zoomMin: 0.45, zoomMax: 1.8,
        theme: opts.theme, autoDelay: 600, touchAction: 'none',
        name: 'Opportunity Space', label: 'Opportunity space', fogK: 0.32, parallax: 3.5,
      });
    } catch (e) {
      console.warn('[Viz3D] 3D view unavailable:', e && e.message);
      return null;
    }
    S.autoOn = false; // auto-orbit is an explicit choice (toolbar): idle stays at 0 fps
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
    const G = GLH();
    let onPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    let onOpen = typeof opts.onOpen === 'function' ? opts.onOpen : null;
    let onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;
    addLights(scene);
    const X = (v) => clamp(v, 0, 100) / 100 - 0.5;
    const YAW0 = S.yaw, PITCH_0 = S.pitch;
    const glowTex = G.glowTexture ? G.glowTexture() : null;
    const shadowTex = G.contactShadowTexture ? G.contactShadowTexture() : null;
    const geoPlane = new THREE.PlaneGeometry(1, 1);

    // the vitrine floor: black-lacquer plate with a champagne edge, engraved grid, hairline frame, axes
    const PLATE_T = 0.03;
    const plateMat = new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, PLATE_T, 1.1), plateMat);
    plate.position.y = -0.5 - PLATE_T / 2 - 0.002;
    pivot.add(plate);
    const pe = 0.55, py = -0.5 - 0.0015;
    const plateEdgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false });
    const plateEdge = new THREE.LineLoop(segmentsGeometry([-pe, py, -pe, pe, py, -pe, pe, py, pe, -pe, py, pe]), plateEdgeMat);
    plateEdge.renderOrder = -2;
    pivot.add(plateEdge);
    const g = [];
    for (let i = 0; i <= 10; i++) {
      const v = i / 10 - 0.5;
      g.push(v, -0.5, -0.5, v, -0.5, 0.5, -0.5, -0.5, v, 0.5, -0.5, v);
    }
    const gridMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
    const grid = new THREE.LineSegments(segmentsGeometry(g), gridMat);
    grid.renderOrder = -2;
    pivot.add(grid);
    const edges = [
      0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
    ];
    const boxMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
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
    const axisMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
    const axes = new THREE.LineSegments(segmentsGeometry(ax), axisMat);
    axes.renderOrder = -1;
    pivot.add(axes);
    // contact shadows: under the cloud on the plate, and under the plate itself
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
    const cshadow = new THREE.Mesh(geoPlane, shadowMat);
    cshadow.rotation.x = -Math.PI / 2;
    cshadow.scale.set(1.5, 1.5, 1);
    cshadow.position.y = -0.4985;
    cshadow.renderOrder = -2.5;
    const plateShadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
    const plateShadow = new THREE.Mesh(geoPlane, plateShadowMat);
    plateShadow.rotation.x = -Math.PI / 2;
    plateShadow.scale.set(2.2, 2.2, 1);
    plateShadow.position.y = -0.5 - PLATE_T - 0.012;
    plateShadow.renderOrder = -8;
    pivot.add(cshadow, plateShadow);

    // context: cutoff plane, recruiter-review plane, "apply now" corner volume (champagne, engraved edges)
    const mkPlane = () => {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const m = new THREE.Mesh(geoPlane, mat);
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

    // points: jewel-ink clearcoat spheres (one InstancedMesh, setColorAt) with a faint champagne rim
    const geoSphere = new THREE.SphereGeometry(1, 24, 16);
    const geoOct = new THREE.OctahedronGeometry(1, 0);
    const glowU = { value: 0.12 };
    const pointMat = shade(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25 }), {
      rim: { power: 3, k: 0.3, alpha: 0 }, key: 'pt',
      extra: (sh) => {
        sh.uniforms.uGlow = glowU;
        sh.fragmentShader = 'uniform float uGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uGlow;');
      },
    });
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
    // halos: selected (pulsing gold ring + glow), highlighted (fg ring), hovered (thin fg ring)
    const ringGeo = new THREE.RingGeometry(0.86, 1, 64);
    const selMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const selRing = new THREE.Mesh(ringGeo, selMat);
    selRing.renderOrder = 20;
    selRing.visible = false;
    const hlMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const hlRing = new THREE.Mesh(ringGeo, hlMat);
    hlRing.renderOrder = 19;
    hlRing.visible = false;
    const hoverMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.75, depthTest: false, depthWrite: false, toneMapped: false });
    const hoverRing = new THREE.LineLoop(circleGeometry(48, 'xy'), hoverMat);
    hoverRing.renderOrder = 18;
    hoverRing.visible = false;
    const selGlowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, toneMapped: false });
    const selGlow = new THREE.Sprite(selGlowMat);
    selGlow.renderOrder = 17;
    selGlow.visible = false;
    scene.add(selRing, hlRing, hoverRing, selGlow);

    // slow dust in three depth layers around the vitrine
    const dust = addDust(scene, [
      { count: 110, spread: [3.6, 2.2, 1.2], center: [0, 0, -1.5], size: 0.007, opacity: 0.5, drift: 0.03 },
      { count: 70, spread: [1.8, 1.4, 1.8], center: [0, 0, 0], size: 0.008, opacity: 0.5, drift: 0.035 },
      { count: 24, spread: [2.2, 1.5, 0.7], center: [0, 0, 1.45], size: 0.01, opacity: 0.3, drift: 0.04 },
    ]);

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
      S.setAuto(!S.autoOn);
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
      const t = S.theme, P = S.pal, dark = S.dark;
      lin(P.lacquer, plateMat.color);
      plateMat.envMapIntensity = dark ? 0.28 : 0.4;
      plateMat.roughness = dark ? 0.3 : 0.34;
      plateMat.clearcoat = dark ? 0.6 : 0.5;
      lin(P.engrave, plateEdgeMat.color);
      plateEdgeMat.opacity = dark ? 0.55 : 0.6;
      lin(P.engrave, gridMat.color);
      gridMat.opacity = dark ? 0.2 : 0.26;
      lin(P.engrave, boxMat.color);
      boxMat.opacity = dark ? 0.26 : 0.32;
      lin(t.muted, axisMat.color);
      axisMat.opacity = dark ? 0.8 : 0.85;
      lin(t.muted, cutPlane.mat.color);
      lin(t.muted, cutPlane.eMat.color);
      cutPlane.mat.opacity = dark ? 0.06 : 0.05;
      cutPlane.eMat.opacity = dark ? 0.45 : 0.5;
      lin(P.metal, revPlane.mat.color);
      lin(P.metal, revPlane.eMat.color);
      revPlane.mat.opacity = dark ? 0.085 : 0.09;
      revPlane.eMat.opacity = dark ? 0.6 : 0.7;
      lin(P.metal, zoneMat.color);
      lin(P.metal, zoneEdgeMat.color);
      zoneMat.opacity = dark ? 0.045 : 0.06;
      zoneEdgeMat.opacity = dark ? 0.3 : 0.38;
      lin(t.accent, selMat.color);
      lin(P.glow, selGlowMat.color);
      selGlowMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      lin(t.fg, hlMat.color);
      lin(t.fg, hoverMat.color);
      shadowMat.opacity = dark ? 0.5 : 0.22;
      plateShadowMat.opacity = dark ? 0.65 : 0.3;
      dropMat.opacity = (dark ? 0.5 : 0.42) * clamp(Math.sqrt(60 / Math.max(1, pts.length)), 0.4, 1);
      glowU.value = dark ? 0.14 : 0.03;
      lin(P.rim, pointMat.userData.cb.uRim.value);
      pointMat.userData.cb.uRimK.value = dark ? 0.32 : 0.12;
      KNOCK_COLOR = cssVar('--st-rejected') || KNOCK_COLOR;
      lin(KNOCK_COLOR, knockMat.color);
      if (meshN && pts.length) applyColors();
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
    S.hooks.ambient = () => true; // dust drift + knockout spin at ≤ 30 fps for 4 s after input
    S.hooks.first = (t) => {
      appearStart = t;
      if (!S.reduced) S.flyTo({ zoom: 1 }, 1400, 'out'); // 8 % dolly-in under the hub's cross-fade
      S.busy(1800);
    };

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
      const wave = S.reduced ? 0.5 : 0.5 + 0.5 * Math.sin((t / 1000) * 4.4);
      const pulse = S.reduced ? 1 : 1 + 0.12 * Math.sin((t / 1000) * 4.4);
      place(selRing, sel, 2.0 * pulse);
      selMat.opacity = S.reduced ? 0.9 : 0.62 + 0.3 * wave;
      place(selGlow, sel, 7.5);
      selGlowMat.opacity = (S.dark ? 0.42 : 0.2) * (0.85 + 0.15 * wave) * (S.quality.glow === false ? 0 : 1);
      place(hlRing, hl, 1.85);
      place(hoverRing, hot !== sel ? hot : -1, 1.6);
      const focus = S.baseDist * S.zoom;
      for (let i = 0; i < dust.length; i++) { const u = dust[i].material.uniforms; if (u && u.uFocus) u.uFocus.value = focus; }
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
    if (!S.reduced) S.zoom = S.zoomT = 1.08; // the dolly-in starts from here on the first rendered frame
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

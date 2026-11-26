/* Callback v3 — "Cal", the mascot.  Owner: mascot.  Contract: docs/BUILD.md §2 (one WebGL context: CB.GL).
 *
 * A luxury collectible rendered on the shared GL hub. Dark theme: the IVORY edition (glazed ivory ceramic, champagne
 * metal trim) — it glows against obsidian. Light theme: the OBSIDIAN edition (black lacquer, champagne trim) — it
 * reads crisply on ivory. Both: a domed obsidian visor with gold-ink eyes painted onto the curved glass plus glow
 * sprites, a champagne bezel, fine panel seams, a refined headset with a champagne mic tip, a monoline "C" seal on
 * the chest and a soft contact shadow.
 *
 * This file never creates a WebGLRenderer, a PMREMGenerator or a probe context. It makes ONE CB.GL.view on a host
 * inside `container`; the caller moves `container` between the dock and the panel stage and the same Cal follows
 * (the hub's ResizeObserver re-sizes the view, onResize re-frames the camera).
 *
 * API  CB.Mascot.available() → boolean (CB.GL.available(): false in Safe Mode / without WebGL)
 *      CB.Mascot.create(container, {onClick}) → {setState(name, ms?), state, canvas, mode, view, destroy()}
 *        states: idle · happy · thinking · talking · concerned · wave · listening · sleep  (unknown → idle)
 *        setState(s) sets the resting state; setState(s, ms) plays s for ms, then returns to the resting state.
 *        canvas → the element showing Cal (the hub's 2D canvas in 3D, the <svg> in 2D). mode → '3d' | '2d'.
 *
 * Pacing (layered on the hub, which renders this view only when invalidated): 30 fps for 4 s after any input or
 * state change; then the dock (host < 120 CSS px) drops to 0 fps and the panel breathes at a slow 10 fps (blinks
 * play at 30 fps). Talking keeps 30 fps (24 in the dock), thinking 20 fps. Paused off-screen / hidden.
 * prefers-reduced-motion: no bob, no breathing, no blinks — one frame per change.
 * The dock renders at ≤ 1.5 device px per CSS px (the GL host is laid out smaller and CSS-scaled up).
 *
 * Safe Mode / no WebGL / a failed view: a hand-drawn 2D SVG Cal with the same expressions; it switches back to 3D
 * by itself when CB.GL leaves Safe Mode. The SVG also covers the first frames while shaders compile.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});

  const STATES = ['idle', 'happy', 'thinking', 'talking', 'concerned', 'wave', 'listening', 'sleep'];
  const SMALL = 120;      // CSS px: a host narrower than this is the dock
  const DOCK_DPR = 1.5;   // device px per CSS px in the dock
  const AMBIENT_MS = 4000;
  const GLH = () => (CB.GL && typeof CB.GL.view === 'function' ? CB.GL : null);
  const now = () => (window.performance && performance.now ? performance.now() : Date.now());
  const mq = (q) => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  function reduced() {
    const G = GLH();
    try { if (G && G.reducedMotion) return !!G.reducedMotion(); } catch (e) { /* noop */ }
    return mq('(prefers-reduced-motion: reduce)');
  }
  function themeName() {
    const G = GLH();
    try { if (G && G.theme) return G.theme() === 'light' ? 'light' : 'dark'; } catch (e) { /* noop */ }
    const a = document.documentElement.getAttribute('data-theme');
    if (a === 'light' || a === 'dark') return a;
    return mq('(prefers-color-scheme: light)') ? 'light' : 'dark';
  }
  function available() {
    const G = GLH();
    try { return !!(G && G.available()); } catch (e) { return false; }
  }
  function report(e, where) {
    try { if (CB.reportError) CB.reportError(e, { where: 'mascot:' + where, silent: true }); else console.warn('[Cal]', where, e); } catch (x) { /* noop */ }
  }

  // ───────────────────────── CSS ─────────────────────────
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return;
    cssDone = true;
    const css = [
      '.cal-m{position:relative;display:block;width:100%;height:100%;cursor:pointer;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
      '.cal-m-gl{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:0 0;opacity:0;transition:opacity 420ms cubic-bezier(.2,.7,.2,1)}',
      '.cal-m-gl>.cbgl-poster{display:none!important}',
      '.cal-m-svg{position:absolute;inset:0;opacity:1;transition:opacity 420ms cubic-bezier(.2,.7,.2,1);pointer-events:none}',
      '.cal-m-svg svg{display:block;width:100%;height:100%;overflow:visible}',
      '.cal-m.is-live .cal-m-gl{opacity:1}',
      '.cal-m.is-live .cal-m-svg{opacity:0}',
      '.cal-m.is-2d .cal-m-gl{display:none}',
      // 2D Cal: poses + micro-motion (CSS only; nothing loops while idle)
      '.cal-m .cm-pose,.cal-m .cm-tilt,.cal-m .cm-look,.cal-m .cm-eye{transform-box:fill-box;transition:transform 260ms cubic-bezier(.2,.7,.2,1)}',
      '.cal-m .cm-tilt{transform-origin:50% 60%}',
      '.cal-m .cm-eye{transform-origin:50% 50%;transition-duration:90ms}',
      '.cal-m.cm-blink .cm-eye{transform:scaleY(.1)}',
      '.cal-m .cm-hand-l{transform-origin:50% 0%}.cal-m .cm-hand-r{transform-origin:50% 100%}',
      '.cal-m[data-state="happy"] .cm-hand-l{transform:translate(-2px,-9px) rotate(-14deg)}',
      '.cal-m[data-state="happy"] .cm-hand-r{transform:translate(2px,-9px) rotate(14deg)}',
      '.cal-m[data-state="wave"] .cm-hand-r{transform:translate(3px,-31px) rotate(10deg);animation:cm-wave .56s ease-in-out infinite}',
      '.cal-m[data-state="thinking"] .cm-hand-r{transform:translate(-17px,-27px)}',
      '.cal-m[data-state="thinking"] .cm-tilt{transform:rotate(5deg)}',
      '.cal-m[data-state="listening"] .cm-tilt{transform:rotate(-4deg)}',
      '.cal-m[data-state="concerned"] .cm-tilt{transform:translateY(1.5px) rotate(-2deg)}',
      '.cal-m[data-state="concerned"] .cm-hand-l{transform:translate(9px,3px)}.cal-m[data-state="concerned"] .cm-hand-r{transform:translate(-9px,3px)}',
      '.cal-m[data-state="sleep"] .cm-tilt{transform:translateY(2px) rotate(6deg)}',
      '.cal-m[data-state="sleep"] .cm-ink{opacity:.55}',
      '.cal-m .cm-bar{transform-box:fill-box;transform-origin:50% 50%}',
      '.cal-m[data-state="talking"] .cm-bar{animation:cm-bar .46s ease-in-out infinite}',
      '.cal-m[data-state="listening"] .cm-bar{animation:cm-bar 1.3s ease-in-out infinite;transform:scaleY(.45)}',
      '.cal-m .cm-bar:nth-child(2){animation-delay:-.13s}.cal-m .cm-bar:nth-child(3){animation-delay:-.29s}.cal-m .cm-bar:nth-child(4){animation-delay:-.07s}.cal-m .cm-bar:nth-child(5){animation-delay:-.21s}',
      '.cal-m[data-state="thinking"] .cm-dot{animation:cm-dot 1.05s ease-in-out infinite}',
      '.cal-m .cm-dot:nth-child(2){animation-delay:.18s}.cal-m .cm-dot:nth-child(3){animation-delay:.36s}',
      '.cal-m[data-state="talking"] .cm-mic-glow,.cal-m[data-state="listening"] .cm-mic-glow{opacity:1}',
      '.cal-m .cm-mic-glow{opacity:0;transition:opacity 300ms}',
      '@keyframes cm-wave{0%,100%{transform:translate(3px,-31px) rotate(-10deg)}50%{transform:translate(3px,-31px) rotate(16deg)}}',
      '@keyframes cm-bar{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}',
      '@keyframes cm-dot{0%,100%{opacity:.25}50%{opacity:1}}',
      '@media (prefers-reduced-motion: reduce){.cal-m *{animation:none!important;transition:none!important}.cal-m-gl,.cal-m-svg{transition:none!important}}',
    ].join('\n');
    try {
      if (typeof CB.css === 'function') CB.css('mascot', css);
      else { const s = document.createElement('style'); s.setAttribute('data-cb', 'mascot'); s.textContent = css; document.head.appendChild(s); }
    } catch (e) { report(e, 'css'); }
  }

  // ───────────────────────── 2D Cal (SVG) ─────────────────────────
  let uid = 0;
  const SHOW = {
    idle: ['open', 'smile'], happy: ['happy', 'grin', 'cheeks'], wave: ['wink', 'grin'], thinking: ['think', 'dots'],
    talking: ['open', 'bars'], listening: ['open', 'bars'], concerned: ['sad', 'frown'], sleep: ['sleep', 'zz'],
  };
  function buildSVG() {
    const id = 'calm' + (++uid);
    const u = (n) => `url(#${id}-${n})`;
    const M = u('metal');
    const wrap = document.createElement('div');
    wrap.className = 'cal-m-svg';
    wrap.setAttribute('aria-hidden', 'true');
    const eye = (x, y, w, h) => `<rect class="cm-eye" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${w / 2}"/>`;
    wrap.innerHTML = `<svg viewBox="0 0 120 140" preserveAspectRatio="xMidYMid meet" focusable="false">
<defs>
  <linearGradient id="${id}-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3E6C4"/><stop offset=".3" stop-color="#D9BC85"/><stop offset=".52" stop-color="#9E7C43"/><stop offset=".72" stop-color="#E6D1A2"/><stop offset="1" stop-color="#B8975A"/></linearGradient>
  <radialGradient id="${id}-ivory" cx=".36" cy=".28" r=".85"><stop offset="0" stop-color="#FFFDF8"/><stop offset=".48" stop-color="#ECE5D6"/><stop offset="1" stop-color="#C2B8A4"/></radialGradient>
  <radialGradient id="${id}-obs" cx=".36" cy=".28" r=".85"><stop offset="0" stop-color="#55555B"/><stop offset=".4" stop-color="#1C1C1F"/><stop offset="1" stop-color="#050506"/></radialGradient>
  <linearGradient id="${id}-visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2A2E"/><stop offset=".42" stop-color="#0B0B0D"/><stop offset="1" stop-color="#030304"/></linearGradient>
  <radialGradient id="${id}-shadow"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".6" stop-color="#000" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <radialGradient id="${id}-glow"><stop offset="0" stop-color="#EBD7A8" stop-opacity=".75"/><stop offset="1" stop-color="#EBD7A8" stop-opacity="0"/></radialGradient>
  <filter id="${id}-ink" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.25" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<ellipse class="cm-shadow" cx="60" cy="133.5" rx="25" ry="3.8" fill="${u('shadow')}"/>
<ellipse cx="60" cy="125.5" rx="11" ry="3" fill="${u('glow')}" opacity=".55"/>
<g class="cm-body">
  <g class="cm-pose cm-hand-l"><ellipse data-shell cx="31" cy="104" rx="5.8" ry="6.6"/><path d="M27.3 99.2 Q31 97.3 34.7 99.2" fill="none" stroke="${M}" stroke-width=".95" stroke-linecap="round"/></g>
  <rect x="53" y="75.5" width="14" height="7" rx="2.4" fill="#0E0F12"/>
  <path data-shell d="M60 80.2C77 80.2 84.5 91 84.5 101.6C84.5 112.6 75 120.6 60 120.6C45 120.6 35.5 112.6 35.5 101.6C35.5 91 43 80.2 60 80.2Z"/>
  <ellipse cx="51" cy="89" rx="9" ry="4" fill="#fff" class="cm-spec" opacity=".2" transform="rotate(-16 51 89)"/>
  <path d="M52.4 80.4Q60 83 67.6 80.4" fill="none" stroke="${M}" stroke-width=".9" stroke-linecap="round"/>
  <path data-seam d="M39.6 91.4Q60 96.4 80.4 91.4" fill="none" stroke-width=".5"/>
  <path d="M36.2 108.2Q60 114.6 83.8 108.2" fill="none" stroke="${M}" stroke-width="1.05"/>
  <circle cx="60" cy="98.6" r="5.7" fill="#0C0C0E" stroke="${M}" stroke-width=".75"/>
  <path d="M62.5 96.2A3.3 3.3 0 1 0 62.5 101" fill="none" stroke="${M}" stroke-width="1.2" stroke-linecap="round"/>
  <ellipse cx="60" cy="120.8" rx="7.4" ry="1.7" fill="none" stroke="${M}" stroke-width="1.1"/>
  <g class="cm-pose cm-hand-r"><ellipse data-shell cx="89" cy="104" rx="5.8" ry="6.6"/><path d="M85.3 99.2 Q89 97.3 92.7 99.2" fill="none" stroke="${M}" stroke-width=".95" stroke-linecap="round"/></g>
</g>
<g class="cm-tilt"><g class="cm-look">
  <path d="M71.2 19.5L75 9.2" stroke="${M}" stroke-width="1.15" stroke-linecap="round"/>
  <circle cx="75.5" cy="7.8" r="5.4" fill="${u('glow')}"/>
  <circle cx="75.5" cy="7.8" r="2.3" fill="#EAD39F"/>
  <path d="M20.2 49.5C19.4 13.2 100.6 13.2 99.8 49.5" fill="none" stroke="${M}" stroke-width="2.1"/>
  <ellipse data-shell cx="60" cy="47.5" rx="38.5" ry="31.5"/>
  <ellipse class="cm-spec" cx="44" cy="27.5" rx="13" ry="5.6" fill="#fff" opacity=".24" transform="rotate(-17 44 27.5)"/>
  <path data-seam d="M60 16.2V31.2" fill="none" stroke-width=".5"/>
  <path data-seam d="M25.4 63.4Q60 85.6 94.6 63.4" fill="none" stroke-width=".5"/>
  <rect data-shell x="15.2" y="37.6" width="10.6" height="24.4" rx="5.3"/>
  <rect x="13.4" y="40.4" width="5.2" height="18.8" rx="2.6" fill="#0E0F12" stroke="${M}" stroke-width=".85"/>
  <rect data-shell x="94.2" y="37.6" width="10.6" height="24.4" rx="5.3"/>
  <rect x="101.4" y="40.4" width="5.2" height="18.8" rx="2.6" fill="#0E0F12" stroke="${M}" stroke-width=".85"/>
  <rect x="28.6" y="32.2" width="62.8" height="30.6" rx="14.2" fill="${u('visor')}" stroke="${M}" stroke-width="1.15"/>
  <path d="M33.5 38.2Q60 31.4 86.5 38.2Q60 35.6 33.5 41.4Z" fill="#fff" opacity=".09"/>
  <g class="cm-face"><g class="cm-ink" filter="${u('ink')}" fill="#F1DCA8" stroke="#F1DCA8" stroke-linecap="round" stroke-linejoin="round">
    <g data-x="open" stroke="none">${eye(47, 46.5, 8, 13.5)}${eye(73, 46.5, 8, 13.5)}</g>
    <g data-x="happy" fill="none" stroke-width="2.6"><path d="M42.6 49Q47 42 51.4 49"/><path d="M68.6 49Q73 42 77.4 49"/></g>
    <g data-x="wink"><g stroke="none">${eye(47, 46.5, 8, 13.5)}</g><path fill="none" stroke-width="2.6" d="M68.6 49Q73 42 77.4 49"/></g>
    <g data-x="think" stroke="none">${eye(49.5, 44.5, 7.4, 11)}${eye(75.5, 44.5, 7.4, 11)}</g>
    <g data-x="sad" stroke="none">${eye(47, 47.5, 8, 12.5)}${eye(73, 47.5, 8, 12.5)}<path d="M41.5 39.2H53.2V45.6Z" fill="#0B0B0D" filter="none"/><path d="M78.5 39.2H66.8V45.6Z" fill="#0B0B0D" filter="none"/></g>
    <g data-x="sleep" fill="none" stroke-width="2.1"><path d="M43 46.8Q47 50.4 51 46.8"/><path d="M69 46.8Q73 50.4 77 46.8"/></g>
    <path data-x="smile" fill="none" stroke-width="1.55" d="M55.6 56.4Q60 59.4 64.4 56.4"/>
    <path data-x="grin" fill="none" stroke-width="1.75" d="M54.2 55.6Q60 61.2 65.8 55.6"/>
    <path data-x="frown" fill="none" stroke-width="1.55" d="M55.6 59.2Q60 56.2 64.4 59.2"/>
    <g data-x="bars" stroke="none"><rect class="cm-bar" x="53.3" y="55" width="1.7" height="5" rx=".85"/><rect class="cm-bar" x="56.4" y="54" width="1.7" height="7" rx=".85"/><rect class="cm-bar" x="59.15" y="53.4" width="1.7" height="8.2" rx=".85"/><rect class="cm-bar" x="61.9" y="54" width="1.7" height="7" rx=".85"/><rect class="cm-bar" x="65" y="55" width="1.7" height="5" rx=".85"/></g>
    <g data-x="dots" stroke="none"><circle class="cm-dot" cx="55.4" cy="57.6" r="1.35"/><circle class="cm-dot" cx="60" cy="57.6" r="1.35"/><circle class="cm-dot" cx="64.6" cy="57.6" r="1.35"/></g>
    <g data-x="cheeks" stroke="none" fill="#E9B48C" opacity=".55"><ellipse cx="38.6" cy="54.6" rx="3.2" ry="1.6"/><ellipse cx="81.4" cy="54.6" rx="3.2" ry="1.6"/></g>
  </g></g>
  <path d="M20.4 56.6C21.4 64.8 29.6 69.2 40.4 68.2" fill="none" stroke="${M}" stroke-width="1.5" stroke-linecap="round"/>
  <circle class="cm-mic-glow" cx="42.4" cy="68" r="5" fill="${u('glow')}"/>
  <circle cx="42.4" cy="68" r="2.25" fill="${M}"/>
  <g data-x="zz" fill="none" stroke="#E3C58A" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"><path d="M84.5 23.5h4.2l-4.2 4.6h4.2"/><path d="M91.4 15.6h3.1l-3.1 3.4h3.1"/></g>
</g></g>
</svg>`;
    const svg = wrap.firstElementChild;
    const parts = {
      wrap, svg, id,
      shells: Array.prototype.slice.call(svg.querySelectorAll('[data-shell]')),
      seams: Array.prototype.slice.call(svg.querySelectorAll('[data-seam]')),
      specs: Array.prototype.slice.call(svg.querySelectorAll('.cm-spec')),
      xs: Array.prototype.slice.call(svg.querySelectorAll('[data-x]')),
      look: svg.querySelector('.cm-look'),
      face: svg.querySelector('.cm-face'),
      shadow: svg.querySelector('.cm-shadow'),
    };
    parts.theme = (th) => {
      const light = th === 'light';
      parts.shells.forEach((el) => el.setAttribute('fill', u(light ? 'obs' : 'ivory')));
      parts.seams.forEach((el) => el.setAttribute('stroke', light ? '#B8975A' : '#A69B88'));
      parts.specs.forEach((el) => el.setAttribute('opacity', light ? '.12' : '.24'));
      parts.shadow.setAttribute('opacity', light ? '.6' : '1');
    };
    parts.state = (s) => {
      const show = SHOW[s] || SHOW.idle;
      parts.xs.forEach((el) => { el.style.display = show.indexOf(el.getAttribute('data-x')) >= 0 ? '' : 'none'; });
    };
    parts.lookAt = (x, y) => {
      parts.look.style.transform = `translate(${(x * 1.4).toFixed(2)}px,${(-y * 0.9).toFixed(2)}px)`;
      parts.face.style.transform = `translate(${(x * 2.6).toFixed(2)}px,${(-y * 1.7).toFixed(2)}px)`;
    };
    return parts;
  }

  // ───────────────────────── 3D Cal (CB.GL view) ─────────────────────────
  const PAL = {
    // Ivory edition, for obsidian pages.
    dark: { shell: '#EAE3D3', rough: 0.36, coat: 0.07, env: 0.9, seam: '#6F6555', seamMetal: 0, seamRough: 0.62,
      metal: '#DDBE82', under: 0.5, shadow: 0.62, eyeGlow: 0.85, exposure: 1.0 },
    // Obsidian edition, for ivory pages.
    light: { shell: '#151517', rough: 0.22, coat: 0.04, env: 1.2, seam: '#CDAE72', seamMetal: 1, seamRough: 0.3,
      metal: '#D6B677', under: 0.22, shadow: 0.36, eyeGlow: 0.8, exposure: 1.06 },
  };
  // Visor: a squircle patch on the head ellipsoid, in (azimuth, elevation) parameter space.
  const HR = 0.6, HS = [1.12, 0.93, 1.0];
  const VA = 0.9, VB = 0.47, VE = -0.03, VN = 3.6;
  const FACE_V = 224 / 256; // the face is drawn in a 512×224 band of a 512×256 (power-of-two) canvas

  function build3D(G, root, host, F, look, onFirst) {
    const T = G.THREE;
    if (!T) throw new Error('THREE missing');
    const C = (h) => G.color(h);
    const kit = G.kit || {};
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(30, 1, 0.1, 60);
    let th = themeName();
    scene.environment = G.env(th) || null;
    if (kit.lights) kit.lights(scene, { intensity: 1 });
    else {
      scene.add(new T.HemisphereLight(0xffffff, C('#2a2f38'), 0.3));
      const k = new T.DirectionalLight(0xffffff, 0.6); k.position.set(-3, 4, 5); scene.add(k);
    }
    const front = new T.DirectionalLight(C('#FFF4E2'), 0.22); // soft frontal fill for the face
    front.position.set(1.5, 1, 6);
    scene.add(front);

    // ── materials ──
    const shellMat = new T.MeshPhysicalMaterial({ color: C(PAL.dark.shell), roughness: 0.36, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 0.9 });
    const metalMat = kit.metal ? kit.metal({ color: '#DDBE82', roughness: 0.24 }) : new T.MeshStandardMaterial({ color: C('#DDBE82'), metalness: 1, roughness: 0.24 });
    const lacMat = kit.lacquer ? kit.lacquer({ color: '#0D0D10' }) : new T.MeshPhysicalMaterial({ color: C('#0D0D10'), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
    const seamMat = new T.MeshStandardMaterial({ color: C('#6F6555'), roughness: 0.6, metalness: 0 });
    const beadMat = new T.MeshStandardMaterial({ color: C('#EAD39F'), emissive: C('#D8BA7E'), emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.4 });
    const face = document.createElement('canvas');
    face.width = 256; face.height = 128;
    const fx = face.getContext('2d');
    const faceTex = new T.CanvasTexture(face);
    faceTex.encoding = T.sRGBEncoding;
    faceTex.anisotropy = 2;
    const visorMat = new T.MeshPhysicalMaterial({ color: C('#050506'), roughness: 0.07, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02,
      emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 1.3, envMapIntensity: 1.25 });
    const glowMat = (hex, op) => new T.SpriteMaterial({ map: G.glowTexture(), color: C(hex), transparent: true, depthWrite: false,
      toneMapped: false, blending: T.AdditiveBlending, opacity: op });

    // ── geometry helpers ──
    const ell = (az, el, f, out) => {
      const ce = Math.cos(el);
      return (out || new T.Vector3()).set(HR * HS[0] * f * Math.sin(az) * ce, HR * HS[1] * f * Math.sin(el), HR * HS[2] * f * Math.cos(az) * ce);
    };
    const sq = (a) => { const c = Math.cos(a), s = Math.sin(a); return [Math.sign(c) * Math.pow(Math.abs(c), 2 / VN), Math.sign(s) * Math.pow(Math.abs(s), 2 / VN)]; };
    const tube = (pts, r, mat, closed, seg) => new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts, !!closed, 'centripetal'), seg || pts.length * 3, r, 6, !!closed), mat);
    const mesh = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); return m; };
    function visorGeometry(R, J) {
      const pos = [], nor = [], uv = [], idx = [];
      const p = new T.Vector3(), n = new T.Vector3();
      for (let i = 0; i <= R; i++) {
        const s = i / R;
        const f = 1.007 + 0.03 * (1 - s * s); // domed lens, proud of the shell
        for (let j = 0; j <= J; j++) {
          const q = sq((j / J) * Math.PI * 2);
          ell(VA * s * q[0], VB * s * q[1] + VE, f, p);
          pos.push(p.x, p.y, p.z);
          n.set(p.x / (HS[0] * HS[0]), p.y / (HS[1] * HS[1]), p.z / (HS[2] * HS[2])).normalize();
          nor.push(n.x, n.y, n.z);
          uv.push(0.5 + 0.5 * s * q[0], 0.5 + 0.5 * s * q[1] * FACE_V);
        }
      }
      for (let i = 0; i < R; i++) for (let j = 0; j < J; j++) {
        const a = i * (J + 1) + j, b = a + J + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    }

    // ── character ──
    const fine = []; // details hidden in the dock (sub-pixel there)
    const body = new T.Group();
    scene.add(body);
    const rig = new T.Group(); // bobbing part
    body.add(rig);
    const head = new T.Group();
    head.position.set(0, 0.36, 0);
    rig.add(head);
    const skull = new T.Mesh(new T.SphereGeometry(HR, 64, 44), shellMat);
    skull.scale.set(HS[0], HS[1], HS[2]);
    head.add(skull);
    head.add(new T.Mesh(visorGeometry(12, 96), visorMat));
    // bezel
    const bz = [];
    for (let j = 0; j < 112; j++) { const q = sq((j / 112) * Math.PI * 2); bz.push(ell(VA * q[0], VB * q[1] + VE, 1.01)); }
    head.add(tube(bz, 0.0125, metalMat, true, 224));
    // seams: crown meridian + jaw line
    const crown = [];
    for (let i = 0; i <= 28; i++) crown.push(ell(0, VB + VE + 0.17 + (Math.PI - 0.55 - (VB + VE + 0.17)) * (i / 28), 1.0015));
    const jaw = [];
    for (let j = 0; j < 72; j++) jaw.push(ell((j / 72) * Math.PI * 2, -0.7, 1.0015));
    fine.push(tube(crown, 0.0058, seamMat, false, 64), tube(jaw, 0.0058, seamMat, true, 144));
    fine.forEach((m) => head.add(m));
    // headset band + ear cups
    const band = new T.Mesh(new T.TorusGeometry(0.705, 0.021, 10, 120, Math.PI), metalMat);
    band.scale.y = 0.9;
    band.rotation.x = -0.2;
    head.add(band);
    [-1, 1].forEach((s) => {
      const cup = new T.Mesh(new T.CylinderGeometry(0.168, 0.176, 0.13, 56), shellMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(s * 0.7, -0.01, 0);
      head.add(cup);
      const bevel = new T.Mesh(new T.TorusGeometry(0.152, 0.015, 12, 72), metalMat);
      bevel.rotation.y = Math.PI / 2;
      bevel.position.set(s * 0.768, -0.01, 0);
      head.add(bevel);
      const disc = new T.Mesh(new T.CylinderGeometry(0.142, 0.142, 0.014, 56), lacMat);
      disc.rotation.z = Math.PI / 2;
      disc.position.set(s * 0.766, -0.01, 0);
      head.add(disc);
      const grille = new T.Mesh(new T.TorusGeometry(0.084, 0.0055, 8, 56), metalMat);
      grille.rotation.y = Math.PI / 2;
      grille.position.set(s * 0.775, -0.01, 0);
      head.add(grille);
      fine.push(grille);
      const pin = new T.Mesh(new T.SphereGeometry(0.026, 20, 14), metalMat);
      pin.position.set(s * 0.775, -0.01, 0);
      head.add(pin);
      const yoke = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.09, 20), metalMat);
      yoke.position.set(s * 0.705, 0.17, -0.02);
      head.add(yoke);
    });
    // mic boom with champagne tip
    const micCurve = new T.CatmullRomCurve3([new T.Vector3(-0.77, -0.08, 0.07), new T.Vector3(-0.74, -0.3, 0.3), new T.Vector3(-0.52, -0.45, 0.53), new T.Vector3(-0.27, -0.47, 0.63)]);
    head.add(new T.Mesh(new T.TubeGeometry(micCurve, 48, 0.0145, 8, false), metalMat));
    const micEnd = micCurve.getPoint(1);
    const micTip = new T.Mesh(new T.SphereGeometry(0.046, 28, 18), metalMat);
    micTip.scale.set(1.25, 1, 1);
    micTip.position.copy(micEnd);
    head.add(micTip);
    const micGlow = new T.Sprite(glowMat('#E8D3A4', 0));
    micGlow.position.copy(micEnd).add(new T.Vector3(0.02, 0, 0.05));
    micGlow.scale.setScalar(0.32);
    head.add(micGlow);
    // antenna + jewel
    const ant = new T.Mesh(new T.CylinderGeometry(0.0085, 0.013, 0.3, 14), metalMat);
    ant.position.set(0.17, 0.665, -0.05);
    ant.rotation.z = -0.3;
    head.add(ant);
    const bead = new T.Mesh(new T.SphereGeometry(0.04, 24, 16), beadMat);
    bead.position.set(0.215, 0.825, -0.05);
    head.add(bead);
    const beadGlow = new T.Sprite(glowMat('#E8D3A4', 0.6));
    beadGlow.position.copy(bead.position);
    beadGlow.scale.setScalar(0.36);
    head.add(beadGlow);
    // eye glows (placed on the visor where the face canvas draws the eyes)
    const eyeGlows = [-1, 1].map(() => { const sp = new T.Sprite(glowMat('#E3C58A', 0.5)); sp.scale.setScalar(0.34); head.add(sp); return sp; });
    // neck + torso
    rig.add(mesh(new T.CylinderGeometry(0.135, 0.17, 0.14, 40), lacMat, 0, -0.19, 0));
    const prof = new T.SplineCurve([
      new T.Vector2(0.001, -1.02), new T.Vector2(0.2, -1.0), new T.Vector2(0.33, -0.92), new T.Vector2(0.41, -0.79),
      new T.Vector2(0.45, -0.62), new T.Vector2(0.45, -0.47), new T.Vector2(0.41, -0.35), new T.Vector2(0.32, -0.26),
      new T.Vector2(0.18, -0.22), new T.Vector2(0.001, -0.21),
    ]).getPoints(64);
    const radAt = (y) => {
      let best = prof[0], d = 9;
      for (let i = 0; i < prof.length - 1; i++) {
        const a = prof[i], b = prof[i + 1];
        if ((y - a.y) * (y - b.y) <= 0 && a.y !== b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
        if (Math.abs(a.y - y) < d) { d = Math.abs(a.y - y); best = a; }
      }
      return best.x;
    };
    const torso = new T.Mesh(new T.LatheGeometry(prof, 72), shellMat);
    rig.add(torso);
    const ring = (y, r, mat) => { const m = new T.Mesh(new T.TorusGeometry(radAt(y) + 0.002, r, 10, 96), mat); m.rotation.x = Math.PI / 2; m.position.y = y; rig.add(m); return m; };
    ring(-0.24, 0.011, metalMat); // collar
    ring(-0.7, 0.011, metalMat);  // waist
    fine.push(ring(-0.36, 0.0055, seamMat), ring(-0.86, 0.0055, seamMat));
    // chest seal: lacquer disc, champagne rim, monoline "C"
    const sealZ = radAt(-0.5) + 0.004;
    const seal = new T.Group();
    seal.position.set(0, -0.505, sealZ);
    rig.add(seal);
    const sd = new T.Mesh(new T.CylinderGeometry(0.108, 0.108, 0.02, 48), lacMat);
    sd.rotation.x = Math.PI / 2;
    seal.add(sd);
    seal.add(new T.Mesh(new T.TorusGeometry(0.108, 0.008, 8, 64), metalMat));
    const cMark = new T.Mesh(new T.TorusGeometry(0.058, 0.0115, 10, 56, Math.PI * 1.5), metalMat);
    cMark.rotation.z = Math.PI / 4;
    cMark.position.z = 0.012;
    seal.add(cMark);
    // hover ring + under-glow
    const base = ring(-0.985, 0.02, metalMat);
    base.geometry.dispose();
    base.geometry = new T.TorusGeometry(0.15, 0.02, 12, 64);
    const underMat = glowMat('#E3C58A', 0.5);
    const under = new T.Sprite(underMat);
    under.position.set(0, -1.07, 0);
    under.scale.set(0.75, 0.42, 1);
    rig.add(under);
    // hands
    const hands = [-1, 1].map((s) => {
      const g = new T.Group();
      const h = new T.Mesh(new T.SphereGeometry(0.112, 36, 26), shellMat);
      h.scale.set(1, 1.12, 0.88);
      g.add(h);
      const cuff = new T.Mesh(new T.TorusGeometry(0.074, 0.012, 10, 48), metalMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.y = 0.108;
      g.add(cuff);
      g.userData.side = s;
      g.userData.base = new T.Vector3(s * 0.66, -0.56, 0.1);
      g.position.copy(g.userData.base);
      rig.add(g);
      return g;
    });
    // contact shadow (stays on the floor while Cal hovers)
    const shadow = kit.shadow ? kit.shadow({ width: 1.55, depth: 0.62, opacity: 0.6 }) : null;
    if (shadow) { shadow.position.y = -1.6; body.add(shadow); }

    // ── theme ──
    function applyTheme(t) {
      th = t;
      const p = PAL[t] || PAL.dark;
      shellMat.color.copy(C(p.shell)); shellMat.roughness = p.rough; shellMat.clearcoatRoughness = p.coat; shellMat.envMapIntensity = p.env;
      seamMat.color.copy(C(p.seam)); seamMat.metalness = p.seamMetal; seamMat.roughness = p.seamRough;
      metalMat.color.copy(C(p.metal));
      underMat.blending = t === 'light' ? T.NormalBlending : T.AdditiveBlending;
      if (shadow) shadow.material.opacity = p.shadow;
    }
    applyTheme(th);

    // ── face (gold ink on the visor) ──
    const INK = '#F4E1B0', HALO = 'rgba(230,196,128,0.95)';
    const K = face.width / 512;
    const FD = { key: '', lookX: 9, lookY: 9 };
    function pill(x, y, w, h) {
      const r = Math.min(w, h) / 2;
      fx.beginPath();
      fx.moveTo(x - w / 2 + r, y - h / 2);
      fx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
      fx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
      fx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
      fx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
      fx.closePath();
      fx.fill();
    }
    const arc = (x, y, r, a0, a1, lw) => { fx.lineWidth = lw; fx.beginPath(); fx.arc(x, y, r, a0, a1); fx.stroke(); };
    const eyePos = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    function drawFace(t, st, blink) {
      fx.setTransform(1, 0, 0, 1, 0, 0);
      fx.globalAlpha = 1;
      fx.shadowBlur = 0;
      fx.fillStyle = '#000';
      fx.fillRect(0, 0, face.width, face.height);
      fx.setTransform(K, 0, 0, K, 0, 0);
      fx.shadowColor = HALO;
      fx.shadowBlur = 20 * K;
      fx.fillStyle = INK;
      fx.strokeStyle = INK;
      fx.lineCap = 'round';
      fx.lineJoin = 'round';
      const cx = 256 + F.lookX * 30, cy = 116 - F.lookY * 18, dx = 84;
      let ex = dx, ey = cy, ew = 42, eh = 74;
      if (st === 'thinking') { ew = 40; eh = 58; ey = cy - 12; }
      if (st === 'listening') { const p = 1 + Math.sin(t * 5) * 0.045; ew *= 1.06 * p; eh *= 1.05 * p; }
      if (st === 'concerned') { eh = 66; ey = cy + 6; }
      const ox = st === 'thinking' ? 14 : 0;
      eyePos[0].x = cx - ex + ox; eyePos[1].x = cx + ex + ox; eyePos[0].y = eyePos[1].y = ey;
      const H = Math.max(5, eh * blink);
      if (st === 'happy' || st === 'wave') {
        [-1, 1].forEach((s) => {
          if (st === 'wave' && s === -1) { pill(cx - dx, cy, ew, H); return; }
          arc(cx + s * dx, cy + 16, 27, Math.PI * 1.13, Math.PI * 1.87, 14);
        });
        arc(cx, cy + 46, 30, Math.PI * 0.2, Math.PI * 0.8, 8);
        if (st === 'happy') {
          fx.shadowColor = 'rgba(236,160,120,0.8)'; fx.shadowBlur = 18 * K; fx.fillStyle = 'rgba(236,172,132,0.5)';
          [-1, 1].forEach((s) => { fx.beginPath(); fx.ellipse(cx + s * (dx + 38), cy + 52, 20, 9, 0, 0, Math.PI * 2); fx.fill(); });
        }
      } else if (st === 'sleep') {
        [-1, 1].forEach((s) => arc(cx + s * dx, cy - 6, 26, Math.PI * 0.18, Math.PI * 0.82, 10));
        fx.globalAlpha = 0.85;
        fx.font = '600 34px "Geist", "Avenir Next", system-ui, sans-serif';
        fx.textAlign = 'center';
        fx.textBaseline = 'middle';
        const d = (t * 10) % 34;
        fx.globalAlpha = 0.9 - d / 50;
        fx.fillText('z', 404, 74 - d * 0.5);
        fx.font = '600 24px "Geist", "Avenir Next", system-ui, sans-serif';
        fx.fillText('z', 438, 48 - d * 0.4);
        fx.globalAlpha = 1;
      } else {
        [-1, 1].forEach((s) => pill(cx + s * dx + ox, ey, ew, H));
        if (st === 'concerned') {
          fx.shadowBlur = 0; fx.fillStyle = '#000';
          [-1, 1].forEach((s) => { fx.save(); fx.translate(cx + s * dx, ey - 34); fx.rotate(-s * 0.4); fx.fillRect(-56, -44, 112, 44); fx.restore(); });
          fx.shadowBlur = 16 * K; fx.fillStyle = INK;
          arc(cx, cy + 102, 22, Math.PI * 1.22, Math.PI * 1.78, 7);
        } else if (st === 'thinking') {
          for (let i = 0; i < 3; i++) {
            fx.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 - i * 0.8));
            fx.beginPath(); fx.arc(cx - 26 + i * 26, cy + 76, 8, 0, Math.PI * 2); fx.fill();
          }
          fx.globalAlpha = 1;
        } else if (st === 'talking' || st === 'listening') {
          const n = 7, bw = 10, gap = 8, x0 = cx - ((n - 1) * (bw + gap)) / 2;
          for (let i = 0; i < n; i++) {
            const env = 1 - Math.abs(i - 3) / 4.5;
            const h = st === 'talking' ? 8 + Math.abs(Math.sin(t * 12.5 + i * 1.7) * Math.sin(t * 3.9 + i)) * 40 * env + 6 * env
              : 6 + Math.abs(Math.sin(t * 3.4 + i * 0.9)) * 10 * env;
            pill(x0 + i * (bw + gap), cy + 78, bw, Math.max(bw, h));
          }
        } else {
          arc(cx, cy + 50, 20, Math.PI * 0.22, Math.PI * 0.78, 7);
        }
      }
      faceTex.needsUpdate = true;
    }
    // canvas (x, y) in the 512×256 logical face → a point just in front of the visor, in head space
    const tmp = new T.Vector3();
    function facePoint(x, y, out) {
      const u = x / 512, v = 1 - y / 256;
      const qx = (u - 0.5) * 2, qy = (v - 0.5) * 2 / FACE_V;
      return ell(VA * qx, VB * qy + VE, 1.09, out || tmp);
    }

    // ── animation ──
    const S = { phase: 0, wave: 0, lx: 0, ly: 0 };
    const tv = new T.Vector3();
    const ease = (dt, rate, rm) => (rm ? 1 : 1 - Math.exp(-dt * rate));
    function update(dt, t) {
      const t0 = now();
      const tt = themeName();
      if (tt !== th) applyTheme(tt);
      const rm = reduced();
      const st = F.state;
      // blink (real time, so it is the same at 10, 30 or 60 fps)
      let blink = 1;
      if (!rm && st !== 'sleep' && st !== 'happy') {
        if (t0 >= F.nextBlinkAt) { F.blinkAt = t0; F.nextBlinkAt = t0 + 2600 + Math.random() * 3600; }
        const b = (t0 - F.blinkAt) / 210;
        if (b >= 0 && b < 1) blink = Math.max(0.07, Math.abs(Math.cos(b * Math.PI)));
      }
      // look
      const tx = st === 'thinking' ? 0.5 : st === 'sleep' ? 0 : look.x;
      const ty = st === 'thinking' ? 0.6 : st === 'sleep' ? -0.25 : st === 'concerned' ? Math.min(look.y, 0) - 0.1 : look.y;
      const kl = ease(dt, 7, rm);
      F.lookX += (tx - F.lookX) * kl;
      F.lookY += (ty - F.lookY) * kl;
      const kh = ease(dt, 5, rm);
      head.rotation.y += (F.lookX * 0.5 - head.rotation.y) * kh;
      head.rotation.x += (-F.lookY * 0.24 + (st === 'concerned' ? 0.12 : st === 'sleep' ? 0.2 : 0) - head.rotation.x) * kh;
      const tilt = st === 'thinking' ? 0.13 : st === 'listening' ? -0.08 : st === 'sleep' ? 0.1 : st === 'happy' && !rm ? Math.sin(t * 7) * 0.06 : 0;
      head.rotation.z += (tilt - head.rotation.z) * kh;
      rig.rotation.y += (head.rotation.y * 0.35 - rig.rotation.y) * ease(dt, 4, rm);
      // hover + breathing
      const rate = st === 'happy' ? 4 : st === 'sleep' ? 0.8 : st === 'talking' ? 2.2 : 1.55;
      const amp = rm ? 0 : st === 'happy' ? 0.06 : st === 'sleep' ? 0.022 : 0.04;
      S.phase += dt * rate;
      const bob = Math.sin(S.phase) * amp;
      rig.position.y = bob;
      rig.rotation.z = rm ? 0 : Math.sin(S.phase * 0.55) * 0.022;
      const breath = rm ? 0 : Math.sin(S.phase) * 0.008;
      torso.scale.set(1 + breath, 1 - breath * 0.5, 1 + breath);
      if (shadow) {
        const p = PAL[th] || PAL.dark;
        shadow.scale.set(1.55 * (1 - bob * 1.6), 0.62 * (1 - bob * 1.6), 1);
        shadow.material.opacity = p.shadow * (1 - bob * 3);
      }
      // hands
      const kk = ease(dt, 9, rm);
      S.wave += dt * 10;
      hands.forEach((h, i) => {
        const s = h.userData.side;
        tv.copy(h.userData.base);
        if (!rm) tv.y += Math.sin(S.phase + i * 1.3 - 0.6) * 0.03;
        if (st === 'talking' && !rm) { tv.y += Math.sin(t * 5 + i * Math.PI) * 0.05; tv.z += 0.06; }
        if (st === 'thinking' && s === 1) tv.set(0.3, -0.13, 0.55);
        if (st === 'happy') tv.set(s * 0.6, -0.1 + (rm ? 0 : Math.abs(Math.sin(t * 7 + i)) * 0.08), 0.18);
        if (st === 'wave' && s === 1) tv.set(0.68 + (rm ? 0 : Math.sin(S.wave) * 0.06), 0.22, 0.12);
        if (st === 'concerned') tv.set(s * 0.36, -0.64, 0.3);
        if (st === 'listening') tv.set(s * 0.64, -0.5, 0.16);
        h.position.lerp(tv, kk);
        h.rotation.z += ((st === 'wave' && s === 1 && !rm ? Math.sin(S.wave) * 0.42 : 0) - h.rotation.z) * Math.min(1, kk * 1.6);
      });
      // jewel + mic + eye glows
      const p = PAL[th] || PAL.dark;
      const think = st === 'thinking' && !rm ? 0.5 + Math.abs(Math.sin(t * 6)) * 0.5 : 0;
      beadMat.emissiveIntensity = 0.55 + think * 0.9 + (rm ? 0 : Math.sin(t * 1.8) * 0.06);
      beadGlow.material.opacity = (th === 'light' ? 0.35 : 0.55) + think * 0.4;
      const speak = st === 'talking' ? 0.55 + (rm ? 0 : Math.abs(Math.sin(t * 9)) * 0.35) : st === 'listening' ? 0.4 : 0;
      micGlow.material.opacity += (speak - micGlow.material.opacity) * Math.min(1, kk * 1.5);
      underMat.opacity = p.under * (st === 'sleep' ? 0.5 : 1) * (1 + bob * 3);
      // face: redraw only when something on it changed
      const animated = st === 'talking' || st === 'thinking' || st === 'listening' || st === 'sleep';
      const key = st + '|' + blink.toFixed(2);
      if (animated || key !== FD.key || Math.abs(F.lookX - FD.lookX) > 0.003 || Math.abs(F.lookY - FD.lookY) > 0.003) {
        drawFace(t, st, blink);
        FD.key = key; FD.lookX = F.lookX; FD.lookY = F.lookY;
      }
      const eg = (st === 'sleep' ? 0.12 : st === 'happy' || st === 'wave' ? 0.6 : 0.75) * p.eyeGlow * (0.35 + 0.65 * blink);
      eyeGlows.forEach((sp, i) => {
        facePoint(eyePos[i].x, eyePos[i].y, sp.position);
        sp.material.opacity = st === 'wave' && i === 1 ? eg * 0.75 : eg;
      });
      if (onFirst) { const f = onFirst; onFirst = null; f(); }
      return false;
    }

    // ── framing ──
    let small = false;
    function onResize(w, h) {
      if (!(w > 0 && h > 0)) return;
      const aspect = w / h;
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      small = Math.min(w, h) < SMALL / (root._calK || 1) - 1;
      // the dock frames Cal a little tighter (the floor shadow may crop), the panel shows the whole figure
      const fitH = small ? 3.0 : 3.18, fitW = 2.05;
      const dist = Math.max(fitH / 2 / tan, fitW / 2 / tan / aspect);
      camera.position.set(0, 0.36, dist);
      camera.lookAt(0, small ? -0.12 : -0.2, 0);
      camera.updateProjectionMatrix();
      fine.forEach((m) => { m.visible = !small; });
    }

    const view = G.view(host, {
      scene, camera, update, onResize,
      interactive: false, ambient: false, clearAlpha: 0, poster: 'none', intro: 900,
      name: 'cal', label: 'Cal, your Callback assistant',
      exposure: (t) => (PAL[t] || PAL.dark).exposure,
    });
    return { view, faceTex, scene, get small() { return small; } };
  }

  // ───────────────────────── create ─────────────────────────
  function create(container, opts) {
    opts = opts || {};
    if (!container || container.nodeType !== 1) return null;
    injectCSS();
    const root = document.createElement('div');
    root.className = 'cal-m is-2d';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', 'Cal, your Callback assistant');
    root.dataset.state = 'idle';
    const glHost = document.createElement('div');
    glHost.className = 'cal-m-gl';
    root.appendChild(glHost);
    let two = null;
    try { two = buildSVG(); root.appendChild(two.wrap); } catch (e) { report(e, 'svg'); }
    container.appendChild(root);

    const F = { state: 'idle', lookX: 0, lookY: 0, nextBlinkAt: now() + 1800, blinkAt: -1e9 };
    const look = { x: 0, y: 0 };
    const P = { timer: 0, iv: 0, lastInput: now(), rm: 0, blink2d: 0 };
    let mode = '2d', V3 = null, failed3D = false, destroyed = false, base = 'idle', revert = 0;
    let rootW = 0, rootH = 0, onScreen = true, rect = null, rectAt = 0, curK = 1;
    const offs = [];

    // ── mode (3D on the hub ↔ 2D SVG) ──
    function want3D() {
      const G = GLH();
      if (!G || failed3D) return false;
      try {
        if (G.tier() === 'safe' || !G.available()) return false;
        return !(V3 && V3.view && V3.view.safe);
      } catch (e) { return false; }
    }
    function syncMode() {
      if (destroyed) return;
      let w = want3D();
      if (w && !V3) {
        try {
          V3 = build3D(GLH(), root, glHost, F, look, () => setTimeout(() => { if (!destroyed && mode === '3d') root.classList.add('is-live'); }, 0));
          applyScale();
        } catch (e) { report(e, 'build'); failed3D = true; V3 = null; w = false; }
      }
      const m = w && V3 ? '3d' : '2d';
      if (m === mode) return;
      mode = m;
      root.classList.toggle('is-2d', m === '2d');
      root.classList.toggle('is-3d', m === '3d');
      if (m === '3d') { blink2DStop(); wake(true); }
      else {
        root.classList.remove('is-live');
        stopPump();
        if (V3 && !V3.view.safe) { /* failed via exception path */ }
        blink2DLoop();
      }
    }

    // ── dock render scale: lay the GL host out smaller and scale it up (≤ DOCK_DPR device px per CSS px) ──
    function applyScale() {
      const G = GLH();
      let dpr = window.devicePixelRatio || 1;
      try { const q = G && G.quality ? G.quality() : null; if (q && q.dprCap) dpr = Math.min(dpr, q.dprCap); } catch (e) { /* noop */ }
      const small = rootW > 0 && Math.min(rootW, rootH) < SMALL;
      const k = small && dpr > DOCK_DPR ? dpr / DOCK_DPR : 1;
      if (Math.abs(k - curK) < 0.01) return;
      curK = k;
      root._calK = k;
      glHost.style.width = glHost.style.height = k === 1 ? '' : (100 / k).toFixed(3) + '%';
      glHost.style.transform = k === 1 ? '' : 'scale(' + k.toFixed(4) + ')';
    }
    const isSmall = () => rootW > 0 && Math.min(rootW, rootH) < SMALL;

    // ── pacing ──
    function interval(t) {
      const small = isSmall();
      const st = F.state;
      if (t - P.lastInput < AMBIENT_MS) return 33;                 // ambient after input / a state change
      if (st === 'talking') return small ? 42 : 33;
      if (st === 'thinking') return small ? 66 : 50;
      if (t - F.blinkAt < 260) return 33;                           // let a blink finish smoothly
      if (st === 'listening') return 100;
      if (small) return 0;                                          // dock: idle → 0 fps
      return Math.max(16, Math.min(100, F.nextBlinkAt - t + 4));    // panel: 10 fps breathing, wake for blinks
    }
    function stopPump() { if (P.timer) clearTimeout(P.timer); P.timer = 0; P.iv = 0; }
    function pump() {
      P.timer = 0;
      if (destroyed || mode !== '3d' || !V3) return;
      if (V3.view.safe) { syncMode(); return; }
      if (!onScreen || document.hidden) { P.iv = 0; return; }
      V3.view.invalidate();
      if (reduced()) { P.iv = 0; return; }
      const iv = interval(now());
      P.iv = iv;
      if (iv > 0) P.timer = setTimeout(pump, iv);
    }
    function wake(input) {
      if (destroyed) return;
      if (input) P.lastInput = now();
      if (mode !== '3d' || !V3) return;
      if (reduced()) {
        if (!P.rm) P.rm = setTimeout(() => { P.rm = 0; if (!destroyed && V3 && mode === '3d') V3.view.invalidate(); }, 60);
        return;
      }
      if (P.timer && P.iv <= 40) return;
      stopPump();
      pump();
    }

    // ── 2D blink (only while the SVG is showing) ──
    function blink2DStop() { if (P.blink2d) clearTimeout(P.blink2d); P.blink2d = 0; root.classList.remove('cm-blink'); }
    function blink2DLoop() {
      blink2DStop();
      if (destroyed || mode !== '2d' || !two) return;
      P.blink2d = setTimeout(() => {
        P.blink2d = 0;
        if (destroyed || mode !== '2d') return;
        if (!document.hidden && onScreen && !reduced() && F.state !== 'sleep' && F.state !== 'happy') {
          root.classList.add('cm-blink');
          setTimeout(() => root.classList.remove('cm-blink'), 130);
        }
        blink2DLoop();
      }, 2800 + Math.random() * 3600);
    }

    // ── state ──
    function show(s) {
      F.state = s;
      root.dataset.state = s;
      if (two) two.state(s);
      wake(true);
    }
    function setState(s, ms) {
      if (destroyed) return;
      s = STATES.indexOf(s) >= 0 ? s : 'idle';
      if (revert) { clearTimeout(revert); revert = 0; }
      if (ms > 0) revert = setTimeout(() => { revert = 0; show(base); }, ms);
      else base = s;
      if (mode === '2d' && want3D()) syncMode();
      show(s);
    }

    // ── input ──
    function onMove(e) {
      if (destroyed) return;
      const t = now();
      if (!rect || t - rectAt > 400) { rect = root.getBoundingClientRect(); rectAt = t; }
      if (!rect.width) return;
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height * 0.36;
      look.x = clamp((e.clientX - cx) / (window.innerWidth * 0.5 || 1), -1, 1);
      look.y = clamp(-(e.clientY - cy) / (window.innerHeight * 0.5 || 1), -1, 1);
      if (mode === '2d' && two) two.lookAt(look.x, look.y);
      wake(true);
    }
    const onKey = () => wake(true);
    const onVis = () => { if (!document.hidden) wake(false); };
    const opt = { passive: true };
    window.addEventListener('pointermove', onMove, opt);
    window.addEventListener('pointerdown', onMove, opt);
    window.addEventListener('keydown', onKey, opt);
    document.addEventListener('visibilitychange', onVis);
    root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && F.state === 'idle') setState('happy', 1200); });
    root.addEventListener('click', () => { try { if (opts.onClick) opts.onClick(); } catch (e) { report(e, 'onClick'); } });

    let ro = null, io = null;
    try {
      ro = new ResizeObserver((es) => {
        const r = es[es.length - 1].contentRect;
        rootW = r.width; rootH = r.height; rect = null;
        applyScale();
        wake(false);
      });
      ro.observe(root);
    } catch (e) { rootW = root.clientWidth; rootH = root.clientHeight; }
    try {
      io = new IntersectionObserver((es) => { onScreen = es[es.length - 1].isIntersecting; rect = null; if (onScreen) wake(false); }, { rootMargin: '32px' });
      io.observe(root);
    } catch (e) { onScreen = true; }
    const G = GLH();
    if (G && G.on) {
      try {
        offs.push(G.on('tier', () => { applyScale(); syncMode(); if (V3) V3.view.invalidate(); }));
        offs.push(G.on('lost', () => stopPump()));
        offs.push(G.on('restored', () => { if (V3) V3.faceTex.needsUpdate = true; wake(false); }));
      } catch (e) { /* noop */ }
    }
    if (typeof CB.on === 'function') {
      offs.push(CB.on('theme', () => { if (two) two.theme(themeName()); if (V3) V3.view.invalidate(); }));
    }

    if (two) { two.theme(themeName()); two.state('idle'); }
    rootW = root.clientWidth; rootH = root.clientHeight;
    syncMode();
    if (mode === '2d') blink2DLoop();
    setState('wave', 2200);

    return {
      setState,
      get state() { return F.state; },
      get canvas() { return mode === '3d' && V3 ? V3.view.el : two ? two.svg : root; },
      get mode() { return mode; },
      get view() { return V3 ? V3.view : null; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopPump();
        blink2DStop();
        if (revert) clearTimeout(revert);
        if (P.rm) clearTimeout(P.rm);
        window.removeEventListener('pointermove', onMove, opt);
        window.removeEventListener('pointerdown', onMove, opt);
        window.removeEventListener('keydown', onKey, opt);
        document.removeEventListener('visibilitychange', onVis);
        try { if (ro) ro.disconnect(); if (io) io.disconnect(); } catch (e) { /* noop */ }
        offs.forEach((f) => { try { if (typeof f === 'function') f(); } catch (e) { /* noop */ } });
        try { if (V3) V3.view.dispose(); } catch (e) { report(e, 'dispose'); }
        V3 = null;
        root.remove();
      },
    };
  }

  CB.Mascot = { available, create, STATES: STATES.slice() };
})();

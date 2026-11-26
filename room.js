/* Callback v3 — Command Room (#room).  Owner: room (docs/BUILD.md §4).
 *
 * The app's immersive mode. Every application floats as a smoked-glass card on concentric amphitheatre arcs around
 * the viewer: one arc segment per pipeline stage (saved → accepted, left to right) with the stage name engraved in
 * Bodoni Moda above it; closed outcomes (rejected / ghosted / withdrawn) sit on a lower, dimmer ring. Black-vitrine
 * studio: the shared studio env (reflections on a lacquer floor and a champagne metal ring), a faint champagne ring
 * grid on the floor, slow dust, gold glows and fog.
 *
 *  · Renders on the ONE shared WebGL hub (CB.GL.view) — never creates a renderer or a context. Idle 0 fps.
 *  · Look around: drag (yaw ±150°, pitch ±25°, inertia), pointer parallax, wheel to turn, pinch / ctrl+wheel to move
 *    closer, double-click (or Recenter) to recenter, arrow keys. iPhone: drag, plus an opt-in gyro ("Immersive",
 *    DeviceOrientationEvent.requestPermission() from the tap) with low-pass filtering.
 *  · Tap a card → CB.UI.openJob(id, 'overview'). A count card ("+12 more") → Pipeline focused on that stage.
 *  · "Enter VR" only when navigator.xr supports immersive-vr: the hub is paused and CB.GL.renderer.xr drives the room.
 *  · ≤ 60 cards (40 on iPhone / low tiers); the rest of a stage becomes one count card. Card textures are redrawn in
 *    place on data / theme / font changes (no texture growth); everything is disposed when the view is left.
 *  · Safe Mode / no WebGL → the same cards as a CSS-3D stage carousel.
 * QA hook: CB.Room.debug() → {mode, yaw, pitch, fov, cards, textures, …}; CB.Room.cardPoint(id) → client {x, y}.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  if (CB.Room && CB.Room.__room) return;

  // ───────────────────────── geometry (metres; floor y = 0, eye at the centre) ─────────────────────────
  const DEG = Math.PI / 180;
  const EYE = 1.6;
  const CW = 0.8, CH = 0.5;                                          // card plane (texture 1.6 : 1)
  const TIERS = [{ r: 3.2, e: -0.6, s: 1 }, { r: 3.85, e: 8.95, s: 1.07 }, { r: 4.5, e: 17.65, s: 1.14 }];
  const LBL = { r: 4.78, e: 24.3, w: 1.5, h: 0.3125 };               // engraved stage names
  const RING = { r: 2.75, e: -15.5, s: 0.72, le: -9.6, lw: 1.08, lh: 0.225 }; // closed outcomes
  const SLOT = 2 * Math.atan((CW + 0.1) / 2 / TIERS[0].r);
  const SLOT_C = 2 * Math.atan((CW * RING.s + 0.07) / 2 / RING.r);
  const GAP = 4.5 * DEG, GAP_C = 4 * DEG, SPAN = 300 * DEG, SPAN_C = 216 * DEG;
  const E_TOP = 26.6 * DEG, E_BOT = -19.6 * DEG;                    // vertical extent used for auto-framing
  const YAW_MAX = 150 * DEG, PITCH_MAX = 25 * DEG, DOLLY_MAX = 1.5, REACH = 0.34;
  const FILTERS = [['all', 'All'], ['active', 'Active'], ['week', 'This week'], ['ko', 'Knockouts']];
  const UA = (window.navigator && navigator.userAgent) || '';
  const IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const TOUCH = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  const F_DISP = '"Bodoni Moda", "Bodoni 72", Didot, "Iowan Old Style", Georgia, serif';
  const F_UI = 'Geist, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
  const F_MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  // ───────────────────────── small utils ─────────────────────────
  const E = (s) => (CB.esc ? CB.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (k, dt) => 1 - Math.exp(-k * dt);
  const smooth = (x) => x * x * (3 - 2 * x);
  const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const now = () => (window.performance && performance.now ? performance.now() : Date.now());
  const reduced = () => { try { return CB.GL && CB.GL.reducedMotion ? !!CB.GL.reducedMotion() : !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
  const toast = (m, o) => { try { if (CB.UI && CB.UI.toast) CB.UI.toast(m, o); } catch (e) { /* noop */ } };
  const report = (e, where) => { try { if (CB.reportError) CB.reportError(e, { where: 'room:' + where, silent: true }); } catch (x) { /* noop */ } };
  const lsGet = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const prog = () => (CB.PROGRESSION && CB.PROGRESSION.length ? CB.PROGRESSION : (CB.STAGES || []).filter((s) => s.order >= 0));
  const closedStages = () => (CB.STAGES || []).filter((s) => s.order < 0);
  const stageName = (s) => (s.label.length > 12 ? s.short : s.label);
  const FALLBACK_STAGE = { key: 'saved', label: 'Saved', short: 'Saved', group: 'pre', order: 0 };
  const svg = (inner, cls) => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const IC = {
    room: '<path d="M12 4.2 17.6 7.4v6.4L12 17 6.4 13.8V7.4z"/><path d="M6.4 7.4 12 10.6l5.6-3.2M12 10.6V17"/><path d="M4.6 14.6C2.6 16.4 6.3 19.4 12 19.4s9.4-3 7.4-4.8" opacity=".65"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    gyro: '<rect x="7.5" y="3" width="9" height="18" rx="2.4"/><path d="M3.6 9.2c-1.4 1.8-1.4 3.8 0 5.6M20.4 9.2c1.4 1.8 1.4 3.8 0 5.6"/>',
    recenter: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
    vr: '<path d="M3 8.6A2.6 2.6 0 0 1 5.6 6h12.8A2.6 2.6 0 0 1 21 8.6v5.8a2.6 2.6 0 0 1-2.6 2.6h-3.1l-1.9-2.4h-2.8L8.7 17H5.6A2.6 2.6 0 0 1 3 14.4z"/><circle cx="8.2" cy="11.4" r="1.4"/><circle cx="15.8" cy="11.4" r="1.4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  // ───────────────────────── fonts + palette ─────────────────────────
  let fontsP = null, fontsOK = false;
  function fontsReady() {
    if (fontsP) return fontsP;
    try {
      const f = document.fonts;
      if (!f || !f.load) { fontsOK = true; return (fontsP = Promise.resolve()); }
      const faces = ['500 40px "Bodoni Moda"', 'italic 400 26px "Bodoni Moda"', '600 22px Geist', '300 60px Geist', '500 13px "Geist Mono"'];
      try { if (f.check && faces.every((x) => f.check(x))) fontsOK = true; } catch (e) { /* noop */ }
      fontsP = Promise.all(faces.map((s) => f.load(s).catch(() => null))).then(() => { fontsOK = true; }, () => { fontsOK = true; });
    } catch (e) { fontsOK = true; fontsP = Promise.resolve(); }
    return fontsP;
  }
  function isLight() {
    try { if (CB.GL && CB.GL.theme) return CB.GL.theme() === 'light'; } catch (e) { /* fall through */ }
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'light';
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  }
  function palette() {
    let cs = null;
    try { cs = getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    const g = (n, d) => { const v = cs ? String(cs.getPropertyValue(n) || '').trim() : ''; return v || d; };
    const light = isLight();
    const P = {
      light,
      bg: g('--bg-0', light ? '#F5F3EE' : '#0A0A09'),
      ink1: g('--ink-1', light ? '#15130F' : '#F2EEE6'), ink2: g('--ink-2', light ? '#4A463E' : '#BDB7AC'),
      ink3: g('--ink-3', light ? '#6B655A' : '#8B867D'), ink4: g('--ink-4', light ? '#A39D91' : '#5F5B55'),
      gold100: g('--gold-100', '#F5EAD0'), gold200: g('--gold-200', '#E8D3A4'), gold300: g('--gold-300', '#D8BA7E'),
      gold400: g('--gold-400', '#C29E5E'), gold500: g('--gold-500', '#A07E44'), gold600: g('--gold-600', '#7A5F33'),
      success: g('--success', '#6CC49A'), warning: g('--warning', '#E0A458'), danger: g('--danger', '#E06C75'),
      st: {},
    };
    (CB.STAGES || []).forEach((s) => { P.st[s.key] = g('--st-' + s.key, s.color); });
    P.bodyTop = light ? 'rgba(255,254,251,.96)' : 'rgba(33,32,30,.90)';
    P.bodyBot = light ? 'rgba(246,243,236,.96)' : 'rgba(15,15,14,.93)';
    P.sheen = light ? 'rgba(255,255,255,.75)' : 'rgba(255,250,240,.06)';
    P.rim = light ? 'rgba(255,255,255,1)' : 'rgba(255,250,240,.16)';
    P.hairA = light ? 'rgba(134,102,43,.62)' : 'rgba(232,211,164,.62)';
    P.hairB = light ? 'rgba(134,102,43,.20)' : 'rgba(216,186,126,.16)';
    P.rule = light ? 'rgba(134,102,43,.26)' : 'rgba(216,186,126,.20)';
    P.engrave = light ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,.8)';
    P.ghost = light ? 'rgba(134,102,43,.42)' : 'rgba(216,186,126,.34)';
    P.key = (light ? 'L' : 'D') + P.bg + P.ink1 + P.gold300;
    return P;
  }

  // ───────────────────────── canvas drawing (cards, labels) ─────────────────────────
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fit(ctx, text, max) {
    text = String(text == null ? '' : text);
    if (ctx.measureText(text).width <= max) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid).trimEnd() + '…').width <= max) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo).trimEnd() + '…';
  }
  function wrap2(ctx, text, max) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    let first = words[0], i = 1;
    while (i < words.length && ctx.measureText(first + ' ' + words[i]).width <= max) { first += ' ' + words[i]; i++; }
    if (i >= words.length) return [fit(ctx, first, max)];
    return [fit(ctx, first, max), fit(ctx, words.slice(i).join(' '), max)];
  }
  function trackedW(ctx, text, track) {
    let w = 0, n = 0;
    for (const ch of text) { w += ctx.measureText(ch).width; n++; }
    return w + track * Math.max(0, n - 1);
  }
  function tracked(ctx, text, x, y, track, align) {
    const w = trackedW(ctx, text, track);
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.textAlign = 'left';
    for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
    return w;
  }
  function cap(ctx, text, x, y, color, align) {
    ctx.font = `500 11.5px ${F_MONO}`;
    ctx.fillStyle = color;
    return tracked(ctx, String(text).toUpperCase(), x, y, 1.7, align || 'left');
  }
  function frameCard(ctx, P, gold, dashed) {
    if (dashed) {
      ctx.setLineDash([7, 8]); ctx.strokeStyle = P.ghost; ctx.lineWidth = 1.6;
      rr(ctx, 3, 3, 506, 314, 26); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    rr(ctx, 2, 2, 508, 316, 26);
    const g = ctx.createLinearGradient(0, 0, 0, 320);
    g.addColorStop(0, P.bodyTop); g.addColorStop(1, P.bodyBot);
    ctx.fillStyle = g; ctx.fill();
    const sh = ctx.createLinearGradient(0, 0, 330, 250);
    sh.addColorStop(0, P.sheen); sh.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = P.rim; ctx.lineWidth = 2;
    rr(ctx, 2, 3.6, 508, 318, 26); ctx.stroke();
    ctx.restore();
    const hg = ctx.createLinearGradient(0, 0, 512, 320);
    hg.addColorStop(0, gold ? P.gold200 : P.hairA); hg.addColorStop(0.5, gold ? P.gold500 : P.hairB); hg.addColorStop(1, gold ? P.gold300 : P.hairA);
    ctx.strokeStyle = hg; ctx.lineWidth = gold ? 2.4 : 1.5;
    rr(ctx, 2.75, 2.75, 506.5, 314.5, 25.5); ctx.stroke();
  }
  function begin(cv, w, h) {
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(cv.width / w, 0, 0, cv.height / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'alphabetic';
    return ctx;
  }
  function scoreColor(a, P) {
    if (!a || a.score == null) return P.ink3;
    if (a.knockouts && a.knockouts.length) return P.danger;
    const t = a.thresholds || { floor: 60, competitive: 75 };
    return a.score >= (t.competitive || 75) ? P.success : a.score >= (t.floor || 60) ? P.warning : P.danger;
  }
  const rel = (iso) => { try { return CB.relDays ? CB.relDays(iso) : ''; } catch (e) { return ''; } };
  function metaLine(m) {
    const j = m.j, bits = [];
    if (j.workMode) bits.push(j.workMode); else if (j.location) bits.push(String(j.location).split(',')[0]);
    if (m.closed) bits.push(m.st.label + (j.responseDate ? ' ' + rel(j.responseDate) : ''));
    else if (j.appliedDate) bits.push('Applied ' + rel(j.appliedDate));
    else if (j.createdAt) bits.push('Saved ' + rel(String(j.createdAt).slice(0, 10)));
    return bits.filter(Boolean).join(' · ');
  }
  function nextInfo(m) {
    const j = m.j;
    if (m.nx && m.nx.datetime) {
      let when = '';
      try { when = CB.fmtDateTime ? CB.fmtDateTime(m.nx.datetime) : m.nx.datetime; } catch (e) { when = String(m.nx.datetime); }
      return { label: 'Next', a: when, b: m.nx.type || 'Interview', on: true };
    }
    if (m.closed) return { label: 'Outcome', a: m.st.label, b: j.rejectionReason || (j.responseDate ? 'Closed ' + rel(j.responseDate) : 'Closed'), on: false };
    if (j.followUpDate && m.st.group === 'active') return { label: 'Follow up', a: CB.fmtDate ? CB.fmtDate(j.followUpDate) : j.followUpDate, b: rel(j.followUpDate), on: true };
    if (j.deadline && m.st.key === 'saved') return { label: 'Apply by', a: CB.fmtDate ? CB.fmtDate(j.deadline) : j.deadline, b: rel(j.deadline), on: true };
    return { label: 'Next', a: 'Nothing scheduled', b: '', on: false };
  }
  function probText(a) { try { return CB.UI && CB.UI.prob ? CB.UI.prob(a) : '—'; } catch (e) { return '—'; } }

  function drawJob(cv, m, P) {
    const ctx = begin(cv, 512, 320);
    if (!ctx) return;
    const j = m.j, a = m.a;
    const gold = m.st.key === 'offer' || m.st.key === 'accepted';
    frameCard(ctx, P, gold, false);
    const ink = P.st[m.st.key] || P.gold300;
    // monogram medallion
    let hue = 32;
    try { hue = CB.hueFor ? CB.hueFor(j.company || '?') : 32; } catch (e) { hue = 32; }
    ctx.beginPath(); ctx.arc(63, 66, 30, 0, Math.PI * 2);
    ctx.fillStyle = P.light ? `hsl(${hue}, 30%, 91%)` : `hsl(${hue}, 18%, 15%)`;
    ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = P.hairA; ctx.stroke();
    ctx.font = `500 25px ${F_DISP}`; ctx.fillStyle = P.light ? P.gold600 : P.gold200; ctx.textAlign = 'center';
    let ini = '?';
    try { ini = CB.initials ? CB.initials(j.company) : String(j.company || '?').slice(0, 2).toUpperCase(); } catch (e) { ini = '?'; }
    ctx.fillText(ini, 63, 75);
    // status chip in its jewel ink
    ctx.font = `600 14.5px ${F_UI}`;
    const lbl = m.st.label;
    const tw = ctx.measureText(lbl).width;
    const cw = tw + 40, cx = 512 - 30 - cw, cy = 34;
    rr(ctx, cx, cy, cw, 30, 15);
    ctx.globalAlpha = P.light ? 0.10 : 0.15; ctx.fillStyle = ink; ctx.fill();
    ctx.globalAlpha = 0.5; ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(cx + 16, cy + 15, 4, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.fillText(lbl, cx + 27, cy + 20.5);
    // company + meta
    ctx.font = `600 22px ${F_UI}`; ctx.fillStyle = P.ink1;
    ctx.fillText(fit(ctx, j.company || 'Company', cx - 108 - 14), 108, 61);
    ctx.font = `500 12.5px ${F_MONO}`; ctx.fillStyle = P.ink3;
    ctx.fillText(fit(ctx, metaLine(m).toUpperCase(), 512 - 108 - 30), 108, 87);
    // role title — the editorial face
    ctx.font = `500 30px ${F_DISP}`; ctx.fillStyle = P.ink1;
    const lines = wrap2(ctx, j.title || 'Role', 444);
    const y0 = lines.length > 1 ? 145 : 160;
    lines.forEach((l, i) => ctx.fillText(l, 34, y0 + i * 37));
    // hairline divider
    const dg = ctx.createLinearGradient(34, 0, 478, 0);
    dg.addColorStop(0, P.rule); dg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = dg; ctx.fillRect(34, 211, 444, 1.2);
    // metrics: ATS · chance · next
    cap(ctx, 'ATS fit', 34, 240, P.ink3);
    ctx.font = `600 34px ${F_UI}`; ctx.fillStyle = scoreColor(a, P);
    const sv = a && a.score != null ? String(a.score) : '—';
    ctx.textAlign = 'left'; ctx.fillText(sv, 33, 284);
    if (m.ko && !m.closed) {
      const sw = ctx.measureText(sv).width;
      ctx.font = `600 11px ${F_MONO}`;
      const kx = 33 + sw + 8;
      rr(ctx, kx, 262, 30, 20, 10); ctx.globalAlpha = 0.16; ctx.fillStyle = P.danger; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = P.danger; ctx.fillText('KO', kx + 8, 276);
    }
    cap(ctx, 'Chance', 150, 240, P.ink3);
    ctx.font = `600 34px ${F_UI}`; ctx.fillStyle = P.ink1; ctx.fillText(probText(a), 149, 284);
    const nx = nextInfo(m);
    cap(ctx, nx.label, 282, 240, P.ink3);
    ctx.font = `${nx.on ? 600 : 500} 16.5px ${F_UI}`; ctx.fillStyle = nx.on ? P.ink1 : P.ink3;
    ctx.fillText(fit(ctx, nx.a, 200), 282, 266);
    if (nx.b) { ctx.font = `450 13.5px ${F_UI}`; ctx.fillStyle = P.ink3; ctx.fillText(fit(ctx, nx.b, 200), 282, 287); }
  }
  function drawMore(cv, d, P) {
    const ctx = begin(cv, 512, 320);
    if (!ctx) return;
    frameCard(ctx, P, false, false);
    ctx.textAlign = 'center';
    ctx.font = `300 84px ${F_UI}`;
    const g = ctx.createLinearGradient(0, 100, 0, 180);
    g.addColorStop(0, P.light ? P.gold400 : P.gold100); g.addColorStop(1, P.light ? P.gold600 : P.gold400);
    ctx.fillStyle = g; ctx.fillText('+' + d.n, 256, 172);
    ctx.font = `italic 400 25px ${F_DISP}`; ctx.fillStyle = P.ink2;
    ctx.fillText(fit(ctx, (d.closed ? 'more ' : 'more in ') + stageName(d.stage).toLowerCase(), 420), 256, 216);
    cap(ctx, 'Open in pipeline  →', 256, 274, P.ink3, 'center');
  }
  function drawGhost(cv, P) {
    const ctx = begin(cv, 512, 320);
    if (!ctx) return;
    frameCard(ctx, P, false, true);
    ctx.textAlign = 'center';
    ctx.font = `italic 400 27px ${F_DISP}`; ctx.fillStyle = P.ink3;
    ctx.fillText('Nothing here yet', 256, 162);
    cap(ctx, 'Awaiting applications', 256, 200, P.ink4, 'center');
  }
  function drawLabel(cv, d, P) {
    const ctx = begin(cv, 768, 160);
    if (!ctx) return;
    const name = stageName(d.stage).toUpperCase();
    const fs = d.closed ? 46 : 54;
    ctx.font = `500 ${fs}px ${F_DISP}`;
    const track = fs * 0.2;
    const w = trackedW(ctx, name, track);
    const sc = Math.min(1, 700 / Math.max(1, w));
    const y = 86;
    ctx.save(); ctx.translate(384, 0); ctx.scale(sc, 1);
    ctx.fillStyle = P.engrave; tracked(ctx, name, 0, y + (P.light ? 1.8 : 2.4), track, 'center');
    const g = ctx.createLinearGradient(0, y - fs * 0.8, 0, y + 6);
    if (P.light) { g.addColorStop(0, P.gold400); g.addColorStop(0.55, P.gold600); g.addColorStop(1, P.gold500); }
    else { g.addColorStop(0, P.gold100); g.addColorStop(0.48, P.gold300); g.addColorStop(0.66, P.gold500); g.addColorStop(1, P.gold200); }
    ctx.fillStyle = g; tracked(ctx, name, 0, y, track, 'center');
    ctx.restore();
    ctx.font = `500 21px ${F_MONO}`; ctx.fillStyle = P.ink3;
    const cnt = pad2(d.n);
    const cw = tracked(ctx, cnt, 384, 138, 4, 'center');
    const rl = (x0, x1) => { const lg = ctx.createLinearGradient(x0, 0, x1, 0); lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, P.rule); return lg; };
    ctx.fillStyle = rl(384 - cw / 2 - 150, 384 - cw / 2 - 18); ctx.fillRect(384 - cw / 2 - 150, 131, 132, 1.3);
    ctx.fillStyle = rl(384 + cw / 2 + 150, 384 + cw / 2 + 18); ctx.fillRect(384 + cw / 2 + 18, 131, 132, 1.3);
  }

  // ───────────────────────── data → models, filters, plan ─────────────────────────
  function toModel(j, a) {
    const st = (CB.STAGE && (CB.STAGE[j.status] || CB.STAGE.saved)) || FALLBACK_STAGE;
    let nx = null;
    try { nx = CB.UI && CB.UI.nextInterview ? CB.UI.nextInterview(j) : null; } catch (e) { nx = null; }
    const ko = !!(a && a.knockouts && a.knockouts.length);
    const today = CB.todayISO ? CB.todayISO() : '';
    const sig = [j.company, j.title, st.key, j.location, j.workMode, j.appliedDate, j.createdAt, j.responseDate, j.followUpDate, j.deadline, j.rejectionReason,
      a ? a.score : '', a ? a.probability : '', ko ? a.knockouts[0].code : '', nx ? nx.datetime + '|' + nx.type : '', today].join('|');
    const text = `${j.company || ''} ${j.title || ''} ${j.location || ''} ${j.workMode || ''} ${(j.tags || []).join(' ')} ${st.label}`.toLowerCase();
    return { id: j.id, j, a: a || null, st, closed: st.group === 'closed', nx, ko, sig, text };
  }
  function readModels() {
    const S = CB.Store;
    if (!S || typeof S.list !== 'function') return [];
    let jobs = [], ats = {};
    try { jobs = S.list() || []; } catch (e) { jobs = []; }
    try { ats = S.atsMap ? S.atsMap() || {} : {}; } catch (e) { ats = {}; }
    return jobs.filter((j) => j && j.id).map((j) => toModel(j, ats[j.id]));
  }
  function weekBounds() {
    const n = new Date();
    const s = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
    const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
    return [s.getTime(), e.getTime()];
  }
  function inWeek(v, wk) {
    if (!v) return false;
    const d = CB.parseDate ? CB.parseDate(v) : new Date(v);
    if (!d || isNaN(d)) return false;
    const t = d.getTime();
    return t >= wk[0] && t < wk[1];
  }
  function passFilter(m, f, wk) {
    if (f === 'active') return m.st.group === 'active' || m.st.key === 'offer';
    if (f === 'ko') return m.ko;
    if (f === 'week') {
      const j = m.j;
      if (inWeek(j.appliedDate, wk) || inWeek(j.followUpDate, wk) || inWeek(j.deadline, wk) || inWeek(j.responseDate, wk)) return true;
      if ((j.interviews || []).some((iv) => iv && inWeek(iv.datetime, wk))) return true;
      return (j.timeline || []).some((t) => t && /^(status|interview|created|email|followup)$/.test(t.kind) && inWeek(t.ts, wk));
    }
    return true;
  }
  function passSearch(m, q) {
    if (!q) return true;
    return q.split(/\s+/).every((w) => !w || m.text.indexOf(w) >= 0);
  }
  const rankOf = (m) => (m.nx ? 0 : 1);
  function cmp(a, b) {
    const ra = rankOf(a), rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    if (a.nx && b.nx) return String(a.nx.datetime).localeCompare(String(b.nx.datetime));
    return String(b.j.updatedAt || '').localeCompare(String(a.j.updatedAt || ''));
  }
  /** Stage segments with column counts, detailed cards and count cards, under a global card budget. */
  function makePlan(models, cap) {
    const PS = prog(), CS = closedStages();
    const by = {};
    PS.concat(CS).forEach((s) => (by[s.key] = []));
    models.forEach((m) => (by[m.st.key] || (by[m.st.key] = [])).push(m));
    Object.keys(by).forEach((k) => by[k].sort(cmp));
    const shrink = (segs, max) => {
      let tot = segs.reduce((x, g) => x + g.cols, 0);
      while (tot > max) {
        let w = null;
        segs.forEach((g) => { if (g.cols > 1 && (!w || g.cols > w.cols)) w = g; });
        if (!w) break;
        w.cols--; tot--;
      }
    };
    const segs = PS.map((s) => { const n = by[s.key].length; return { s, key: s.key, closed: false, n, items: by[s.key], cols: n ? Math.max(Math.ceil(n / 3), Math.ceil(Math.sqrt(n))) : 1 }; });
    shrink(segs, Math.max(PS.length, Math.floor((SPAN - Math.max(0, PS.length - 1) * GAP) / SLOT)));
    segs.forEach((g) => { g.cap = g.cols * TIERS.length; });
    const csegs = CS.filter((s) => by[s.key].length).map((s) => ({ s, key: s.key, closed: true, n: by[s.key].length, items: by[s.key], cols: by[s.key].length }));
    shrink(csegs, Math.max(csegs.length, Math.floor((SPAN_C - Math.max(0, csegs.length - 1) * GAP_C) / SLOT_C)));
    csegs.forEach((g) => { g.cap = g.cols; });
    const all = segs.concat(csegs);
    all.forEach((g) => { g.detail = Math.min(g.n, g.cap); if (g.n > g.cap) g.detail = Math.max(0, g.cap - 1); g.more = g.n - g.detail; });
    const slots = (g) => g.detail + (g.more > 0 ? 1 : 0);
    const weight = (g) => slots(g) * (g.closed ? 2 : g.key === 'saved' ? 1.6 : g.key === 'applied' ? 1.3 : 1);
    let total = all.reduce((x, g) => x + slots(g), 0), guard = 400;
    while (total > cap && guard-- > 0) {
      let w = null;
      all.forEach((g) => { if (slots(g) > 1 && (!w || weight(g) > weight(w))) w = g; });
      if (!w) break;
      const before = slots(w);
      w.detail--; w.more++;
      if (slots(w) === before && w.detail > 0) { w.detail--; w.more++; }
      total = all.reduce((x, g) => x + slots(g), 0);
    }
    // angles: the pipeline reads left (positive yaw) → right, centred straight ahead
    const width = segs.reduce((x, g) => x + g.cols * SLOT, 0) + Math.max(0, segs.length - 1) * GAP;
    let cur = width / 2;
    segs.forEach((g) => { g.w = g.cols * SLOT; g.thc = cur - g.w / 2; cur -= g.w + GAP; });
    const wc = csegs.reduce((x, g) => x + g.cols * SLOT_C, 0) + Math.max(0, csegs.length - 1) * GAP_C;
    cur = wc / 2;
    csegs.forEach((g) => { g.w = g.cols * SLOT_C; g.thc = cur - g.w / 2; cur -= g.w + GAP_C; });
    return { segs, csegs, total, width, detailed: all.reduce((x, g) => x + g.detail, 0) };
  }

  // ───────────────────────── the 3D room ─────────────────────────
  function create3D(R) {
    const G = CB.GL, T = G.THREE;
    const host = R.host;
    const tier = G.tier();
    const lowMem = IOS || tier === 'low' || tier === 'mid';
    const TW = lowMem ? 448 : 512, TH = Math.round(TW / 1.6);
    const LW = lowMem ? 640 : 768, LH = Math.round(LW / 4.8);
    const rd = G.renderer;
    const gl2 = !!(rd && rd.capabilities && rd.capabilities.isWebGL2);
    const MIPS = gl2 && !IOS;
    let ANISO = 1;
    try { ANISO = rd && rd.capabilities ? Math.min(lowMem ? 2 : 8, rd.capabilities.getMaxAnisotropy() || 1) : 1; } catch (e) { ANISO = 1; }
    const CAP = lowMem ? 40 : 60;
    let P = palette();

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(56, 1, 0.05, 60);
    camera.rotation.order = 'YXZ';
    camera.position.set(0, EYE, 0);
    const EYEV = new T.Vector3(0, EYE, 0);
    const world = new T.Group();
    scene.add(world);
    scene.fog = new T.Fog(G.color(P.bg), 5.6, 13);
    try { const env = G.env(); if (env) scene.environment = env; } catch (e) { report(e, 'env'); }
    try { if (G.kit && G.kit.lights) G.kit.lights(scene, { intensity: 1 }); } catch (e) { report(e, 'lights'); }

    // studio: lacquer floor, champagne ring grid, metal plinth ring, pool of light, boundary lamps, dust, glows
    const floorColor = () => (P.light ? '#E7E2D7' : '#090908');
    const floorMat = (G.kit && G.kit.lacquer) ? G.kit.lacquer({ color: floorColor(), roughness: 0.3, envMapIntensity: P.light ? 0.5 : 0.16 }) : new T.MeshStandardMaterial({ color: G.color(floorColor()), roughness: 0.3 });
    const fadeCv = document.createElement('canvas');
    fadeCv.width = fadeCv.height = 256;
    try {
      const fc = fadeCv.getContext('2d');
      const rg = fc.createRadialGradient(128, 128, 0, 128, 128, 128);
      rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.42, 'rgba(255,255,255,1)'); rg.addColorStop(0.78, 'rgba(255,255,255,.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      fc.fillStyle = rg; fc.fillRect(0, 0, 256, 256);
    } catch (e) { /* noop */ }
    const fadeTex = new T.CanvasTexture(fadeCv);
    floorMat.map = fadeTex; floorMat.transparent = true; floorMat.depthWrite = false; floorMat.needsUpdate = true;
    const floor = new T.Mesh(new T.CircleGeometry(14, 128), floorMat);
    floor.renderOrder = -3;
    floor.rotation.x = -Math.PI / 2;
    world.add(floor);
    const gridMat = new T.LineBasicMaterial({ color: G.color(P.light ? P.gold500 : P.gold300), transparent: true, opacity: P.light ? 0.2 : 0.1, depthWrite: false });
    const grid = new T.LineSegments(gridGeometry(T), gridMat);
    grid.position.y = 0.004;
    world.add(grid);
    const metal = (G.kit && G.kit.metal) ? G.kit.metal({ roughness: 0.26, envMapIntensity: 1.2 }) : new T.MeshStandardMaterial({ color: G.color('#DDBE82'), metalness: 1, roughness: 0.3 });
    const plinth = new T.Mesh(new T.TorusGeometry(TIERS[0].r - 0.04, 0.0105, 6, 260), metal);
    plinth.rotation.x = Math.PI / 2; plinth.position.y = 0.014;
    world.add(plinth);
    const plinth2 = new T.Mesh(new T.TorusGeometry(RING.r - 0.5, 0.006, 6, 220), metal);
    plinth2.rotation.x = Math.PI / 2; plinth2.position.y = 0.01;
    world.add(plinth2);
    const poolMat = new T.MeshBasicMaterial({ map: G.glowTexture(), color: G.color(P.gold300), transparent: true, depthWrite: false, toneMapped: false, opacity: P.light ? 0.16 : 0.13, blending: P.light ? T.NormalBlending : T.AdditiveBlending });
    const pool = new T.Mesh(new T.PlaneGeometry(7.5, 7.5), poolMat);
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.007;
    world.add(pool);
    const lampMat = new T.SpriteMaterial({ map: G.dustTexture(), color: G.color(P.light ? P.gold500 : P.gold200), transparent: true, depthWrite: false, toneMapped: false, opacity: P.light ? 0.7 : 0.85, blending: P.light ? T.NormalBlending : T.AdditiveBlending });
    const lamps = [];
    for (let i = 0; i < 12; i++) { const s = new T.Sprite(lampMat); s.scale.set(0.085, 0.085, 1); s.visible = false; world.add(s); lamps.push(s); }
    let dust = null;
    try {
      if (G.kit && G.kit.dust) {
        dust = G.kit.dust({ count: 460, spread: [12, 3.6, 12], center: [0, 2.0, 0], size: 0.03, focus: 3.6, aperture: 0.24, drift: 0.035, opacity: 0.5 });
        if (dust) world.add(dust);
      }
    } catch (e) { report(e, 'dust'); }
    const mkGlow = (size, op) => { try { const s = G.kit && G.kit.glow ? G.kit.glow({ size, opacity: op }) : null; if (s) { s.visible = false; s.renderOrder = -2; world.add(s); } return s; } catch (e) { return null; } };
    const labelGlows = prog().map(() => mkGlow(1.9, 0.2));
    const cardGlows = [0, 1, 2, 3, 4, 5].map(() => mkGlow(1.55, 0.34));
    const hoverGlow = mkGlow(1.75, 0.5);
    if (hoverGlow) hoverGlow.material.opacity = 0;

    // shared resources
    const PLANE = new T.PlaneGeometry(1, 1);
    const ghostCv = document.createElement('canvas');
    ghostCv.width = 384; ghostCv.height = 240;
    drawGhost(ghostCv, P);
    const ghostTex = makeTex(ghostCv);

    const items = new Map();
    const S = {
      alive: true, view: null, yaw: 0, pitch: 0, dolly: 0, tDolly: 0, vyaw: 0, vpitch: 0, p0: 3 * DEG,
      px: 0, py: 0, tpx: 0, tpy: 0, tween: null, drag: null, pointers: new Map(), pinch: null,
      hover: null, sel: null, focus: null, w: 0, h: 0, first: true, plan: null, lastTap: 0, xr: null,
    };
    const GY = { on: false, have: false, raw: 0, yaw0: 0, fy: 0, fp: 0, timer: 0, got: false };
    const tmpO = new T.Object3D();
    const tv = new T.Vector3(), dir = new T.Vector3(), fwd = new T.Vector3();
    const ray = new T.Raycaster(), ndc = new T.Vector2();
    const qDev = new T.Quaternion(), eDev = new T.Euler(), q0 = new T.Quaternion(), qX = new T.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), zee = new T.Vector3(0, 0, 1);

    function makeTex(cv) {
      const t = new T.CanvasTexture(cv);
      t.encoding = T.sRGBEncoding;
      t.anisotropy = ANISO;
      if (!MIPS) { t.generateMipmaps = false; t.minFilter = T.LinearFilter; }
      t.magFilter = T.LinearFilter;
      return t;
    }
    const polar = (r, th, y, out) => (out || new T.Vector3()).set(-r * Math.sin(th), y, -r * Math.cos(th));
    const yAt = (r, e) => EYE + r * Math.tan(e * DEG);

    function draw(it) {
      try {
        if (it.kind === 'card') drawJob(it.cv, it.data, P);
        else if (it.kind === 'more') drawMore(it.cv, it.data, P);
        else if (it.kind === 'label') drawLabel(it.cv, it.data, P);
        if (it.tex) it.tex.needsUpdate = true;
      } catch (e) { report(e, 'draw'); }
    }
    const sigOf = (it) => P.key + (fontsOK ? 'F' : 'f') + '|' + (it.kind === 'card' ? it.data.sig : it.kind === 'more' ? it.data.n + (it.data.closed ? 'c' : '') : it.kind === 'label' ? it.data.n : '');
    function makeItem(key, kind, data) {
      const it = { key, kind, data, mesh: null, mat: null, tex: null, cv: null, own: kind !== 'ghost', base: new T.Vector3(), tbase: new T.Vector3(), tq: new T.Quaternion(),
        op: 0, tOp: 1, dim: 1, appr: 0, scale: 1, w: CW, h: CH, delay: 0, phase: Math.random() * Math.PI * 2, bob: kind === 'card' || kind === 'more', dying: false, qInit: false, sig: '', glow: null };
      if (kind === 'ghost') it.tex = ghostTex;
      else {
        it.cv = document.createElement('canvas');
        if (kind === 'label') { it.cv.width = LW; it.cv.height = LH; it.w = data.closed ? RING.lw : LBL.w; it.h = data.closed ? RING.lh : LBL.h; }
        else if (kind === 'more') { it.cv.width = 384; it.cv.height = 240; }
        else { it.cv.width = TW; it.cv.height = TH; }
        it.tex = makeTex(it.cv);
        draw(it);
        it.sig = sigOf(it);
      }
      it.mat = new T.MeshBasicMaterial({ map: it.tex, transparent: true, alphaTest: 0.02, toneMapped: false, opacity: 0, depthWrite: kind !== 'label' });
      it.mesh = new T.Mesh(PLANE, it.mat);
      it.mesh.userData.item = it;
      if (kind === 'label') it.mesh.renderOrder = 1;
      world.add(it.mesh);
      return it;
    }
    function kill(it) {
      items.delete(it.key);
      try { world.remove(it.mesh); } catch (e) { /* noop */ }
      try { it.mat.dispose(); } catch (e) { /* noop */ }
      if (it.own) {
        try { it.tex.dispose(); } catch (e) { /* noop */ }
        if (it.cv) { it.cv.width = 1; it.cv.height = 1; }
      }
      if (S.hover === it) S.hover = null;
      if (S.sel === it) S.sel = null;
      if (S.focus === it) S.focus = null;
    }
    function place(key, kind, data, pos, scale, dim, index, intro, seen) {
      seen.add(key);
      let it = items.get(key);
      if (it && it.dying) it.dying = false;
      if (!it) {
        it = makeItem(key, kind, data);
        items.set(key, it);
        it.base.copy(pos);
        it.base.y -= intro ? 0.4 : 0.2;
        it.delay = intro ? 0.12 + index * 0.026 : 0;
      } else {
        it.data = data;
        if (it.own && sigOf(it) !== it.sig) { draw(it); it.sig = sigOf(it); }
      }
      it.tbase.copy(pos);
      it.scale = scale; it.dim = dim; it.tOp = 1;
      tmpO.position.copy(pos); tmpO.lookAt(EYEV); it.tq.copy(tmpO.quaternion);
      if (!it.qInit) { it.mesh.quaternion.copy(it.tq); it.qInit = true; }
      return it;
    }

    function layout(models) {
      const intro = S.first && !reduced();
      const plan = makePlan(models, CAP);
      S.plan = plan;
      const seen = new Set();
      let idx = 0, li = 0, gi = 0, lampI = 0;
      labelGlows.forEach((g) => { if (g) g.visible = false; });
      cardGlows.forEach((g) => { if (g) { g.visible = false; g.userData.it = null; } });
      lamps.forEach((l) => { l.visible = false; });
      const lamp = (th) => { const l = lamps[lampI++]; if (!l) return; polar(TIERS[0].r - 0.04, th, 0.05, l.position); l.visible = true; };
      plan.segs.forEach((g, si) => {
        const list = g.items.slice(0, g.detail);
        const nSlots = list.length + (g.more > 0 ? 1 : 0);
        const step = g.w / g.cols;
        for (let i = 0; i < nSlots; i++) {
          const t = Math.min(TIERS.length - 1, Math.floor(i / g.cols)), col = i % g.cols;
          const m = Math.min(g.cols, nSlots - t * g.cols);
          const th = g.thc + ((m - 1) / 2 - col) * step;
          const tr = TIERS[t];
          const pos = polar(tr.r, th, yAt(tr.r, tr.e));
          if (i < list.length) {
            const it = place('j:' + list[i].id, 'card', list[i], pos, tr.s, 1, idx++, intro, seen);
            if (it.data.st.key === 'offer' || it.data.st.key === 'accepted') { const cg = cardGlows[gi++]; if (cg) { cg.visible = true; cg.userData.it = it; } }
          } else place('m:' + g.key, 'more', { stage: g.s, n: g.more, closed: false }, pos, tr.s, 1, idx++, intro, seen);
        }
        if (!g.n) place('g:' + g.key, 'ghost', { stage: g.s }, polar(TIERS[0].r, g.thc, yAt(TIERS[0].r, TIERS[0].e)), 1, 0.9, idx++, intro, seen);
        const lit = place('l:' + g.key, 'label', { stage: g.s, n: g.n, closed: false }, polar(LBL.r, g.thc, yAt(LBL.r, LBL.e)), 1, g.n ? 1 : 0.55, li++, intro, seen);
        const lg = labelGlows[si];
        if (lg) { lg.visible = true; lg.userData.it = lit; lg.userData.k = g.key === 'offer' || g.key === 'accepted' ? 1.9 : 1; }
        if (si === 0) lamp(g.thc + g.w / 2 + GAP / 2);
        lamp(g.thc - g.w / 2 - GAP / 2);
      });
      plan.csegs.forEach((g) => {
        const list = g.items.slice(0, g.detail);
        const nSlots = list.length + (g.more > 0 ? 1 : 0);
        for (let i = 0; i < nSlots; i++) {
          const th = g.thc + ((nSlots - 1) / 2 - i) * SLOT_C;
          const pos = polar(RING.r, th, yAt(RING.r, RING.e));
          if (i < list.length) place('j:' + list[i].id, 'card', list[i], pos, RING.s, 0.62, idx++, intro, seen);
          else place('m:' + g.key, 'more', { stage: g.s, n: g.more, closed: true }, pos, RING.s, 0.62, idx++, intro, seen);
        }
        place('l:' + g.key, 'label', { stage: g.s, n: g.n, closed: true }, polar(RING.r + 0.02, g.thc, yAt(RING.r, RING.le)), 1, 0.66, li++, intro, seen);
      });
      items.forEach((it, key) => { if (!seen.has(key) && !it.dying) { it.dying = true; it.tOp = 0; it.delay = 0; } });
      if (S.first) {
        S.first = false;
        if (intro) { S.yaw = 16 * DEG; tweenTo(0, 0, 0, 2200); }
      }
      if (S.view) S.view.kick(intro ? 3000 : 1400);
    }

    // ── camera ──
    function hfov() { return 2 * Math.atan(Math.tan((camera.fov * DEG) / 2) * camera.aspect); }
    function frame() {
      const h = S.h || host.clientHeight, w = S.w || host.clientWidth;
      if (!h || !w) return;
      let hr = null;
      try { hr = host.getBoundingClientRect(); } catch (e) { return; }
      let top = 120, bot = h - 72;
      const hud = R.el.hud;
      if (hud) { const r = hud.getBoundingClientRect(); if (r.height) top = r.bottom - hr.top + 14; }
      const tab = document.getElementById('tabbar');
      if (tab) {
        let vis = false;
        try { vis = getComputedStyle(tab).display !== 'none'; } catch (e) { vis = false; }
        if (vis) { const r = tab.getBoundingClientRect(); if (r.height) bot = Math.min(bot, r.top - hr.top - 62); }
      }
      const nT = 1 - (2 * top) / h, nB = 1 - (2 * bot) / h;
      let p = (E_TOP + E_BOT) / 2, v = 28 * DEG;
      if (nT > 0.05 && nB < -0.05) {
        let lo = E_BOT + 1e-3, hi = E_TOP - 1e-3;
        const f = (x) => Math.tan(E_TOP - x) * nB - Math.tan(E_BOT - x) * nT;
        for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
        p = (lo + hi) / 2;
        v = Math.atan(Math.tan(E_TOP - p) / nT);
      }
      v = clamp(v, 19 * DEG, 42 * DEG);
      camera.fov = (2 * v) / DEG;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      S.p0 = p;
      if (S.view) S.view.invalidate();
    }
    function tweenTo(yaw, pitch, dolly, ms) {
      if (reduced() || !ms) { S.yaw = yaw; S.pitch = pitch; S.tDolly = dolly; S.tween = null; if (S.view) S.view.invalidate(); return; }
      S.vyaw = S.vpitch = 0;
      S.tween = { y0: S.yaw, p0: S.pitch, d0: S.tDolly, y1: yaw, p1: pitch, d1: dolly, t: 0, dur: ms / 1000 };
      if (S.view) S.view.kick(ms + 200);
    }
    function applyCamera() {
      let yaw = S.yaw, pitch = S.p0 + S.pitch;
      if (GY.on && GY.have) { yaw = S.yaw + GY.fy; pitch = clamp(GY.fp + S.pitch, -55 * DEG, 55 * DEG); }
      camera.rotation.set(pitch - S.py * 0.5 * DEG, yaw - S.px * 0.9 * DEG, 0);
      tv.set(S.px * 0.07, -S.py * 0.045, 0).applyEuler(camera.rotation);
      camera.position.copy(EYEV).add(tv);
      fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(fwd, S.dolly);
    }
    function update(dt, t) {
      if (!S.alive) return false;
      const rm = reduced();
      if (S.tween) {
        const tw = S.tween;
        tw.t += dt;
        const k = smooth(clamp(tw.t / tw.dur, 0, 1));
        S.yaw = tw.y0 + (tw.y1 - tw.y0) * k; S.pitch = tw.p0 + (tw.p1 - tw.p0) * k; S.tDolly = tw.d0 + (tw.d1 - tw.d0) * k;
        if (tw.t >= tw.dur) S.tween = null;
      } else if (!S.drag) {
        if (Math.abs(S.vyaw) > 1e-4 || Math.abs(S.vpitch) > 1e-4) {
          S.yaw += S.vyaw * dt; S.pitch += S.vpitch * dt;
          const d = Math.exp(-dt * 3.6);
          S.vyaw *= d; S.vpitch *= d;
        }
      }
      if (!GY.on) {
        if (S.yaw > YAW_MAX) { S.yaw = YAW_MAX; S.vyaw = 0; }
        if (S.yaw < -YAW_MAX) { S.yaw = -YAW_MAX; S.vyaw = 0; }
      } else S.yaw = wrapA(S.yaw);
      if (S.pitch > PITCH_MAX) { S.pitch = PITCH_MAX; S.vpitch = 0; }
      if (S.pitch < -PITCH_MAX) { S.pitch = -PITCH_MAX; S.vpitch = 0; }
      S.dolly += (S.tDolly - S.dolly) * ease(rm ? 60 : 7, dt);
      S.px += (S.tpx - S.px) * ease(3.5, dt); S.py += (S.tpy - S.py) * ease(3.5, dt);
      applyCamera();
      const kp = ease(rm ? 60 : 5, dt), ko = ease(rm ? 60 : 5.5, dt), ka = ease(rm ? 60 : 9, dt);
      const dead = [];
      const hot = S.sel || S.focus || S.hover;
      items.forEach((it) => {
        if (it.delay > 0) { it.delay -= dt; it.mesh.visible = false; return; }
        it.base.lerp(it.tbase, kp);
        it.mesh.quaternion.slerp(it.tq, kp);
        it.op += (it.tOp - it.op) * ko;
        const ta = it === hot ? (it === S.sel ? 1.3 : 1) : 0;
        it.appr += (ta - it.appr) * ka;
        dir.copy(EYEV).sub(it.base).normalize();
        it.mesh.position.copy(it.base).addScaledVector(dir, it.appr * REACH);
        if (it.bob && !rm) it.mesh.position.y += Math.sin(t * 0.62 + it.phase) * 0.011;
        const sc = it.scale * (1 + it.appr * 0.045);
        it.mesh.scale.set(it.w * sc, it.h * sc, 1);
        it.mat.opacity = clamp(it.op * it.dim, 0, 1);
        it.mesh.visible = it.mat.opacity > 0.004;
        if (it.dying && it.op < 0.012) dead.push(it);
      });
      dead.forEach(kill);
      labelGlows.forEach((g) => {
        const it = g && g.visible && g.userData.it;
        if (!it) return;
        g.position.copy(it.mesh.position).addScaledVector(dir.copy(EYEV).sub(it.mesh.position).normalize(), -0.25);
        g.material.opacity = (P.light ? 0.1 : 0.16) * (g.userData.k || 1) * it.op * it.dim;
      });
      cardGlows.forEach((g) => {
        const it = g && g.visible && g.userData.it;
        if (!it) return;
        g.position.copy(it.mesh.position).addScaledVector(dir.copy(EYEV).sub(it.mesh.position).normalize(), -0.12);
        g.material.opacity = (P.light ? 0.2 : 0.3) * it.op * it.dim;
      });
      if (hoverGlow) {
        const it = hot && (hot.kind === 'card' || hot.kind === 'more') ? hot : null;
        if (it) { hoverGlow.visible = true; hoverGlow.position.copy(it.mesh.position).addScaledVector(dir.copy(EYEV).sub(it.mesh.position).normalize(), -0.1); }
        const target = it ? (P.light ? 0.3 : 0.42) * it.op : 0;
        hoverGlow.material.opacity += (target - hoverGlow.material.opacity) * ka;
        if (!it && hoverGlow.material.opacity < 0.01) hoverGlow.visible = false;
      }
      return true;
    }

    // ── picking + activation ──
    function pick(cx, cy) {
      const el = S.view && S.view.el;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      world.updateMatrixWorld();
      ray.setFromCamera(ndc, camera);
      const list = [];
      items.forEach((it) => { if ((it.kind === 'card' || it.kind === 'more') && !it.dying && it.op > 0.3 && it.mesh.visible) list.push(it.mesh); });
      const hit = ray.intersectObjects(list, false)[0];
      return hit ? hit.object.userData.item : null;
    }
    function setHover(it) {
      if (S.hover === it) return;
      S.hover = it;
      host.classList.toggle('is-hover', !!it);
      if (S.view) S.view.kick(700);
    }
    function activate(it) {
      if (!it) return;
      S.sel = it;
      if (S.view) S.view.kick(800);
      const go = () => {
        if (!S.alive) return;
        if (it.kind === 'more') {
          try { if (CB.Views) CB.Views._boardFocus = it.data.stage.key; } catch (e) { /* noop */ }
          location.hash = 'board';
        } else if (it.kind === 'card') R.open(it.data.id);
      };
      if (reduced()) go(); else setTimeout(go, 170);
    }

    // ── pointer / wheel / keys ──
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { S.view.el.setPointerCapture(e.pointerId); } catch (x) { /* noop */ }
      S.sel = null;
      if (S.pointers.size >= 2) {
        const pts = Array.from(S.pointers.values());
        S.pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), dolly: S.tDolly };
        S.drag = null;
        host.classList.remove('is-dragging');
        return;
      }
      S.tween = null; S.vyaw = 0; S.vpitch = 0;
      S.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, samples: [], type: e.pointerType };
    }
    function onMove(e) {
      const p = S.pointers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (S.pinch) {
        if (S.pointers.size >= 2) {
          const pts = Array.from(S.pointers.values());
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          S.tDolly = clamp(S.pinch.dolly + (d - S.pinch.d) * 0.0058, 0, DOLLY_MAX);
          S.view.kick(400);
        }
        return;
      }
      const d = S.drag;
      if (d && d.id === e.pointerId) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        d.x = e.clientX; d.y = e.clientY;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > (d.type === 'touch' ? 9 : 4)) {
          d.moved = true;
          host.classList.add('is-dragging');
          setHover(null);
          R.dismissHint();
        }
        if (d.moved) {
          const kx = hfov() / Math.max(1, S.w), ky = (camera.fov * DEG) / Math.max(1, S.h);
          S.yaw += dx * kx; S.pitch += dy * ky;
          const t = now();
          d.samples.push([t, dx * kx, dy * ky]);
          while (d.samples.length && t - d.samples[0][0] > 100) d.samples.shift();
        }
        return;
      }
      if (e.pointerType === 'mouse' && S.view) {
        const r = S.view.el.getBoundingClientRect();
        if (r.width && r.height) { S.tpx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1); S.tpy = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1); }
        setHover(pick(e.clientX, e.clientY));
      }
    }
    function onUp(e) {
      S.pointers.delete(e.pointerId);
      try { S.view.el.releasePointerCapture(e.pointerId); } catch (x) { /* noop */ }
      if (S.pinch) { if (S.pointers.size < 2) S.pinch = null; S.drag = null; return; }
      const d = S.drag;
      if (!d || d.id !== e.pointerId) return;
      S.drag = null;
      host.classList.remove('is-dragging');
      if (d.moved) {
        const t = now();
        const s = d.samples.filter((x) => t - x[0] < 100);
        if (s.length > 1 && !reduced()) {
          const span = Math.max(0.016, (t - s[0][0]) / 1000);
          let sx = 0, sy = 0;
          s.forEach((x) => { sx += x[1]; sy += x[2]; });
          S.vyaw = clamp(sx / span, -4, 4); S.vpitch = clamp(sy / span, -2, 2) * 0.6;
          S.view.kick(1500);
        }
        return;
      }
      if (e.type === 'pointercancel') return;
      const it = pick(e.clientX, e.clientY);
      if (it) activate(it);
    }
    function onLeaveEl(e) { if (e.pointerType === 'mouse' && !S.drag) { setHover(null); S.tpx = 0; S.tpy = 0; } }
    function onWheel(e) {
      if (!S.view) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) { S.tDolly = clamp(S.tDolly - e.deltaY * k * 0.0045, 0, DOLLY_MAX); S.view.kick(500); return; }
      S.tween = null;
      const dx = e.deltaX * k, dy = e.deltaY * k;
      const kk = hfov() / Math.max(1, S.w);
      S.yaw -= (Math.abs(dx) > Math.abs(dy) ? dx : dy) * kk * 0.9;
      if (!GY.on) S.yaw = clamp(S.yaw, -YAW_MAX, YAW_MAX);
      R.dismissHint();
      S.view.kick(450);
    }
    function onDbl(e) { e.preventDefault(); recenter(); }
    function onKey(e) {
      const step = 12 * DEG;
      if (e.key === 'ArrowLeft') tweenTo(S.yaw + step, S.pitch, S.tDolly, 420);
      else if (e.key === 'ArrowRight') tweenTo(S.yaw - step, S.pitch, S.tDolly, 420);
      else if (e.key === 'ArrowUp') tweenTo(S.yaw, clamp(S.pitch + 6 * DEG, -PITCH_MAX, PITCH_MAX), S.tDolly, 360);
      else if (e.key === 'ArrowDown') tweenTo(S.yaw, clamp(S.pitch - 6 * DEG, -PITCH_MAX, PITCH_MAX), S.tDolly, 360);
      else if (e.key === '+' || e.key === '=') tweenTo(S.yaw, S.pitch, clamp(S.tDolly + 0.35, 0, DOLLY_MAX), 360);
      else if (e.key === '-' || e.key === '_') tweenTo(S.yaw, S.pitch, clamp(S.tDolly - 0.35, 0, DOLLY_MAX), 360);
      else if (e.key === 'Home' || e.key === 'r' || e.key === 'R') recenter();
      else return;
      e.preventDefault();
    }
    function recenter() {
      if (GY.on && GY.have) { GY.yaw0 = GY.raw; }
      S.vyaw = S.vpitch = 0;
      tweenTo(0, 0, 0, 900);
    }

    // ── gyro (iPhone "Immersive") ──
    function screenAngle() {
      let a = 0;
      try { a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : +window.orientation || 0; } catch (e) { a = 0; }
      return a * DEG;
    }
    function onOrient(e) {
      if (!GY.on || e.alpha == null || e.beta == null) return;
      GY.got = true;
      eDev.set((e.beta || 0) * DEG, (e.alpha || 0) * DEG, -(e.gamma || 0) * DEG, 'YXZ');
      qDev.setFromEuler(eDev); qDev.multiply(qX); qDev.multiply(q0.setFromAxisAngle(zee, -screenAngle()));
      fwd.set(0, 0, -1).applyQuaternion(qDev);
      const yaw = Math.atan2(-fwd.x, -fwd.z), pitch = Math.asin(clamp(fwd.y, -1, 1));
      GY.raw = yaw;
      if (!GY.have) { GY.have = true; GY.yaw0 = yaw; GY.fy = 0; GY.fp = pitch; S.yaw = 0; S.pitch = 0; }
      const ty = wrapA(yaw - GY.yaw0);
      const dy = wrapA(ty - GY.fy) * 0.08, dp = (pitch - GY.fp) * 0.08;   // low-pass, alpha 0.08
      GY.fy = wrapA(GY.fy + dy); GY.fp += dp;
      if (Math.abs(dy) + Math.abs(dp) > 2e-4 && S.view) S.view.kick(240);
    }
    function startGyro() {
      if (GY.on) return;
      GY.on = true; GY.have = false; GY.got = false;
      window.addEventListener('deviceorientation', onOrient);
      R.setGyroUI(true);
      clearTimeout(GY.timer);
      GY.timer = setTimeout(() => { if (GY.on && !GY.got) { stopGyro(); toast('This device is not reporting motion, so drag to look around instead.'); } }, 1800);
    }
    function stopGyro() {
      clearTimeout(GY.timer);
      if (!GY.on) return;
      GY.on = false;
      window.removeEventListener('deviceorientation', onOrient);
      if (GY.have) { S.yaw = clamp(wrapA(S.yaw + GY.fy), -YAW_MAX, YAW_MAX); S.pitch = clamp(GY.fp - S.p0, -PITCH_MAX, PITCH_MAX); }
      GY.have = false;
      R.setGyroUI(false);
      if (S.view) S.view.kick(600);
    }
    function toggleGyro() {
      if (GY.on) { stopGyro(); return; }
      const DOE = window.DeviceOrientationEvent;
      if (!DOE) { toast('Motion sensors are not available here.'); return; }
      if (typeof DOE.requestPermission === 'function') {
        // iOS: must be called synchronously from the tap
        DOE.requestPermission().then((res) => { if (res === 'granted') startGyro(); else toast('Motion access was declined. Allow it in Safari settings to look around by moving your phone.'); },
          () => toast('Motion access needs a tap on a secure (https) page.'));
      } else startGyro();
    }

    // ── WebXR (Vision Pro / Quest) ──
    function xrSupported() {
      try {
        if (!navigator.xr || !navigator.xr.isSessionSupported || !G.renderer || !G.renderer.xr) return Promise.resolve(false);
        return navigator.xr.isSessionSupported('immersive-vr').then((ok) => !!ok, () => false);
      } catch (e) { return Promise.resolve(false); }
    }
    function enterVR() {
      const r = G.renderer;
      if (!r || !r.xr || !navigator.xr || S.xr) return;
      let req;
      try { req = navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] }); } catch (e) { toast('Could not start VR here.'); return; }
      req.then((session) => startXR(session), (e) => { report(e, 'xr'); toast('VR is not available right now.'); });
    }
    function startXR(session) {
      const r = G.renderer;
      if (!S.alive || !r) { try { session.end(); } catch (e) { /* noop */ } return; }
      const X = { session, controllers: [], lines: [], cam: new T.PerspectiveCamera(60, 1, 0.05, 60), last: 0, focus: null, openId: null, kind: null, ended: false, bg: scene.background };
      S.xr = X;
      session.addEventListener('end', onXREnd);
      session.requestReferenceSpace('local-floor').then(() => 'local-floor', () => 'local').then((space) => {
        if (!S.alive || X.ended) return;
        G.pause();
        try { r.setScissorTest(false); r.setRenderTarget(null); } catch (e) { /* noop */ }
        r.xr.enabled = true;
        r.xr.setReferenceSpaceType(space);
        world.position.y = space === 'local' ? -EYE : 0;
        scene.background = G.color(P.bg);
        for (let i = 0; i < 2; i++) {
          const c = r.xr.getController(i);
          const g = new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0, 0, -1)]);
          const line = new T.Line(g, new T.LineBasicMaterial({ color: G.color(P.gold200), transparent: true, opacity: 0.7 }));
          line.scale.z = 5;
          c.add(line);
          c.addEventListener('select', onXRSelect);
          scene.add(c);
          X.controllers.push(c); X.lines.push(line);
        }
        return r.xr.setSession(session).then(() => {
          r.setAnimationLoop((time) => {
            const t = time / 1000;
            const dt = X.last ? Math.min(0.1, t - X.last) : 1 / 72;
            X.last = t;
            try { xrFrame(dt, t); r.render(scene, X.cam); } catch (e) { report(e, 'xr-frame'); }
          });
        });
      }).catch((e) => { report(e, 'xr-start'); toast('VR could not start.'); try { session.end(); } catch (x) { onXREnd(); } });
    }
    const xrMat = new T.Matrix4();
    function xrRayHit(c) {
      xrMat.identity().extractRotation(c.matrixWorld);
      ray.ray.origin.setFromMatrixPosition(c.matrixWorld);
      ray.ray.direction.set(0, 0, -1).applyMatrix4(xrMat);
      const list = [];
      items.forEach((it) => { if ((it.kind === 'card' || it.kind === 'more') && !it.dying && it.op > 0.3) list.push(it.mesh); });
      const hit = ray.intersectObjects(list, false)[0];
      return hit ? hit.object.userData.item : null;
    }
    function xrFrame(dt, t) {
      const X = S.xr;
      if (!X) return;
      let hov = null;
      X.controllers.forEach((c, i) => { const h = xrRayHit(c); if (h) hov = h; if (X.lines[i]) X.lines[i].material.opacity = h ? 1 : 0.55; });
      S.hover = X.focus ? null : hov;
      S.focus = X.focus;
      update(dt, t);
    }
    function onXRSelect(e) {
      const X = S.xr;
      if (!X) return;
      const it = xrRayHit(e.target);
      if (!it) { X.focus = null; return; }
      if (it.kind === 'more' || X.focus === it) { X.openId = it.kind === 'card' ? it.data.id : null; X.kind = it.kind; X.pick = it; try { X.session.end(); } catch (x) { onXREnd(); } return; }
      X.focus = it;
    }
    function onXREnd() {
      const X = S.xr;
      if (!X || X.ended) return;
      X.ended = true;
      S.xr = null;
      const r = G.renderer;
      try { if (r) { r.setAnimationLoop(null); r.xr.enabled = false; } } catch (e) { /* noop */ }
      X.controllers.forEach((c) => { try { c.removeEventListener('select', onXRSelect); scene.remove(c); } catch (e) { /* noop */ } });
      X.lines.forEach((l) => { try { l.geometry.dispose(); l.material.dispose(); if (l.parent) l.parent.remove(l); } catch (e) { /* noop */ } });
      scene.background = X.bg || null;
      world.position.y = 0;
      S.focus = null; S.hover = null;
      try { G.resume(); } catch (e) { report(e, 'xr-resume'); }
      if (S.view) S.view.invalidate();
      if (S.alive && X.pick) activate(X.pick);
    }
    function endXR() { const X = S.xr; if (X) { try { X.session.end(); } catch (e) { onXREnd(); } } }

    // ── theme / fonts ──
    function retheme() {
      if (!S.alive) return;
      P = palette();
      try {
        scene.fog.color.copy(G.color(P.bg));
        floorMat.color.copy(G.color(floorColor())); floorMat.envMapIntensity = P.light ? 0.5 : 0.16;
        gridMat.color.copy(G.color(P.light ? P.gold500 : P.gold300)); gridMat.opacity = P.light ? 0.2 : 0.1;
        poolMat.color.copy(G.color(P.gold300)); poolMat.opacity = P.light ? 0.16 : 0.13;
        poolMat.blending = P.light ? T.NormalBlending : T.AdditiveBlending; poolMat.needsUpdate = true;
        lampMat.color.copy(G.color(P.light ? P.gold500 : P.gold200)); lampMat.opacity = P.light ? 0.7 : 0.85;
        lampMat.blending = P.light ? T.NormalBlending : T.AdditiveBlending; lampMat.needsUpdate = true;
        drawGhost(ghostCv, P); ghostTex.needsUpdate = true;
      } catch (e) { report(e, 'retheme'); }
      items.forEach((it) => { if (it.own) { draw(it); it.sig = sigOf(it); } });
      if (S.view) S.view.invalidate();
    }
    fontsReady().then(() => { if (S.alive) { retheme(); frame(); } });

    // ── mount the view on the shared hub ──
    const view = G.view(host, {
      scene, camera, update, interactive: true, ambient: true, clearAlpha: 0, poster: 'none', intro: 2600,
      name: 'Command Room', label: 'Command Room: your applications arranged by stage around you. Drag to look around.',
      onResize(w, h) { S.w = w; S.h = h; frame(); },
    });
    S.view = view;
    const el = view.el;
    if (el && !view.safe) {
      el.style.touchAction = 'none';
      el.tabIndex = 0;
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('pointerleave', onLeaveEl);
      el.addEventListener('wheel', onWheel, { passive: false });
      el.addEventListener('dblclick', onDbl);
      el.addEventListener('keydown', onKey);
    }
    S.w = host.clientWidth; S.h = host.clientHeight;
    frame();

    const inst = {
      mode: '3d',
      cap: CAP,
      view,
      setData(models) { if (S.alive) layout(models); },
      retheme,
      reframe: frame,
      recenter,
      toggleGyro,
      gyroOn: () => GY.on,
      enterVR,
      xrSupported,
      failed: () => !!(view && view.safe),
      focusStage(key) {
        const g = S.plan && (S.plan.segs.find((x) => x.key === key) || S.plan.csegs.find((x) => x.key === key));
        if (!g) return;
        const closed = g.closed;
        if (GY.on && GY.have) { S.yaw = wrapA(g.thc - GY.fy); if (S.view) S.view.kick(400); return; }
        tweenTo(clamp(g.thc, -YAW_MAX, YAW_MAX), closed ? clamp((RING.e * DEG) - S.p0 + 6 * DEG, -PITCH_MAX, 0) : 0, S.tDolly, 1000);
      },
      focusItem(key) {
        const it = items.get(key);
        S.focus = it || null;
        if (!it) { if (S.view) S.view.kick(400); return null; }
        const th = Math.atan2(-it.tbase.x, -it.tbase.z);
        const el2 = Math.atan2(it.tbase.y - EYE, Math.hypot(it.tbase.x, it.tbase.z));
        if (!(GY.on && GY.have)) tweenTo(clamp(th, -YAW_MAX, YAW_MAX), clamp(el2 - S.p0, -PITCH_MAX, PITCH_MAX), S.tDolly, 700);
        if (S.view) S.view.kick(900);
        return it.data;
      },
      open(key) { const it = items.get(key); if (it) activate(it); },
      cardPoint(id) {
        const it = items.get('j:' + id) || items.get(id);
        if (!it || !S.view || !S.view.el) return null;
        const p = S.view.project(it.mesh.position);
        const r = S.view.el.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y, visible: p.visible, op: it.op };
      },
      debug() {
        let cards = 0, more = 0, ghosts = 0, labels = 0, dying = 0;
        items.forEach((it) => { if (it.dying) { dying++; return; } if (it.kind === 'card') cards++; else if (it.kind === 'more') more++; else if (it.kind === 'ghost') ghosts++; else labels++; });
        const mem = G.renderer && G.renderer.info ? G.renderer.info.memory : null;
        return { mode: '3d', yaw: S.yaw / DEG, pitch: S.pitch / DEG, p0: S.p0 / DEG, fov: camera.fov, aspect: camera.aspect, dolly: S.dolly, cards, more, ghosts, labels, dying, items: items.size, cap: CAP, tex: TW + 'x' + TH,
          textures: mem ? mem.textures : null, geometries: mem ? mem.geometries : null, frames: view.frames, hover: S.hover ? S.hover.key : null, gyro: GY.on, xr: !!S.xr,
          detailed: S.plan ? S.plan.detailed : 0, span: S.plan ? S.plan.width / DEG : 0 };
      },
      destroy() {
        if (!S.alive) return;
        endXR();
        stopGyro();
        S.alive = false;
        try {
          if (el) {
            el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointercancel', onUp); el.removeEventListener('pointerleave', onLeaveEl); el.removeEventListener('wheel', onWheel);
            el.removeEventListener('dblclick', onDbl); el.removeEventListener('keydown', onKey);
          }
        } catch (e) { /* noop */ }
        items.forEach((it) => { if (it.own && it.cv) { it.cv.width = 1; it.cv.height = 1; } });
        try { view.dispose(); } catch (e) { report(e, 'dispose'); }      // geometries, materials, our textures
        try { ghostTex.dispose(); fadeTex.dispose(); } catch (e) { /* noop */ }
        ghostCv.width = 1; ghostCv.height = 1; fadeCv.width = 1; fadeCv.height = 1;
        items.clear();
      },
    };
    return inst;
  }

  function gridGeometry(T) {
    const pts = [];
    [1.1, 1.9, 2.25, 3.62, 4.5, 5.6, 7, 8.8, 11].forEach((r) => {
      const n = Math.ceil(r * 46);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        pts.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      }
    });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, r0 = i % 3 === 0 ? 1.1 : 2.25;
      pts.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * 11, 0, Math.sin(a) * 11);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    return g;
  }

  // ───────────────────────── Safe Mode: CSS-3D stage carousel ─────────────────────────
  function create2D(R) {
    const box = R.el.flat;
    box.hidden = false;
    R.host.classList.add('is-2d');
    let raf = 0, alive = true, track = null, models = [];
    const card = (m) => {
      const a = m.a, nx = nextInfo(m);
      const sv = a && a.score != null ? a.score : '—';
      let sc = '';
      try { sc = CB.UI && CB.UI.scoreClass ? CB.UI.scoreClass(a) : ''; } catch (e) { sc = ''; }
      let mono = '';
      try { mono = CB.UI && CB.UI.mono ? CB.UI.mono(m.j.company, 34) : ''; } catch (e) { mono = ''; }
      return `<button type="button" class="r2-card${m.st.key === 'offer' || m.st.key === 'accepted' ? ' is-gold' : ''}" data-id="${E(m.id)}" style="--c:var(--st-${E(m.st.key)})">
        <span class="r2-top">${mono}<span class="r2-co"><b>${E(m.j.company || 'Company')}</b><small>${E(metaLine(m))}</small></span><span class="r2-chip"><i></i>${E(m.st.label)}</span></span>
        <span class="r2-ti">${E(m.j.title || 'Role')}</span>
        <span class="r2-m"><span><small>ATS fit</small><b class="score-${E(sc)}">${E(sv)}${m.ko && !m.closed ? '<em>KO</em>' : ''}</b></span><span><small>Chance</small><b>${E(probText(a))}</b></span><span class="r2-nx"><small>${E(nx.label)}</small><b class="${nx.on ? '' : 'is-off'}">${E(nx.a)}</b></span></span>
      </button>`;
    };
    const more = (g) => `<button type="button" class="r2-card r2-more" data-more="${E(g.key)}"><b>+${g.more}</b><span>more in ${E(stageName(g.s).toLowerCase())}</span><small>Open in pipeline →</small></button>`;
    function render() {
      const plan = makePlan(models, 60);
      const col = (g) => `<section class="r2-col${g.n ? '' : ' is-empty'}" data-stage="${E(g.key)}" style="--c:var(--st-${E(g.key)})">
          <header><h3>${E(stageName(g.s))}</h3><span>${pad2(g.n)}</span></header>
          <div class="r2-cards">${g.items.slice(0, g.detail).map(card).join('')}${g.more > 0 ? more(g) : ''}${g.n ? '' : '<div class="r2-ghost"><i>Nothing here yet</i></div>'}</div>
        </section>`;
      box.innerHTML = `<div class="r2-track" tabindex="0" aria-label="Pipeline stages">${plan.segs.map(col).join('')}</div>
        ${plan.csegs.length ? `<div class="r2-closed" aria-label="Closed outcomes">${plan.csegs.map((g) => `<div class="r2-cgroup" style="--c:var(--st-${E(g.key)})"><h4>${E(g.s.label)} <span>${pad2(g.n)}</span></h4><div class="r2-crow">${g.items.slice(0, g.detail).map(card).join('')}${g.more > 0 ? more(g) : ''}</div></div>`).join('')}</div>` : ''}`;
      track = box.querySelector('.r2-track');
      if (track) track.addEventListener('scroll', schedule, { passive: true });
      curve();
    }
    function schedule() { if (!raf && alive) raf = requestAnimationFrame(curve); }
    function curve() {
      raf = 0;
      if (!track || !alive) return;
      const tr = track.getBoundingClientRect();
      const cx = tr.left + tr.width / 2;
      const half = Math.max(1, tr.width / 2);
      track.querySelectorAll('.r2-col').forEach((c) => {
        const r = c.getBoundingClientRect();
        const t = clamp((r.left + r.width / 2 - cx) / half, -1.6, 1.6);
        c.style.transform = `rotateY(${(-t * 26).toFixed(2)}deg) translateZ(${(-Math.abs(t) * 110).toFixed(1)}px)`;
        c.style.opacity = String(clamp(1 - Math.abs(t) * 0.32, 0.4, 1).toFixed(3));
      });
    }
    function onClick(e) {
      const b = e.target.closest && e.target.closest('[data-id],[data-more]');
      if (!b || !box.contains(b)) return;
      if (b.hasAttribute('data-more')) { try { if (CB.Views) CB.Views._boardFocus = b.getAttribute('data-more'); } catch (x) { /* noop */ } location.hash = 'board'; return; }
      R.open(b.getAttribute('data-id'));
    }
    box.addEventListener('click', onClick);
    window.addEventListener('resize', schedule);
    return {
      mode: '2d',
      setData(list) { models = list; render(); },
      retheme() { /* CSS tokens follow the theme */ },
      reframe: schedule,
      recenter() { if (track) { const first = track.querySelector('.r2-col'); const n = track.querySelectorAll('.r2-col').length; const mid = track.querySelectorAll('.r2-col')[Math.floor(n / 2)] || first; if (mid) track.scrollTo({ left: mid.offsetLeft - (track.clientWidth - mid.offsetWidth) / 2, behavior: reduced() ? 'auto' : 'smooth' }); } },
      toggleGyro() {}, gyroOn: () => false, enterVR() {}, xrSupported: () => Promise.resolve(false), failed: () => false,
      focusStage(key) { const c = track && track.querySelector(`[data-stage="${key}"]`); if (c) track.scrollTo({ left: c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2, behavior: reduced() ? 'auto' : 'smooth' }); else { const cl = box.querySelector('.r2-closed'); if (cl) cl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } },
      focusItem() { return null; }, open() {}, cardPoint(id) { const b = box.querySelector(`[data-id="${CSS && CSS.escape ? CSS.escape(id) : id}"]`); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: true, op: 1 }; },
      debug() { return { mode: '2d', cards: box.querySelectorAll('[data-id]').length, more: box.querySelectorAll('[data-more]').length, columns: box.querySelectorAll('.r2-col').length }; },
      destroy() {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        box.removeEventListener('click', onClick);
        window.removeEventListener('resize', schedule);
        box.innerHTML = ''; box.hidden = true;
        R.host.classList.remove('is-2d');
      },
    };
  }

  // ───────────────────────── view controller (HUD, filters, lifecycle) ─────────────────────────
  const R = { host: null, root: null, inst: null, el: {}, filter: 'all', q: '', models: [], vis: [], unsub: [], timer: 0, hintT: 0, force2D: false, qT: 0, vrOk: false };

  R.open = (id) => {
    try { if (CB.UI && CB.UI.openJob) CB.UI.openJob(id, 'overview'); } catch (e) { report(e, 'open'); }
  };
  R.dismissHint = () => {
    const h = R.el.hint;
    if (!h || h.hidden || h.classList.contains('is-out')) return;
    h.classList.add('is-out');
    lsSet('cb.room.hint', String((+lsGet('cb.room.hint') || 0) + 1));
    clearTimeout(R.hintT);
    R.hintT = setTimeout(() => { if (R.el.hint) R.el.hint.hidden = true; }, 700);
  };
  R.setGyroUI = (on) => {
    const b = R.el.gyro;
    if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); const s = b.querySelector('span'); if (s) s.textContent = on ? 'Immersive on' : 'Immersive'; }
  };

  function want3D() {
    if (R.force2D) return false;
    try { return !!(window.THREE && CB.GL && CB.GL.tier() !== 'safe' && CB.GL.available()); } catch (e) { return false; }
  }
  function hudHTML() {
    const touchHint = TOUCH && !window.matchMedia('(hover: hover)').matches;
    return `<div class="room-vig" aria-hidden="true"></div>
      <div class="room-2d" hidden></div>
      <div class="room-hud">
        <div class="room-bar glass">
          <div class="room-seg" role="radiogroup" aria-label="Show">${FILTERS.map(([k, l]) => `<button type="button" role="radio" data-f="${k}" aria-checked="${R.filter === k ? 'true' : 'false'}">${l}</button>`).join('')}</div>
          <label class="room-q"><button type="button" class="room-q-btn" aria-label="Search">${svg(IC.search)}</button><input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="Search the room" aria-label="Search applications in the room" value="${E(R.q)}"></label>
          <span class="room-n" aria-live="polite"></span>
        </div>
        <div class="room-legend glass" role="toolbar" aria-label="Go to a stage"></div>
      </div>
      <div class="room-empty" hidden></div>
      <div class="room-dock">
        <button type="button" class="room-btn" data-act="gyro" aria-pressed="false" hidden>${svg(IC.gyro)}<span>Immersive</span></button>
        <button type="button" class="room-btn" data-act="recenter" title="Recenter (double-click)">${svg(IC.recenter)}<span>Recenter</span></button>
        <button type="button" class="room-btn room-btn-vr" data-act="vr" hidden>${svg(IC.vr)}<span>Enter VR</span></button>
      </div>
      <div class="room-hint" hidden>${touchHint ? 'Drag to look around · Pinch to move closer · Tap a card to open it' : 'Drag to look around · Scroll to turn · Pinch or ⌃ scroll to move closer · Double-click to recenter'}</div>
      <div class="room-focus" hidden aria-hidden="true"></div>
      <div class="room-sr" aria-label="Applications in the room"></div>`;
  }
  function mountHost(root) {
    const host = document.createElement('div');
    host.className = 'room';
    host.innerHTML = hudHTML();
    R.host = host;
    R.root = root;
    const q = (s) => host.querySelector(s);
    R.el = { hud: q('.room-hud'), bar: q('.room-bar'), seg: q('.room-seg'), input: q('.room-q input'), qbtn: q('.room-q-btn'), n: q('.room-n'), legend: q('.room-legend'),
      empty: q('.room-empty'), dock: q('.room-dock'), gyro: q('[data-act="gyro"]'), recenter: q('[data-act="recenter"]'), vr: q('[data-act="vr"]'),
      hint: q('.room-hint'), focus: q('.room-focus'), sr: q('.room-sr'), flat: q('.room-2d') };
    R.el.seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      R.filter = b.getAttribute('data-f');
      R.el.seg.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
      apply();
    });
    R.el.seg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const bs = Array.from(R.el.seg.querySelectorAll('[data-f]'));
      const i = bs.findIndex((x) => x.getAttribute('aria-checked') === 'true');
      const n = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length];
      if (n) { n.focus(); n.click(); e.preventDefault(); }
    });
    R.el.input.addEventListener('input', () => {
      clearTimeout(R.qT);
      R.qT = setTimeout(() => { R.q = R.el.input.value.trim().toLowerCase(); apply(true); }, 160);
    });
    R.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { R.el.input.value = ''; R.q = ''; apply(); R.el.input.blur(); }
      if (e.key === 'Enter') { const m = R.vis[0]; if (m && R.vis.length === 1) R.open(m.id); }
    });
    R.el.input.addEventListener('focus', () => R.el.bar.classList.add('is-search'));
    R.el.input.addEventListener('blur', () => { if (!R.el.input.value) R.el.bar.classList.remove('is-search'); });
    R.el.qbtn.addEventListener('click', (e) => { e.preventDefault(); R.el.bar.classList.add('is-search'); R.el.input.focus(); });
    R.el.legend.addEventListener('click', (e) => {
      const b = e.target.closest('[data-stage]');
      if (b && R.inst) R.inst.focusStage(b.getAttribute('data-stage'));
    });
    R.el.dock.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !R.inst) return;
      const a = b.getAttribute('data-act');
      if (a === 'recenter') R.inst.recenter();
      else if (a === 'gyro') R.inst.toggleGyro();
      else if (a === 'vr') R.inst.enterVR();
    });
    R.el.empty.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.getAttribute('data-act');
      try {
        if (a === 'add' && CB.UI && CB.UI.addJob) CB.UI.addJob();
        else if (a === 'samples' && CB.Store && CB.Store.loadSamples) CB.Store.loadSamples();
        else if (a === 'reset') { R.filter = 'all'; R.q = ''; R.el.input.value = ''; R.el.bar.classList.remove('is-search'); R.el.seg.querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-checked', x.getAttribute('data-f') === 'all' ? 'true' : 'false')); apply(); }
      } catch (x) { report(x, 'empty-action'); }
    });
    R.el.sr.addEventListener('focusin', (e) => {
      const b = e.target.closest('[data-key]');
      if (!b || !R.inst) return;
      const d = R.inst.focusItem(b.getAttribute('data-key'));
      const f = R.el.focus;
      if (f) {
        if (d && d.j) { f.innerHTML = `<b>${E(d.j.company || 'Company')}</b><span>${E(d.j.title || '')}</span><kbd>Enter</kbd>`; f.hidden = false; }
        else if (d && d.stage) { f.innerHTML = `<b>+${E(d.n)} more</b><span>${E(stageName(d.stage))}</span><kbd>Enter</kbd>`; f.hidden = false; }
        else f.hidden = true;
      }
    });
    R.el.sr.addEventListener('focusout', () => { setTimeout(() => { if (R.el.sr && !R.el.sr.contains(document.activeElement)) { if (R.el.focus) R.el.focus.hidden = true; if (R.inst) R.inst.focusItem(null); } }, 0); });
    R.el.sr.addEventListener('click', (e) => {
      const b = e.target.closest('[data-key]');
      if (b && R.inst) { const k = b.getAttribute('data-key'); if (R.inst.mode === '3d') R.inst.open(k); else if (k.indexOf('j:') === 0) R.open(k.slice(2)); }
    });
    const n = +lsGet('cb.room.hint') || 0;
    if (n < 2 && R.el.hint) {
      R.el.hint.hidden = false;
      clearTimeout(R.hintT);
      R.hintT = setTimeout(() => R.dismissHint(), 7000);
    }
    if (R.el.gyro && TOUCH && 'DeviceOrientationEvent' in window) R.el.gyro.hidden = false;
    return host;
  }
  function sizeHost() {
    const host = R.host;
    if (!host || !host.isConnected) return;
    const top = document.querySelector('.main > .top') || document.querySelector('.top');
    const th = top ? top.offsetHeight : 64;
    host.style.setProperty('--room-top', th + 'px');
    const r = host.getBoundingClientRect();
    const sy = window.scrollY || window.pageYOffset || 0;
    const h = Math.max(320, Math.round(window.innerHeight - (r.top + sy) + sy));
    if (host.style.height !== h + 'px') host.style.height = h + 'px';
    if (R.inst && R.inst.reframe) R.inst.reframe();
  }
  function apply(fromSearch) {
    const wk = weekBounds();
    const q = R.q;
    R.vis = R.models.filter((m) => passFilter(m, R.filter, wk) && passSearch(m, q));
    if (R.inst) { try { R.inst.setData(R.vis); } catch (e) { report(e, 'setData'); } }
    renderHud();
    if (fromSearch && q && R.vis.length && R.inst && R.inst.mode === '3d') {
      const first = R.vis.slice().sort(cmp)[0];
      if (first) R.inst.focusItem('j:' + first.id);
      setTimeout(() => { if (R.inst && R.inst.mode === '3d' && R.el.sr && !R.el.sr.contains(document.activeElement)) R.inst.focusItem(null); }, 1600);
    }
  }
  function renderHud() {
    const el = R.el;
    if (!el.legend) return;
    const cnt = {};
    R.vis.forEach((m) => { cnt[m.st.key] = (cnt[m.st.key] || 0) + 1; });
    const closedN = closedStages().reduce((x, s) => x + (cnt[s.key] || 0), 0);
    el.legend.innerHTML = prog().map((s) => `<button type="button" data-stage="${E(s.key)}" class="${cnt[s.key] ? '' : 'is-zero'}" style="--c:var(--st-${E(s.key)})" title="Go to ${E(s.label)}"><i></i><span>${E(stageName(s))}</span><b>${cnt[s.key] || 0}</b></button>`).join('') +
      `<span class="sep" aria-hidden="true"></span><button type="button" data-stage="${E((closedStages().find((s) => cnt[s.key]) || closedStages()[0] || { key: 'rejected' }).key)}" class="${closedN ? '' : 'is-zero'}" style="--c:var(--st-rejected)" title="Look down at closed outcomes"><i></i><span>Closed</span><b>${closedN}</b></button>`;
    const total = R.models.length, shown = R.vis.length;
    el.n.textContent = total ? (shown === total ? `${total} in the room` : `${shown} of ${total}`) : '';
    // empty states
    if (!total) {
      el.empty.innerHTML = `<div class="room-empty-card"><div class="room-empty-k">Command Room</div><h2>Your room is waiting.</h2><p>Every application you track takes its place here, arranged by stage all around you. Drag to look around; tap a card to open it.</p><div class="room-empty-a"><button type="button" class="btn btn-accent" data-act="add">Add a job</button><button type="button" class="btn" data-act="samples">Load examples</button></div></div>`;
      el.empty.hidden = false;
    } else if (!shown) {
      el.empty.innerHTML = `<div class="room-empty-card is-sm"><div class="room-empty-k">No matches</div><h2>Nothing in this view.</h2><p>${R.q ? `No application matches “${E(R.q)}”${R.filter !== 'all' ? ' with this filter' : ''}.` : 'No application fits this filter yet.'}</p><div class="room-empty-a"><button type="button" class="btn" data-act="reset">Show everything</button></div></div>`;
      el.empty.hidden = false;
    } else { el.empty.hidden = true; el.empty.innerHTML = ''; }
    // accessible list of what is in the room (keyboard: Tab through cards; the camera follows)
    const sr = [];
    const plan = makePlan(R.vis, (R.inst && R.inst.cap) || 60);
    plan.segs.concat(plan.csegs).forEach((g) => {
      g.items.slice(0, g.detail).forEach((m) => sr.push(`<button type="button" data-key="j:${E(m.id)}">${E(m.j.company || 'Company')}, ${E(m.j.title || 'role')}. ${E(m.st.label)}. ATS ${m.a && m.a.score != null ? E(m.a.score) : 'not scored'}, interview chance ${E(probText(m.a))}.</button>`));
      if (g.more > 0) sr.push(`<button type="button" data-key="m:${E(g.key)}">${g.more} more in ${E(g.s.label)}. Opens the pipeline.</button>`);
    });
    el.sr.innerHTML = sr.join('');
  }
  function ensureMode() {
    const w3 = want3D();
    if (R.inst && (R.inst.mode === '3d') === w3 && !(R.inst.failed && R.inst.failed())) return;
    if (R.inst && R.inst.failed && R.inst.failed()) R.force2D = true;
    if (R.inst) { try { R.inst.destroy(); } catch (e) { report(e, 'destroy'); } R.inst = null; }
    try { R.inst = want3D() ? create3D(R) : create2D(R); } catch (e) { report(e, 'create'); try { R.force2D = true; R.inst = create2D(R); } catch (x) { report(x, 'create2d'); R.inst = null; } }
    if (R.el.recenter) R.el.recenter.hidden = false;
    if (R.el.gyro) R.el.gyro.hidden = !(R.inst && R.inst.mode === '3d' && TOUCH && 'DeviceOrientationEvent' in window);
    if (R.el.vr) {
      R.el.vr.hidden = true;
      if (R.inst && R.inst.mode === '3d') R.inst.xrSupported().then((ok) => { if (ok && R.el.vr && R.inst && R.inst.mode === '3d') R.el.vr.hidden = false; });
    }
  }
  function onResize() { sizeHost(); }
  function leave() {
    clearInterval(R.timer); R.timer = 0;
    clearTimeout(R.hintT); clearTimeout(R.qT);
    R.unsub.forEach((f) => { try { f(); } catch (e) { /* noop */ } });
    R.unsub = [];
    window.removeEventListener('resize', onResize);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
    if (R.inst) { try { R.inst.destroy(); } catch (e) { report(e, 'destroy'); } }
    R.inst = null;
    if (R.host && R.host.parentNode) R.host.parentNode.removeChild(R.host);
    if (R.root) R.root.classList.remove('cb-room-on');
    R.host = null; R.root = null; R.el = {}; R.force2D = false; R.vis = []; R.models = [];
  }

  function render(root, opts) {
    injectCSS();
    const fresh = !R.host;
    if (fresh) {
      mountHost(root);
      root.innerHTML = '';
      root.appendChild(R.host);
      root.classList.add('cb-room-on');
      sizeHost();
      window.addEventListener('resize', onResize);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
      R.unsub.push(CB.on('theme', () => { if (R.inst) R.inst.retheme(); }));
      if (CB.GL && CB.GL.on) R.unsub.push(CB.GL.on('tier', () => { setTimeout(() => { if (R.host) { ensureMode(); apply(); } }, 0); }));
      R.timer = setInterval(() => { if (R.inst && R.inst.mode === '3d' && R.inst.failed()) { ensureMode(); apply(); } }, 2000);
    } else if (R.host.parentNode !== root) {
      root.innerHTML = '';
      root.appendChild(R.host);
      root.classList.add('cb-room-on');
      R.root = root;
    }
    R.models = readModels();
    ensureMode();
    apply();
    if (fresh) requestAnimationFrame(() => { sizeHost(); });
    if (opts && typeof opts.onLeave === 'function') opts.onLeave(leave);
  }

  // ───────────────────────── styles (tokens only) ─────────────────────────
  function injectCSS() {
    if (!CB.css) return;
    CB.css('room', `
#view.cb-room-on { max-width: none !important; padding: 0 !important; }
.room { --room-top: 64px; position: relative; display: block; width: 100%; height: 100vh; margin-top: calc(-1 * var(--room-top)); overflow: hidden; isolation: isolate;
  background: var(--bg-0); color: var(--ink-1); -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.room > canvas.cbgl-view { touch-action: none; cursor: grab; outline: none; }
.room > canvas.cbgl-view:focus-visible { box-shadow: inset 0 0 0 2px var(--gold-line); }
.room.is-hover > canvas.cbgl-view { cursor: pointer; }
.room.is-dragging > canvas.cbgl-view { cursor: grabbing; }
.room-vig { position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--bg-0) 86%, transparent) 0, color-mix(in srgb, var(--bg-0) 34%, transparent) calc(var(--room-top) + 36px), transparent calc(var(--room-top) + 130px)),
    radial-gradient(125% 100% at 50% 44%, transparent 52%, rgba(0, 0, 0, .58) 100%); }
:root[data-theme="light"] .room-vig { background: linear-gradient(to bottom, color-mix(in srgb, var(--bg-0) 88%, transparent) 0, color-mix(in srgb, var(--bg-0) 40%, transparent) calc(var(--room-top) + 36px), transparent calc(var(--room-top) + 130px)), radial-gradient(125% 100% at 50% 44%, transparent 55%, rgba(90, 68, 28, .12) 100%); }
@media (prefers-color-scheme: light) { :root:not([data-theme]) .room-vig { background: linear-gradient(to bottom, color-mix(in srgb, var(--bg-0) 88%, transparent) 0, transparent calc(var(--room-top) + 130px)), radial-gradient(125% 100% at 50% 44%, transparent 55%, rgba(90, 68, 28, .12) 100%); } }
.room-hud { position: absolute; z-index: 4; left: 0; right: 0; top: calc(var(--room-top) + 2px); display: grid; justify-items: center; gap: 8px; padding: 0 24px; pointer-events: none; }
.room-hud > * { pointer-events: auto; }
.room .glass { background: var(--glass-thin); border: 1px solid var(--glass-line); box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-hi); -webkit-backdrop-filter: blur(22px) saturate(var(--glass-sat)); backdrop-filter: blur(22px) saturate(var(--glass-sat)); }
.room-bar { display: flex; align-items: center; gap: 6px; padding: 5px; border-radius: var(--r-pill); max-width: 100%; }
.room-seg { display: flex; gap: 2px; min-width: 0; }
.room-seg button { -webkit-appearance: none; appearance: none; border: 0; margin: 0; background: transparent; color: var(--ink-2); font: 500 12.5px/1 var(--f-ui); letter-spacing: .005em; height: 32px; padding: 0 14px; border-radius: var(--r-pill); cursor: pointer; white-space: nowrap;
  transition: color var(--dur-1) var(--ease-out), background-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out); }
.room-seg button:hover { color: var(--ink-1); background: color-mix(in srgb, var(--ink-1) 5%, transparent); }
.room-seg button[aria-checked="true"] { color: var(--gold-200); background: var(--gold-soft); box-shadow: inset 0 0 0 1px var(--gold-line); }
:root[data-theme="light"] .room-seg button[aria-checked="true"] { color: var(--gold-600); }
.room-seg button:focus-visible, .room-btn:focus-visible, .room-legend button:focus-visible, .room-q-btn:focus-visible { outline: 2px solid var(--gold-300); outline-offset: 2px; }
.room-q { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 4px; border-radius: var(--r-pill); background: color-mix(in srgb, var(--surface-1) 58%, transparent); box-shadow: inset 0 0 0 1px var(--line-2); color: var(--ink-3); cursor: text; }
.room-q:focus-within { box-shadow: inset 0 0 0 1px var(--gold-line), 0 0 0 3px var(--gold-soft); color: var(--ink-2); }
.room-q-btn { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
.room-q svg { width: 15px; height: 15px; }
.room-q input { -webkit-appearance: none; appearance: none; border: 0; outline: 0; background: transparent; width: 190px; min-width: 0; padding: 0; font: 450 13px/1 var(--f-ui); color: var(--ink-1); -webkit-user-select: text; user-select: text; }
.room-q input::placeholder { color: var(--ink-3); }
.room-q input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
.room-n { font: 500 10.5px/1 var(--f-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); padding: 0 12px 0 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.room-n:empty { display: none; }
.room-legend { display: flex; align-items: center; gap: 1px; padding: 3px; border-radius: var(--r-pill); max-width: 100%; overflow-x: auto; scrollbar-width: none; touch-action: pan-x; }
.room-legend::-webkit-scrollbar { display: none; }
.room-legend button { display: inline-flex; align-items: center; gap: 7px; height: 27px; padding: 0 10px; border: 0; margin: 0; background: transparent; border-radius: var(--r-pill); color: var(--ink-2); font: 500 11.5px/1 var(--f-ui); cursor: pointer; white-space: nowrap; flex: none;
  transition: color var(--dur-1) var(--ease-out), background-color var(--dur-1) var(--ease-out), opacity var(--dur-2) var(--ease-out); }
.room-legend button i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 22%, transparent), 0 0 10px color-mix(in srgb, var(--c) 55%, transparent); flex: none; }
.room-legend button b { font: 500 10.5px/1 var(--f-mono); color: var(--ink-3); font-variant-numeric: tabular-nums; }
.room-legend button:hover { color: var(--ink-1); background: color-mix(in srgb, var(--ink-1) 6%, transparent); }
.room-legend button.is-zero { opacity: .42; }
.room-legend .sep { width: 1px; height: 14px; margin: 0 5px; background: var(--line-3); flex: none; }
.room-dock { position: absolute; z-index: 4; left: 24px; bottom: 22px; display: flex; gap: 8px; }
.room-btn { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 16px 0 13px; border-radius: var(--r-pill); border: 1px solid var(--glass-line); background: var(--glass-thin); color: var(--ink-1);
  font: 500 12.5px/1 var(--f-ui); letter-spacing: .005em; cursor: pointer; box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-hi);
  -webkit-backdrop-filter: blur(22px) saturate(var(--glass-sat)); backdrop-filter: blur(22px) saturate(var(--glass-sat)); transition: transform var(--dur-1) var(--ease-out), border-color var(--dur-1), color var(--dur-1); }
.room-btn svg { width: 16px; height: 16px; flex: none; }
.room-btn:hover { border-color: var(--line-3); }
.room-btn:active { transform: scale(.97); }
.room-btn[aria-pressed="true"] { color: var(--gold-200); border-color: var(--gold-line); background: color-mix(in srgb, var(--gold-300) 14%, var(--glass-thin)); }
:root[data-theme="light"] .room-btn[aria-pressed="true"] { color: var(--gold-600); }
.room-btn-vr { background: var(--metal-cta, var(--gold-300)); color: var(--gold-ink); border-color: transparent; box-shadow: inset 0 1px 0 rgba(255, 252, 240, .6), inset 0 -1px 0 rgba(90, 64, 20, .3), var(--e-gold); }
.room-btn[hidden] { display: none; }
.room-hint, .room-focus { position: absolute; z-index: 4; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: calc(100% - 32px); padding: 10px 16px; border-radius: var(--r-pill);
  background: var(--glass-thin); border: 1px solid var(--glass-line); -webkit-backdrop-filter: blur(22px) saturate(var(--glass-sat)); backdrop-filter: blur(22px) saturate(var(--glass-sat));
  font: 500 10.5px/1.25 var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
  animation: roomHintIn var(--dur-4) var(--ease-out) both; transition: opacity var(--dur-4) var(--ease-out), transform var(--dur-4) var(--ease-out); }
.room-hint.is-out { opacity: 0; transform: translate(-50%, 8px); }
.room-focus { display: flex; align-items: center; gap: 10px; text-transform: none; letter-spacing: 0; font: 450 13px/1.2 var(--f-ui); color: var(--ink-2); bottom: 76px; box-shadow: var(--e-gold); }
.room-focus b { color: var(--ink-1); font-weight: 600; }
.room-focus kbd { margin-left: 4px; }
.room-hint[hidden], .room-focus[hidden] { display: none; }
@keyframes roomHintIn { from { opacity: 0; transform: translate(-50%, 8px); } }
.room-empty { position: absolute; z-index: 3; inset: 0; display: grid; place-items: center; padding: calc(var(--room-top) + 96px) 20px 96px; pointer-events: none; }
.room-empty[hidden] { display: none; }
.room-empty-card { pointer-events: auto; position: relative; max-width: 470px; text-align: center; padding: 36px 36px 30px; border-radius: var(--r-xl); background: var(--glass); border: 1px solid var(--glass-line);
  box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-hi); -webkit-backdrop-filter: blur(26px) saturate(var(--glass-sat)); backdrop-filter: blur(26px) saturate(var(--glass-sat)); animation: roomRise var(--dur-4) var(--ease-out) both; }
.room-empty-card::after { content: ""; position: absolute; left: 50%; top: 0; width: 120px; height: 1px; transform: translateX(-50%); background: linear-gradient(90deg, transparent, var(--gold-300), transparent); opacity: .8; }
.room-empty-k { font: 500 10.5px/1 var(--f-mono); letter-spacing: .24em; text-transform: uppercase; color: var(--gold-300); }
:root[data-theme="light"] .room-empty-k { color: var(--gold-500); }
.room-empty h2 { margin: 16px 0 12px; font: 400 42px/1.04 var(--f-display); letter-spacing: -.02em; color: var(--ink-1); font-variation-settings: "opsz" 72; }
.room-empty-card.is-sm h2 { font-size: 32px; }
.room-empty p { margin: 0 auto 24px; max-width: 36ch; color: var(--ink-2); font: 400 14px/1.6 var(--f-ui); }
.room-empty-a { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
@keyframes roomRise { from { opacity: 0; transform: translateY(10px) scale(.985); } }
.room-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
/* Safe Mode: CSS-3D stage carousel */
.room-2d { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; gap: 14px; padding: calc(var(--room-top) + 108px) 0 84px; perspective: 1300px; perspective-origin: 50% 42%; overflow: hidden; }
.room-2d[hidden] { display: none; }
.r2-track { flex: 1 1 auto; min-height: 0; display: flex; gap: 18px; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; padding: 8px calc(50% - 150px); scrollbar-width: none; touch-action: pan-x pan-y; outline: none; }
.r2-track::-webkit-scrollbar { display: none; }
.r2-col { flex: none; width: 300px; display: flex; flex-direction: column; gap: 10px; scroll-snap-align: center; transform-origin: 50% 50%; will-change: transform; min-height: 0; }
.r2-col > header { display: grid; justify-items: center; gap: 6px; padding: 2px 0 6px; }
.r2-col h3 { margin: 0; font: 500 21px/1 var(--f-display); letter-spacing: .2em; text-transform: uppercase; background: var(--metal-champagne); -webkit-background-clip: text; background-clip: text; color: transparent; }
.r2-col header span { font: 500 11px/1 var(--f-mono); letter-spacing: .2em; color: var(--ink-3); }
.r2-col.is-empty { opacity: .6; }
.r2-cards { display: grid; gap: 10px; overflow-y: auto; min-height: 0; padding: 2px 2px 8px; scrollbar-width: none; }
.r2-card { position: relative; display: grid; gap: 10px; width: 100%; text-align: left; padding: 14px 15px 13px; border-radius: var(--r-lg); border: 1px solid color-mix(in srgb, var(--gold-300) 30%, var(--line-2));
  background: linear-gradient(180deg, var(--surface-2), var(--surface-1)); box-shadow: var(--e2); color: var(--ink-1); font: inherit; cursor: pointer;
  transition: transform var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out); }
.r2-card:hover, .r2-card:focus-visible { transform: translateY(-2px); border-color: var(--gold-line); box-shadow: var(--e3); outline: none; }
.r2-card.is-gold { border-color: var(--gold-line); box-shadow: var(--e2), var(--e-gold); }
.r2-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.r2-co { display: grid; gap: 3px; min-width: 0; flex: 1; }
.r2-co b { font: 600 13.5px/1.2 var(--f-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r2-co small { font: 500 10px/1.2 var(--f-mono); letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.r2-chip { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 22px; padding: 0 9px; border-radius: var(--r-pill); font: 600 10.5px/1 var(--f-ui); color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 40%, transparent); }
.r2-chip i { width: 6px; height: 6px; border-radius: 50%; background: var(--c); }
.r2-ti { font: 500 19px/1.2 var(--f-display); letter-spacing: -.005em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.r2-m { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 16px; padding-top: 10px; border-top: 1px solid var(--line-1); }
.r2-m > span { display: grid; gap: 4px; min-width: 0; }
.r2-m small { font: 500 9.5px/1 var(--f-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
.r2-m b { font: 600 17px/1.1 var(--f-ui); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.r2-m .r2-nx b { font-size: 12.5px; font-weight: 600; padding-top: 3px; }
.r2-m b.is-off { color: var(--ink-3); font-weight: 500; }
.r2-m b em { font: 600 9.5px/1 var(--f-mono); font-style: normal; color: var(--danger); margin-left: 6px; vertical-align: 3px; }
.r2-m .score-s-good { color: var(--success); } .r2-m .score-s-warn { color: var(--warning); } .r2-m .score-s-bad { color: var(--danger); }
.r2-more { justify-items: center; text-align: center; gap: 4px; padding: 18px; }
.r2-more b { font: 300 34px/1 var(--f-ui); color: var(--gold-300); }
.r2-more span { font: italic 400 16px/1.2 var(--f-display); color: var(--ink-2); }
.r2-more small { font: 500 9.5px/1 var(--f-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); margin-top: 6px; }
.r2-ghost { display: grid; place-items: center; height: 120px; border-radius: var(--r-lg); border: 1px dashed var(--gold-line); color: var(--ink-3); font: italic 400 16px/1 var(--f-display); }
.r2-closed { flex: none; display: flex; gap: 22px; overflow-x: auto; padding: 4px 24px 2px; opacity: .72; scrollbar-width: none; touch-action: pan-x; }
.r2-closed::-webkit-scrollbar { display: none; }
.r2-cgroup { flex: none; display: grid; gap: 8px; }
.r2-cgroup h4 { margin: 0; font: 500 12px/1 var(--f-display); letter-spacing: .2em; text-transform: uppercase; color: var(--ink-2); }
.r2-cgroup h4 span { font: 500 10px/1 var(--f-mono); color: var(--ink-3); letter-spacing: .1em; margin-left: 6px; }
.r2-crow { display: flex; gap: 10px; }
.r2-crow .r2-card { width: 230px; padding: 11px 12px; gap: 7px; }
.r2-crow .r2-ti { font-size: 15px; }
.r2-crow .r2-m b { font-size: 14px; }
@media (max-width: 900px) {
  .room-hud { padding: 0 12px; gap: 7px; }
  .room-bar { width: 100%; justify-content: space-between; }
  .room-seg { flex: 1 1 auto; overflow-x: auto; scrollbar-width: none; touch-action: pan-x; }
  .room-seg::-webkit-scrollbar { display: none; }
  .room-seg button { height: 32px; padding: 0 11px; font-size: 12px; flex: none; }
  .room-q { flex: none; width: 32px; padding: 0; justify-content: center; background: transparent; box-shadow: none; }
  .room-q input { width: 0; opacity: 0; }
  .room-bar.is-search .room-seg { display: none; }
  .room-bar.is-search .room-q { flex: 1 1 auto; width: auto; justify-content: flex-start; padding: 0 12px 0 4px; background: color-mix(in srgb, var(--surface-1) 58%, transparent); box-shadow: inset 0 0 0 1px var(--gold-line); }
  .room-bar.is-search .room-q input { width: 100%; opacity: 1; font-size: 16px; }
  .room-n { display: none; }
  .room-legend { width: 100%; justify-content: flex-start; }
  .room-dock { left: 12px; bottom: calc(var(--tab-h) + 22px + env(safe-area-inset-bottom, 0px)); }
  .room-btn { height: 36px; padding: 0 14px 0 11px; font-size: 12px; }
  .room-hint { bottom: calc(var(--tab-h) + 72px + env(safe-area-inset-bottom, 0px)); white-space: normal; text-align: center; width: max-content; max-width: calc(100% - 40px); line-height: 1.5; }
  .room-focus { bottom: calc(var(--tab-h) + 72px + env(safe-area-inset-bottom, 0px)); }
  .room-empty { padding: calc(var(--room-top) + 110px) 16px calc(var(--tab-h) + 80px); }
  .room-empty-card { padding: 28px 22px 24px; }
  .room-empty h2 { font-size: 34px; }
  .room-2d { padding: calc(var(--room-top) + 104px) 0 calc(var(--tab-h) + 78px + env(safe-area-inset-bottom, 0px)); }
  .r2-track { padding: 8px calc(50% - 136px); gap: 14px; }
  .r2-col { width: 272px; }
}
@media (prefers-reduced-motion: reduce) {
  .room-hint, .room-empty-card { animation: none; }
  .r2-col { will-change: auto; }
}
`);
  }

  // ───────────────────────── registration ─────────────────────────
  CB.Room = {
    __room: true,
    debug: () => (R.inst ? Object.assign({ filter: R.filter, q: R.q, total: R.models.length, visible: R.vis.length }, R.inst.debug()) : null),
    cardPoint: (id) => (R.inst ? R.inst.cardPoint(id) : null),
  };
  if (CB.registerView) {
    CB.registerView({ key: 'room', label: 'Command Room', sec: 'Track', order: 15, crumb: 'Your search, all around you', icon: IC.room, render });
  }
  if (CB.registerCommand) CB.registerCommand({ key: 'room-open', label: 'Open Command Room', run: () => { location.hash = 'room'; } });
  function intent() {
    if (!CB.Cal || typeof CB.Cal.registerIntent !== 'function') return false;
    CB.Cal.registerIntent(/\b(command room|immersive|vr)\b/i, (text, say) => {
      location.hash = 'room';
      say('Opening the Command Room: every application, arranged by stage all around you. Drag to look around, or tap a card to open it.');
      return true;
    });
    return true;
  }
  if (!intent()) {
    const retry = () => { intent(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retry, { once: true });
    else setTimeout(retry, 0);
  }
})();

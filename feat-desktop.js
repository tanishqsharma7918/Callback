/* Callback v3 — the Claude desktop app (feat-desktop).
 *
 * Installed from the Claude desktop app (open Callback → Share → Install as app), Callback becomes a real Mac /
 * Windows app through the `desktop` capability:
 *   · its own icon, native macOS chrome (inset traffic lights, draggable headers) and a real menu bar
 *     (⌘N new application, ⌘1–⌘8 rooms, ⇧⌘L light/dark, Add upcoming to Calendar, Export & Backup)
 *   · a Dock badge with what needs you today (the app's own Badging API calls are routed to the Dock)
 *   · reminders as system notifications: interviews the day before, an hour before and 10 minutes before;
 *     follow-up, offer-decision and apply-by days from 9:00. They arrive while Callback runs; with the menu-bar item
 *     on, closing the window keeps it running.
 *   · a menu-bar item: the next interview, what's due, quick actions.
 * Notifications and the menu bar each ask once, only after a click on "Turn on". Elsewhere (claude.ai, the Claude
 * app's main window) Settings → Desktop app offers "Install as app" when the Claude desktop app can do it.
 * Inert in the standalone / GitHub build (no window.claude).
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  if (typeof document === 'undefined' || CB.standalone || CB.Desktop) return;
  const E = (s) => CB.esc(s);
  const LS = 'callback.desktop.';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  const ready = () => !!(CB.App && CB.App.booted && CB.Store && CB.Store.ready && CB.Time && CB.UI);
  const toast = (m) => { try { CB.UI.toast(m); } catch (e) { /* noop */ } };

  const D = { api: null, mode: 'pending', install: 'unavailable', perms: {}, mac: false, notifOn: false, trayOn: false, traySig: '', ticking: 0, cards: new Set() };
  const WIN = { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 }, dragHeight: 12, backgroundColor: '#0b0b0c', minWidth: 980, minHeight: 640 };
  const ROOMS = [['Dashboard', 'dashboard'], ['Command Room', 'room'], ['Pipeline', 'board'], ['Spreadsheet', 'sheet'], ['Calendar', 'calendar'], ['ATS Lab', 'ats'], ['Studio', 'studio'], ['Reports & Export', 'reports']];
  const word = () => (D.mac ? 'Mac' : 'desktop');

  // ───────────────────────── small helpers ─────────────────────────
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (d) => { let h = d.getHours(); const m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return m ? `${h}:${pad(m)} ${ap}` : `${h} ${ap}`; };
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const relDay = (d) => { const t = new Date(); const tm = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1); if (dayKey(d) === dayKey(t)) return 'Today'; if (dayKey(d) === dayKey(tm)) return 'Tomorrow'; return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };
  const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const show = (hash) => { if (D.api && D.api.window) D.api.window.show().catch(() => {}); if (hash) location.hash = hash; };
  const openJob = (id, tab) => { show(); setTimeout(() => { try { CB.UI.openJob(id, tab || 'overview'); } catch (e) { /* job gone */ } }, 120); };
  const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

  function drawIcon() { // fallback app icon: champagne monogram on an obsidian tile (the real one is callback-icon-256.png)
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const bg = g.createLinearGradient(0, 24, 0, 232); bg.addColorStop(0, '#1b1a18'); bg.addColorStop(1, '#070707');
    rr(24, 24, 208, 208, 47); g.fillStyle = bg; g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(217,185,122,.45)'; g.stroke();
    const gold = g.createLinearGradient(70, 70, 186, 186); gold.addColorStop(0, '#F3DDA8'); gold.addColorStop(1, '#B08A47');
    g.strokeStyle = gold; g.lineWidth = 15; g.lineCap = 'round';
    g.beginPath(); g.arc(128, 128, 54, 0.3 * Math.PI, 1.7 * Math.PI); g.stroke();
    g.fillStyle = gold; g.beginPath(); g.arc(171, 128, 9, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png');
  }
  function trayIcon() { // template glyph: black on transparent, macOS paints it in the menu bar's color
    const c = document.createElement('canvas'); c.width = c.height = 36;
    const g = c.getContext('2d');
    g.strokeStyle = '#000'; g.lineWidth = 3.6; g.lineCap = 'round';
    g.beginPath(); g.arc(18, 18, 11.5, 0.3 * Math.PI, 1.7 * Math.PI); g.stroke();
    g.fillStyle = '#000'; g.beginPath(); g.arc(27.2, 18, 2.4, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png');
  }

  // ───────────────────────── window, icon, menu, badge ─────────────────────────
  function chrome(api) {
    api.window.setOptions(WIN).catch(() => {}); // same options every load (different ones rebuild + reload the window)
    fetch('callback-icon-256.png').then((r) => (r.ok ? r.blob() : Promise.reject(new Error('icon')))).then(blobToDataUrl)
      .then((u) => (u.length < 340000 ? u : drawIcon())).catch(() => drawIcon())
      .then((u) => api.app.dock.setIcon(u)).catch(() => {});
    api.Menu.setApplicationMenu([
      {
        label: 'File',
        submenu: [
          { label: 'New Application…', accelerator: 'CmdOrCtrl+N', click: () => { try { CB.UI.addJob(); } catch (e) { /* booting */ } } },
          { label: 'Search…', click: () => { try { CB.UI.palette(); } catch (e) { /* booting */ } } },
          { type: 'separator' },
          { label: 'Add Upcoming to Calendar…', click: () => { try { CB.Time.exportAll(); } catch (e) { /* booting */ } } },
          { label: 'Export & Backup…', click: () => show('reports') },
        ],
      },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ label: 'Light / Dark', accelerator: 'CmdOrCtrl+Shift+L', click: () => { try { CB.UI.setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); } catch (e) { /* noop */ } } }] },
      { label: 'Go', submenu: ROOMS.map(([label, key], i) => ({ label, accelerator: 'CmdOrCtrl+' + (i + 1), click: () => show(key) })) },
    ]).catch(() => {});
  }
  function badge(api) {
    const set = (n) => api.app.dock.setBadge(n > 0 ? String(Math.min(999, n)) : '').catch(() => false);
    try {
      navigator.setAppBadge = (n) => set(parseInt(n, 10) || 0);
      navigator.clearAppBadge = () => set(0);
    } catch (e) { /* read-only navigator: no badge */ }
    if (CB.Time && CB.Time.updateBadge) CB.Time.updateBadge(true);
  }

  // ───────────────────────── reminders ─────────────────────────
  // One notification per slot per event; the key carries the time so a rescheduled interview reminds again.
  function due(ev, now) {
    if (ev.kind === 'interview') {
      const mins = (ev.start - now) / 60000;
      if (mins <= 0) return null;
      if (mins <= 12) return { slot: 'm', all: ['m', 'h', 'd'], body: `Starting in ${Math.max(1, Math.round(mins))} min: ${ev.label} with ${ev.company}. Test your link, camera and audio.` };
      if (mins <= 62) return { slot: 'h', all: ['h', 'd'], body: `In ${Math.round(mins)} minutes: ${ev.label} with ${ev.company} at ${fmtTime(ev.start)}. ${ev.title}.` };
      if (mins <= 24 * 60) return { slot: 'd', all: ['d'], body: `${relDay(ev.start)} at ${fmtTime(ev.start)}: ${ev.label} with ${ev.company}. ${ev.title}. Pick 3 stories with numbers that prove the must-haves.` };
      return null;
    }
    if (!(ev.at instanceof Date) || dayKey(ev.at) !== dayKey(now) || now < ev.at) return null; // all-day items: from 9:00 on the day
    const body = ev.kind === 'followup' ? `Follow up today with ${ev.company} (${ev.title}). Studio has a message ready.`
      : ev.kind === 'offer' ? `Offer decision due today: ${ev.company}. Compare, negotiate once, then answer in writing.`
        : ev.kind === 'apply' ? `Last day to apply: ${ev.title} at ${ev.company}.` : '';
    return body ? { slot: 'a', all: ['a'], body } : null;
  }
  async function tick() {
    if (!D.notifOn || !ready()) return;
    const now = new Date();
    const fired = lsGet('fired', {});
    const cutoff = now.getTime() - 4 * 864e5;
    Object.keys(fired).forEach((k) => { if (fired[k] < cutoff) delete fired[k]; });
    let list = [];
    try { list = CB.Time.events(CB.Store.list(), { now }); } catch (e) { return; }
    const out = [];
    for (const ev of list) {
      const d = due(ev, now);
      if (!d) continue;
      const base = `${ev.key}@${ev.at instanceof Date ? ev.at.getTime() : ''}|`;
      if (fired[base + d.slot]) continue;
      d.all.forEach((s) => { fired[base + s] = now.getTime(); }); // a late open sends only the most urgent one
      out.push(cut(d.body, 300));
    }
    lsSet('fired', fired);
    for (const body of out.slice(0, 4)) { // never a burst
      try { await D.api.notification.show({ body }); } catch (e) {
        if (/^EPERM/.test(String(e && e.message))) { D.notifOn = false; drawCards(); break; }
      }
    }
  }

  // ───────────────────────── menu bar item ─────────────────────────
  function trayLabel(ev) {
    const when = ev.kind === 'interview' ? `${relDay(ev.start)} ${fmtTime(ev.start)}` : relDay(ev.at);
    const what = ev.kind === 'interview' ? ev.label : ev.kind === 'followup' ? 'Follow up' : ev.kind === 'offer' ? 'Offer decision' : 'Apply by';
    return cut(`${when} · ${what} · ${ev.company}`, 60);
  }
  async function renderTray(force) {
    if (!D.trayOn || !ready()) return;
    const now = new Date();
    let evs = [], dueN = 0;
    try { evs = CB.Time.events(CB.Store.list(), { now }); dueN = CB.Time.dueCount ? CB.Time.dueCount() : 0; } catch (e) { return; }
    const next = evs.find((e) => e.kind === 'interview');
    let title = '';
    if (next && next.start - now < 18 * 3600e3) title = cut(`${fmtTime(next.start)} ${next.company}`, 24);
    else if (dueN) title = `${dueN} due`;
    const menu = [
      { label: next ? cut(`Next: ${next.label} · ${next.company}`, 60) : 'No interviews scheduled', enabled: false },
      ...(next ? [{ label: `${relDay(next.start)} at ${fmtTime(next.start)}`, enabled: false }] : []),
      { type: 'separator' },
      ...evs.slice(0, 5).map((ev) => ({ label: trayLabel(ev), click: () => openJob(ev.jobId, ev.kind === 'interview' ? 'interviews' : 'overview') })),
      ...(evs.length ? [{ type: 'separator' }] : []),
      { label: dueN ? `${dueN} thing${dueN > 1 ? 's' : ''} need you today` : 'Nothing due today', click: () => show('dashboard') },
      { label: 'New Application…', click: () => { show(); setTimeout(() => { try { CB.UI.addJob(); } catch (e) { /* noop */ } }, 150); } },
      { label: 'Command Room', click: () => show('room') },
      { type: 'separator' },
      { label: 'Open Callback', click: () => show() },
    ];
    const toolTip = next ? cut(`Next: ${next.label} · ${next.company} · ${relDay(next.start)} ${fmtTime(next.start)}`, 100) : dueN ? `${dueN} due today` : 'Nothing due today';
    const sig = JSON.stringify([title, toolTip, menu.map((m) => m.label || m.type)]);
    if (sig === D.traySig && !force) return;
    D.traySig = sig;
    try { await D.api.tray.set({ icon: trayIcon(), title, toolTip, menu }); } catch (e) {
      if (/^EPERM/.test(String(e && e.message))) { D.trayOn = false; drawCards(); }
    }
  }

  function startLoops() {
    if (D.ticking) return;
    D.ticking = setInterval(() => { tick(); renderTray(); }, 30000);
    CB.on('data', CB.debounce(() => { tick(); renderTray(); }, 1200));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); renderTray(); } });
  }
  function apply(perms) {
    D.perms = Object.assign({}, D.perms, perms || {});
    const n = D.perms.notifications === 'granted', t = D.perms['menu-bar'] === 'granted';
    const was = D.trayOn;
    D.notifOn = n; D.trayOn = t;
    if (n || t) startLoops();
    if (n) tick();
    if (t) renderTray(!was);
    else if (was && D.api) D.api.tray.remove().catch(() => {});
    drawCards();
  }
  async function turnOn() { // from a click only
    if (!D.api || D.mode !== 'app') return;
    let res = null;
    try { res = await D.api.permissions.request(['notifications', 'menu-bar']); } catch (e) { toast('Bring Callback to the front, then try again.'); return; }
    apply(res);
    closeOffer();
    const on = [res.notifications === 'granted' && 'reminders', res['menu-bar'] === 'granted' && 'the menu bar item'].filter(Boolean);
    toast(on.length ? `Turned on ${on.join(' and ')}.` : 'Left off. You can turn these on in Settings → Desktop app.');
  }
  const manage = () => { if (D.api && D.api.permissions) D.api.permissions.manage().then(refreshPerms).catch(() => toast('Open the app’s Permissions from the Callback menu.')); };
  async function refreshPerms() { if (D.api && D.mode === 'app') { try { apply(await D.api.permissions.state()); } catch (e) { /* keep */ } } }

  // ───────────────────────── first-run offer (never a permission prompt on launch) ─────────────────────────
  function closeOffer() { const o = document.getElementById('dk-offer'); if (o) o.remove(); }
  function offer() {
    if (document.getElementById('dk-offer') || (lsGet('offerSnooze', 0) > Date.now())) return;
    const el = document.createElement('section');
    el.id = 'dk-offer'; el.className = 'dk-offer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Turn on reminders');
    el.innerHTML = `<div class="dk-k">Callback for ${E(word())}</div>
      <h3>Let Callback tap you on the shoulder.</h3>
      <p>Interview reminders as ${E(word())} notifications, a day, an hour and 10 minutes before, and your next interview in the menu bar.</p>
      <div class="dk-a"><button type="button" class="btn btn-primary" data-on>Turn on</button><button type="button" class="btn btn-ghost" data-later>Not now</button></div>`;
    el.querySelector('[data-on]').onclick = turnOn;
    el.querySelector('[data-later]').onclick = () => { lsSet('offerSnooze', Date.now() + 7 * 864e5); closeOffer(); };
    document.body.appendChild(el);
  }

  // ───────────────────────── install (outside the app) ─────────────────────────
  async function install() { // from a click only
    if (!D.api || !D.api.install) return;
    let r = 'unavailable';
    try { r = await D.api.install.request(); } catch (e) { r = 'failed'; }
    if (r === 'installed') { D.install = 'installed'; toast('Installing Callback as an app. It opens in its own window.'); }
    else if (r === 'cancelled') toast('Not installed.');
    else toast('This window can’t install apps. Open Callback in the Claude desktop app and choose Share → Install as app.');
    drawCards();
  }

  // ───────────────────────── Settings card ─────────────────────────
  function cardHtml() {
    if (D.mode === 'app') {
      const row = (name, k, desc) => {
        const st = D.perms[k] || 'unavailable';
        const on = st === 'granted';
        const btn = on ? '' : st === 'denied' ? '<button type="button" class="btn btn-sm" data-manage>Manage</button>' : st === 'prompt' ? '<button type="button" class="btn btn-sm btn-primary" data-on>Turn on</button>' : '';
        return `<div class="dk-row"><div><b>${E(name)}</b><span>${E(desc)}</span></div><div class="dk-st"><i class="dk-dot${on ? ' on' : ''}"></i>${on ? 'On' : st === 'denied' ? 'Off' : st === 'prompt' ? 'Not set' : 'Unavailable'}${btn}</div></div>`;
      };
      return `<p class="dk-lead">Callback is running as its own ${E(word())} app.</p>
        ${row('Reminders', 'notifications', 'Interviews a day, an hour and 10 minutes before; follow-ups, offers and deadlines on the day')}
        ${row('Menu bar', 'menu-bar', 'Your next interview and what’s due, one click away')}
        <div class="dk-row"><div><b>Dock badge</b><span>How many things need you today</span></div><div class="dk-st"><i class="dk-dot on"></i>On</div></div>
        <p class="dk-note">Reminders arrive while Callback is running. With the menu bar item on, closing the window keeps it running.</p>`;
    }
    if (D.mode === 'pending') return '<p class="dk-lead">Checking…</p>';
    const st = D.install;
    const lead = '<p class="dk-lead">Install Callback as its own app: its own window and Dock icon, a real menu bar, interview reminders as notifications and your next interview in the menu bar.</p>';
    if (st === 'available') return `${lead}<div class="dk-a"><button type="button" class="btn btn-primary" data-install>Install as app</button></div>`;
    if (st === 'installed') return `${lead}<p class="dk-note"><b>Installed on this computer.</b> Open Callback from your Applications folder or Spotlight.</p>`;
    return `${lead}<p class="dk-note">Open Callback in the Claude desktop app for Mac or Windows and choose <b>Share → Install as app</b>. Not available on phones yet.</p>`;
  }
  function drawCards() {
    D.cards.forEach((el) => {
      if (!el.isConnected) { D.cards.delete(el); return; }
      el.innerHTML = `<div class="dk-card">${cardHtml()}</div>`;
      el.querySelectorAll('[data-on]').forEach((b) => { b.onclick = turnOn; });
      el.querySelectorAll('[data-manage]').forEach((b) => { b.onclick = manage; });
      el.querySelectorAll('[data-install]').forEach((b) => { b.onclick = install; });
    });
  }
  if (typeof CB.registerSettings === 'function') {
    CB.registerSettings({ key: 'desktop', title: 'Desktop app', order: 64, render(el) { D.cards.add(el); drawCards(); } });
  }
  if (typeof CB.registerCommand === 'function') CB.registerCommand({ key: 'desktop-app', label: 'Desktop app: install, reminders, menu bar', run: () => { location.hash = 'settings'; } });
  if (CB.Cal && typeof CB.Cal.registerIntent === 'function') {
    CB.Cal.registerIntent(/\b(install (callback|the app|it|as (an )?app)|desktop app|mac app|menu ?bar item|turn on (reminders|notifications))\b/i, (text, say) => {
      location.hash = 'settings';
      say(D.mode === 'app'
        ? (D.notifOn ? 'Reminders are on. I’ll notify you a day, an hour and 10 minutes before each interview.' : 'Open **Settings → Desktop app** and tap **Turn on** for reminders and the menu bar.')
        : 'Install me as an app from the Claude desktop app: open Callback there and choose **Share → Install as app**. Then turn on reminders in **Settings → Desktop app**.');
      return true;
    });
  }

  CB.css('feat-desktop', `
html.desktop-mac .side { padding-top: 46px; }
html.desktop-mac .side .brand, html.desktop-mac .top { app-region: drag; -webkit-app-region: drag; }
html.desktop-mac .top a, html.desktop-mac .top button, html.desktop-mac .top input, html.desktop-mac .top select, html.desktop-mac .top textarea,
html.desktop-mac .top label, html.desktop-mac .top [role="button"], html.desktop-mac .top [tabindex] { app-region: no-drag; -webkit-app-region: no-drag; }
.dk-offer { position: fixed; z-index: 70; left: calc(var(--side-w) + 24px); bottom: 24px; width: min(360px, calc(100vw - 48px)); padding: 18px 18px 16px;
  border-radius: var(--r-lg); background: var(--glass-thick); -webkit-backdrop-filter: blur(22px) saturate(1.3); backdrop-filter: blur(22px) saturate(1.3);
  box-shadow: inset 0 1px 0 var(--rim, rgba(255,255,255,.06)), 0 0 0 1px var(--line-2), 0 24px 60px -18px rgba(0,0,0,.6); animation: dkIn 520ms var(--ease-out, cubic-bezier(.2,.8,.2,1)) both; }
@keyframes dkIn { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }
.dk-offer .dk-k { font: 500 10px/14px var(--f-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--gold-300); }
.dk-offer h3 { margin: 6px 0 6px; font: 500 22px/1.15 var(--f-display); letter-spacing: -.01em; color: var(--ink-1); }
.dk-offer p { margin: 0 0 14px; font: 400 13px/1.5 var(--f-ui); color: var(--ink-3); }
.dk-a { display: flex; gap: 8px; flex-wrap: wrap; }
.dk-card { display: grid; gap: 10px; }
.dk-lead { margin: 0; font: 400 13px/1.5 var(--f-ui); color: var(--ink-2); }
.dk-note { margin: 2px 0 0; font: 400 12px/1.5 var(--f-ui); color: var(--ink-3); }
.dk-note b { color: var(--ink-2); font-weight: 600; }
.dk-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 0; border-top: 1px solid var(--line-1); }
.dk-row > div:first-child { display: grid; gap: 2px; min-width: 0; }
.dk-row b { font: 600 13px/1.3 var(--f-ui); color: var(--ink-1); }
.dk-row span { font: 400 12px/1.4 var(--f-ui); color: var(--ink-3); }
.dk-st { display: flex; align-items: center; gap: 8px; flex: none; font: 500 12px/1 var(--f-mono); color: var(--ink-3); }
.dk-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-4); }
.dk-dot.on { background: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent); }
@media (max-width: 900px) { .dk-offer { left: 16px; right: 16px; width: auto; bottom: calc(var(--tab-h) + 20px + env(safe-area-inset-bottom, 0px)); } }
`);

  // ───────────────────────── boot ─────────────────────────
  CB.Desktop = { state: () => ({ mode: D.mode, install: D.install, perms: Object.assign({}, D.perms), mac: D.mac, notifications: D.notifOn, menuBar: D.trayOn }), tick, renderTray, turnOn, install };
  (async function boot() {
    let api = null;
    try { api = await CB.cap('desktop'); } catch (e) { api = null; }
    D.api = api;
    if (!api) { D.mode = 'none'; drawCards(); return; }
    if (!api.window || !api.app) { // a browser, the Claude app's main window, the mobile apps
      D.mode = 'web';
      try { D.install = await api.install.state(); } catch (e) { D.install = 'unavailable'; }
      drawCards();
      return;
    }
    D.mode = 'app';
    try { D.mac = (await api.os.platform()) === 'darwin'; } catch (e) { D.mac = /Mac/.test(navigator.platform || ''); }
    const root = document.documentElement;
    root.classList.add('desktop-app');
    if (D.mac) root.classList.add('desktop-mac');
    chrome(api);
    for (let i = 0; i < 150 && !ready(); i++) await new Promise((r) => setTimeout(r, 200)); // data-dependent work waits for the store
    badge(api);
    let perms = {};
    for (const wait of [0, 4000, 12000]) { // "unavailable" while the app is still signing in: ask again later
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try { perms = await api.permissions.state(); } catch (e) { perms = {}; }
      if (perms.notifications !== 'unavailable' || perms['menu-bar'] !== 'unavailable') break;
    }
    apply(perms);
    if (perms.notifications === 'prompt' || perms['menu-bar'] === 'prompt') setTimeout(offer, 2500);
  })();
})();

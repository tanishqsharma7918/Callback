/* Callback — app shell, shared UI components, job drawer, add-job flow, palette. Views live in views.js. */
(function () {
  'use strict';
  const CB = window.CB;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const E = CB.esc;
  const S = () => CB.Store;

  const ICON = {
    dashboard: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 4v3h6V4z"/>',
    board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
    sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
    ats: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    ghost: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-3-2-2 2-2-2-2 2-2-2z"/><circle cx="9.5" cy="10" r="1"/><circle cx="14.5" cy="10" r="1"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    speaker: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  };
  const icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;

  const VIEWS = [
    { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', sec: 'Track' },
    { key: 'board', label: 'Pipeline', icon: 'board', sec: 'Track' },
    { key: 'sheet', label: 'Spreadsheet', icon: 'sheet', sec: 'Track' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar', sec: 'Track' },
    { key: 'ats', label: 'ATS Lab', icon: 'ats', sec: 'Analyze' },
    { key: 'inbox', label: 'Inbox Parser', icon: 'inbox', sec: 'Analyze' },
    { key: 'reports', label: 'Reports & Export', icon: 'reports', sec: 'Analyze' },
    { key: 'settings', label: 'Settings', icon: 'settings', sec: 'You' },
  ];
  const CRUMB = {
    dashboard: 'Your search at a glance', board: 'Drag cards between stages', sheet: 'Excel-style grid · edit any cell',
    calendar: 'Interviews, follow-ups and deadlines', ats: 'Resume vs. every posting, scored brutally', inbox: 'Paste recruiter emails, update automatically',
    reports: 'Excel, Word, CSV and backups', settings: 'Eligibility, strictness, goals and data',
  };

  const App = { current: null, cleanup: [], ai: false, drawerId: null, drawerTab: 'overview', busy: false };

  // ───────────────────────── shared components ─────────────────────────
  const UI = {};
  UI.icon = icon;
  UI.chip = (key, extra = '') => { const s = CB.STAGE[key] || CB.STAGE.saved; return `<span class="chip ${extra}" style="--c:var(--st-${s.key})">${E(s.label)}</span>`; };
  UI.scoreClass = (a) => {
    if (!a || a.score == null) return '';
    if (a.knockouts && a.knockouts.length) return 's-bad';
    const t = a.thresholds || { floor: 60, competitive: 75 };
    return a.score >= t.competitive ? 's-good' : a.score >= t.floor ? 's-warn' : 's-bad';
  };
  UI.score = (a) => (a && a.score != null ? `<span class="score ${UI.scoreClass(a)}" title="ATS fit score">${a.score}</span>` : `<span class="score" title="${E(a ? a.verdictLabel : '')}">—</span>`);
  UI.stamp = (a, big) => {
    if (!a) return '';
    const label = { REJECTED: 'Auto-rejected', STRONG: 'Shortlist', COMPETITIVE: 'Review', LONG_SHOT: 'Long shot', NO_RESUME: 'No resume', NO_JD: 'No JD', ERROR: 'Error' }[a.verdict] || a.verdict;
    const code = a.verdict === 'REJECTED' && a.knockouts[0] ? a.knockouts[0].code : a.score != null ? 'ATS ' + a.score : '';
    return `<span class="stamp stamp-${a.verdict} ${big ? 'stamp-big stamp-anim' : ''}">${E(label)}${code ? `<small>${E(code)}</small>` : ''}</span>`;
  };
  UI.prob = (a) => (a && a.probability != null ? (a.probability >= 1 ? 'Reached' : a.probability < 0.01 ? '<1%' : CB.pct(a.probability, a.probability < 0.1 ? 1 : 0)) : '—');
  UI.mono = (name, size) => `<span class="mono-ava" style="--h:${CB.hueFor(name || '?')}${size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px` : ''}" aria-hidden="true">${E(CB.initials(name))}</span>`;
  UI.scoreColor = (s, a) => (a && a.knockouts && a.knockouts.length ? 'var(--bad)' : s >= ((a && a.thresholds && a.thresholds.competitive) || 75) ? 'var(--good)' : s >= ((a && a.thresholds && a.thresholds.floor) || 60) ? 'var(--warn)' : 'var(--bad)');
  UI.compColor = (s) => (s >= 80 ? 'var(--good)' : s >= 55 ? 'var(--warn)' : 'var(--bad)');
  UI.opts = (arr, cur, labels) => arr.map((v, i) => `<option value="${E(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${E(labels ? labels[i] : v || '—')}</option>`).join('');
  UI.stageOpts = (cur) => CB.STAGES.map((s) => `<option value="${s.key}"${s.key === cur ? ' selected' : ''}>${E(s.label)}</option>`).join('');
  UI.nextInterview = (j) => (j.interviews || []).filter((i) => i.outcome === 'Scheduled' && i.datetime && CB.parseDate(i.datetime) > new Date(Date.now() - 3600000)).sort((a, b) => a.datetime.localeCompare(b.datetime))[0] || null;
  UI.daysInStage = (j) => {
    const t = (j.timeline || []).filter((x) => x.kind === 'status' || x.kind === 'auto' || x.kind === 'created').map((x) => x.ts).sort().pop();
    return t ? CB.daysSince(t.slice(0, 10)) : null;
  };

  // toasts
  UI.toast = (text, opts = {}) => {
    const host = $('#toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (opts.tone ? ' ' + opts.tone : '');
    t.innerHTML = `<span>${E(text)}</span>${opts.undo ? '<button type="button">Undo</button>' : ''}`;
    if (opts.undo) t.querySelector('button').onclick = () => { const u = S().undo(); t.remove(); if (u) UI.toast('Undone'); };
    host.appendChild(t);
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(() => t.remove(), opts.ms || (opts.undo ? 6500 : 3600));
    return t;
  };
  CB.on('toast', (d) => UI.toast(d.text, { tone: d.tone }));

  // modal
  UI.modal = ({ title, body, foot, size, onMount, onClose, dismissable = true }) => {
    const scrim = document.createElement('div');
    scrim.className = 'scrim top';
    const m = document.createElement('div');
    m.className = 'modal' + (size === 'sm' ? ' sm' : '');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="modal-h"><h3>${E(title)}</h3><button class="btn btn-ghost btn-icon" data-x style="margin-left:auto" aria-label="Close">${icon('x')}</button></div><div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}`;
    document.body.append(scrim, m);
    const prev = document.activeElement;
    const close = () => { scrim.remove(); m.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(); prev && prev.focus && prev.focus(); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    scrim.onclick = () => dismissable && close();
    m.querySelector('[data-x]').onclick = close;
    const api = { el: m, close };
    onMount && onMount(m, api);
    setTimeout(() => { const f = m.querySelector('[autofocus]') || m.querySelector('input,textarea,select,button.btn-primary'); f && f.focus(); }, 30);
    return api;
  };
  UI.confirm = ({ title, text, ok = 'Confirm', danger }) => new Promise((res) => {
    let done = false;
    UI.modal({
      title, size: 'sm', body: `<p style="margin:0;color:var(--ink-2)">${E(text)}</p>`,
      foot: `<button class="btn" data-c>Cancel</button><button class="btn ${danger ? 'btn-primary btn-danger' : 'btn-primary'}" data-ok style="${danger ? 'background:var(--bad);border-color:var(--bad);color:#fff' : ''}">${E(ok)}</button>`,
      onMount: (m, api) => { m.querySelector('[data-c]').onclick = () => api.close(); m.querySelector('[data-ok]').onclick = () => { done = true; api.close(); }; },
      onClose: () => res(done),
    });
  });

  /** Every status change from the UI goes here (captures rejection reasons, offers undo). */
  UI.moveJob = (id, to, opts = {}) => {
    const j = S().get(id);
    if (!j || j.status === to) return;
    if (to === 'rejected' && !opts.reason) {
      UI.modal({
        title: `Rejected by ${j.company || 'company'}`, size: 'sm',
        body: `<label class="field"><span>Reason (helps your reports)</span><select class="input" id="rej-reason">${UI.opts(CB.REJECTION_REASONS, 'No reason given')}</select></label><label class="field"><span>Note (optional)</span><input class="input" id="rej-note" placeholder="e.g. Feedback from the recruiter"></label>`,
        foot: '<button class="btn" data-c>Cancel</button><button class="btn btn-primary" data-ok>Mark rejected</button>',
        onMount: (m, api) => {
          m.querySelector('[data-c]').onclick = () => { api.close(); CB.emit('data', { reason: 'cancel' }); };
          m.querySelector('[data-ok]').onclick = () => { const reason = $('#rej-reason', m).value, note = $('#rej-note', m).value; api.close(); UI.moveJob(id, to, { reason, note }); };
        },
      });
      return;
    }
    S().move(id, to, opts);
    const st = CB.STAGE[to];
    UI.toast(`${j.company || 'Job'} → ${st.label}`, { undo: true });
    if (to === 'offer') setTimeout(() => UI.toast('Offer! Add the numbers in the Overview tab to compare.'), 400);
  };

  // AI runner with streaming + stop
  UI.aiRun = async (host, starter) => {
    const ctl = new AbortController();
    host.innerHTML = `<div class="ai-box"><div class="row" style="justify-content:space-between"><span class="thinking">Claude is thinking…</span><button class="btn btn-sm" data-stop>Stop</button></div><div class="ai-out"></div></div>`;
    const out = host.querySelector('.ai-out');
    const th = host.querySelector('.thinking');
    host.querySelector('[data-stop]').onclick = () => ctl.abort();
    try {
      const r = await starter({ signal: ctl.signal, onText: ({ text }) => { th.textContent = 'Writing…'; out.innerHTML = CB.AI.md(text); } });
      out.innerHTML = CB.AI.md(r.text);
      host.querySelector('.row').innerHTML = `<span class="muted" style="font-size:12px">Claude · ${r.truncated ? 'cut short — ask for less' : 'done'}</span><button class="btn btn-sm" data-copy>Copy</button>`;
      host.querySelector('[data-copy]').onclick = () => UI.copy(r.text);
      return r.text;
    } catch (e) {
      const msg = CB.AI.errText(e);
      if (e && e.text) out.innerHTML = CB.AI.md(e.text);
      host.querySelector('.row').innerHTML = `<span class="muted" style="font-size:12px">${E(msg || 'Stopped.')}</span>`;
      return null;
    }
  };
  UI.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); UI.toast('Copied'); }
    catch (e) { UI.toast('Copy is blocked here — select the text and copy it manually.', { tone: 'warn' }); }
  };
  UI.save = async (promise, label) => {
    try {
      const r = await promise;
      if (r && r.ok === false) { if (r.code !== 'declined') UI.toast(r.message || 'Could not save the file.', { tone: 'bad' }); }
      else UI.toast(label || 'File ready');
    } catch (e) { console.error(e); UI.toast((e && e.message) || 'Export failed.', { tone: 'bad' }); }
  };

  // ───────────────────────── resume ─────────────────────────
  UI.uploadResume = async (file) => {
    if (!file) return;
    const reading = UI.toast('Reading ' + file.name + '…', { ms: 20000 });
    try {
      const r = await CB.IO.extractText(file);
      reading.remove();
      if (!r.text || r.text.trim().length < 80) throw new Error('No readable text found. If it is a scanned PDF, export it as a text PDF or .docx — an ATS sees a blank resume too.');
      S().setResume({ text: r.text, fileName: file.name, uploadedAt: CB.nowISO(), warnings: r.warnings || [], pages: r.pages || null, kind: r.kind, sample: false });
      const p = S().profile();
      UI.toast(`Resume parsed: ${p.skills.size} skills · ${p.totalYears} yrs · ${p.roles.length} roles. All applications re-scored — see your next moves below.`, { ms: 5000 });
      CB.emit('resume:uploaded', { grade: CB.ATS.auditResume(p, r.warnings || []) });
    } catch (e) { reading.remove(); UI.toast(e.message || 'Could not read that file.', { tone: 'bad' }); }
  };
  UI.pasteResume = () => {
    UI.modal({
      title: 'Paste resume text', body: '<p class="muted" style="margin:0">Paste the full text of your resume. For the most accurate parsing keep section headings (Experience, Education, Skills) and dates like "Jan 2022 – Present".</p><textarea class="input" id="rs-text" rows="16" placeholder="Your Name&#10;City, ST · email · phone&#10;&#10;EXPERIENCE&#10;Title — Company&#10;Jan 2022 – Present&#10;• Led…"></textarea>',
      foot: '<button class="btn" data-c>Cancel</button><button class="btn btn-primary" data-ok>Use this resume</button>',
      onMount: (m, api) => {
        m.querySelector('[data-c]').onclick = api.close;
        m.querySelector('[data-ok]').onclick = () => {
          const t = $('#rs-text', m).value.trim();
          if (t.length < 80) { UI.toast('That looks too short to be a resume.', { tone: 'warn' }); return; }
          S().setResume({ text: t, fileName: 'Pasted resume', uploadedAt: CB.nowISO(), warnings: [], sample: false });
          api.close();
          const p = S().profile();
          UI.toast(`Resume parsed: ${p.skills.size} skills · ${p.totalYears} yrs. All applications re-scored.`);
        };
      },
    });
  };

  // ───────────────────────── nav ─────────────────────────
  function renderNav() {
    const jobs = S().ready ? S().list() : [];
    const acts = S().ready ? CB.Auto.compute(jobs, S().settings, {}).filter((a) => a.sev === 1).length : 0;
    const counts = { board: jobs.filter((j) => CB.STAGE[j.status].group === 'active').length, dashboard: acts };
    let html = '', sec = '';
    VIEWS.forEach((v) => {
      if (v.sec !== sec) { sec = v.sec; html += `<div class="nav-sec">${E(sec)}</div>`; }
      const n = counts[v.key];
      html += `<a href="#${v.key}" ${App.current === v.key ? 'aria-current="page"' : ''}>${icon(v.icon)}<span>${E(v.label)}</span>${n ? `<span class="nav-count ${v.key === 'dashboard' ? 'hot' : ''}" title="${v.key === 'dashboard' ? 'Actions due' : 'Active applications'}">${n}</span>` : ''}</a>`;
    });
    $('#nav').innerHTML = html;
    const tb = [['dashboard', 'Home', 'dashboard'], ['board', 'Pipeline', 'board'], ['add', '', 'plus'], ['ats', 'ATS', 'ats'], ['more', 'More', 'more']];
    $('#tabbar').innerHTML = tb.map(([k, l, ic]) => k === 'add' ? `<button type="button" data-add aria-label="Add job"><span class="add-fab">${icon('plus')}</span></button>` : k === 'more' ? `<button type="button" data-more ${['sheet', 'calendar', 'inbox', 'reports', 'settings'].includes(App.current) ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></button>` : `<a href="#${k}" ${App.current === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('');
    $('#tabbar [data-add]').onclick = () => UI.addJob();
    $('#tabbar [data-more]').onclick = () => {
      UI.modal({
        title: 'More', size: 'sm',
        body: `<div style="display:grid;gap:6px">${VIEWS.filter((v) => !['dashboard', 'board', 'ats'].includes(v.key)).map((v) => `<a class="btn" style="justify-content:flex-start" href="#${v.key}" data-go>${icon(v.icon)}<span>${E(v.label)}</span><span class="muted" style="margin-left:auto;font-weight:400;font-size:12px">${E(CRUMB[v.key])}</span></a>`).join('')}</div>`,
        onMount: (m, api) => $$('[data-go]', m).forEach((a) => (a.onclick = () => api.close())),
      });
    };
    // resume mini + sync
    const r = S().resume;
    const p = S().ready ? S().profile() : null;
    const audit = p ? CB.ATS.auditResume(p, (r && r.warnings) || []) : null;
    $('#resume-mini').innerHTML = audit ? `<span class="grade g-${audit.grade}">${audit.grade}</span><span style="min-width:0"><b class="ell" style="display:block;font-size:12.5px">${E(r.sample ? 'Example resume' : r.fileName || 'Resume')}</b><span class="muted" style="font-size:11.5px">${p.skills.size} skills · ${p.totalYears} yrs · score ${audit.score}</span></span>` : `<span class="grade g-none">?</span><span><b style="display:block;font-size:12.5px">No resume yet</b><span class="muted" style="font-size:11.5px">Upload to score every job</span></span>`;
    const sy = $('#sync');
    sy.className = 'sync ' + (S().mode === 'cloud' ? 'cloud' : S().mode === 'local' ? 'local' : '');
    sy.querySelector('span').textContent = S().mode === 'cloud' ? (S().stale ? 'Sync slow — showing saved copy' : 'Synced across your devices') : S().mode === 'local' ? 'Saved on this device only' : 'Connecting…';
  }

  // ───────────────────────── routing ─────────────────────────
  function teardown() { App.cleanup.forEach((f) => { try { f(); } catch (e) { /* noop */ } }); App.cleanup = []; CB.Charts.tip.hide(); }
  function route() {
    const k = (location.hash || '').slice(1);
    const v = VIEWS.find((x) => x.key === k) ? k : 'dashboard';
    show(v);
  }
  function show(k, refresh) {
    const view = $('#view');
    const keepScroll = refresh ? window.scrollY : 0;
    App.next = k;
    if (!refresh) teardown();
    App.current = k;
    const meta = VIEWS.find((x) => x.key === k);
    $('#page-title').textContent = meta.label;
    $('#page-crumb').textContent = CRUMB[k] || '';
    document.title = meta.label + ' · Callback';
    renderNav();
    if (!S().ready) { view.innerHTML = `<div class="empty"><span class="thinking">Loading your applications…</span><p class="muted" style="max-width:46ch">Your data syncs between your iPhone and MacBook. If this takes more than a few seconds, the saved copy will open.</p></div>`; return; }
    if (refresh) teardown();
    try { CB.Views[k](view, { refresh }); }
    catch (e) { console.error(e); view.innerHTML = `<div class="empty"><h3>Something went wrong drawing this view</h3><p class="muted">${E(e.message)}</p></div>`; }
    if (refresh) window.scrollTo(0, keepScroll); else window.scrollTo(0, 0);
  }
  const rerender = CB.debounce(() => {
    if (App.busy) { rerender(); return; }
    if (App.current) show(App.current, true);
    if (App.drawerId) Drawer.refresh();
  }, 140);
  App.rerender = rerender;

  // ───────────────────────── theme ─────────────────────────
  function applyTheme() {
    let t = 'system';
    try { t = localStorage.getItem('callback.theme') || 'system'; } catch (e) { /* noop */ }
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  UI.setTheme = (t) => { try { localStorage.setItem('callback.theme', t); } catch (e) { /* noop */ } applyTheme(); CB.emit('theme'); rerender(); };
  UI.theme3d = () => {
    const cs = getComputedStyle(document.documentElement);
    const g = (v) => cs.getPropertyValue(v).trim();
    const toHex = (c) => { if (/^#/.test(c)) return c; const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const rgb = getComputedStyle(d).color; d.remove(); const m = rgb.match(/\d+(\.\d+)?/g) || [0, 0, 0]; return '#' + m.slice(0, 3).map((x) => (+x | 0).toString(16).padStart(2, '0')).join(''); };
    return { fg: toHex(g('--ink')), muted: toHex(g('--muted')), grid: toHex(g('--line-2')), surface: toHex(g('--surface')), accent: toHex(g('--accent')) };
  };
  UI.stageHex = (key) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--st-' + key).trim();
    return /^#/.test(v) ? v : CB.STAGE[key].color;
  };
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => { CB.emit('theme'); rerender(); });
  }

  // ───────────────────────── job drawer ─────────────────────────
  const Drawer = {};
  const FIELDS = [
    ['company', 'Company', 'text'], ['title', 'Job title', 'text'], ['location', 'Location', 'text'],
    ['workMode', 'Work mode', 'select', ['', ...CB.WORK_MODES]], ['employmentType', 'Type', 'select', ['', ...CB.EMP_TYPES]], ['seniority', 'Seniority', 'select', ['', ...CB.SENIORITY.map((s) => s.label)]],
    ['source', 'Source', 'select', CB.SOURCES], ['priority', 'Priority', 'select', CB.PRIORITIES], ['applicants', 'Applicants on posting', 'number'],
    ['salaryMin', 'Salary min', 'number'], ['salaryMax', 'Salary max', 'number'], ['salaryPeriod', 'Pay period', 'select', ['year', 'hour', 'month']],
    ['appliedDate', 'Applied', 'date'], ['postedDate', 'Posted', 'date'], ['followUpDate', 'Follow up on', 'date'], ['deadline', 'Apply by', 'date'],
    ['responseDate', 'First response', 'date'], ['referrerName', 'Referrer', 'text'],
  ];
  const fieldHtml = (j, [k, label, type, opts]) => {
    const v = j[k] ?? '';
    if (type === 'select') return `<label class="field"><span>${E(label)}</span><select class="input" data-f="${k}">${UI.opts(opts, v)}</select></label>`;
    return `<label class="field"><span>${E(label)}</span><input class="input" data-f="${k}" type="${type}" value="${E(v)}"${type === 'number' ? ' inputmode="decimal"' : ''}></label>`;
  };

  Drawer.open = (id, tab) => {
    const j = S().get(id);
    if (!j) return;
    Drawer.close(true);
    App.drawerId = id;
    App.drawerTab = tab || App.drawerTab || 'overview';
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.id = 'dr-scrim';
    const d = document.createElement('aside');
    d.className = 'drawer';
    d.id = 'drawer';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', 'Application details');
    document.body.append(scrim, d);
    scrim.onclick = () => Drawer.close();
    Drawer.render();
  };
  Drawer.close = (silent) => {
    $('#drawer') && $('#drawer').remove();
    $('#dr-scrim') && $('#dr-scrim').remove();
    if (Drawer._cleanup) { Drawer._cleanup.forEach((f) => f()); Drawer._cleanup = []; }
    if (!silent) App.drawerId = null;
  };
  Drawer.refresh = () => {
    const d = $('#drawer');
    if (!d) return;
    if (!S().get(App.drawerId)) { Drawer.close(); return; }
    if (d.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || (document.activeElement && document.activeElement.isContentEditable)) { Drawer.renderHead(); return; }
    Drawer.render(true);
  };
  Drawer.renderHead = () => {
    const d = $('#drawer');
    const j = S().get(App.drawerId);
    if (!d || !j) return;
    const a = S().atsFor(j);
    const st = CB.STAGE[j.status];
    const head = d.querySelector('.dr-head');
    const tabs = [['overview', 'Overview'], ['ats', 'ATS report'], ['interviews', `Interviews${j.interviews.length ? ' · ' + j.interviews.length : ''}`], ['contacts', `Contacts${j.contacts.length ? ' · ' + j.contacts.length : ''}`], ['docs', 'Notes & docs'], ['timeline', 'Timeline']];
    head.innerHTML = `
      <div class="dr-title">${UI.mono(j.company, 44)}
        <div style="min-width:0"><h2>${E(j.title || 'Untitled role')}</h2><div class="co">${E(j.company || 'Company')}${j.location ? ' · ' + E(j.location) : ''}${j.sample ? ' <span class="example-dot">Example</span>' : ''}</div></div>
        <div class="row" style="gap:4px;flex-wrap:nowrap">
          ${j.url ? `<a class="btn btn-ghost btn-icon" href="${E(j.url)}" target="_blank" rel="noopener" title="Open posting">${icon('link')}</a>` : ''}
          <button class="btn btn-ghost btn-icon" data-dossier title="Export dossier (.docx)">${icon('doc')}</button>
          <button class="btn btn-ghost btn-icon" data-del title="Delete">${icon('trash')}</button>
          <button class="btn btn-ghost btn-icon" data-close title="Close" aria-label="Close">${icon('x')}</button>
        </div>
      </div>
      <div class="dr-stage">
        <label class="sr" for="dr-status">Status</label>
        <select class="input" id="dr-status" style="width:auto;font-weight:600;border-color:var(--st-${st.key})">${UI.stageOpts(j.status)}</select>
        ${UI.score(a)} ${UI.stamp(a)} <span class="tag">Chance ${UI.prob(a)}</span>
        ${j.appliedDate ? `<span class="tag">Applied ${CB.fmtDate(j.appliedDate)} · ${CB.relDays(j.appliedDate)}</span>` : ''}
        ${CB.fmtSalary(j) ? `<span class="tag">${E(CB.fmtSalary(j))}</span>` : ''}
      </div>
      <div class="stepper" aria-hidden="true">${CB.PROGRESSION.filter((s) => s.key !== 'saved').map((s) => `<i class="${(j.maxStage || 0) >= s.order ? 'on' : ''}" style="--c:var(--st-${st.group === 'closed' ? j.status : s.key})" title="${E(s.label)}"></i>`).join('')}</div>
      <div class="dr-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${App.drawerTab === k}">${E(l)}</button>`).join('')}</div>`;
    head.querySelector('[data-close]').onclick = () => Drawer.close();
    head.querySelector('#dr-status').onchange = (e) => UI.moveJob(j.id, e.target.value);
    head.querySelector('[data-del]').onclick = async () => {
      if (await UI.confirm({ title: 'Delete application?', text: `${j.company} · ${j.title} and its interviews, contacts and notes will be removed. You can undo right after.`, ok: 'Delete', danger: true })) { S().remove(j.id); Drawer.close(); UI.toast('Deleted', { undo: true }); }
    };
    head.querySelector('[data-dossier]').onclick = () => UI.save(CB.IO.exportJobDossierDocx(j, a, S().resume && S().resume.fileName), 'Dossier ready');
    $$('[data-tab]', head).forEach((b) => (b.onclick = () => { App.drawerTab = b.dataset.tab; Drawer.render(); }));
  };
  Drawer.render = (keepScroll) => {
    const d = $('#drawer');
    const j = S().get(App.drawerId);
    if (!d || !j) return;
    const prevScroll = keepScroll && d.querySelector('.dr-body') ? d.querySelector('.dr-body').scrollTop : 0;
    if (Drawer._cleanup) { Drawer._cleanup.forEach((f) => f()); }
    Drawer._cleanup = [];
    d.innerHTML = `<div class="dr-head"></div><div class="dr-body" id="dr-body"></div>`;
    Drawer.renderHead();
    const body = d.querySelector('.dr-body');
    (Tabs[App.drawerTab] || Tabs.overview)(body, j);
    if (keepScroll) body.scrollTop = prevScroll;
    d.onkeydown = (e) => { if (e.key === 'Escape' && !$('.modal')) Drawer.close(); };
  };

  // live field binding for the drawer
  function bindFields(root, id) {
    const commit = (el) => {
      const f = el.dataset.f;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') v = v === '' ? null : +v;
      const cur = S().get(id);
      if (!cur || cur[f] === v) return;
      S().update(id, (j) => { j[f] = v; }, { undoLabel: 'Edit' });
    };
    $$('[data-f]', root).forEach((el) => {
      el.addEventListener('change', () => commit(el));
      if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'url') el.addEventListener('input', CB.debounce(() => commit(el), 700));
    });
  }

  const Tabs = {};
  Tabs.overview = (body, j) => {
    const a = S().atsFor(j);
    const closed = CB.STAGE[j.status].group === 'closed';
    body.innerHTML = `
      ${j.status === 'offer' || j.status === 'accepted' ? `<section class="card"><div class="card-h"><h3>Offer</h3><span class="sub">Compare against the posted range${j.salaryMax ? ` (${E(CB.fmtSalary(j))})` : ''}</span></div>
        <div class="grid3">
          <label class="field"><span>Base salary</span><input class="input" type="number" data-o="base" value="${E(j.offer?.base ?? '')}"></label>
          <label class="field"><span>Bonus %</span><input class="input" type="number" data-o="bonus" value="${E(j.offer?.bonus ?? '')}"></label>
          <label class="field"><span>Sign-on</span><input class="input" type="number" data-o="signOn" value="${E(j.offer?.signOn ?? '')}"></label>
          <label class="field"><span>Equity</span><input class="input" data-o="equity" value="${E(j.offer?.equity ?? '')}"></label>
          <label class="field"><span>Decision deadline</span><input class="input" type="date" data-o="deadline" value="${E(j.offer?.deadline ?? '')}"></label>
          <div class="field"><span>Year-one cash</span><div style="font:700 20px/2 var(--f-ui)">${E(CB.fmtMoney((+j.offer?.base || 0) * (1 + (+j.offer?.bonus || 0) / 100) + (+j.offer?.signOn || 0), 'USD', false) || '—')}</div></div>
        </div>
        ${j.salaryMax && j.offer?.base ? `<p class="muted" style="margin:10px 0 0;font-size:12.5px">Base is ${Math.round((j.offer.base - j.salaryMin) / Math.max(1, j.salaryMax - j.salaryMin) * 100)}% of the way through the posted band. ${j.offer.base < (j.salaryMin + j.salaryMax) / 2 ? 'Below the midpoint — there is usually room to negotiate.' : 'At or above the midpoint.'}</p>` : ''}
      </section>` : ''}
      ${closed && j.status === 'rejected' ? `<section class="card"><div class="grid2"><label class="field"><span>Rejection reason</span><select class="input" data-f="rejectionReason">${UI.opts(CB.REJECTION_REASONS, j.rejectionReason)}</select></label><div class="field"><span>Rejected at</span><div style="padding-top:6px">${UI.chip(j.rejectionStage || 'applied')}</div></div></div></section>` : ''}
      <section class="card"><div class="card-h"><h3>Details</h3><span class="sub">Changes save automatically</span></div>
        <div class="kv">${FIELDS.map((f) => fieldHtml(j, f)).join('')}</div>
        <div class="row" style="margin-top:14px">
          <label class="check"><input type="checkbox" data-f="referral" ${j.referral ? 'checked' : ''}><span>Referred by someone inside</span></label>
          <div class="row" style="margin-left:auto;gap:4px" aria-label="Excitement">${[1, 2, 3, 4, 5].map((n) => `<button class="btn btn-ghost btn-icon" data-star="${n}" title="Excitement ${n}/5" style="color:${n <= (j.excitement || 0) ? 'var(--accent-strong)' : 'var(--line-2)'}">${icon('star').replace('fill="none"', n <= (j.excitement || 0) ? 'fill="currentColor"' : 'fill="none"')}</button>`).join('')}</div>
        </div>
        <label class="field" style="margin-top:12px"><span>Posting URL</span><input class="input" data-f="url" type="url" value="${E(j.url)}" placeholder="https://www.linkedin.com/jobs/view/…"></label>
      </section>
      <section class="card"><div class="card-h"><h3>Job description</h3><span class="sub">${a.score != null ? 'Scored ' + a.score + ' — see ATS report' : 'Paste it to get an ATS score'}</span>
        <div class="right">${App.ai ? '<button class="btn btn-sm claude-btn" data-ai-extract>Re-read with Claude</button>' : ''}</div></div>
        <textarea class="input" data-f="jd" rows="12" placeholder="Paste the full job description…">${E(j.jd)}</textarea>
        ${j.jdAI ? `<p class="muted" style="font-size:12px;margin:8px 0 0">Requirements were read by Claude${j.jdAI.summary ? ': ' + E(j.jdAI.summary) : ''} · <button class="btn btn-ghost btn-sm" data-ai-clear>Use local parser</button></p>` : ''}
      </section>`;
    bindFields(body, j.id);
    $$('[data-star]', body).forEach((b) => (b.onclick = () => S().update(j.id, (x) => { x.excitement = +b.dataset.star === x.excitement ? 0 : +b.dataset.star; })));
    $$('[data-o]', body).forEach((el) => el.addEventListener('change', () => S().update(j.id, (x) => { x.offer = x.offer || {}; x.offer[el.dataset.o] = el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value; })));
    const ex = $('[data-ai-extract]', body);
    if (ex) ex.onclick = async () => {
      ex.disabled = true; ex.textContent = 'Reading…';
      try {
        const r = await CB.AI.extractJob(S().get(j.id).jd, j.url);
        S().update(j.id, (x) => { x.jdAI = r; if (!x.seniority && r.seniority) x.seniority = r.seniority; if (x.applicants == null && r.applicants) x.applicants = r.applicants; });
        UI.toast('Requirements re-read by Claude and re-scored.');
      } catch (e) { UI.toast(CB.AI.errText(e) || 'Stopped', { tone: 'warn' }); ex.disabled = false; ex.textContent = 'Re-read with Claude'; }
    };
    const cl = $('[data-ai-clear]', body);
    if (cl) cl.onclick = () => S().update(j.id, (x) => { x.jdAI = null; });
  };

  Tabs.ats = (body, j) => {
    const a = S().atsFor(j);
    if (a.verdict === 'NO_RESUME' || a.verdict === 'NO_JD') {
      body.innerHTML = `<div class="empty">${UI.stamp(a, true)}<h3>${a.verdict === 'NO_RESUME' ? 'Upload your resume to score this job' : 'Paste the job description to score this job'}</h3>
        <p class="muted" style="max-width:46ch">${a.verdict === 'NO_RESUME' ? 'Callback compares your resume against the posting the way an ATS and a recruiter screen do: knockout questions first, then ranking.' : 'Open the Overview tab and paste the full description. LinkedIn: open the posting, select all, copy, paste.'}</p>
        ${a.verdict === 'NO_RESUME' ? '<a class="btn btn-primary" href="#ats">Go to ATS Lab</a>' : '<button class="btn btn-primary" data-go-ov>Paste the description</button>'}</div>`;
      const g = $('[data-go-ov]', body);
      if (g) g.onclick = () => { App.drawerTab = 'overview'; Drawer.render(); setTimeout(() => { const t = $('#drawer [data-f="jd"]'); t && t.focus(); }, 50); };
      return;
    }
    const vend = CB.ATS.parseJobUrl(j.url).vendor;
    const req = a.skills.required, pref = a.skills.preferred;
    const ico = { evidenced: '✓', listed: '◐', transferable: '≈', missing: '✗', alternative: '∨' };
    const tip = (s) => (s.status === 'alternative' ? `Either/or requirement — covered by ${s.via}` : s.via ? `${s.status} · via ${s.via}` : s.status);
    const skl = (s) => `<span class="sk sk-${s.status}" title="${E(tip(s))}"><i>${ico[s.status]}</i>${E(s.name)}${s.jdCount > 1 ? `<small>×${s.jdCount}</small>` : ''}</span>`;
    body.innerHTML = `
      <section class="card"><div class="ats-hero">
        <div class="ring-host" id="ats-ring"></div>
        <div style="display:grid;gap:10px;min-width:0">
          <div class="row">${UI.stamp(a, true)}</div>
          <div style="font-size:13.5px;color:var(--ink-2)"><b style="color:var(--ink)">Interview chance ${UI.prob(a)}</b>${a.rank ? ` · estimated rank <b style="color:var(--ink)">#${a.rank.position}</b> of ${a.rank.estimatedPool ? '~' : ''}${a.rank.pool} applicants (top ${100 - a.rank.percentile}%)` : ''}</div>
          <div class="muted" style="font-size:12px">${E(a.strictness)} mode · cutoff ${a.thresholds.floor} · recruiter review ${a.thresholds.competitive}+ · shortlist ${a.thresholds.strong}+${a.probabilityNotes.length ? '<br>Odds factors: ' + E(a.probabilityNotes.join(' · ')) : ''}</div>
          ${vend && CB.ATS.VENDOR_TIPS[vend] ? `<div class="tag" style="white-space:normal;line-height:1.4;padding:6px 8px"><b>${E(vend)}:</b>&nbsp;${E(CB.ATS.VENDOR_TIPS[vend])}</div>` : ''}
        </div></div>
      </section>
      ${a.knockouts.length ? `<section style="display:grid;gap:8px">${a.knockouts.map((k) => `<div class="ko"><code>${E(k.code)}</code><div><b>${E(k.label)}</b><span>${E(k.detail)}</span></div></div>`).join('')}</section>` : ''}
      <section class="card"><div class="card-h"><h3>Score breakdown</h3><span class="sub">Weighted like an ATS rank + recruiter screen</span></div>
        ${a.components.map((c) => `<div class="comp"><div class="comp-l"><b>${E(c.label)} <span class="muted" style="display:inline;font-weight:500">${Math.round(c.weight * 100)}%</span></b><span>${E(c.detail)}</span></div><div class="trk"><i style="width:${c.score ?? 0}%;background:${c.score == null ? 'var(--line-2)' : UI.compColor(c.score)}"></i></div><div class="v">${c.score ?? '—'}</div></div>`).join('')}
      </section>
      <section class="card"><div class="card-h"><h3>Must-have skills</h3><span class="sub">✓ in experience · ◐ skills list only · ≈ transferable · ∨ either/or, covered · ✗ missing</span></div>
        <div class="skills-grid">${req.length ? req.map(skl).join('') : '<span class="muted">No must-have skills detected.</span>'}</div>
        ${pref.length ? `<div class="lbl" style="margin:14px 0 8px">Nice to have</div><div class="skills-grid">${pref.map(skl).join('')}</div>` : ''}
        ${a.keywords.matched.length || a.keywords.missing.length ? `<div class="lbl" style="margin:14px 0 8px">Domain terms the posting repeats</div><div class="skills-grid">${a.keywords.matched.map((k) => `<span class="sk sk-evidenced"><i>✓</i>${E(k)}</span>`).join('')}${a.keywords.missing.map((k) => `<span class="sk sk-missing"><i>✗</i>${E(k)}</span>`).join('')}</div>` : ''}
      </section>
      <section class="card"><div class="card-h"><h3>Fix before you apply</h3><span class="sub">Ordered by impact</span></div>
        ${a.fixes.length ? a.fixes.map((f) => `<div class="fix"><span class="p p${f.priority}">P${f.priority}</span><span>${E(f.text)}</span></div>`).join('') : '<p class="muted" style="margin:0">Nothing critical. Apply early and get a referral if you can.</p>'}
      </section>
      ${a.reqs && a.reqs.flags.length ? `<section class="card"><div class="card-h"><h3>Posting signals</h3></div>${a.reqs.flags.map((f) => `<div class="fix"><span class="p p2">!</span><span>${E(f)}</span></div>`).join('')}</section>` : ''}
      <section class="card"><div class="card-h"><h3>Recruiter's-eye view</h3><span class="sub">The posting as the screener reads it against your resume</span></div><div class="jd-hl">${CB.ATS.highlight(j.jd, a)}</div></section>
      <section class="card"><div class="card-h"><h3>Claude deep review</h3><span class="sub">A brutal 60-second recruiter screen, plus rewritten bullets</span>
        <div class="right">${App.ai ? '<button class="btn btn-sm claude-btn" data-review>Run review</button>' : ''}</div></div>
        <div id="ai-review">${App.ai ? '<p class="muted" style="margin:0;font-size:13px">Uses your Claude account. Takes 20–60 seconds.</p>' : (CB.standalone ? '<p class="muted" style="margin:0;font-size:13px">The Claude deep review is part of the claude.ai version. Everything else on this page runs on your device.</p>' : '<p class="muted" style="margin:0;font-size:13px">Claude features are available when this page is opened inside claude.ai.</p>')}</div>
      </section>`;
    CB.Charts.ring($('#ats-ring', body), a.score / 100, { label: a.score, sub: 'ATS fit / 100', size: 132, stroke: 11, color: UI.scoreColor(a.score, a), aria: 'ATS score ' + a.score });
    const rv = $('[data-review]', body);
    if (rv) rv.onclick = () => UI.aiRun($('#ai-review', body), (o) => CB.AI.review(S().get(j.id), S().resume.text, a, o));
  };

  Tabs.interviews = (body, j) => {
    const ivs = [...j.interviews].sort((x, y) => (x.datetime || '').localeCompare(y.datetime || ''));
    body.innerHTML = `
      <section style="display:grid;gap:8px">${ivs.length ? ivs.map((iv) => {
        const d = CB.parseDate(iv.datetime);
        return `<div class="iv" data-iv="${iv.id}">
          <div class="iv-date">${d ? `<span>${CB.MONTHS[d.getMonth()]}</span><b>${d.getDate()}</b>` : '<b>—</b>'}</div>
          <div style="min-width:0"><b>Round ${iv.round} · ${E(iv.type)}</b><div class="muted" style="font-size:12.5px">${E(CB.fmtDateTime(iv.datetime))}${iv.durationMin ? ' · ' + iv.durationMin + ' min' : ''}${iv.interviewer ? ' · ' + E(iv.interviewer) : ''}</div>
            ${iv.link ? `<a href="${E(iv.link)}" target="_blank" rel="noopener" style="font-size:12.5px">Join link</a>` : ''}
            <div class="row" style="margin-top:6px;gap:8px"><label class="check" style="font-size:12.5px"><input type="checkbox" data-ty ${iv.thankYouSent ? 'checked' : ''}><span>Thank-you sent</span></label>${App.ai ? '<button class="btn btn-sm claude-btn" data-prep>Prep with Claude</button>' : ''}</div>
            <textarea class="input" data-ivnotes rows="2" placeholder="Notes: questions asked, who you met, how it went" style="margin-top:6px;min-height:52px">${E(iv.notes)}</textarea>
            <div data-prep-out style="margin-top:8px"></div>
          </div>
          <div style="display:grid;gap:6px;justify-items:end"><select class="input" data-outcome style="width:auto">${UI.opts(CB.INTERVIEW_OUTCOMES, iv.outcome)}</select><button class="btn btn-ghost btn-sm btn-danger" data-delv>Remove</button></div>
        </div>`;
      }).join('') : '<p class="muted" style="margin:0">No interviews logged yet. Add the recruiter screen as soon as it is booked so reminders and your calendar work.</p>'}</section>
      <section class="card"><div class="card-h"><h3>Add interview</h3></div>
        <div class="grid3">
          <label class="field"><span>Type</span><select class="input" id="iv-type">${UI.opts(CB.INTERVIEW_TYPES, j.interviews.length ? 'Technical screen' : 'Recruiter screen')}</select></label>
          <label class="field"><span>Date & time</span><input class="input" id="iv-dt" type="datetime-local" value="${CB.addDays(CB.todayISO(), 2)}T10:00"></label>
          <label class="field"><span>Duration (min)</span><input class="input" id="iv-dur" type="number" value="45"></label>
          <label class="field"><span>Interviewer</span><input class="input" id="iv-who" placeholder="Name, role"></label>
          <label class="field"><span>Video link</span><input class="input" id="iv-link" type="url" placeholder="https://"></label>
          <div class="field"><span>&nbsp;</span><button class="btn btn-primary" id="iv-add">Add interview</button></div>
        </div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Adding an interview also advances the status if needed (Recruiter screen → Screen, technical/onsite → Interviewing / Final).</p>
      </section>`;
    const upd = (ivId, fn) => S().update(j.id, (x) => { const iv = x.interviews.find((i) => i.id === ivId); if (iv) fn(iv, x); });
    $$('[data-iv]', body).forEach((row) => {
      const id = row.dataset.iv;
      $('[data-outcome]', row).onchange = (e) => {
        const o = e.target.value;
        upd(id, (iv, x) => { iv.outcome = o; x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'interview', text: `${iv.type}: ${o}` }); });
        if (o === 'Failed') setTimeout(() => UI.confirm({ title: 'Mark the application rejected?', text: 'This interview failed. Move the application to Rejected now?', ok: 'Mark rejected' }).then((y) => y && UI.moveJob(j.id, 'rejected', { reason: 'Interview performance' })), 200);
      };
      $('[data-ty]', row).onchange = (e) => upd(id, (iv) => { iv.thankYouSent = e.target.checked; });
      $('[data-ivnotes]', row).addEventListener('input', CB.debounce((e) => upd(id, (iv) => { iv.notes = e.target.value; }), 700));
      $('[data-delv]', row).onclick = () => S().update(j.id, (x) => { x.interviews = x.interviews.filter((i) => i.id !== id); }, { undoLabel: 'Remove interview' });
      const pb = $('[data-prep]', row);
      if (pb) pb.onclick = () => {
        if (!S().resume) { UI.toast('Upload your resume first.', { tone: 'warn' }); return; }
        const iv = S().get(j.id).interviews.find((i) => i.id === id);
        UI.aiRun($('[data-prep-out]', row), (o) => CB.AI.interviewPrep(S().get(j.id), S().resume.text, iv.type, o));
      };
    });
    $('#iv-add', body).onclick = () => {
      const type = $('#iv-type', body).value, dt = $('#iv-dt', body).value;
      if (!dt) { UI.toast('Pick a date and time.', { tone: 'warn' }); return; }
      S().update(j.id, (x) => {
        x.interviews.push({ id: CB.uid('i_'), round: x.interviews.length + 1, type, datetime: dt, durationMin: +$('#iv-dur', body).value || 45, interviewer: $('#iv-who', body).value, link: $('#iv-link', body).value, outcome: 'Scheduled', notes: '', thankYouSent: false });
        x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'interview', text: `${type} scheduled for ${CB.fmtDateTime(dt)}` });
      });
      const target = /recruiter/i.test(type) ? 'screen' : /panel|onsite|executive|final/i.test(type) ? 'final' : /take-home/i.test(type) ? 'assessment' : 'interview';
      const cur = S().get(j.id);
      if (CB.STAGE[target].order > CB.STAGE[cur.status].order || CB.STAGE[cur.status].order < 0) S().move(j.id, target, { note: 'Interview scheduled', auto: true });
      UI.toast('Interview added');
    };
  };

  Tabs.contacts = (body, j) => {
    body.innerHTML = `
      <section style="display:grid;gap:8px">${j.contacts.length ? j.contacts.map((c) => `<div class="iv" style="grid-template-columns:auto minmax(0,1fr) auto" data-c="${c.id}">${UI.mono(c.name, 38)}<div style="min-width:0"><b>${E(c.name)}</b> <span class="muted">${E(c.role)}</span>
        <div style="font-size:12.5px;display:flex;gap:10px;flex-wrap:wrap;margin-top:2px">${c.email ? `<span class="mono" style="font-size:12px">${E(c.email)}</span><button class="btn btn-ghost btn-sm" data-copy="${E(c.email)}">Copy</button>` : ''}${c.phone ? `<span>${E(c.phone)}</span>` : ''}${c.linkedin ? `<a href="${E(c.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ''}</div>
        ${c.notes ? `<div class="muted" style="font-size:12.5px">${E(c.notes)}</div>` : ''}</div><button class="btn btn-ghost btn-sm btn-danger" data-delc>Remove</button></div>`).join('') : '<p class="muted" style="margin:0">Add recruiters, hiring managers and referrers. A named contact doubles your odds of a reply to a follow-up.</p>'}</section>
      <section class="card"><div class="card-h"><h3>Add contact</h3></div>
        <div class="grid3">
          <label class="field"><span>Name</span><input class="input" id="c-name"></label>
          <label class="field"><span>Role</span><select class="input" id="c-role">${UI.opts(['Recruiter', 'Hiring manager', 'Referrer', 'Interviewer', 'Team member', 'Other'], 'Recruiter')}</select></label>
          <label class="field"><span>Email</span><input class="input" id="c-email" type="email"></label>
          <label class="field"><span>Phone</span><input class="input" id="c-phone" type="tel"></label>
          <label class="field"><span>LinkedIn URL</span><input class="input" id="c-li" type="url"></label>
          <label class="field"><span>Notes</span><input class="input" id="c-notes"></label>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn btn-primary" id="c-add">Add contact</button>${App.ai ? '<button class="btn claude-btn" id="c-out">Draft outreach with Claude</button>' : ''}</div>
        <div id="c-out-box" style="margin-top:10px"></div>
      </section>`;
    $$('[data-copy]', body).forEach((b) => (b.onclick = () => UI.copy(b.dataset.copy)));
    $$('[data-delc]', body).forEach((b) => (b.onclick = () => { const id = b.closest('[data-c]').dataset.c; S().update(j.id, (x) => { x.contacts = x.contacts.filter((c) => c.id !== id); }, { undoLabel: 'Remove contact' }); }));
    $('#c-add', body).onclick = () => {
      const name = $('#c-name', body).value.trim();
      if (!name) { UI.toast('Add a name.', { tone: 'warn' }); return; }
      S().update(j.id, (x) => { x.contacts.push({ id: CB.uid('c_'), name, role: $('#c-role', body).value, email: $('#c-email', body).value.trim(), phone: $('#c-phone', body).value.trim(), linkedin: $('#c-li', body).value.trim(), notes: $('#c-notes', body).value.trim() }); });
    };
    const ob = $('#c-out', body);
    if (ob) ob.onclick = () => { if (!S().resume) return UI.toast('Upload your resume first.', { tone: 'warn' }); UI.aiRun($('#c-out-box', body), (o) => CB.AI.outreach(S().get(j.id), S().resume.text, o)); };
  };

  const sanitize = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    d.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    d.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((at) => { if (/^on/i.test(at.name) || (at.name === 'href' && /^\s*javascript:/i.test(at.value)) || at.name === 'style') n.removeAttribute(at.name); }));
    return d.innerHTML;
  };
  Tabs.docs = (body, j) => {
    const s = S().settings;
    const name = s.candidateName || (S().profile() && S().profile().name) || 'Your Name';
    const letter = j.coverLetter || '';
    body.innerHTML = `
      <section class="card"><div class="card-h"><h3>Notes</h3><span class="sub">Prep, research, salary talk — saved as you type</span></div>
        <div class="rte-bar" role="toolbar" aria-label="Formatting">
          <button data-cmd="bold" title="Bold"><b>B</b></button><button data-cmd="italic" title="Italic"><i>I</i></button><button data-cmd="underline" title="Underline"><u>U</u></button>
          <button data-cmd="insertUnorderedList" title="Bullets">•</button><button data-cmd="insertOrderedList" title="Numbered">1.</button><button data-cmd="formatBlock" data-v="h3" title="Heading">H</button><button data-cmd="removeFormat" title="Clear formatting">⌫</button>
        </div>
        <div class="rte" contenteditable="true" id="notes-ed" aria-label="Notes">${sanitize(j.notes) || ''}</div>
      </section>
      <section class="card"><div class="card-h"><h3>Cover letter</h3><span class="sub">Edit on the page · export to Word</span>
        <div class="right">${App.ai ? '<button class="btn btn-sm claude-btn" data-cl-ai>Draft with Claude</button>' : ''}<button class="btn btn-sm" data-cl-tpl>Template</button><button class="btn btn-sm" data-cl-docx>${icon('download')}.docx</button></div></div>
        <div style="background:var(--sunken);padding:18px;border-radius:var(--r);overflow-x:auto"><div class="page-doc" contenteditable="true" id="cl-ed" aria-label="Cover letter">${E(letter) || '<span style="color:#888">Draft with Claude or start from the template. Text you write here is saved automatically.</span>'}</div></div>
        <div id="cl-status" class="muted" style="font-size:12px;margin-top:8px"></div>
      </section>`;
    const ed = $('#notes-ed', body);
    $$('[data-cmd]', body).forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); document.execCommand(b.dataset.cmd, false, b.dataset.v || null); ed.dispatchEvent(new Event('input')); }));
    ed.addEventListener('input', CB.debounce(() => S().update(j.id, (x) => { x.notes = sanitize(ed.innerHTML); }, { silent: true }), 800));
    const cl = $('#cl-ed', body);
    cl.addEventListener('focus', () => { if (!S().get(j.id).coverLetter) cl.textContent = ''; }, { once: true });
    const saveCl = CB.debounce(() => { S().update(j.id, (x) => { x.coverLetter = cl.innerText.trim(); }, { silent: true }); $('#cl-status', body).textContent = 'Saved'; }, 800);
    cl.addEventListener('input', saveCl);
    $('[data-cl-tpl]', body).onclick = () => {
      const p = S().profile();
      const a = S().atsFor(j);
      const top = (a.skills ? a.skills.required.filter((x) => x.status === 'evidenced').map((x) => x.name) : []).slice(0, 3);
      cl.innerText = `I'm applying for the ${j.title} role at ${j.company}. ${p ? `Over the past ${Math.floor(p.totalYears)} years as a ${p.recentTitle || 'professional'}, ` : ''}I've built the kind of work this team describes${top.length ? `, with hands-on experience in ${top.join(', ')}` : ''}.\n\n[Proof point 1: the most relevant result from your resume, with a number.]\n\n[Proof point 2: a second result that maps to a must-have in the posting.]\n\nI'd welcome a conversation about how I can help ${j.company} — thank you for your time.`;
      saveCl();
    };
    $('[data-cl-docx]', body).onclick = () => UI.save(CB.IO.exportCoverLetterDocx({ job: S().get(j.id), text: cl.innerText.trim(), candidateName: name, candidateEmail: s.candidateEmail || (S().profile() && S().profile().contact.email) || '', candidatePhone: s.candidatePhone || (S().profile() && S().profile().contact.phone) || '' }), 'Cover letter ready');
    const ai = $('[data-cl-ai]', body);
    if (ai) ai.onclick = async () => {
      if (!S().resume) return UI.toast('Upload your resume first.', { tone: 'warn' });
      ai.disabled = true;
      $('#cl-status', body).innerHTML = '<span class="thinking">Claude is drafting…</span>';
      try {
        const r = await CB.AI.coverLetter(S().get(j.id), S().resume.text, name, { onText: ({ text }) => { cl.innerText = text; } });
        cl.innerText = r.text.trim();
        saveCl();
      } catch (e) { $('#cl-status', body).textContent = CB.AI.errText(e); }
      ai.disabled = false;
    };
  };

  Tabs.timeline = (body, j) => {
    const items = [...j.timeline].sort((a, b) => b.ts.localeCompare(a.ts));
    const label = (t) => {
      if (t.kind === 'status' || t.kind === 'auto') return `${CB.STAGE[t.from] ? CB.STAGE[t.from].label : '—'} → ${CB.STAGE[t.to] ? CB.STAGE[t.to].label : '—'}${t.kind === 'auto' ? ' (automatic)' : ''}`;
      return { created: 'Added', note: 'Note', interview: 'Interview', email: 'Email', followup: 'Follow-up sent', ats: 'ATS', import: 'Imported' }[t.kind] || t.kind;
    };
    body.innerHTML = `
      <section class="card"><div class="row"><input class="input" id="tl-note" placeholder="Add a note to the timeline…" style="flex:1 1 220px"><button class="btn btn-primary" id="tl-add">Add note</button><button class="btn" id="tl-fu">${icon('send')}Log follow-up</button></div></section>
      <section class="card"><div class="timeline">${items.map((t) => `<div class="tl"><span class="tl-dot" style="--c:${t.to ? `var(--st-${t.to})` : t.kind === 'followup' ? 'var(--info)' : t.kind === 'email' ? 'var(--accent-strong)' : 'var(--muted)'}"></span><div><div class="tl-t">${E(label(t))}</div>${t.text ? `<div style="font-size:13px;color:var(--ink-2);white-space:pre-wrap">${E(t.text)}</div>` : ''}<div class="tl-s">${E(CB.fmtDateTime(t.ts))}</div></div></div>`).join('')}</div></section>`;
    const add = () => { const v = $('#tl-note', body).value.trim(); if (v) S().log(j.id, 'note', v); };
    $('#tl-add', body).onclick = add;
    $('#tl-note', body).onkeydown = (e) => { if (e.key === 'Enter') add(); };
    $('#tl-fu', body).onclick = () => UI.logFollowUp(j.id);
  };

  UI.logFollowUp = (id) => {
    S().update(id, (x) => {
      x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'followup', text: 'Followed up with the recruiter' });
      x.followUpDate = CB.addDays(CB.todayISO(), +S().settings.followUpDays || 7);
    }, { undoLabel: 'Follow-up' });
    UI.toast('Follow-up logged · next reminder in ' + (S().settings.followUpDays || 7) + ' days', { undo: true });
  };
  UI.openJob = (id, tab) => Drawer.open(id, tab);

  // ───────────────────────── add job ─────────────────────────
  UI.addJob = (prefill = {}) => {
    const state = { posting: null, ai: null, aiRunning: false };
    const m = UI.modal({
      title: 'Add application',
      body: `
        <label class="field"><span>Job link (LinkedIn, Greenhouse, Lever, Workday, company site…)</span><input class="input" id="aj-url" type="url" placeholder="https://www.linkedin.com/jobs/view/…" value="${E(prefill.url || '')}" autofocus></label>
        <div id="aj-urlinfo"></div>
        <label class="field"><span>Posting text <span class="muted" style="font-weight:400">— paste the whole page; Callback strips the LinkedIn clutter</span></span><textarea class="input" id="aj-text" rows="7" placeholder="On LinkedIn: open the job, tap Show more, then select all and copy (⌘A ⌘C on Mac; on iPhone, press and hold → Select All → Copy) and paste here.">${E(prefill.jd || '')}</textarea></label>
        <div class="grid3" id="aj-fields">
          <label class="field"><span>Company</span><input class="input" id="aj-company"></label>
          <label class="field"><span>Job title</span><input class="input" id="aj-title"></label>
          <label class="field"><span>Location</span><input class="input" id="aj-loc"></label>
          <label class="field"><span>Work mode</span><select class="input" id="aj-mode">${UI.opts(['', ...CB.WORK_MODES], '')}</select></label>
          <label class="field"><span>Source</span><select class="input" id="aj-source">${UI.opts(CB.SOURCES, 'LinkedIn')}</select></label>
          <label class="field"><span>Salary</span><input class="input" id="aj-salary" placeholder="e.g. 150k–180k"></label>
        </div>
        <div id="aj-dup"></div>
        <div id="aj-verdict"></div>`,
      foot: `${'<button class="btn claude-btn" id="aj-ai" hidden>Extract with Claude</button>'}<span style="flex:1"></span><button class="btn" id="aj-save">Save for later</button><button class="btn btn-primary" id="aj-apply">Mark applied today</button>`,
      onMount: (el) => {
        if (App.ai) $('#aj-ai', el).hidden = false;
      },
    });
    const el = m.el;
    const get = (id) => $(id, el);
    const parseMoney = (s) => {
      const r = CB.ATS.extractSalary('$' + String(s).replace(/\s/g, '').replace(/^\$/, '').replace(/[–—-]/, '-$'));
      return r || null;
    };
    const fill = (id, v, force) => { const i = get(id); if (v && (force || !i.value || i.dataset.auto === '1')) { i.value = v; i.dataset.auto = '1'; } };
    const update = CB.debounce(() => {
      const url = get('#aj-url').value.trim();
      const text = get('#aj-text').value;
      const u = CB.ATS.parseJobUrl(url);
      const info = get('#aj-urlinfo');
      if (u.isLinkedIn) {
        info.innerHTML = `<div class="tag" style="white-space:normal;line-height:1.45;padding:8px 10px;display:block">LinkedIn job ${u.jobId ? '<b class="mono">#' + E(u.jobId) + '</b>' : ''} detected. LinkedIn blocks other sites from reading its pages, so paste the posting text below and Callback extracts everything else. ${u.canonical ? `<a href="${E(u.canonical)}" target="_blank" rel="noopener">Open the posting ↗</a>` : ''}</div>`;
        get('#aj-source').value = 'LinkedIn';
      } else if (u.vendor) {
        info.innerHTML = `<div class="tag" style="white-space:normal;padding:6px 10px">${E(u.vendor)} posting${u.company ? ' · ' + E(u.company) : ''}. Paste the description text below to score it.</div>`;
        if (u.vendor !== 'Indeed' && u.vendor !== 'Glassdoor' && u.vendor !== 'Wellfound') get('#aj-source').value = 'Company site';
        else get('#aj-source').value = u.vendor;
      } else info.innerHTML = '';
      const p = text.trim() ? CB.ATS.extractPosting(text, url) : { title: u.title, company: u.company, url: u };
      state.posting = p;
      fill('#aj-company', state.ai?.company || p.company);
      fill('#aj-title', state.ai?.title || p.title);
      fill('#aj-loc', state.ai?.location || p.location);
      if (p.workMode || state.ai?.workMode) { const s = get('#aj-mode'); if (!s.value || s.dataset.auto === '1') { s.value = state.ai?.workMode || p.workMode; s.dataset.auto = '1'; } }
      if (p.salary && p.salary.min) fill('#aj-salary', `${CB.fmtMoney(p.salary.min)}${p.salary.max && p.salary.max !== p.salary.min ? '–' + CB.fmtMoney(p.salary.max) : ''}${p.salary.period === 'hour' ? '/hr' : ''}`);
      // duplicates
      const company = get('#aj-company').value.trim().toLowerCase(), title = get('#aj-title').value.trim().toLowerCase();
      const dup = S().list().find((j) => (u.jobId && j.linkedinJobId === u.jobId) || (j.url && url && j.url === url) || (company && title && j.company.toLowerCase() === company && j.title.toLowerCase() === title));
      get('#aj-dup').innerHTML = dup ? `<div class="ko" style="background:var(--warn-bg);border-color:color-mix(in srgb,var(--warn) 40%,transparent)"><code style="color:var(--warn)">DUP</code><div><b>Already tracked</b><span>${E(dup.company)} · ${E(dup.title)} is in ${E(CB.STAGE[dup.status].label)}. <button class="btn btn-sm" data-open-dup>Open it</button></span></div></div>` : '';
      const od = $('[data-open-dup]', el);
      if (od) od.onclick = () => { m.close(); UI.openJob(dup.id); };
      // live verdict
      const jd = (p.jd || text || '').trim();
      const v = get('#aj-verdict');
      if (!jd) { v.innerHTML = ''; return; }
      const tmp = CB.newJob({ title: get('#aj-title').value, company: get('#aj-company').value, location: get('#aj-loc').value, workMode: get('#aj-mode').value, source: get('#aj-source').value, jd, jdAI: state.ai, applicants: p.applicants ? p.applicants.n : null });
      tmp.updatedAt = 'preview-' + CB.hash(jd + JSON.stringify(state.ai) + tmp.title + tmp.location + tmp.workMode + tmp.source);
      const a = S().atsFor(tmp);
      if (a.verdict === 'NO_RESUME') { v.innerHTML = `<div class="tag" style="padding:8px 10px;white-space:normal">Upload your resume in the ATS Lab to see whether you'd pass the screen before you apply.</div>`; return; }
      const missing = a.skills.required.filter((s) => s.status === 'missing').slice(0, 6).map((s) => s.name);
      v.innerHTML = `<div class="card" style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:center;background:var(--surface-2)">
        <div style="display:grid;gap:8px;justify-items:center">${UI.stamp(a, true)}<span class="score ${UI.scoreClass(a)}" style="font-size:15px;height:30px;min-width:46px">${a.score}</span></div>
        <div style="display:grid;gap:5px;font-size:13px;min-width:0">
          <b>${a.verdict === 'REJECTED' ? 'An ATS would screen you out' : a.verdict === 'STRONG' ? 'Strong match — apply now' : a.verdict === 'COMPETITIVE' ? 'Competitive — tailor, then apply' : 'Long shot — tailor heavily or skip'}</b>
          <span class="muted">Interview chance ${UI.prob(a)} · ${a.skills.required.filter((s) => s.credit >= 0.5).length}/${a.skills.required.length} must-haves${a.yearsRequired ? ` · ${a.yearsRequired}+ yrs required, you have ${a.yearsCandidate}` : ''}</span>
          ${a.knockouts.length ? `<span style="color:var(--bad);font-weight:600">${a.knockouts.map((k) => E(k.code + ' ' + k.label)).join(' · ')}</span>` : ''}
          ${missing.length ? `<span>Missing: ${missing.map((x) => `<span class="sk sk-missing" style="padding:1px 6px"><i>✗</i>${E(x)}</span>`).join(' ')}</span>` : ''}
          ${p.applicants ? `<span class="muted">${p.applicants.over ? 'Over ' : ''}${p.applicants.n} applicants${p.postedDaysAgo ? ` · posted ${p.postedDaysAgo.days}d ago${p.postedDaysAgo.reposted ? ' (reposted)' : ''}` : ''}</span>` : ''}
        </div></div>`;
    }, 250);
    ['#aj-url', '#aj-text', '#aj-company', '#aj-title', '#aj-loc'].forEach((id) => get(id).addEventListener('input', (e) => { if (e.target.id !== 'aj-url' && e.target.id !== 'aj-text') e.target.dataset.auto = '0'; update(); }));
    ['#aj-mode', '#aj-source'].forEach((id) => get(id).addEventListener('change', (e) => { e.target.dataset.auto = '0'; update(); }));
    get('#aj-salary').addEventListener('input', (e) => (e.target.dataset.auto = '0'));
    update();
    const aiBtn = get('#aj-ai');
    aiBtn.onclick = async () => {
      const text = get('#aj-text').value.trim();
      if (text.length < 120) { UI.toast('Paste the posting text first — LinkedIn pages cannot be read by link alone.', { tone: 'warn' }); return; }
      aiBtn.disabled = true; aiBtn.textContent = 'Claude is reading…';
      try {
        state.ai = await CB.AI.extractJob(text, get('#aj-url').value.trim());
        ['#aj-company', '#aj-title', '#aj-loc'].forEach((id) => (get(id).dataset.auto = '1'));
        get('#aj-mode').dataset.auto = '1';
        if (state.ai.salaryMin) { get('#aj-salary').value = `${CB.fmtMoney(state.ai.salaryMin)}${state.ai.salaryMax ? '–' + CB.fmtMoney(state.ai.salaryMax) : ''}${state.ai.salaryPeriod === 'hour' ? '/hr' : ''}`; }
        update();
        aiBtn.textContent = 'Extracted by Claude ✓';
      } catch (e) { UI.toast(CB.AI.errText(e) || 'Stopped', { tone: 'warn' }); aiBtn.disabled = false; aiBtn.textContent = 'Extract with Claude'; }
    };
    const save = (applied) => {
      const url = get('#aj-url').value.trim();
      const text = get('#aj-text').value;
      const p = state.posting || {};
      const u = CB.ATS.parseJobUrl(url);
      const company = get('#aj-company').value.trim(), title = get('#aj-title').value.trim();
      if (!company && !title) { UI.toast('Add at least a company or a title.', { tone: 'warn' }); return; }
      const sal = get('#aj-salary').value.trim() ? parseMoney(get('#aj-salary').value) : p.salary;
      const ai = state.ai || {};
      const job = {
        company, title, location: get('#aj-loc').value.trim(), workMode: get('#aj-mode').value, source: get('#aj-source').value,
        url: u.canonical || url, linkedinJobId: u.isLinkedIn ? u.jobId : '', jd: (p.jd || text || '').trim(), jdAI: state.ai || null,
        employmentType: ai.employmentType || p.employmentType || 'Full-time', seniority: ai.seniority || p.seniority || '',
        salaryMin: sal ? sal.min : ai.salaryMin ?? null, salaryMax: sal ? sal.max : ai.salaryMax ?? null, salaryPeriod: (sal && sal.period) || ai.salaryPeriod || 'year',
        applicants: p.applicants ? p.applicants.n : ai.applicants ?? null,
        postedDate: p.postedDaysAgo ? CB.addDays(CB.todayISO(), -p.postedDaysAgo.days) : ai.postedDaysAgo != null ? CB.addDays(CB.todayISO(), -ai.postedDaysAgo) : '',
        status: applied ? 'applied' : 'saved', appliedDate: applied ? CB.todayISO() : '', followUpDate: applied ? CB.addDays(CB.todayISO(), +S().settings.followUpDays || 7) : '',
      };
      const saved = S().add(job, { log: applied ? `Applied via ${job.source}` : `Saved from ${job.source}` });
      if (applied) S().update(saved.id, (x) => { x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'status', from: 'saved', to: 'applied', text: '' }); x.maxStage = 1; }, { silent: true });
      m.close();
      const a = S().atsFor(S().get(saved.id));
      UI.toast(`${company || title} ${applied ? 'applied' : 'saved'}${a.score != null ? ' · ATS ' + a.score + (a.knockouts.length ? ' · ' + a.knockouts[0].code : '') : ''}`, { undo: true });
      UI.openJob(saved.id, a.score != null ? 'ats' : 'overview');
    };
    get('#aj-save').onclick = () => save(false);
    get('#aj-apply').onclick = () => save(true);
  };

  // ───────────────────────── command palette ─────────────────────────
  UI.palette = () => {
    if ($('.palette')) return;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.style.zIndex = 90;
    const p = document.createElement('div');
    p.className = 'palette';
    p.innerHTML = `<input id="pal-q" placeholder="Search applications or type a command…" autocomplete="off" aria-label="Search"><div class="pal-list" id="pal-list" role="listbox"></div>`;
    document.body.append(scrim, p);
    const close = () => { scrim.remove(); p.remove(); };
    scrim.onclick = close;
    const cmds = [
      ...VIEWS.map((v, i) => ({ label: 'Go to ' + v.label, k: String(i + 1), run: () => (location.hash = v.key) })),
      { label: 'Ask Cal (assistant)', k: 'C', run: () => CB.Cal && CB.Cal.open() },
      { label: 'Add application', k: 'N', run: () => UI.addJob() },
      { label: 'Upload resume', run: () => { location.hash = 'ats'; setTimeout(() => $('#rs-file') && $('#rs-file').click(), 200); } },
      { label: 'Export Excel workbook', run: () => UI.save(CB.IO.exportExcel({ jobs: S().list(), atsById: S().atsMap(), stats: CB.Stats.compute(S().list(), S().atsMap()), resumeName: S().resume && S().resume.fileName }), 'Workbook ready') },
      { label: 'Export Word report', run: () => UI.save(CB.IO.exportReportDocx({ jobs: S().list(), atsById: S().atsMap(), stats: CB.Stats.compute(S().list(), S().atsMap()), resumeName: S().resume && S().resume.fileName }), 'Report ready') },
      { label: 'Toggle dark / light', run: () => UI.setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark') },
      { label: 'Undo last change', k: '⌘Z', run: () => { const u = S().undo(); UI.toast(u ? 'Undone' : 'Nothing to undo'); } },
    ];
    let sel = 0, items = [];
    const draw = () => {
      const q = $('#pal-q', p).value.trim().toLowerCase();
      const jobs = S().list().filter((j) => !q || `${j.company} ${j.title} ${j.location} ${CB.STAGE[j.status].label}`.toLowerCase().includes(q)).slice(0, 8).map((j) => ({ job: j, label: `${j.company} · ${j.title}`, run: () => UI.openJob(j.id) }));
      const cs = cmds.filter((c) => !q || c.label.toLowerCase().includes(q));
      items = [...jobs, ...cs];
      sel = Math.min(sel, Math.max(0, items.length - 1));
      $('#pal-list', p).innerHTML = (jobs.length ? '<div class="pal-sec">Applications</div>' : '') + jobs.map((it, i) => `<div class="pal-item" role="option" data-i="${i}" aria-selected="${i === sel}">${UI.mono(it.job.company, 26)}<span class="ell">${E(it.label)}</span><span class="k">${UI.chip(it.job.status)}</span></div>`).join('') + (cs.length ? '<div class="pal-sec">Commands</div>' : '') + cs.map((c, k) => { const i = jobs.length + k; return `<div class="pal-item" role="option" data-i="${i}" aria-selected="${i === sel}"><span>${E(c.label)}</span>${c.k ? `<span class="k"><kbd>${E(c.k)}</kbd></span>` : ''}</div>`; }).join('') || '<div class="pal-item muted">No matches</div>';
      $$('.pal-item[data-i]', p).forEach((n) => (n.onclick = () => { close(); items[+n.dataset.i].run(); }));
    };
    const q = $('#pal-q', p);
    q.oninput = () => { sel = 0; draw(); };
    q.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { const it = items[sel]; close(); it && it.run(); }
      else if (e.key === 'Escape') close();
    };
    draw();
    q.focus();
  };

  // ───────────────────────── keyboard ─────────────────────────
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); UI.palette(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); const u = S().undo(); UI.toast(u ? 'Undone' : 'Nothing to undo'); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || $('.modal') || $('.palette')) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); UI.addJob(); }
    else if ((e.key === 'c' || e.key === 'C') && CB.Cal) { e.preventDefault(); CB.Cal.show(true); CB.Cal.open(); }
    else if (e.key === '/') { e.preventDefault(); UI.palette(); }
    else if (/^[1-8]$/.test(e.key) && !$('#drawer')) { location.hash = VIEWS[+e.key - 1].key; }
    else if (e.key === 'Escape' && $('#drawer')) Drawer.close();
  });

  // ───────────────────────── boot ─────────────────────────
  async function boot() {
    applyTheme();
    $('#add-job').onclick = () => UI.addJob();
    $('#open-palette').onclick = () => UI.palette();
    window.addEventListener('hashchange', route);
    route();
    CB.AI.get().then((s) => { App.ai = !!s; if (App.ai && S().ready) rerender(); });
    CB.on('ai:off', () => { App.ai = false; rerender(); });
    await S().init();
    CB.on('data', () => rerender());
    route();
    try { if (CB.Cal) CB.Cal.mount(); } catch (e) { console.error('Cal', e); }
    let lastW = window.innerWidth;
    window.addEventListener('resize', CB.debounce(() => { if (Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; rerender(); } }, 250));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && App.current === 'dashboard') rerender(); });
  }

  CB.UI = UI;
  CB.App = App;
  CB.Drawer = Drawer;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();

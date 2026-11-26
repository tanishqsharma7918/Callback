/* Callback — views: dashboard, board, sheet, ATS lab, calendar, inbox, reports, settings. */
(function () {
  'use strict';
  const CB = window.CB;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const E = CB.esc;
  const S = CB.Store;
  const UI = () => CB.UI;
  const V = {};
  const persist = {};
  const onLeave = (view, fn) => CB.App.cleanup.push(() => { if (CB.App.next !== view) fn(); });

  // App.next tracking for persistent 3D scenes (set before teardown runs)
  window.addEventListener('hashchange', () => { CB.App.next = (location.hash || '#dashboard').slice(1); }, true);

  const ACT_ICON = { interview: 'calendar', outcome: 'check', thanks: 'mail', followup: 'send', ghost: 'ghost', stale: 'clock', knockout: 'alert', deadline: 'clock', nojd: 'doc' };
  function runAction(a) {
    if (a.action.type === 'open') UI().openJob(a.jobId, a.action.tab);
    else if (a.action.type === 'move') UI().moveJob(a.jobId, a.action.to, { auto: true, note: 'From Action Center' });
    else if (a.action.type === 'followup') UI().logFollowUp(a.jobId);
    else if (a.action.type === 'thanks') { S.update(a.jobId, (x) => { const iv = x.interviews.find((i) => i.id === a.ivId); if (iv) { iv.thankYouSent = true; if (iv.outcome === 'Scheduled') iv.outcome = 'Completed'; } x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'followup', text: 'Thank-you note sent' }); }, { undoLabel: 'Thank-you' }); UI().toast('Thank-you logged', { undo: true }); }
    else if (UI().runCustomAction) UI().runCustomAction(a); // platform hook: CB.registerAction items with action.run
  }

  // ═════════════════════════ DASHBOARD ═════════════════════════
  V.dashboard = (root) => {
    const jobs = S.list();
    const ats = S.atsMap();
    const st = CB.Stats.compute(jobs, ats);
    const acts = CB.Auto.compute(jobs, S.settings, ats);
    const samples = jobs.filter((j) => j.sample).length;
    const goal = +S.settings.weeklyGoal || 15;
    const upcoming = [];
    jobs.forEach((j) => (j.interviews || []).forEach((iv) => { const d = CB.parseDate(iv.datetime); if (iv.outcome === 'Scheduled' && d && d > new Date(Date.now() - 3600000) && d < new Date(Date.now() + 21 * 864e5)) upcoming.push({ j, iv, d }); }));
    upcoming.sort((a, b) => a.d - b.d);
    const prevWeek = st.weekly[st.weekly.length - 2] ? st.weekly[st.weekly.length - 2].value : 0;

    if (!jobs.length) {
      root.innerHTML = `<div class="empty card" style="max-width:720px;margin:20px auto">
        <svg class="empty-mark" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="27" fill="none" stroke="url(#cb-metal)" stroke-width="1"/><circle cx="28" cy="28" r="22.5" fill="none" stroke="url(#cb-metal)" stroke-width=".6" opacity=".5"/><path d="M37.3 18.6a13.2 13.2 0 1 0 0 18.8" fill="none" stroke="url(#cb-metal)" stroke-width="2.2" stroke-linecap="round"/><circle cx="37.8" cy="28" r="1.8" fill="url(#cb-metal)"/></svg>
        <div class="hero-eyebrow" style="justify-content:center">A private office for your search</div>
        <h3>Start tracking your search</h3>
        <p class="muted" style="max-width:52ch">Paste a LinkedIn link and the posting text, and Callback extracts the details, scores it against your resume with a strict ATS, and tracks it from Applied to Offer.</p>
        <div class="row" style="justify-content:center"><button class="btn btn-accent" data-add>${UI().icon('plus')}Add your first job</button><a class="btn" href="#ats">${UI().icon('upload')}Upload resume</a><button class="btn" data-ex>Load example data</button><a class="btn" href="#reports">Import from Excel</a></div>
      </div>`;
      $('[data-add]', root).onclick = () => UI().addJob();
      $('[data-ex]', root).onclick = () => { const n = S.loadSamples(); UI().toast(`Loaded ${n} example applications`); };
      if (UI().mountDashCards) UI().mountDashCards(root.firstElementChild, { jobs, ats, stats: st, actions: acts }); // platform hook: CB.registerDashCard
      return;
    }
    const kpi = (label, value, sub, extra = '') => `<div class="card kpi${/^Offers/.test(label) && st.offers ? ' is-gold' : ''}">${extra}<div class="kpi-l">${label}</div><div class="kpi-v" data-count="${E(label)}">${value}</div><div class="kpi-d">${sub}</div></div>`;
    // Hero: editorial greeting + one-line status summary (design)
    const now = new Date();
    const hr = now.getHours();
    const greet = hr >= 5 && hr < 12 ? 'Good morning' : hr >= 12 && hr < 17 ? 'Good afternoon' : 'Good evening';
    let who = '';
    try { who = String(S.settings.candidateName || (S.profile() && S.profile().name) || '').trim().split(/\s+/)[0] || ''; } catch (e) { who = ''; }
    if (who.length > 18) who = '';
    const wk = (() => { const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); })();
    const dateLine = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const urgent = acts.filter((a) => a.sev === 1).length;
    const ivSoon = upcoming.filter((u) => u.d < new Date(Date.now() + 7 * 864e5)).length;
    const parts = [`<b>${st.active}</b> active application${st.active === 1 ? '' : 's'}`];
    if (ivSoon) parts.push(`<b>${ivSoon}</b> interview${ivSoon === 1 ? '' : 's'} this week`);
    else if (upcoming.length) parts.push(`next interview ${E(CB.relDays ? CB.relDays(CB.toISODate(upcoming[0].d)) : '')}`.trim());
    if (st.offers) parts.push(`<b class="gold">${st.offers} offer${st.offers === 1 ? '' : 's'}</b> on the table`);
    const summary = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
    const tail = urgent ? ` <b>${urgent}</b> thing${urgent === 1 ? '' : 's'} need${urgent === 1 ? 's' : ''} you today.` : ' Nothing urgent today.';
    const wkPct = Math.min(100, Math.round((st.thisWeek / Math.max(1, goal)) * 100));
    const hero = `<section class="hero" aria-label="Summary">
        <div><div class="hero-eyebrow">${E(dateLine)} · Week ${wk}</div>
          <h2>${greet}${who ? `, <em>${E(who)}</em>` : ''}.</h2>
          <p class="hero-sum">You have ${summary}.${tail}</p></div>
        <div class="hero-week" title="Applications this week vs. your goal"><div class="hero-week-l"><span>This week</span><b class="num">${st.thisWeek}<small>/${goal}</small></b></div><div class="hero-week-bar"><i style="width:${wkPct}%"></i></div></div>
      </section>`;
    root.innerHTML = `
      ${samples ? `<div class="banner"><span><b>${samples} example applications</b> and ${S.resume && S.resume.sample ? 'an example resume are' : 'are'} loaded so you can see everything working. They are fictional.</span><div class="row"><a class="btn btn-sm" href="#ats">Upload my resume</a><button class="btn btn-sm btn-primary" data-clear-ex>Clear examples</button></div></div>` : ''}
      <div class="dash">
        ${hero}
        <div class="kpis">
          ${kpi('Applications sent', st.applied, `${st.thisWeek} this week · goal ${goal}${st.thisWeek - prevWeek ? ` · <span class="${st.thisWeek >= prevWeek ? 'delta-up' : 'delta-down'}">${st.thisWeek >= prevWeek ? '+' : ''}${st.thisWeek - prevWeek} vs last wk</span>` : ''}`, '<div data-spark></div>')}
          ${kpi('Response rate', CB.pct(st.responseRate), `${st.responses} replied${st.medianDaysToResponse != null ? ` · median ${st.medianDaysToResponse}d` : ''}`)}
          ${kpi('Interview rate', CB.pct(st.interviewRate), `${st.interviews} interviews · ${st.screens} screens`)}
          ${kpi('Offers', st.offers, st.offers ? `${CB.pct(st.offerRate, 1)} of applications` : 'Keep going')}
          ${kpi('Average ATS fit', st.avgAts != null ? Math.round(st.avgAts) + '<small>/100</small>' : '—', `${st.verdicts.REJECTED} auto-rejected · ${st.verdicts.STRONG} shortlist`)}
          ${kpi('Expected interviews', st.expectedInterviews.toFixed(1), `from ${st.active} active applications`)}
        </div>
        <section class="card span-7"><div class="card-h"><h3>Pipeline tower</h3><span class="sub">Drag to rotate · tap a tier to open it on the board</span></div><div id="tower-slot"></div>
          <div class="tower-legend"><span>Particles falling away = applications lost at that stage</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--st-rejected);margin-right:5px"></i>Rejected ${st.rejected}</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--st-ghosted);margin-right:5px"></i>Ghosted ${st.ghosted}</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--st-withdrawn);margin-right:5px"></i>Withdrawn ${st.withdrawn}</span></div></section>
        <section class="card span-5"><div class="card-h"><h3>Action center</h3><span class="sub">${acts.length ? `${acts.length} things need you` : 'All caught up'}</span></div>
          <div class="actions">${acts.length ? acts.slice(0, 14).map((a, i) => `<div class="act k-${a.kind}"><span class="act-ic">${UI().icon(ACT_ICON[a.kind] || 'bolt')}</span><div style="min-width:0"><div class="act-t"><button class="link" data-open="${i}">${E(a.title)}</button></div><div class="act-d ell">${E(a.detail)}</div></div><button class="btn btn-sm" data-act="${i}">${E(a.action.label)}</button></div>`).join('') : '<p class="empty-note">Nothing due. Follow-ups, ghosting, thank-you notes and interview prep appear here automatically.</p>'}</div></section>
        <section class="card span-7"><div class="card-h"><h3>Application flow</h3><span class="sub">Where applications advance and where they drop out</span></div><div id="flow"></div></section>
        <section class="card span-5"><div class="card-h"><h3>This week</h3><span class="sub">${st.streak ? `${st.streak}-day application streak` : 'Apply today to start a streak'}</span></div>
          <div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;align-items:center">
            <div class="ring-host" id="goal-ring" style="width:118px;height:118px"></div>
            <div style="display:grid;gap:6px;font-size:13px"><div><b style="font-size:15px">${st.thisWeek} of ${goal}</b> applications</div><div class="muted">${Math.max(0, goal - st.thisWeek)} to go · ${Math.max(0, 7 - ((new Date().getDay() + 6) % 7) - 1)} days left in the week</div><div class="muted">Average reply ${st.avgDaysToResponse != null ? Math.round(st.avgDaysToResponse) + ' days' : '—'} after applying</div></div>
          </div>
          <div style="margin-top:14px" id="heat"></div></section>
        <section class="card span-8"><div class="card-h"><h3>Applications per week</h3><span class="sub">Last 12 weeks vs. your goal</span></div><div id="weekly"></div></section>
        <section class="card span-4"><div class="card-h"><h3>Response rate by source</h3><span class="sub">Any reply, including rejections</span></div><div id="sources"></div></section>
        <section class="card span-5"><div class="card-h"><h3>Upcoming interviews</h3><span class="sub">Next 3 weeks</span></div>
          ${upcoming.length ? `<div style="display:grid;gap:8px">${upcoming.slice(0, 6).map(({ j, iv, d }) => `<button class="iv" style="text-align:left;cursor:pointer;width:100%" data-job="${j.id}"><div class="iv-date"><span>${CB.MONTHS[d.getMonth()]}</span><b>${d.getDate()}</b></div><div style="min-width:0"><b class="ell" style="display:block">${E(j.company)} · ${E(iv.type)}</b><span class="muted" style="font-size:12.5px">${E(CB.fmtDateTime(iv.datetime))}${iv.interviewer ? ' · ' + E(iv.interviewer) : ''}</span></div>${UI().chip(j.status)}</button>`).join('')}</div>` : '<p class="empty-note">No interviews booked. Log them from an application’s Interviews tab or paste the invite in the Inbox Parser.</p>'}</section>
        <section class="card span-7"><div class="card-h"><h3>Where everything stands</h3><span class="sub">${jobs.length} tracked</span></div><div id="mix"></div>
          <div class="lbl" style="margin:16px 0 8px">Rejections by stage</div><div id="rej"></div></section>
      </div>`;
    const clr = $('[data-clear-ex]', root);
    if (clr) clr.onclick = async () => { if (await UI().confirm({ title: 'Clear example data?', text: 'Removes the fictional applications and the example resume. Your own entries stay.', ok: 'Clear examples' })) { const n = S.clearSamples(); UI().toast(`Removed ${n} examples`); } };
    $$('[data-act]', root).forEach((b) => (b.onclick = () => runAction(acts[+b.dataset.act])));
    $$('[data-open]', root).forEach((b) => (b.onclick = () => { const a = acts[+b.dataset.open]; UI().openJob(a.jobId, a.action.tab || 'overview'); }));
    $$('[data-job]', root).forEach((b) => (b.onclick = () => UI().openJob(b.dataset.job, 'interviews')));
    CB.Charts.spark($('[data-spark]', root), st.weekly.map((w) => w.value));
    CB.Charts.ring($('#goal-ring', root), st.thisWeek / goal, { label: `${Math.round(Math.min(1, st.thisWeek / goal) * 100)}%`, sub: 'weekly goal', size: 118, stroke: 10 });
    CB.Charts.heatmap($('#heat', root), st.daily, { weeks: 20 });
    CB.Charts.columns($('#weekly', root), st.weekly, { goal, unit: 'applications', highlightLast: true, height: 260 });
    CB.Charts.rateBars($('#sources', root), st.bySource.map((s) => ({ label: s.source, sub: `${s.responses}/${s.applied} replied · ${s.interviews} interviews`, value: s.rate || 0, tip: `<b>${E(s.source)}</b><br>${s.applied} applied · ${s.responses} replies · ${s.interviews} interviews` })), { max: 1 });
    CB.Charts.flow($('#flow', root), jobs);
    CB.Charts.segBar($('#mix', root), CB.STAGES.map((s) => ({ label: s.label, value: st.byStage[s.key] || 0, color: `var(--st-${s.key})`, ink: s.ink })));
    const rs = Object.entries(st.rejectionsByStage).sort((a, b) => b[1] - a[1]);
    if (rs.length) CB.Charts.rateBars($('#rej', root), rs.map(([k, n]) => ({ label: 'After ' + (CB.STAGE[k] ? CB.STAGE[k].label : k), value: n, text: String(n), color: 'var(--st-rejected)', sub: CB.pct(n / Math.max(1, st.rejected)) + ' of rejections' })));
    else $('#rej', root).innerHTML = '<p class="empty-note">No rejections logged.</p>';

    // 3D tower (persistent across refreshes)
    const slot = $('#tower-slot', root);
    const stages = st.funnel.map((f) => ({ key: f.key, label: f.key === 'saved' ? 'Tracked' : CB.STAGE[f.key].short, color: UI().stageHex(f.key), count: f.count }));
    if (!persist.towerHost) { persist.towerHost = document.createElement('div'); persist.towerHost.className = 'tower'; }
    slot.replaceWith(persist.towerHost);
    const theme = UI().theme3d();
    const onPick = (key) => { CB.Views._boardFocus = key; location.hash = 'board'; };
    if (persist.funnel) persist.funnel.update(stages, st.dropoffs, theme);
    else if (CB.Viz3D && CB.Viz3D.available && CB.Viz3D.available()) {
      try { persist.funnel = CB.Viz3D.createFunnel(persist.towerHost, { stages, dropoffs: st.dropoffs, theme, onPick }); } catch (e) { console.error(e); persist.funnel = null; }
    }
    if (!persist.funnel) CB.Charts.funnel2d(persist.towerHost, stages);
    onLeave('dashboard', () => { if (persist.funnel) { persist.funnel.destroy(); persist.funnel = null; } persist.towerHost = null; });
    if (UI().mountDashCards) UI().mountDashCards($('.kpis', root), { jobs, ats, stats: st, actions: acts }); // platform hook: CB.registerDashCard
  };

  // ═════════════════════════ BOARD ═════════════════════════
  const B = { q: '', source: '', sort: 'updated', closed: true };
  V.board = (root) => {
    const ats = S.atsMap();
    let jobs = S.list();
    const q = B.q.trim().toLowerCase();
    if (q) jobs = jobs.filter((j) => `${j.company} ${j.title} ${j.location} ${(j.tags || []).join(' ')}`.toLowerCase().includes(q));
    if (B.source) jobs = jobs.filter((j) => (j.referral ? 'Referral' : j.source) === B.source || j.source === B.source);
    const sorters = {
      updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
      ats: (a, b) => ((ats[b.id] && ats[b.id].score) ?? -1) - ((ats[a.id] && ats[a.id].score) ?? -1),
      chance: (a, b) => ((ats[b.id] && ats[b.id].probability) ?? -1) - ((ats[a.id] && ats[a.id].probability) ?? -1),
      applied: (a, b) => (b.appliedDate || '').localeCompare(a.appliedDate || ''),
      salary: (a, b) => (b.salaryMax || b.salaryMin || 0) - (a.salaryMax || a.salaryMin || 0),
      priority: (a, b) => CB.PRIORITIES.indexOf(a.priority) - CB.PRIORITIES.indexOf(b.priority),
    };
    jobs.sort(sorters[B.sort] || sorters.updated);
    const cols = CB.STAGES.filter((s) => B.closed || s.group !== 'closed');
    const focus = CB.Views._boardFocus;
    CB.Views._boardFocus = null;
    const card = (j) => {
      const a = ats[j.id];
      const nx = UI().nextInterview(j);
      const dis = UI().daysInStage(j);
      return `<article class="jcard" data-id="${j.id}" tabindex="0" aria-label="${E(j.company)} ${E(j.title)}">
        <select class="input btn-sm jc-move" data-move aria-label="Move to stage" style="width:auto;padding:2px 4px;font-size:11px">${UI().stageOpts(j.status)}</select>
        <div class="jc-top">${UI().mono(j.company)}<div style="min-width:0;padding-right:28px"><div class="jc-co ell">${E(j.company || 'Company')}</div><div class="jc-ti">${E(j.title || 'Role')}</div></div></div>
        <div class="jc-meta">${j.workMode ? `<span class="tag">${E(j.workMode)}</span>` : ''}${CB.fmtSalary(j) ? `<span class="tag">${E(CB.fmtSalary(j))}</span>` : ''}${j.referral ? '<span class="tag" style="color:var(--good)">Referral</span>' : `<span class="tag">${E(j.source)}</span>`}${j.priority === 'High' ? '<span class="tag" style="color:var(--bad)">High priority</span>' : ''}${j.sample ? '<span class="example-dot">Example</span>' : ''}</div>
        ${nx ? `<div class="jc-next">${UI().icon('calendar').replace('<svg', '<svg width="13" height="13"')}<span class="ell">${E(nx.type)} · ${E(CB.fmtDateTime(nx.datetime))}</span></div>` : ''}
        ${a && a.knockouts && a.knockouts.length && CB.STAGE[j.status].group !== 'closed' ? `<div class="jc-next" style="background:var(--bad-bg)"><b style="color:var(--bad);font:700 10.5px var(--f-mono)">${E(a.knockouts[0].code)}</b><span class="ell">${E(a.knockouts[0].label)}</span></div>` : ''}
        <div class="jc-foot">${UI().score(a)}<span>${UI().prob(a)} chance</span><span class="right">${dis != null ? `${dis}d in stage` : ''}</span></div>
      </article>`;
    };
    root.innerHTML = `
      <div class="toolbar">
        <input class="input grow" id="b-q" type="search" placeholder="Filter by company, title, location…" value="${E(B.q)}">
        <select class="input" id="b-src" aria-label="Source"><option value="">All sources</option>${CB.SOURCES.map((s) => `<option${s === B.source ? ' selected' : ''}>${E(s)}</option>`).join('')}</select>
        <select class="input" id="b-sort" aria-label="Sort">${[['updated', 'Recently updated'], ['ats', 'ATS score'], ['chance', 'Interview chance'], ['applied', 'Applied date'], ['salary', 'Salary'], ['priority', 'Priority']].map(([k, l]) => `<option value="${k}"${k === B.sort ? ' selected' : ''}>Sort: ${l}</option>`).join('')}</select>
        <label class="check" style="font-size:13px;align-items:center"><input type="checkbox" id="b-closed" ${B.closed ? 'checked' : ''}><span>Show closed</span></label>
      </div>
      <div class="board" id="board">${cols.map((s) => { const list = jobs.filter((j) => j.status === s.key); return `<section class="col" data-stage="${s.key}" style="--c:var(--st-${s.key})"><div class="col-h"><b>${E(s.label)}</b><span class="n">${list.length}</span></div>${list.map(card).join('') || '<p class="muted" style="font-size:12px;text-align:center;margin:10px 0">Drop here</p>'}</section>`; }).join('')}</div>`;
    const qi = $('#b-q', root);
    qi.oninput = CB.debounce(() => { B.q = qi.value; V.board(root); const n = $('#b-q', root); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200);
    $('#b-src', root).onchange = (e) => { B.source = e.target.value; V.board(root); };
    $('#b-sort', root).onchange = (e) => { B.sort = e.target.value; V.board(root); };
    $('#b-closed', root).onchange = (e) => { B.closed = e.target.checked; V.board(root); };
    if (focus) { const c = $(`.col[data-stage="${focus}"]`, root); if (c) setTimeout(() => { c.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }); c.classList.add('drop'); setTimeout(() => c.classList.remove('drop'), 1200); }, 60); }
    bindBoardDrag(root);
  };

  function bindBoardDrag(root) {
    const board = $('#board', root);
    let drag = null;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $$('.jcard', board).forEach((cardEl) => {
      const id = cardEl.dataset.id;
      $('[data-move]', cardEl).addEventListener('change', (e) => UI().moveJob(id, e.target.value));
      $('[data-move]', cardEl).addEventListener('pointerdown', (e) => e.stopPropagation());
      $('[data-move]', cardEl).addEventListener('click', (e) => e.stopPropagation());
      cardEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') UI().openJob(id); });
      if (!reduce) {
        cardEl.addEventListener('pointermove', (e) => {
          if (e.pointerType !== 'mouse' || drag) return;
          const r = cardEl.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
          cardEl.style.transform = `perspective(700px) rotateX(${(0.5 - py) * 7}deg) rotateY(${(px - 0.5) * 9}deg) translateZ(4px)`;
          cardEl.style.setProperty('--mx', px * 100 + '%');
          cardEl.style.setProperty('--my', py * 100 + '%');
        });
        cardEl.addEventListener('pointerleave', () => { cardEl.style.transform = ''; });
      }
      cardEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const start = { x: e.clientX, y: e.clientY, id, el: cardEl, type: e.pointerType, active: false, timer: null, moved: false };
        drag = start;
        if (e.pointerType !== 'mouse') start.timer = setTimeout(() => { if (drag === start && !start.moved) begin(start, e.clientX, e.clientY); }, 260);
      });
    });
    const begin = (d, x, y) => {
      d.active = true;
      CB.App.busy = true;
      const r = d.el.getBoundingClientRect();
      d.dx = x - r.left; d.dy = y - r.top;
      d.ghost = d.el.cloneNode(true);
      d.ghost.classList.add('ghost-card');
      d.ghost.style.width = r.width + 'px';
      d.ghost.style.left = r.left + 'px';
      d.ghost.style.top = r.top + 'px';
      document.body.appendChild(d.ghost);
      d.el.classList.add('dragging');
      d.el.style.transform = '';
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* noop */ }
    };
    const move = (e) => {
      if (!drag) return;
      const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (!drag.active) {
        if (dist > 6) {
          drag.moved = true;
          if (drag.type === 'mouse') begin(drag, e.clientX, e.clientY);
          else { clearTimeout(drag.timer); drag = null; }
        }
        return;
      }
      drag.ghost.style.left = e.clientX - drag.dx + 'px';
      drag.ghost.style.top = e.clientY - drag.dy + 'px';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const col = under && under.closest && under.closest('.col');
      $$('.col.drop', board).forEach((c) => c !== col && c.classList.remove('drop'));
      if (col) col.classList.add('drop');
      drag.over = col ? col.dataset.stage : null;
      const br = board.getBoundingClientRect();
      if (e.clientX > br.right - 60) board.scrollLeft += 14;
      else if (e.clientX < br.left + 60) board.scrollLeft -= 14;
    };
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      clearTimeout(d.timer);
      if (d.active) {
        d.ghost.remove();
        d.el.classList.remove('dragging');
        $$('.col.drop', board).forEach((c) => c.classList.remove('drop'));
        CB.App.busy = false;
        if (d.over && d.over !== S.get(d.id).status) UI().moveJob(d.id, d.over);
      } else if (!d.moved) UI().openJob(d.id);
    };
    const tm = (e) => { if (drag && drag.active) e.preventDefault(); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    document.addEventListener('touchmove', tm, { passive: false });
    CB.App.cleanup.push(() => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); document.removeEventListener('touchmove', tm); CB.App.busy = false; });
  }

  // ═════════════════════════ SHEET (Excel-style) ═════════════════════════
  const X = { sort: { k: 'updatedAt', dir: -1 }, filters: {}, sel: { r: 0, c: 0 }, anchor: null, tab: 'Applications', q: '' };
  const colLetter = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function sheetCols(ats) {
    const A = (j) => ats[j.id] || {};
    return [
      { k: 'company', l: 'Company', t: 'text', fz: true, w: 150 },
      { k: 'title', l: 'Title', t: 'text', w: 220 },
      { k: 'status', l: 'Status', t: 'status', w: 140, get: (j) => CB.STAGE[j.status].label, html: (j) => UI().chip(j.status) },
      { k: 'ats', l: 'ATS', t: 'ro', num: true, w: 60, get: (j) => A(j).score ?? '', style: (j) => { const a = A(j); if (a.score == null) return ''; const c = UI().scoreColor(a.score, a); return `background:color-mix(in srgb, ${c} 9%, var(--surface-1));color:color-mix(in oklab, ${c} 80%, var(--ink-1))`; } },
      { k: 'chance', l: 'Chance', t: 'ro', num: true, w: 70, get: (j) => (A(j).probability != null ? Math.round(A(j).probability * 1000) / 10 : ''), fmt: (v) => (v === '' ? '' : v >= 100 ? 'Reached' : v + '%') },
      { k: 'verdict', l: 'Verdict', t: 'ro', w: 120, get: (j) => A(j).verdictLabel || '', html: (j) => (A(j).verdict && A(j).score != null ? UI().stamp(A(j)) : '') },
      { k: 'appliedDate', l: 'Applied', t: 'date', w: 110, fmt: (v) => (v ? CB.fmtDate(v, true) : '') },
      { k: 'days', l: 'Days', t: 'ro', num: true, w: 56, get: (j) => (j.appliedDate ? CB.daysSince(j.appliedDate) : '') },
      { k: 'source', l: 'Source', t: 'select', opts: CB.SOURCES, w: 140 },
      { k: 'location', l: 'Location', t: 'text', w: 150 },
      { k: 'workMode', l: 'Mode', t: 'select', opts: ['', ...CB.WORK_MODES], w: 90 },
      { k: 'salaryMin', l: 'Salary min', t: 'number', num: true, w: 100, fmt: (v) => (v ? CB.fmtMoney(v, 'USD', false) : '') },
      { k: 'salaryMax', l: 'Salary max', t: 'number', num: true, w: 100, fmt: (v) => (v ? CB.fmtMoney(v, 'USD', false) : '') },
      { k: 'priority', l: 'Priority', t: 'select', opts: CB.PRIORITIES, w: 86 },
      { k: 'followUpDate', l: 'Follow-up', t: 'date', w: 110, fmt: (v) => (v ? CB.fmtDate(v, true) : '') },
      { k: 'next', l: 'Next interview', t: 'ro', w: 170, get: (j) => { const n = UI().nextInterview(j); return n ? `${n.type} · ${CB.fmtDateTime(n.datetime)}` : ''; } },
      { k: 'applicants', l: 'Applicants', t: 'number', num: true, w: 86 },
      { k: 'rejectionReason', l: 'Rejection reason', t: 'select', opts: ['', ...CB.REJECTION_REASONS], w: 170 },
      { k: 'url', l: 'Link', t: 'text', w: 200 },
      { k: 'updatedAt', l: 'Updated', t: 'ro', w: 120, get: (j) => (j.updatedAt || '').slice(0, 10), fmt: (v) => (v ? CB.fmtDate(v, true) : '') },
    ];
  }
  V.sheet = (root) => {
    const ats = S.atsMap();
    const cols = sheetCols(ats);
    const val = (c, j) => (c.get ? c.get(j) : j[c.k] ?? '');
    const disp = (c, j) => { const v = val(c, j); return c.html ? c.html(j) : E(c.fmt ? c.fmt(v) : v); };
    let rows;
    if (X.tab === 'Applications') {
      rows = S.list();
      const q = X.q.trim().toLowerCase();
      if (q) rows = rows.filter((j) => `${j.company} ${j.title} ${j.location} ${j.source}`.toLowerCase().includes(q));
      for (const k in X.filters) {
        const f = String(X.filters[k] || '').toLowerCase();
        if (!f) continue;
        const c = cols.find((x) => x.k === k);
        rows = rows.filter((j) => String(c.fmt ? c.fmt(val(c, j)) : val(c, j)).toLowerCase().includes(f));
      }
      const sc = cols.find((x) => x.k === X.sort.k) || { k: 'updatedAt', get: (j) => j.updatedAt };
      rows.sort((a, b) => { const va = val(sc, a), vb = val(sc, b); if (va === vb) return 0; if (va === '' || va == null) return 1; if (vb === '' || vb == null) return -1; return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * X.sort.dir; });
    }
    const tabs = ['Applications', 'Interviews', 'Contacts', 'Timeline'];
    let tableHtml = '';
    if (X.tab === 'Applications') {
      X.sel.r = CB.clamp(X.sel.r, 0, Math.max(0, rows.length - 1));
      X.sel.c = CB.clamp(X.sel.c, 0, cols.length - 1);
      tableHtml = `<table class="xt" id="xt"><thead>
        <tr class="letters"><th class="rn"></th>${cols.map((c, i) => `<th class="${c.fz ? 'fz' : ''}" style="min-width:${c.w}px">${colLetter(i)}</th>`).join('')}</tr>
        <tr class="heads"><th class="rn">#</th>${cols.map((c) => `<th class="${c.fz ? 'fz' : ''} ${c.num ? 'num' : ''}" data-sort="${c.k}">${E(c.l)}${X.sort.k === c.k ? `<span class="sort-ind">${X.sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr>
        <tr class="filters"><th class="rn">⚲</th>${cols.map((c) => `<th class="${c.fz ? 'fz' : ''}"><input data-filter="${c.k}" value="${E(X.filters[c.k] || '')}" placeholder="Filter" aria-label="Filter ${E(c.l)}"></th>`).join('')}</tr>
      </thead><tbody>${rows.map((j, r) => `<tr data-id="${j.id}"><td class="rn">${r + 1}</td>${cols.map((c, ci) => `<td data-r="${r}" data-c="${ci}" class="${c.fz ? 'fz' : ''} ${c.num ? 'num' : ''}" style="${c.style ? c.style(j) : ''}">${disp(c, j)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else {
      const all = S.list();
      let head = [], body = [];
      if (X.tab === 'Interviews') {
        head = ['Company', 'Title', 'Round', 'Type', 'Date & time', 'Duration', 'Interviewer', 'Outcome', 'Thank-you'];
        all.forEach((j) => j.interviews.forEach((iv) => body.push({ id: j.id, sort: iv.datetime || '', cells: [j.company, j.title, iv.round, iv.type, CB.fmtDateTime(iv.datetime), (iv.durationMin || '') + ' min', iv.interviewer, iv.outcome, iv.thankYouSent ? 'Yes' : 'No'] })));
        body.sort((a, b) => b.sort.localeCompare(a.sort));
      } else if (X.tab === 'Contacts') {
        head = ['Name', 'Role', 'Company', 'Email', 'Phone', 'LinkedIn', 'Notes'];
        all.forEach((j) => j.contacts.forEach((c) => body.push({ id: j.id, cells: [c.name, c.role, j.company, c.email, c.phone, c.linkedin, c.notes] })));
      } else {
        head = ['When', 'Company', 'Title', 'Event', 'Detail'];
        all.forEach((j) => j.timeline.forEach((t) => body.push({ id: j.id, sort: t.ts, cells: [CB.fmtDateTime(t.ts), j.company, j.title, t.to ? `${CB.STAGE[t.from] ? CB.STAGE[t.from].label : ''} → ${CB.STAGE[t.to].label}` : t.kind, t.text] })));
        body.sort((a, b) => b.sort.localeCompare(a.sort));
        body = body.slice(0, 500);
      }
      tableHtml = `<table class="xt"><thead><tr class="letters"><th class="rn"></th>${head.map((_, i) => `<th>${colLetter(i)}</th>`).join('')}</tr><tr class="heads"><th class="rn">#</th>${head.map((h) => `<th>${E(h)}</th>`).join('')}</tr></thead><tbody>${body.map((b, r) => `<tr data-id="${b.id}" style="cursor:pointer"><td class="rn">${r + 1}</td>${b.cells.map((c) => `<td>${E(c ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td class="rn">1</td><td colspan="${head.length}" class="muted">No ${X.tab.toLowerCase()} yet.</td></tr>`}</tbody></table>`;
    }
    root.innerHTML = `
      <div class="toolbar">
        <input class="input grow" id="x-q" type="search" placeholder="Search the sheet…" value="${E(X.q)}" ${X.tab !== 'Applications' ? 'disabled' : ''}>
        <button class="btn" id="x-add">${UI().icon('plus')}Row</button>
        <button class="btn" id="x-del" ${X.tab !== 'Applications' ? 'disabled' : ''}>${UI().icon('trash')}Delete rows</button>
        <button class="btn" id="x-copy">Copy as table</button>
        <button class="btn" id="x-imp">${UI().icon('upload')}Import .xlsx/.csv</button>
        <button class="btn btn-primary" id="x-xlsx">${UI().icon('download')}Excel workbook</button>
        <button class="btn" id="x-csv">CSV</button>
        <input type="file" id="x-file" accept=".xlsx,.csv,.tsv,.txt" hidden>
      </div>
      <div class="xl">
        <div class="xl-bar"><div class="xl-ref" id="x-ref">A1</div><div class="xl-fx">fx</div><div class="xl-val" id="x-val"></div></div>
        <div class="xl-scroll" id="x-scroll" tabindex="0" aria-label="Spreadsheet. Arrow keys move, Enter edits.">${tableHtml}</div>
        <div class="xl-status" id="x-status"></div>
        <div class="xl-tabs">${tabs.map((t) => `<button data-tab="${t}" aria-pressed="${t === X.tab}">${t}</button>`).join('')}</div>
      </div>
      <p class="muted" style="font-size:12px;margin-top:8px">Click a cell to select · Enter or double-click to edit · Shift-click to sum a range · Tab/arrows to move · Status changes follow the pipeline rules. Export opens in Excel with live formulas, dropdowns and conditional formatting.</p>`;
    $$('[data-tab]', root).forEach((b) => (b.onclick = () => { X.tab = b.dataset.tab; V.sheet(root); }));
    const xlData = () => ({ jobs: S.list(), atsById: S.atsMap(), stats: CB.Stats.compute(S.list(), S.atsMap()), resumeName: S.resume && S.resume.fileName });
    $('#x-xlsx', root).onclick = () => UI().save(CB.IO.exportExcel(xlData()), 'Workbook ready');
    $('#x-csv', root).onclick = () => UI().save(CB.IO.exportCSV(xlData()), 'CSV ready');
    $('#x-add', root).onclick = () => UI().addJob();
    $('#x-imp', root).onclick = () => $('#x-file', root).click();
    $('#x-file', root).onchange = (e) => importSheet(e.target.files[0]);
    $('#x-copy', root).onclick = () => {
      const tbl = $('#x-scroll table', root);
      const lines = $$('tr', tbl).filter((tr) => !tr.classList.contains('letters') && !tr.classList.contains('filters')).map((tr) => $$('th,td', tr).slice(1).map((c) => c.textContent.trim().replace(/\t/g, ' ')).join('\t'));
      UI().copy(lines.join('\n'));
    };
    if (X.tab !== 'Applications') { $$('tbody tr[data-id]', root).forEach((tr) => (tr.onclick = () => UI().openJob(tr.dataset.id))); return; }
    const scroll = $('#x-scroll', root);
    const qi = $('#x-q', root);
    qi.oninput = CB.debounce(() => { X.q = qi.value; V.sheet(root); const n = $('#x-q', root); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 220);
    $$('[data-sort]', root).forEach((th) => (th.onclick = () => { const k = th.dataset.sort; X.sort = { k, dir: X.sort.k === k ? -X.sort.dir : 1 }; V.sheet(root); }));
    $$('[data-filter]', root).forEach((inp) => (inp.oninput = CB.debounce(() => { X.filters[inp.dataset.filter] = inp.value; const k = inp.dataset.filter; V.sheet(root); const n = $(`[data-filter="${k}"]`, root); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 260)));
    $('#x-del', root).onclick = async () => {
      const [r0, r1] = X.anchor ? [Math.min(X.anchor.r, X.sel.r), Math.max(X.anchor.r, X.sel.r)] : [X.sel.r, X.sel.r];
      const ids = rows.slice(r0, r1 + 1).map((j) => j.id);
      if (!ids.length) return;
      if (await UI().confirm({ title: `Delete ${ids.length} row${ids.length > 1 ? 's' : ''}?`, text: ids.map((id) => S.get(id).company).slice(0, 5).join(', ') + (ids.length > 5 ? '…' : ''), ok: 'Delete', danger: true })) { S.removeMany(ids); UI().toast(`Deleted ${ids.length}`, { undo: ids.length === 1 }); }
    };
    const cell = (r, c) => $(`td[data-r="${r}"][data-c="${c}"]`, scroll);
    const paint = () => {
      $$('td.sel, td.inrange', scroll).forEach((t) => t.classList.remove('sel', 'inrange'));
      $$('tr.rowsel', scroll).forEach((t) => t.classList.remove('rowsel'));
      const td = cell(X.sel.r, X.sel.c);
      if (!td) { $('#x-status', root).innerHTML = `<span>${rows.length} rows</span>`; return; }
      td.classList.add('sel');
      td.parentElement.classList.add('rowsel');
      const c = cols[X.sel.c];
      const j = rows[X.sel.r];
      $('#x-ref', root).textContent = colLetter(X.sel.c) + (X.sel.r + 1);
      $('#x-val', root).textContent = String(val(c, j) ?? '');
      let r0 = X.sel.r, r1 = X.sel.r;
      if (X.anchor && X.anchor.c === X.sel.c) { r0 = Math.min(X.anchor.r, X.sel.r); r1 = Math.max(X.anchor.r, X.sel.r); for (let r = r0; r <= r1; r++) { const t = cell(r, X.sel.c); t && t.classList.add('inrange'); } }
      const vals = rows.slice(r0, r1 + 1).map((x) => val(c, x)).filter((v) => v !== '' && v != null);
      const nums = vals.map(Number).filter((v) => !isNaN(v) && typeof vals[0] !== 'boolean');
      $('#x-status', root).innerHTML = `<span>${rows.length} rows</span><span>Count <b>${vals.length}</b></span>${c.num && nums.length ? `<span>Sum <b>${Math.round(nums.reduce((a, b) => a + b, 0) * 10) / 10}</b></span><span>Average <b>${Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10}</b></span><span>Min <b>${Math.min(...nums)}</b></span><span>Max <b>${Math.max(...nums)}</b></span>` : ''}`;
    };
    const ensureVisible = () => { const td = cell(X.sel.r, X.sel.c); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); };
    let editing = null;
    const edit = (initial) => {
      const c = cols[X.sel.c];
      const j = rows[X.sel.r];
      if (!j || c.t === 'ro') { if (j && c.t === 'ro') UI().toast(`${c.l} is calculated. Edit the application to change it.`); return; }
      const td = cell(X.sel.r, X.sel.c);
      const cur = j[c.k] ?? '';
      let inp;
      if (c.t === 'status' || c.t === 'select') {
        inp = document.createElement('select');
        inp.innerHTML = c.t === 'status' ? UI().stageOpts(j.status) : UI().opts(c.opts, cur);
      } else {
        inp = document.createElement('input');
        inp.type = c.t === 'number' ? 'number' : c.t === 'date' ? 'date' : 'text';
        inp.value = initial != null ? initial : cur;
      }
      inp.className = 'cell-ed';
      td.innerHTML = '';
      td.appendChild(inp);
      editing = { inp, c, j, done: false };
      inp.focus();
      if (inp.select && initial == null && inp.type === 'text') inp.select();
      const commit = (moveDir) => {
        if (!editing || editing.done) return;
        editing.done = true;
        let v = inp.value;
        if (c.t === 'number') v = v === '' ? null : +v;
        editing = null;
        if (c.t === 'status') { if (v !== j.status) UI().moveJob(j.id, v); else V.sheet(root); }
        else if (v !== (j[c.k] ?? (c.t === 'number' ? null : ''))) S.update(j.id, (x) => { x[c.k] = v; }, { undoLabel: 'Edit cell' });
        else td.innerHTML = disp(c, j);
        if (moveDir) { if (moveDir === 'down') X.sel.r = Math.min(rows.length - 1, X.sel.r + 1); if (moveDir === 'right') X.sel.c = Math.min(cols.length - 1, X.sel.c + 1); }
        setTimeout(() => { const sc = $('#x-scroll'); sc && sc.focus({ preventScroll: true }); paint(); }, 0);
      };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
        else if (e.key === 'Tab') { e.preventDefault(); commit('right'); }
        else if (e.key === 'Escape') { editing.done = true; editing = null; td.innerHTML = disp(c, j); scroll.focus(); paint(); }
        e.stopPropagation();
      };
      inp.onblur = () => commit();
      if (inp.tagName === 'SELECT') inp.onchange = () => commit();
    };
    scroll.addEventListener('click', (e) => {
      const td = e.target.closest('td[data-r]');
      if (!td || editing) return;
      const r = +td.dataset.r, c = +td.dataset.c;
      if (e.shiftKey) { X.anchor = X.anchor || { ...X.sel }; X.sel = { r, c: X.anchor.c }; }
      else { X.anchor = null; X.sel = { r, c }; }
      paint();
      scroll.focus({ preventScroll: true });
    });
    scroll.addEventListener('dblclick', (e) => { if (e.target.closest('td[data-r]')) edit(); });
    $$('td.rn', scroll).forEach((td) => (td.ondblclick = () => UI().openJob(td.parentElement.dataset.id)));
    scroll.addEventListener('keydown', (e) => {
      if (editing || e.target !== scroll) return;
      const k = e.key;
      const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      if (mv) {
        e.preventDefault();
        if (e.shiftKey && mv[1] === 0) { X.anchor = X.anchor || { ...X.sel }; } else X.anchor = null;
        X.sel.r = CB.clamp(X.sel.r + mv[0], 0, rows.length - 1);
        X.sel.c = CB.clamp(X.sel.c + mv[1], 0, cols.length - 1);
        paint(); ensureVisible();
      } else if (k === 'Enter' || k === 'F2') { e.preventDefault(); edit(); }
      else if (k === 'Tab') { e.preventDefault(); X.sel.c = CB.clamp(X.sel.c + (e.shiftKey ? -1 : 1), 0, cols.length - 1); paint(); ensureVisible(); }
      else if (k === ' ' && e.shiftKey) { e.preventDefault(); UI().openJob(rows[X.sel.r].id); }
      else if ((k === 'Delete' || k === 'Backspace') && ['text', 'number', 'date'].includes(cols[X.sel.c].t)) { e.preventDefault(); const c = cols[X.sel.c], j = rows[X.sel.r]; S.update(j.id, (x) => { x[c.k] = c.t === 'number' ? null : ''; }, { undoLabel: 'Clear cell' }); }
      else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && ['text', 'number'].includes(cols[X.sel.c].t)) { e.preventDefault(); edit(k); }
    });
    paint();
    if (document.activeElement === document.body || !document.activeElement || document.activeElement.id === 'view') scroll.focus({ preventScroll: true });
  };

  async function importSheet(file) {
    if (!file) return;
    try {
      const r = await CB.IO.importSpreadsheet(file);
      if (!r.jobs.length) { UI().toast('No rows found. The first row should be headers like Company, Title, Status, Date Applied.', { tone: 'warn' }); return; }
      const res = S.importJobs(r.jobs);
      UI().toast(`Imported ${res.added} new, updated ${res.updated} existing${r.skipped ? `, skipped ${r.skipped} blank rows` : ''}.`);
    } catch (e) { UI().toast(e.message || 'Could not read that file.', { tone: 'bad' }); }
  }
  V._importSheet = importSheet;

  // ═════════════════════════ ATS LAB ═════════════════════════
  const A = { sort: 'score', filter: 'all', focus: false };
  const VERDICT_VAR = { STRONG: '--good', COMPETITIVE: '--info', LONG_SHOT: '--warn', REJECTED: '--bad' };
  const cssHex = (v) => { const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); if (/^#/.test(c)) return c; const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d); const m = (getComputedStyle(d).color.match(/\d+/g) || [0, 0, 0]).slice(0, 3); d.remove(); return '#' + m.map((x) => (+x).toString(16).padStart(2, '0')).join(''); };

  /** Missing must-haves aggregated across open applications. */
  function skillGaps(jobs, ats) {
    const map = new Map();
    jobs.filter((j) => CB.STAGE[j.status].group !== 'closed').forEach((j) => {
      const a = ats[j.id];
      if (!a || a.score == null) return;
      a.skills.required.forEach((s) => {
        if (s.kind === 'soft' || !['missing', 'listed', 'transferable'].includes(s.status)) return;
        const g = map.get(s.name) || { name: s.name, missing: 0, listed: 0, transferable: 0, via: '', jobs: [], weight: 0 };
        g[s.status]++;
        if (s.via) g.via = s.via;
        g.weight += s.weight;
        if (!g.jobs.includes(j.company)) g.jobs.push(j.company);
        map.set(s.name, g);
      });
    });
    return [...map.values()].sort((x, y) => (y.missing * 2 + y.listed + y.transferable) * y.weight - (x.missing * 2 + x.listed + x.transferable) * x.weight).slice(0, 12);
  }

  /** Resume bullets that hurt you, with an honest rewrite template. */
  function bulletDoctor(p) {
    const buzz = CB.Taxonomy.buzzwords || [];
    return p.bullets.map((b) => {
      const issues = [];
      if (b.weak) issues.push('Passive opener');
      else if (!b.action) issues.push('No action verb');
      if (!b.quantified) issues.push('No number');
      if (b.words > 30) issues.push('Too long');
      const bz = buzz.filter((w) => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(b.text));
      if (bz.length) issues.push('Cliché: ' + bz[0]);
      let t = b.text.trim().replace(/\.$/, '');
      t = t.replace(/^(was )?(responsible for|in charge of|tasked with|duties included)\s+/i, 'Owned ')
        .replace(/^(helped|assisted)( to| with| in)?\s+/i, 'Drove ')
        .replace(/^(worked on|involved in|participated in)\s+/i, 'Built ')
        .replace(/^(handled)\s+/i, 'Ran ');
      if (!b.action && !b.weak && !/^(Owned|Drove|Built|Ran)\b/.test(t)) t = 'Led ' + t.charAt(0).toLowerCase() + t.slice(1);
      bz.forEach((w) => { t = t.replace(new RegExp('\\s*\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), ''); });
      if (!b.quantified) t += ', [result with a number — e.g. cut X by 30%, saved 5 hrs/week, served 2M users]';
      return { text: b.text, issues, suggestion: t.charAt(0).toUpperCase() + t.slice(1) + '.', severity: issues.length };
    }).filter((x) => x.issues.length).sort((a, b) => b.severity - a.severity).slice(0, 8);
  }

  V.ats = (root) => {
    const r = S.resume;
    const p = S.profile();
    const audit = p ? CB.ATS.auditResume(p, (r && r.warnings) || []) : null;
    const jobs = S.list();
    const ats = S.atsMap();
    const st = CB.Stats.compute(jobs, ats);
    const strict = S.settings.strictness || 'brutal';
    const T = CB.ATS.STRICT[strict];
    let rows = jobs.map((j) => ({ j, a: ats[j.id] })).filter((x) => x.a && x.a.score != null);
    if (A.filter !== 'all') rows = rows.filter((x) => x.a.verdict === A.filter);
    rows.sort(A.sort === 'chance' ? (x, y) => (y.a.probability || 0) - (x.a.probability || 0) : A.sort === 'company' ? (x, y) => x.j.company.localeCompare(y.j.company) : (x, y) => y.a.score - x.a.score);
    const unscored = jobs.filter((j) => !ats[j.id] || ats[j.id].score == null).length;
    const sk = p ? [...p.skills.values()].filter((s) => s.kind !== 'soft') : [];
    const ev = (k) => sk.filter((s) => s.evidence === k);
    const examples = jobs.filter((j) => j.sample).length;
    const ownWithJD = jobs.filter((j) => !j.sample && String(j.jd || '').trim()).length;
    const gaps = p ? skillGaps(jobs, ats) : [];
    const doctor = p ? bulletDoctor(p) : [];
    const best = jobs.filter((j) => j.status === 'saved' && ats[j.id] && ats[j.id].score != null && !ats[j.id].knockouts.length).sort((x, y) => ats[y.id].score - ats[x.id].score)[0];
    const nextIv = jobs.flatMap((j) => (j.interviews || []).filter((i) => i.outcome === 'Scheduled' && i.datetime >= CB.todayISO()).map((i) => ({ j, i }))).sort((x, y) => x.i.datetime.localeCompare(y.i.datetime))[0];
    const steps = p ? [
      { done: !examples, title: examples ? `Clear the ${examples} example applications` : 'Example data cleared', text: 'They are fictional and skew your numbers.', btn: examples ? ['clear', 'Clear examples'] : null },
      { done: audit.fails === 0, title: audit.fails ? `Fix ${audit.fails} resume problem${audit.fails > 1 ? 's' : ''} an ATS penalizes` : 'Resume passes the ATS audit', text: audit.fails ? audit.checks.filter((c) => c.status === 'fail').map((c) => c.label).slice(0, 3).join(' · ') : `Grade ${audit.grade}. Keep tightening the bullets below.`, btn: audit.fails || doctor.length ? ['doctor', 'Show fixes'] : null },
      { done: ownWithJD >= 3, title: ownWithJD ? `Add more target jobs (${ownWithJD} so far)` : 'Add the jobs you are targeting', text: 'Paste a LinkedIn link and the posting text. Each one is scored against this resume before you apply.', btn: ['add', 'Add a job'] },
      { done: gaps.length > 0 && gaps[0].missing === 0, title: gaps.length ? `Close your top skill gap: ${gaps[0].name}` : 'Skill gaps appear once jobs are scored', text: gaps.length ? `Asked for by ${gaps[0].jobs.length} of your open applications.` : 'Add a few postings first.', btn: gaps.length ? ['gaps', 'See skill gaps'] : null },
      { done: false, title: best ? `Apply to your best match: ${best.company}` : 'Apply where you score 75+', text: best ? `${best.title} · ATS ${ats[best.id].score} · ${CB.UI.prob(ats[best.id])} interview chance` : 'Saved jobs scoring 75+ with no knockouts show up here.', btn: best ? ['best', 'Open it'] : ['board', 'Open pipeline'] },
      ...(nextIv ? [{ done: false, title: `Prep for ${nextIv.j.company} · ${nextIv.i.type}`, text: CB.fmtDateTime(nextIv.i.datetime), btn: ['iv', 'Prep'] }] : []),
    ] : [];
    const doneCount = steps.filter((s) => s.done).length;

    root.innerHTML = `
      <div class="dash">
        <section class="card span-5" id="ats-resume"><div class="card-h"><h3>Your resume</h3><span class="sub">${p ? 'Parsed like an ATS reads it' : 'PDF, Word (.docx) or text'}</span></div>
          ${r && r.sample ? '<div class="banner" style="margin-bottom:12px"><span>This is the <b>example resume</b>. Upload yours to score your real applications.</span></div>' : ''}
          <div class="drop-zone" id="rs-drop"><div class="row" style="justify-content:center">${UI().icon('upload').replace('<svg', '<svg width="22" height="22"')}<b>${p ? 'Replace resume' : 'Upload your resume'}</b></div><span class="muted" style="font-size:12.5px">Drop a file here or choose one. ${CB.standalone ? 'It never leaves this device.' : 'Text never leaves your account.'}</span>
            <div class="row" style="justify-content:center"><button class="btn btn-primary" id="rs-pick">Choose file</button><button class="btn" id="rs-paste">Paste text</button></div>
            <input type="file" id="rs-file" accept=".pdf,.docx,.txt,.md,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden></div>
          ${p ? `<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:center;margin-top:14px">
              <div class="ring-host" id="rs-ring" style="width:110px;height:110px"></div>
              <div style="display:grid;gap:4px;font-size:13px;min-width:0"><b class="ell">${E(r.fileName || 'Resume')}</b><span class="muted">${E(p.name || 'Name not found')} · ${E(p.recentTitle || 'Title not found')}</span><span><b>${p.totalYears}</b> yrs experience · <b>${p.roles.length}</b> roles · <b>${sk.length}</b> hard skills</span><span>${E(p.education.label)}${p.education.field ? ' in ' + E(p.education.field) : ''} · reads as <b>${E(CB.ATS.levelLabel(p.level))}</b></span><span class="muted">${p.words} words · uploaded ${CB.relDays((r.uploadedAt || '').slice(0, 10))}</span></div>
            </div>
            ${App().ai ? '<div class="row" style="margin-top:12px"><button class="btn btn-sm claude-btn" id="rs-ai">Second opinion from Claude</button></div><div id="rs-ai-out" style="margin-top:10px"></div>' : ''}` : ''}
        </section>

        <section class="card span-7 next-card" id="ats-next"><div class="card-h"><h3>${p ? 'Your next moves' : 'Start here'}</h3><span class="sub">${p ? `${doneCount} of ${steps.length} done` : 'Upload your resume to unlock scoring'}</span></div>
          ${p ? `<div class="steps">${steps.map((s, i) => `<div class="step ${s.done ? 'done' : ''}"><span class="step-n">${s.done ? '✓' : i + 1}</span><div style="min-width:0"><b>${E(s.title)}</b><span>${E(s.text)}</span></div>${s.btn ? `<button class="btn btn-sm ${!s.done && i === steps.findIndex((x) => !x.done) ? 'btn-primary' : ''}" data-step="${s.btn[0]}">${E(s.btn[1])}</button>` : '<span></span>'}</div>`).join('')}</div>`
            : `<ol class="start-list"><li><b>Upload your resume</b> — PDF, Word or pasted text. Callback reads it exactly like an ATS parser.</li><li><b>Add the jobs you want</b> — paste a LinkedIn link plus the posting text; each gets a fit score, knockouts and an interview chance.</li><li><b>Fix what the scoreboard flags</b> — missing must-haves, listed-only skills, weak bullets.</li><li><b>Apply where you score 75+</b>, and track every reply on the pipeline.</li></ol>`}
        </section>

        <section class="card span-12" id="ats-board"><div class="card-h"><h3>Scoreboard</h3><span class="sub">Every tracked posting scored against your resume${unscored ? ` · ${unscored} need a job description` : ''}</span>
          <div class="right"><div class="seg-ctl" role="group" aria-label="Strictness">${Object.entries(CB.ATS.STRICT).map(([k, v]) => `<button data-strict="${k}" aria-pressed="${k === strict}">${v.label}</button>`).join('')}</div></div></div>
          <div class="row" style="margin-bottom:12px;gap:8px">${[['all', 'All', null], ['STRONG', 'Shortlist', st.verdicts.STRONG], ['COMPETITIVE', 'Review', st.verdicts.COMPETITIVE], ['LONG_SHOT', 'Long shot', st.verdicts.LONG_SHOT], ['REJECTED', 'Auto-rejected', st.verdicts.REJECTED]].map(([k, l, n]) => `<button class="btn btn-sm ${A.filter === k ? 'btn-primary' : ''}" data-vf="${k}">${l} <span class="mono" style="opacity:.7">${k === 'all' ? jobs.length - unscored : n}</span></button>`).join('')}
            <span class="muted" style="font-size:12px;margin-left:auto">${E(T.label)}: cutoff ${T.floor} · review ${T.competitive}+ · shortlist ${T.strong}+ · must-have floor ${Math.round(T.koMQ * 100)}%</span></div>
          ${p ? `<div class="tw"><table class="t"><thead><tr><th data-s="company">Application</th><th>Status</th><th data-s="score" class="num">ATS fit</th><th>Verdict</th><th data-s="chance" class="num">Interview chance</th><th class="num">Est. rank</th><th>Knockouts / biggest gaps</th></tr></thead><tbody>
            ${rows.map(({ j, a }) => `<tr data-id="${j.id}"><td><div class="row" style="flex-wrap:nowrap;gap:10px">${UI().mono(j.company, 30)}<div style="min-width:0"><b class="ell" style="display:block;max-width:260px">${E(j.company)}</b><span class="muted ell" style="display:block;max-width:260px;font-size:12px">${E(j.title)}</span></div></div></td>
              <td>${UI().chip(j.status)}</td>
              <td class="num"><div class="scorebar"><div class="trk"><i style="width:${a.score}%;background:${UI().scoreColor(a.score, a)}"></i></div><span class="score ${UI().scoreClass(a)}">${a.score}</span></div></td>
              <td>${UI().stamp(a)}</td>
              <td class="num mono">${UI().prob(a)}</td>
              <td class="num mono" style="font-size:12px">#${a.rank.position}<span class="muted">/${a.rank.estimatedPool ? '~' : ''}${a.rank.pool}</span></td>
              <td style="font-size:12px;max-width:320px">${a.knockouts.length ? `<b style="color:var(--bad)">${a.knockouts.map((k) => E(k.code)).join(' ')}</b> ${E(a.knockouts[0].detail).slice(0, 90)}` : a.skills.required.filter((s) => s.status === 'missing').slice(0, 4).map((s) => `<span class="sk sk-missing" style="padding:1px 6px;margin:1px"><i>✗</i>${E(s.name)}</span>`).join('') || '<span class="muted">No major gaps</span>'}</td></tr>`).join('') || `<tr><td colspan="7" class="muted">No applications in this group.</td></tr>`}
          </tbody></table></div>` : '<p class="empty-note">Upload your resume to score all applications.</p>'}
        </section>

        <section class="card span-6" id="ats-gaps"><div class="card-h"><h3>Skill gaps across your jobs</h3><span class="sub">What your open applications keep asking for</span></div>
          ${gaps.length ? `<div class="gaps">${gaps.map((g) => `<div class="gap"><div class="gap-h"><b>${E(g.name)}</b><span class="mono muted">${g.jobs.length} job${g.jobs.length > 1 ? 's' : ''}</span></div>
              <div class="gap-bar"><i class="m" style="flex:${g.missing}"></i><i class="l" style="flex:${g.listed}"></i><i class="t" style="flex:${g.transferable}"></i></div>
              <span class="gap-t">${g.missing ? `Missing in ${g.missing}` : ''}${g.listed ? `${g.missing ? ' · ' : ''}In your skills list only for ${g.listed} — move it into an experience bullet` : ''}${g.transferable ? `${g.missing || g.listed ? ' · ' : ''}Partly covered by ${E(g.via)} — name the overlap` : ''}</span>
              <span class="gap-j">${g.jobs.slice(0, 4).map(E).join(', ')}${g.jobs.length > 4 ? ` +${g.jobs.length - 4}` : ''}</span></div>`).join('')}</div>
            <div class="row" style="margin-top:10px;gap:14px;font-size:12px;color:var(--ink-2)"><span><i class="lg m"></i>Missing</span><span><i class="lg l"></i>Listed only</span><span><i class="lg t"></i>Transferable</span></div>`
            : `<p class="empty-note">${p ? 'No gaps across your open applications. Add more postings to see patterns.' : 'Upload your resume to see which skills your target jobs keep asking for.'}</p>`}
        </section>
        <section class="card span-6" id="ats-doctor"><div class="card-h"><h3>Bullet doctor</h3><span class="sub">${p ? `${doctor.length} bullet${doctor.length === 1 ? '' : 's'} costing you points` : 'Rewrites for weak resume bullets'}</span></div>
          ${doctor.length ? doctor.map((d, i) => `<div class="doc"><div class="row" style="gap:6px">${d.issues.map((x) => `<span class="tag" style="color:var(--bad)">${E(x)}</span>`).join('')}</div>
              <p class="doc-old">${E(d.text)}</p><p class="doc-new"><b>Try:</b> ${E(d.suggestion)}</p><button class="btn btn-ghost btn-sm" data-copy-doc="${i}">Copy rewrite</button></div>`).join('')
            : `<p class="empty-note">${p ? 'Every bullet opens with a strong verb and carries a number. Nice.' : 'Upload your resume to get bullet-by-bullet rewrites.'}</p>`}
          ${doctor.length ? '<p class="muted" style="font-size:12px;margin:8px 0 0">Fill the brackets with true numbers from your work. Never invent metrics — recruiters ask about them.</p>' : ''}
        </section>

        <section class="card span-12" id="ats-space"><div class="card-h"><h3>Opportunity space</h3><span class="sub">ATS fit × interview chance × days since applied · tap a point to inspect it · red wireframes are knockouts</span></div><div id="galaxy-slot"></div></section>

        <section class="card span-6"><div class="card-h"><h3>Resume audit</h3><span class="sub">${audit ? `Grade ${audit.grade} · ${audit.score}/100 · ${audit.fails} fails · ${audit.warns} warnings` : 'Upload a resume'}</span></div>
          ${audit ? audit.checks.map((c) => `<div class="check-row"><span class="ci ci-${c.status}">${c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'}</span><div><b>${E(c.label)}</b><span>${E(c.detail)}</span></div></div>`).join('') : '<p class="empty-note">The audit checks contact info, section headings, parseable dates, quantified impact, action verbs, clichés, skill evidence, gaps and length.</p>'}
        </section>
        <section class="card span-6"><div class="card-h"><h3>What the ATS extracted</h3><span class="sub">Skills by evidence strength</span></div>
          ${p ? `<div class="lbl" style="margin-bottom:6px">In experience bullets (full credit) · ${ev('experience').length}</div><div class="skills-grid">${ev('experience').map((s) => `<span class="sk sk-evidenced"><i>✓</i>${E(s.name)}${s.recent ? '' : '<small>older</small>'}</span>`).join('') || '<span class="muted">None</span>'}</div>
            <div class="lbl" style="margin:12px 0 6px">In projects (75%) · ${ev('project').length}</div><div class="skills-grid">${ev('project').map((s) => `<span class="sk sk-transferable"><i>≈</i>${E(s.name)}</span>`).join('') || '<span class="muted">None</span>'}</div>
            <div class="lbl" style="margin:12px 0 6px">Skills list only (${Math.round(T.listedCredit * 100)}% credit) · ${ev('listed').length + ev('summary').length}</div><div class="skills-grid">${[...ev('listed'), ...ev('summary')].map((s) => `<span class="sk sk-listed"><i>◐</i>${E(s.name)}</span>`).join('') || '<span class="muted">None</span>'}</div>
            <div class="lbl" style="margin:14px 0 6px">Roles and dates detected</div>
            ${p.roles.map((ro) => `<div style="display:flex;gap:10px;font-size:12.5px;padding:4px 0;border-bottom:1px dashed var(--line)"><b class="ell" style="flex:1">${E(ro.title || 'Untitled role')}</b><span class="mono muted">${CB.MONTHS[ro.start % 12]} ${Math.floor(ro.start / 12)} – ${ro.current ? 'Present' : CB.MONTHS[ro.end % 12] + ' ' + Math.floor(ro.end / 12)} · ${Math.round(ro.months / 12 * 10) / 10}y</span></div>`).join('') || '<p class="muted">No dated roles found — this is a critical ATS failure.</p>'}` : '<p class="empty-note">Upload a resume to see what an ATS pulls out of it.</p>'}
        </section>

        <section class="card span-6"><div class="card-h"><h3>Does the score predict replies?</h3><span class="sub">Applications per ATS band · dark = got a screen</span></div><div id="calib"></div>
          <div class="row" style="gap:14px;font-size:12px;color:var(--ink-2);margin-top:6px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:color-mix(in srgb,var(--st-rejected) 55%,transparent);margin-right:5px"></i>Below cutoff</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:color-mix(in srgb,var(--st-assessment) 60%,transparent);margin-right:5px"></i>Long shot</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:color-mix(in srgb,var(--st-offer) 55%,transparent);margin-right:5px"></i>Competitive+</span><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--ink);opacity:.78;margin-right:5px"></i>Got a screen</span></div></section>
        <section class="card span-6"><div class="card-h"><h3>Quick check</h3><span class="sub">Paste any job description — scored instantly, nothing saved</span></div>
          <textarea class="input" id="qc-text" rows="6" placeholder="Paste a job description to see if you'd pass the screen…"></textarea>
          <div class="row" style="margin-top:10px"><input class="input" id="qc-title" placeholder="Job title (improves seniority match)" style="flex:1 1 200px"><button class="btn btn-primary" id="qc-go">Score it</button><button class="btn" id="qc-track" hidden>Track this job</button></div>
          <div id="qc-out" style="margin-top:12px"></div>
        </section>

        <section class="card span-12"><details><summary style="cursor:pointer;font-weight:650;font-family:var(--f-display);font-size:15.5px">How the score works</summary>
          <div class="grid2" style="margin-top:12px;font-size:13px;line-height:1.6">
            <div><p><b>1. Knockouts first.</b> Like Workday or Greenhouse screening questions, these reject before anyone reads your resume: work authorization (DQ-AUTH), clearance (DQ-CLR), years below ${Math.round(T.koYoeRatio * 100)}% of the minimum (DQ-YOE), a required degree with no equivalent-experience clause (DQ-DEG), required licenses (DQ-CERT), languages (DQ-LANG), a 3+ level seniority jump (DQ-SEN)${T.koLocation ? ', on-site roles you can’t reach (DQ-LOC)' : ''}, under ${Math.round(T.koMQ * 100)}% of must-have skills (DQ-MQ), and a final fit score under ${T.floor} (DQ-SCORE).</p>
            <p><b>2. Ranking.</b> Must-have skills 36%, experience 16%, title &amp; seniority 12%, domain keywords 10%, nice-to-haves 8%, education 7%, resume quality 6%, logistics 5%. Skills earn full credit only when used in experience bullets; listed-only skills earn ${Math.round(T.listedCredit * 100)}%; close substitutes (e.g. GCP for AWS) earn partial credit; "Go or Python" style requirements are met by either. Each missing must-have costs another ${T.gapPenalty} points, and ${T.label} mode bends the curve down.</p></div>
            <div><p><b>3. Interview chance.</b> A logistic curve centered at 82 (a fit of 82 alone ≈ 22%), multiplied by source (referral ×3.2, recruiter outreach ×4, Easy Apply ×0.6), applicant volume (500+ ×0.5, under 25 ×1.35) and how fast you applied (within 2 days ×1.25, after 45 days ×0.55). Knockouts cap the chance at 0.4%.</p>
            <p><b>4. Rank.</b> Your fit is placed in a modeled applicant pool (mean 57, SD 13) of the posting's applicant count, or a typical count for the source. Recruiters usually read the top 10–25%.</p>
            <p class="muted">${CB.standalone ? 'The engine runs entirely on this device — no account, no upload, nothing leaves your phone or computer.' : 'The engine runs entirely on this page. "Re-read with Claude" and "Run review" add an AI read on top, using your claude.ai account.'}</p></div>
          </div></details></section>
      </div>`;
    // resume upload
    const fileIn = $('#rs-file', root);
    $('#rs-pick', root).onclick = () => fileIn.click();
    fileIn.onchange = () => { A.focus = true; UI().uploadResume(fileIn.files[0]); };
    $('#rs-paste', root).onclick = () => { A.focus = true; UI().pasteResume(); };
    const dz = $('#rs-drop', root);
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); A.focus = true; UI().uploadResume(e.dataTransfer.files[0]); };
    if (p) CB.Charts.ring($('#rs-ring', root), audit.score / 100, { label: audit.grade, sub: `resume ${audit.score}/100`, size: 110, stroke: 9, color: UI().compColor(audit.score) });
    const rai = $('#rs-ai', root);
    if (rai) rai.onclick = async () => {
      const out = $('#rs-ai-out', root);
      out.innerHTML = '<span class="thinking">Claude is reading your resume…</span>';
      try {
        const x = await CB.AI.parseResume(r.text);
        out.innerHTML = `<div class="ai-box ai-out"><p><b>${E(x.headline || x.currentTitle || '')}</b> · Claude reads ${E(x.totalYears)} years as <b>${E(x.seniority || '')}</b></p><h4>Strengths</h4><ul>${(x.strengths || []).map((s) => `<li>${E(s)}</li>`).join('')}</ul><h4>Weaknesses</h4><ul>${(x.weaknesses || []).map((s) => `<li>${E(s)}</li>`).join('')}</ul>${Math.abs((+x.totalYears || 0) - p.totalYears) >= 1 ? `<p class="muted">Claude counts ${E(x.totalYears)} years; the local parser counts ${p.totalYears}. If yours is wrong, set an override in Settings.</p>` : ''}</div>`;
      } catch (e) { out.innerHTML = `<p class="muted">${E(CB.AI.errText(e))}</p>`; }
    };
    // next-step buttons
    const scrollTo = (id) => { const el = $(id, root); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); } };
    $$('[data-step]', root).forEach((b) => (b.onclick = async () => {
      const k = b.dataset.step;
      if (k === 'clear') { if (await UI().confirm({ title: 'Clear example data?', text: 'Removes the 22 fictional applications. Your resume and your own entries stay.', ok: 'Clear examples' })) { const n = S.clearSamples(); UI().toast(`Removed ${n} examples`); } }
      else if (k === 'doctor') scrollTo(doctor.length ? '#ats-doctor' : '#ats-gaps');
      else if (k === 'add') UI().addJob();
      else if (k === 'gaps') scrollTo('#ats-gaps');
      else if (k === 'best' && best) UI().openJob(best.id, 'ats');
      else if (k === 'board') location.hash = 'board';
      else if (k === 'iv' && nextIv) UI().openJob(nextIv.j.id, 'interviews');
    }));
    $$('[data-copy-doc]', root).forEach((b) => (b.onclick = () => UI().copy(doctor[+b.dataset.copyDoc].suggestion)));
    if (A.focus && p) { A.focus = false; setTimeout(() => scrollTo('#ats-next'), 120); }
    $$('[data-strict]', root).forEach((b) => (b.onclick = () => { S.setSettings({ strictness: b.dataset.strict }); UI().toast(`${CB.ATS.STRICT[b.dataset.strict].label} mode · all applications re-scored`); }));
    $$('[data-vf]', root).forEach((b) => (b.onclick = () => { A.filter = b.dataset.vf; V.ats(root); }));
    $$('[data-s]', root).forEach((th) => { th.style.cursor = 'pointer'; th.onclick = () => { A.sort = th.dataset.s; V.ats(root); }; });
    $$('tbody tr[data-id]', root).forEach((tr) => {
      tr.onclick = () => UI().openJob(tr.dataset.id, 'ats');
      tr.onpointerenter = (e) => { if (e.pointerType === 'mouse' && persist.galaxy && persist.galaxy.highlight) persist.galaxy.highlight(tr.dataset.id); };
      tr.onpointerleave = (e) => { if (e.pointerType === 'mouse' && persist.galaxy && persist.galaxy.highlight) persist.galaxy.highlight(null); };
    });
    CB.Charts.atsHistogram($('#calib', root), st.atsBuckets, { floor: T.floor, competitive: T.competitive });
    // quick check
    $('#qc-go', root).onclick = () => {
      const jd = $('#qc-text', root).value.trim();
      if (jd.length < 80) { UI().toast('Paste a full job description.', { tone: 'warn' }); return; }
      const post = CB.ATS.extractPosting(jd, '');
      const qcJob = CB.newJob({ title: $('#qc-title', root).value.trim() || post.title, company: post.company, location: post.location, workMode: post.workMode, jd: post.jd || jd, applicants: post.applicants ? post.applicants.n : null });
      qcJob.updatedAt = 'qc-' + CB.hash(jd + qcJob.title);
      const a = S.atsFor(qcJob);
      const out = $('#qc-out', root);
      if (a.score == null) { out.innerHTML = `<p class="muted">${E(a.verdictLabel)}</p>`; return; }
      out.innerHTML = `<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:center">${UI().stamp(a, true)}<div style="font-size:13px;display:grid;gap:4px"><b>Fit ${a.score}/100 · interview chance ${UI().prob(a)}</b>${a.knockouts.map((k) => `<span style="color:var(--bad)"><b class="mono">${E(k.code)}</b> ${E(k.detail)}</span>`).join('')}<span>${a.skills.required.map((s) => `<span class="sk sk-${s.status}" style="padding:1px 6px;margin:1px"><i>${{ evidenced: '✓', listed: '◐', transferable: '≈', missing: '✗', alternative: '∨' }[s.status]}</i>${E(s.name)}</span>`).join('')}</span></div></div>`;
      $('#qc-track', root).hidden = false;
    };
    $('#qc-track', root).onclick = () => UI().addJob({ jd: $('#qc-text', root).value });
    // galaxy (persistent WebGL scene, re-parented on refresh)
    const slot = $('#galaxy-slot', root);
    const pts = jobs.map((j) => ({ j, a: ats[j.id] })).filter((x) => x.a && x.a.score != null).map(({ j, a }) => ({
      id: j.id, label: j.company, sub: j.title, x: a.score, y: Math.min(a.probability, 0.8), z: j.appliedDate ? Math.max(0, CB.daysSince(j.appliedDate)) : 0,
      size: CB.clamp(((j.salaryMax || j.salaryMin || 120000) - 80000) / 220000, 0, 1), color: UI().stageHex(j.status), status: j.status, statusLabel: CB.STAGE[j.status].label,
      verdict: a.verdict, verdictColor: cssHex(VERDICT_VAR[a.verdict] || '--muted'), knocked: a.knockouts.length > 0, active: CB.STAGE[j.status].group !== 'closed',
    }));
    if (!persist.galaxyHost) { persist.galaxyHost = document.createElement('div'); persist.galaxyHost.className = 'galaxy'; }
    slot.replaceWith(persist.galaxyHost);
    const theme = UI().theme3d();
    const thresholds = { floor: T.floor, competitive: T.competitive };
    const onOpen = (id, tab) => UI().openJob(id, tab || 'overview');
    if (persist.galaxy) persist.galaxy.update(pts, theme, { thresholds });
    else if (CB.Viz3D && CB.Viz3D.available && CB.Viz3D.available()) {
      try { persist.galaxy = CB.Viz3D.createGalaxy(persist.galaxyHost, { points: pts, theme, thresholds, onOpen, onPick: (id) => onOpen(id, 'ats') }); } catch (e) { console.error(e); persist.galaxy = null; }
    }
    if (!persist.galaxy) persist.galaxyHost.innerHTML = '<p class="empty-note" style="padding:20px">3D view needs WebGL. The scoreboard above has the same data.</p>';
    onLeave('ats', () => { if (persist.galaxy) { persist.galaxy.destroy(); persist.galaxy = null; } persist.galaxyHost = null; });
  };
  const App = () => CB.App;

  // ═════════════════════════ CALENDAR ═════════════════════════
  const C = { y: new Date().getFullYear(), m: new Date().getMonth() };
  V.calendar = (root) => {
    const jobs = S.list();
    const evs = [];
    jobs.forEach((j) => {
      (j.interviews || []).forEach((iv) => iv.datetime && evs.push({ date: iv.datetime.slice(0, 10), dt: iv.datetime, label: `${j.company} · ${iv.type}`, c: iv.outcome === 'Failed' ? 'var(--st-rejected)' : iv.outcome === 'Cancelled' ? 'var(--st-ghosted)' : 'var(--st-interview)', id: j.id, tab: 'interviews', kind: 'Interview' }));
      if (j.followUpDate && CB.STAGE[j.status].group === 'active') evs.push({ date: j.followUpDate, label: `Follow up · ${j.company}`, c: 'var(--st-applied)', id: j.id, tab: 'timeline', kind: 'Follow-up' });
      if (j.deadline && j.status === 'saved') evs.push({ date: j.deadline, label: `Apply by · ${j.company}`, c: 'var(--st-final)', id: j.id, tab: 'overview', kind: 'Deadline' });
      if (j.offer && j.offer.deadline && j.status === 'offer') evs.push({ date: j.offer.deadline, label: `Offer decision · ${j.company}`, c: 'var(--st-offer)', id: j.id, tab: 'overview', kind: 'Offer' });
      if (j.appliedDate) evs.push({ date: j.appliedDate, label: `Applied · ${j.company}`, c: 'var(--st-saved)', id: j.id, tab: 'overview', kind: 'Applied', minor: true });
    });
    const first = new Date(C.y, C.m, 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const today = CB.todayISO();
    const days = [];
    for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
    const byDate = {};
    evs.forEach((e) => (byDate[e.date] = byDate[e.date] || []).push(e));
    const agenda = evs.filter((e) => !e.minor && e.date >= today && e.date <= CB.addDays(today, 21)).sort((a, b) => (a.dt || a.date).localeCompare(b.dt || b.date));
    root.innerHTML = `<div class="dash">
      <section class="card span-8"><div class="card-h"><h3>${CB.MONTHS[C.m]} ${C.y}</h3><div class="right"><button class="btn btn-sm" data-nav="-1" aria-label="Previous month">‹</button><button class="btn btn-sm" data-nav="0">Today</button><button class="btn btn-sm" data-nav="1" aria-label="Next month">›</button></div></div>
        <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
        ${days.map((d) => { const iso = CB.toISODate(d); const list = byDate[iso] || []; return `<div class="cal-d ${d.getMonth() !== C.m ? 'out' : ''} ${iso === today ? 'today' : ''}"><span class="cal-n">${d.getDate()}</span>${list.filter((e) => !e.minor).slice(0, 3).map((e) => `<button class="ev" style="--c:${e.c}" data-id="${e.id}" data-tab="${e.tab}" title="${E(e.label)}">${E(e.label)}</button>`).join('')}${list.filter((e) => !e.minor).length > 3 ? `<span class="muted" style="font-size:10.5px">+${list.filter((e) => !e.minor).length - 3} more</span>` : ''}${list.some((e) => e.minor) ? `<span class="muted" style="font-size:10.5px">${list.filter((e) => e.minor).length} applied</span>` : ''}</div>`; }).join('')}</div>
        <div class="row" style="gap:14px;margin-top:10px;font-size:12px;color:var(--ink-2)">${[['var(--st-interview)', 'Interview'], ['var(--st-applied)', 'Follow-up'], ['var(--st-final)', 'Apply-by deadline'], ['var(--st-offer)', 'Offer decision']].map(([c, l]) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${c};margin-right:5px"></i>${l}</span>`).join('')}</div></section>
      <section class="card span-4"><div class="card-h"><h3>Next 3 weeks</h3></div>
        ${agenda.length ? agenda.map((e) => `<button class="act" style="width:100%;text-align:left;cursor:pointer;margin-bottom:6px;grid-template-columns:4px minmax(0,1fr)" data-id="${e.id}" data-tab="${e.tab}"><span style="background:${e.c};border-radius:2px;align-self:stretch"></span><div><div class="act-t">${E(e.label)}</div><div class="act-d">${e.dt ? E(CB.fmtDateTime(e.dt)) : E(CB.fmtDate(e.date, true))} · ${E(CB.relDays(e.date))}</div></div></button>`).join('') : '<p class="empty-note">Nothing scheduled. Interviews, follow-ups and deadlines appear here.</p>'}</section></div>`;
    $$('[data-nav]', root).forEach((b) => (b.onclick = () => { const n = +b.dataset.nav; if (!n) { C.y = new Date().getFullYear(); C.m = new Date().getMonth(); } else { C.m += n; if (C.m < 0) { C.m = 11; C.y--; } if (C.m > 11) { C.m = 0; C.y++; } } V.calendar(root); }));
    $$('[data-id]', root).forEach((b) => (b.onclick = () => UI().openJob(b.dataset.id, b.dataset.tab)));
  };

  // ═════════════════════════ INBOX PARSER ═════════════════════════
  const EXAMPLES = {
    rejection: `From: Talent Team <no-reply@greenhouse.io>
Subject: Your application to Kestrel Security

Hi Alex,

Thank you for your interest in the Site Reliability Engineer role at Kestrel Security and for the time you put into your application. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our needs at this time.

We wish you the best in your search.
Kestrel Security Recruiting`,
    interview: `From: Grace Kim <grace.kim@lumenbank.example>
Subject: Next steps – Senior Software Engineer, Accounts

Hi Alex,

Thanks for chatting with me! The team would like to move you forward to a technical interview with two engineers from the Accounts team. Would Tuesday, Dec 1 at 2:00 PM PT work? It will be a 60-minute video call on Zoom.

Best,
Grace — Lumen Bank Talent Acquisition`,
    assessment: `Subject: Cobalt AI – Online assessment

Hello,

Thank you for applying to the Machine Learning Engineer, LLM Platform position at Cobalt AI. As a next step, please complete our CodeSignal assessment within 5 days. The assessment takes about 70 minutes.

Cobalt AI Recruiting`,
  };
  V.inbox = (root) => {
    const recent = [];
    S.list().forEach((j) => j.timeline.filter((t) => t.kind === 'email').forEach((t) => recent.push({ j, t })));
    recent.sort((a, b) => b.t.ts.localeCompare(a.t.ts));
    root.innerHTML = `<div class="dash">
      <section class="card span-7"><div class="card-h"><h3>Paste an email</h3><span class="sub">Rejections, interview invites, assessments, offers, "we received your application"</span></div>
        <textarea class="input" id="em-text" rows="12" placeholder="Paste the whole email, including the From and Subject lines if you can…"></textarea>
        <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="em-go">Analyze email</button>${App().ai ? '<button class="btn claude-btn" id="em-ai">Analyze with Claude</button>' : ''}<span class="muted" style="font-size:12px;margin-left:auto">Try:</span>${Object.keys(EXAMPLES).map((k) => `<button class="btn btn-sm" data-ex="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
        <div id="em-out" style="margin-top:14px"></div></section>
      <section class="card span-5"><div class="card-h"><h3>How the auto-tracker works</h3></div>
        <div style="font-size:13px;line-height:1.6;color:var(--ink-2)"><p style="margin-top:0">Callback reads the email, classifies it, finds the application by company and title, and proposes the status change. Nothing changes until you press Apply.</p>
        <ul style="padding-left:18px"><li><b>Rejection</b> → Rejected, with the stage it happened at</li><li><b>Interview invite</b> → Screen / Interviewing / Final, and the proposed time goes on your calendar</li><li><b>Assessment</b> → Assessment</li><li><b>Offer</b> → Offer</li><li><b>Application received</b> → Applied (creates the job if it's new)</li></ul>
        <p class="muted">Tip: when a rejection arrives, paste it here first — your response rate and rejection-stage reports stay accurate.</p></div>
        <div class="lbl" style="margin:14px 0 6px">Recently processed</div>
        ${recent.slice(0, 8).map(({ j, t }) => `<button class="act" style="width:100%;text-align:left;cursor:pointer;margin-bottom:6px;grid-template-columns:minmax(0,1fr)" data-id="${j.id}"><div><div class="act-t">${E(j.company)} · ${E(t.text.split('\n')[0].slice(0, 70))}</div><div class="act-d">${E(CB.fmtDateTime(t.ts))}</div></div></button>`).join('') || '<p class="empty-note">Nothing yet.</p>'}
      </section></div>`;
    $$('[data-ex]', root).forEach((b) => (b.onclick = () => { $('#em-text', root).value = EXAMPLES[b.dataset.ex]; analyze(); }));
    $$('button[data-id]', root).forEach((b) => (b.onclick = () => UI().openJob(b.dataset.id, 'timeline')));
    const analyze = (aiRes) => {
      const text = $('#em-text', root).value.trim();
      if (text.length < 30) { UI().toast('Paste an email first.', { tone: 'warn' }); return; }
      const jobs = S.list();
      const r = aiRes || CB.ATS.classifyEmail(text, jobs);
      const typeLabel = { rejection: 'Rejection', interview: 'Interview invite', assessment: 'Assessment', offer: 'Offer', received: 'Application received', recruiter: 'Recruiter outreach', unknown: 'Unclear', other: 'Other' }[r.type] || r.type;
      const job = r.jobId ? S.get(r.jobId) : null;
      const out = $('#em-out', root);
      out.innerHTML = `<div class="card" style="background:var(--surface-2);display:grid;gap:12px">
        <div class="row"><span class="stamp stamp-${r.type === 'rejection' ? 'REJECTED' : r.type === 'offer' ? 'STRONG' : r.type === 'unknown' || r.type === 'other' ? 'NO_JD' : 'COMPETITIVE'}">${E(typeLabel)}${r.confidence ? `<small>${Math.round(r.confidence * 100)}% sure</small>` : '<small>Claude</small>'}</span>${r.company ? `<span class="tag">Company: ${E(r.company)}</span>` : ''}${r.title ? `<span class="tag">Role: ${E(r.title)}</span>` : ''}</div>
        ${r.summary ? `<p style="margin:0;font-size:13px">${E(r.summary)}</p>` : ''}
        ${r.evidence && r.evidence.length ? `<div style="font-size:12.5px;color:var(--ink-2)">Signals: ${r.evidence.map((e) => `<mark class="hl hl-evidenced">${E(e.text)}</mark>`).join(' · ')}</div>` : ''}
        <div class="grid3">
          <label class="field"><span>Application</span><select class="input" id="em-job"><option value="">${r.type === 'received' ? '+ Create new application' : '— Choose —'}</option>${jobs.sort((a, b) => a.company.localeCompare(b.company)).map((j) => `<option value="${j.id}"${j.id === r.jobId ? ' selected' : ''}>${E(j.company)} · ${E(j.title)} (${E(CB.STAGE[j.status].label)})</option>`).join('')}</select></label>
          <label class="field"><span>Move to</span><select class="input" id="em-stage"><option value="">No status change</option>${CB.STAGES.map((s) => `<option value="${s.key}"${s.key === r.stage ? ' selected' : ''}>${E(s.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Interview time</span><input class="input" type="datetime-local" id="em-dt" value="${E(r.datetime || '')}"></label>
        </div>
        ${job ? `<div style="font-size:13px">${UI().chip(job.status)} → ${r.stage ? UI().chip(r.stage) : '<span class="muted">no change</span>'} for <b>${E(job.company)}</b></div>` : r.type !== 'received' ? '<div class="muted" style="font-size:12.5px">No tracked application matched. Pick one above, or add the job first.</div>' : ''}
        <div class="row"><button class="btn btn-primary" id="em-apply">Apply update</button></div></div>`;
      $('#em-apply', root).onclick = () => {
        let id = $('#em-job', root).value;
        const stage = $('#em-stage', root).value;
        const dt = $('#em-dt', root).value;
        if (!id) {
          if (r.type !== 'received' && r.type !== 'recruiter') { UI().toast('Choose the application this email is about.', { tone: 'warn' }); return; }
          const nj = S.add({ company: r.company || 'Unknown company', title: r.title || 'Role from email', status: r.type === 'received' ? 'applied' : 'saved', source: r.type === 'recruiter' ? 'Recruiter outreach' : 'Company site' }, { log: 'Created from an email' });
          id = nj.id;
        }
        S.log(id, 'email', `${typeLabel}: ${text.split('\n').find((l) => /^subject:/i.test(l)) || text.slice(0, 140)}`);
        if (dt && (r.type === 'interview' || r.type === 'assessment' || stage === 'screen' || stage === 'interview' || stage === 'final')) {
          S.update(id, (x) => { x.interviews.push({ id: CB.uid('i_'), round: x.interviews.length + 1, type: stage === 'screen' ? 'Recruiter screen' : stage === 'final' ? 'Panel / Onsite' : stage === 'assessment' ? 'Take-home review' : 'Technical screen', datetime: dt, durationMin: 60, interviewer: '', link: '', outcome: 'Scheduled', notes: 'From email', thankYouSent: false }); });
        }
        if (stage && S.get(id).status !== stage) UI().moveJob(id, stage, stage === 'rejected' ? { reason: 'No reason given', note: 'From email' } : { note: 'From email' });
        else UI().toast('Logged to the timeline');
        $('#em-text', root).value = '';
        out.innerHTML = '';
      };
    };
    $('#em-go', root).onclick = () => analyze();
    const ai = $('#em-ai', root);
    if (ai) ai.onclick = async () => {
      const text = $('#em-text', root).value.trim();
      if (text.length < 30) { UI().toast('Paste an email first.', { tone: 'warn' }); return; }
      ai.disabled = true;
      $('#em-out', root).innerHTML = '<span class="thinking">Claude is reading…</span>';
      try { const r = await CB.AI.classifyEmail(text, S.list()); if (r.jobId && !S.get(r.jobId)) r.jobId = null; analyze({ ...r, confidence: null, evidence: [] }); }
      catch (e) { $('#em-out', root).innerHTML = `<p class="muted">${E(CB.AI.errText(e))}</p>`; }
      ai.disabled = false;
    };
  };

  // ═════════════════════════ REPORTS ═════════════════════════
  V.reports = (root) => {
    const jobs = S.list();
    const ats = S.atsMap();
    const st = CB.Stats.compute(jobs, ats);
    const data = () => ({ jobs: S.list(), atsById: S.atsMap(), stats: CB.Stats.compute(S.list(), S.atsMap()), resumeName: S.resume && S.resume.fileName });
    const funnel = [['Applied', st.applied], ['Got any reply', st.responses], ['Recruiter screen', st.screens], ['Interviewing', st.interviews], ['Final round', st.finals], ['Offer', st.offers], ['Accepted', st.accepted]];
    const respDays = jobs.filter((j) => j.responseDate && j.appliedDate).map((j) => CB.daysBetween(j.appliedDate, j.responseDate));
    const bands = [['0–3 days', 0, 3], ['4–7', 4, 7], ['8–14', 8, 14], ['15–30', 15, 30], ['30+', 31, 9999]].map(([l, a, b]) => ({ label: l, value: respDays.filter((d) => d >= a && d <= b).length }));
    const screened = jobs.filter((j) => (j.maxStage || 0) >= 2).map((j) => ats[j.id]).filter((a) => a && a.score != null);
    const notScreened = jobs.filter((j) => (j.appliedDate || (j.maxStage || 0) >= 1) && (j.maxStage || 0) < 2).map((j) => ats[j.id]).filter((a) => a && a.score != null);
    const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y.score, 0) / a.length) : '—');
    root.innerHTML = `<div class="dash">
      <section class="card span-12"><div class="card-h"><h3>Export &amp; import</h3><span class="sub">Real Office files — open in Excel, Word, Numbers, Pages or Google</span></div>
        <div class="grid3">
          <div class="card" style="box-shadow:none;background:var(--surface-2)"><b>Excel workbook (.xlsx)</b><p class="muted" style="font-size:12.5px;margin:6px 0 10px">Dashboard with live formulas, Applications sheet with status dropdowns, color-coded stages, ATS color scale, frozen panes and filters, plus ATS Breakdown, Interviews, Timeline and Contacts sheets.</p><button class="btn btn-primary" data-exp="xlsx">${UI().icon('download')}Download .xlsx</button></div>
          <div class="card" style="box-shadow:none;background:var(--surface-2)"><b>Word report (.docx)</b><p class="muted" style="font-size:12.5px;margin:6px 0 10px">A formatted search report: KPIs, pipeline table with stage colors, every application, ATS risk list, upcoming interviews and follow-ups due.</p><button class="btn btn-primary" data-exp="docx">${UI().icon('download')}Download .docx</button></div>
          <div class="card" style="box-shadow:none;background:var(--surface-2)"><b>CSV &amp; backup</b><p class="muted" style="font-size:12.5px;margin:6px 0 10px">CSV for any spreadsheet tool. The JSON backup holds everything (jobs, resume, settings) and restores on any device.</p><div class="row"><button class="btn" data-exp="csv">CSV</button><button class="btn" data-exp="json">Backup (.json)</button></div></div>
        </div>
        <div class="row" style="margin-top:14px"><b style="font-size:13px">Import:</b><button class="btn" id="r-imp-x">${UI().icon('upload')}From Excel / CSV tracker</button><button class="btn" id="r-imp-j">Restore backup</button><span class="muted" style="font-size:12px">Columns are matched automatically (Company, Position, Status, Date Applied, Link, Salary…). Duplicates are merged.</span>
          <input type="file" id="r-fx" accept=".xlsx,.csv,.tsv,.txt" hidden><input type="file" id="r-fj" accept=".json,application/json" hidden></div>
      </section>
      <section class="card span-6"><div class="card-h"><h3>Conversion funnel</h3><span class="sub">Share of applications that reached each step</span></div>
        <div class="tw"><table class="t" style="cursor:default"><thead><tr><th>Step</th><th class="num">Count</th><th class="num">From previous</th><th class="num">From applied</th></tr></thead><tbody>
        ${funnel.map(([l, n], i) => `<tr style="cursor:default"><td>${E(l)}</td><td class="num mono">${n}</td><td class="num mono">${i ? (funnel[i - 1][1] ? CB.pct(n / funnel[i - 1][1]) : '—') : '—'}</td><td class="num mono">${st.applied ? CB.pct(n / st.applied, 1) : '—'}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card span-6"><div class="card-h"><h3>Source performance</h3><span class="sub">Where your replies come from</span></div>
        <div class="tw"><table class="t"><thead><tr><th>Source</th><th class="num">Applied</th><th class="num">Replies</th><th class="num">Reply rate</th><th class="num">Interview rate</th></tr></thead><tbody>
        ${st.bySource.map((s) => `<tr style="cursor:default"><td>${E(s.source)}</td><td class="num mono">${s.applied}</td><td class="num mono">${s.responses}</td><td class="num mono">${CB.pct(s.rate)}</td><td class="num mono">${CB.pct(s.interviewRate)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No applications yet.</td></tr>'}</tbody></table></div></section>
      <section class="card span-6"><div class="card-h"><h3>Time to first reply</h3><span class="sub">${respDays.length ? `Average ${Math.round(respDays.reduce((a, b) => a + b, 0) / respDays.length)} days · median ${st.medianDaysToResponse} days` : 'No replies yet'}</span></div><div id="r-resp"></div></section>
      <section class="card span-6"><div class="card-h"><h3>Why applications closed</h3><span class="sub">Rejection reasons you logged</span></div><div id="r-reasons"></div></section>
      <section class="card span-6"><div class="card-h"><h3>ATS score vs. outcome</h3><span class="sub">Is tailoring paying off?</span></div>
        <div class="grid2"><div class="card kpi" style="box-shadow:none;background:var(--surface-2)"><div class="kpi-l">Avg ATS · got a screen</div><div class="kpi-v">${avg(screened)}</div><div class="kpi-d">${screened.length} applications</div></div><div class="card kpi" style="box-shadow:none;background:var(--surface-2)"><div class="kpi-l">Avg ATS · no screen</div><div class="kpi-v">${avg(notScreened)}</div><div class="kpi-d">${notScreened.length} applications</div></div></div>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0">If the screened average is clearly higher, the score is tracking real recruiter behavior for you — prioritize postings above your screened average.</p></section>
      <section class="card span-6"><div class="card-h"><h3>Compensation</h3><span class="sub">Posted ranges you're targeting</span></div>
        <div class="grid2"><div class="card kpi" style="box-shadow:none;background:var(--surface-2)"><div class="kpi-l">Median posted max</div><div class="kpi-v">${st.medianSalary ? E(CB.fmtMoney(st.medianSalary)) : '—'}</div><div class="kpi-d">annualized</div></div>
        <div class="card kpi" style="box-shadow:none;background:var(--surface-2)"><div class="kpi-l">Offers</div><div class="kpi-v">${jobs.filter((j) => j.offer && j.offer.base).length}</div><div class="kpi-d">${jobs.filter((j) => j.offer && j.offer.base).map((j) => `${E(j.company)} ${E(CB.fmtMoney(j.offer.base))}`).join(' · ') || 'none yet'}</div></div></div></section>
    </div>`;
    $$('[data-exp]', root).forEach((b) => (b.onclick = () => {
      const k = b.dataset.exp;
      if (k === 'xlsx') UI().save(CB.IO.exportExcel(data()), 'Workbook ready');
      if (k === 'docx') UI().save(CB.IO.exportReportDocx(data()), 'Report ready');
      if (k === 'csv') UI().save(CB.IO.exportCSV(data()), 'CSV ready');
      if (k === 'json') UI().save(CB.IO.exportJSON({ jobs: S.list(), resume: S.resume, settings: S.settings }), 'Backup ready');
    }));
    $('#r-imp-x', root).onclick = () => $('#r-fx', root).click();
    $('#r-fx', root).onchange = (e) => importSheet(e.target.files[0]);
    $('#r-imp-j', root).onclick = () => $('#r-fj', root).click();
    $('#r-fj', root).onchange = async (e) => {
      try {
        const d = await CB.IO.importJSON(e.target.files[0]);
        if (await UI().confirm({ title: 'Restore this backup?', text: `Replaces your current data with ${d.jobs.length} applications from ${CB.fmtDate((d.exportedAt || '').slice(0, 10), true)}.`, ok: 'Restore', danger: true })) { const n = S.restoreBackup(d); UI().toast(`Restored ${n} applications`); }
      } catch (err) { UI().toast(err.message || 'That file is not a Callback backup.', { tone: 'bad' }); }
    };
    CB.Charts.columns($('#r-resp', root), bands, { unit: 'replies', height: 170 });
    const rr = Object.entries(st.rejectionsByReason).sort((a, b) => b[1] - a[1]);
    if (rr.length) CB.Charts.rateBars($('#r-reasons', root), rr.map(([k, n]) => ({ label: k, value: n, text: String(n), color: 'var(--st-rejected)', sub: CB.pct(n / Math.max(1, st.rejected)) })));
    else $('#r-reasons', root).innerHTML = '<p class="empty-note">No rejections logged.</p>';
  };

  // ═════════════════════════ SETTINGS ═════════════════════════
  V.settings = (root) => {
    const s = S.settings;
    let theme = 'system';
    try { theme = localStorage.getItem('callback.theme') || 'dark'; } catch (e) { /* noop */ }
    const p = S.profile();
    root.innerHTML = `<div class="dash">
      <section class="card span-6"><div class="card-h"><h3>Eligibility</h3><span class="sub">Used for knockout questions — answer honestly</span></div>
        <div style="display:grid;gap:12px">
          <label class="check"><input type="checkbox" data-s="needsSponsorship" ${s.needsSponsorship ? 'checked' : ''}><span><b>I need visa sponsorship</b><br><span class="muted" style="font-size:12.5px">Postings that won't sponsor become an automatic DQ-AUTH rejection.</span></span></label>
          <label class="check"><input type="checkbox" data-s="hasClearance" ${s.hasClearance ? 'checked' : ''}><span><b>I hold an active security clearance</b></span></label>
          <label class="check"><input type="checkbox" data-s="remoteOnly" ${s.remoteOnly ? 'checked' : ''}><span><b>Remote only</b><br><span class="muted" style="font-size:12.5px">Hybrid and on-site roles lose logistics points.</span></span></label>
          <label class="check"><input type="checkbox" data-s="willingToRelocate" ${s.willingToRelocate ? 'checked' : ''}><span><b>Open to relocating</b></span></label>
          <div class="grid2">
            <label class="field"><span>Home location</span><input class="input" data-s="homeLocation" value="${E(s.homeLocation)}" placeholder="e.g. Seattle, WA"></label>
            <label class="field"><span>Years of experience override</span><input class="input" type="number" step="0.5" data-s="yearsOverride" value="${E(s.yearsOverride)}" placeholder="${p ? 'Parsed: ' + p.totalYears : 'From resume'}"></label>
            <label class="field"><span>Highest degree override</span><select class="input" data-s="degreeOverride">${UI().opts(['', '1', '2', '3', '4', '5'], s.degreeOverride, ['From resume' + (p ? ` (${p.education.label})` : ''), 'High school', 'Associate / bootcamp', "Bachelor's", "Master's", 'Doctorate'])}</select></label>
          </div>
        </div></section>
      <section class="card span-6"><div class="card-h"><h3>ATS strictness</h3></div>
        <div style="display:grid;gap:10px">${Object.entries((CB.ATS && CB.ATS.STRICT) || {}).map(([k, v]) => `<label class="check opt-card${s.strictness === k ? ' is-on' : ''}"><input type="radio" name="strict" value="${k}" ${s.strictness === k ? 'checked' : ''}><span><b>${E(v.label)}</b>${k === 'brutal' ? ' <span class="tag">Default</span>' : ''}<br><span class="muted" style="font-size:12.5px">Cutoff ${v.floor} · review ${v.competitive}+ · must-haves ≥ ${Math.round(v.koMQ * 100)}% · years ≥ ${Math.round(v.koYoeRatio * 100)}% of minimum · listed-only skills ${Math.round(v.listedCredit * 100)}% credit${v.koDegreeGap === 1 ? ' · degree gaps knock out' : ''}${v.koLocation ? ' · location knocks out' : ''}</span></span></label>`).join('')}</div></section>
      <section class="card span-6"><div class="card-h"><h3>Goals &amp; automations</h3></div>
        <div class="grid3">
          <label class="field"><span>Weekly application goal</span><input class="input" type="number" data-s="weeklyGoal" value="${E(s.weeklyGoal)}"></label>
          <label class="field"><span>Follow up after (days)</span><input class="input" type="number" data-s="followUpDays" value="${E(s.followUpDays)}"></label>
          <label class="field"><span>Suggest "ghosted" after (days)</span><input class="input" type="number" data-s="ghostDays" value="${E(s.ghostDays)}"></label>
        </div>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0">The Action Center proposes follow-ups, ghosting, thank-you notes, outcome logging and deadline warnings. Nothing changes until you press the button.</p></section>
      <section class="card span-6"><div class="card-h"><h3>For cover letters</h3></div>
        <div class="grid3">
          <label class="field"><span>Your name</span><input class="input" data-s="candidateName" value="${E(s.candidateName)}" placeholder="${E((p && p.name) || '')}"></label>
          <label class="field"><span>Email</span><input class="input" data-s="candidateEmail" value="${E(s.candidateEmail)}" placeholder="${E((p && p.contact.email) || '')}"></label>
          <label class="field"><span>Phone</span><input class="input" data-s="candidatePhone" value="${E(s.candidatePhone)}" placeholder="${E((p && p.contact.phone) || '')}"></label>
        </div></section>
      <section class="card span-6"><div class="card-h"><h3>Appearance</h3></div>
        <div class="seg-ctl" role="group" aria-label="Theme">${[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button data-theme-set="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>
        <label class="check" style="margin-top:14px"><input type="checkbox" id="st-cal" ${(() => { try { return localStorage.getItem('callback.cal.hidden') === '1' ? '' : 'checked'; } catch (e) { return 'checked'; } })()}><span><b>Show Cal, the assistant</b><br><span class="muted" style="font-size:12.5px">Press C anywhere (Mac) to call Cal even when hidden.</span></span></label>
        <label class="check" style="margin-top:12px"><input type="checkbox" data-fx-reduce ${(() => { try { return localStorage.getItem('callback.reduceFx') === '1' ? 'checked' : ''; } catch (e) { return ''; } })()}><span><b>Reduce glass and motion</b><br><span class="muted" style="font-size:12.5px">Opaque panels and instant transitions. Easier on older iPhones and on the eyes.</span></span></label>
        <p class="muted" style="font-size:12.5px;margin:12px 0 0">${CB.standalone ? 'On iPhone: open the app in Safari, tap Share → Add to Home Screen. On Mac: open it in Safari and choose File → Add to Dock, or in Chrome choose Install. It then works offline.' : 'On Mac or Windows: open Callback in the Claude desktop app and choose Share → Install as app for its own window, menu bar and reminders (Settings → Desktop app). On iPhone: open it in the Claude app, or use the web version from your Home Screen.'}</p></section>
      <section class="card span-6"><div class="card-h"><h3>Your data</h3><span class="sub">${S.mode === 'cloud' ? 'Synced to your claude.ai account — private to you' : 'Stored in this browser only'}</span></div>
        <div class="row">
          <button class="btn" id="st-ex-load">Load examples</button>
          <button class="btn" id="st-ex-clear">Clear examples</button>
          <button class="btn" id="st-backup">${UI().icon('download')}Backup (.json)</button>
          <button class="btn btn-danger" id="st-wipe">Delete everything</button>
        </div>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0">${S.list().length} applications · resume ${S.resume ? (S.resume.sample ? 'example' : 'uploaded') : 'not uploaded'}. ${S.mode === 'cloud' ? 'Only you can read this data, even if you share the page link.' : 'Export a backup regularly; browsers can clear site data.'}</p></section>
    </div>`;
    const num = (k) => ['weeklyGoal', 'followUpDays', 'ghostDays'].includes(k);
    $$('[data-s]', root).forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.s;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (num(k)) v = Math.max(1, +v || CB.Store.DEFAULT_SETTINGS[k]);
      S.setSettings({ [k]: v });
      UI().toast('Saved · applications re-scored');
    }));
    $$('input[name="strict"]', root).forEach((el) => (el.onchange = () => S.setSettings({ strictness: el.value })));
    $$('[data-theme-set]', root).forEach((b) => (b.onclick = () => UI().setTheme(b.dataset.themeSet)));
    $('#st-cal', root).onchange = (e) => CB.Cal && CB.Cal.show(e.target.checked);
    $('#st-ex-load', root).onclick = () => { const n = S.loadSamples(); UI().toast(`Loaded ${n} examples`); };
    $('#st-ex-clear', root).onclick = () => { const n = S.clearSamples(); UI().toast(`Removed ${n} examples`); };
    $('#st-backup', root).onclick = () => UI().save(CB.IO.exportJSON({ jobs: S.list(), resume: S.resume, settings: S.settings }), 'Backup ready');
    $('#st-wipe', root).onclick = async () => {
      if (await UI().confirm({ title: 'Delete everything?', text: `All ${S.list().length} applications and your resume will be permanently removed from every device. Export a backup first if you might want them.`, ok: 'Delete everything', danger: true })) { S.clearAll(); UI().toast('All data deleted'); }
    };
    if (UI().mountSettingsCards) UI().mountSettingsCards($('.dash', root)); // platform hook: CB.registerSettings
  };

  CB.Views = V;
})();

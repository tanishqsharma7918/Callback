/* Callback — Cal, the assistant. Chat panel + two brains:
 *  1. Claude with page tools (via the `sample` capability) — operates the whole app.
 *  2. A local command engine — works offline / outside claude.ai for the core actions.
 * Optional voice: `tts` speaks replies, `dictation` takes voice input (where the viewer supports them). */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  const $ = (s, r = document) => r.querySelector(s);
  const E = CB.esc;
  const S = () => CB.Store;
  const UI = () => CB.UI;
  const A = { open: false, turns: [], log: [], mascot: null, busy: false, ctl: null, voice: false, tts: null, dict: null, toolsOk: null, maxTools: 16, cur: null, nudged: '' };
  const LS = 'callback.cal';
  const BUILTIN_VIEWS = ['dashboard', 'board', 'sheet', 'calendar', 'ats', 'inbox', 'reports', 'settings'];
  const VIEW_NAMES = { dashboard: 'Dashboard', board: 'Pipeline board', sheet: 'Spreadsheet', calendar: 'Calendar', ats: 'ATS Lab', inbox: 'Inbox Parser', reports: 'Reports & Export', settings: 'Settings' };
  // Views registered by feature modules (CB.registerView) are reachable by Cal too.
  const allViews = () => { try { return CB.App && CB.App.views ? CB.App.views() : []; } catch (e) { return []; } };
  const viewKeys = () => { const k = allViews().map((v) => v.key); return k.length ? k : BUILTIN_VIEWS; };
  const viewName = (k) => VIEW_NAMES[k] || (allViews().find((v) => v.key === k) || {}).label || k;
  const extViews = () => allViews().filter((v) => v.reg);
  const reEsc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ───────────────────────── extension points ─────────────────────────
  const INTENTS = []; // {re, handler}
  const EXT_TOOLS = []; // {name, description, inputSchema, execute}
  /** registerIntent(regex, handler(text, say, act) → true if handled). Checked before the built-in local commands. */
  function registerIntent(re, handler) {
    if (typeof re === 'string') { try { re = new RegExp(re, 'i'); } catch (e) { re = null; } }
    if (!(re instanceof RegExp) || typeof handler !== 'function') { console.warn('[Callback] Cal.registerIntent ignored: needs (RegExp, function)'); return () => {}; }
    const it = { re, handler };
    INTENTS.push(it);
    return () => { const i = INTENTS.indexOf(it); if (i >= 0) INTENTS.splice(i, 1); };
  }
  /** registerTool({name, description, inputSchema, execute(input, ctx)}) — appended to Claude's tools (within maxTools). */
  function registerTool(def) {
    if (!def || !/^[A-Za-z0-9_-]{1,64}$/.test(String(def.name || '')) || typeof def.execute !== 'function') { console.warn('[Callback] Cal.registerTool ignored: needs {name (A-Z a-z 0-9 _ -), description, execute}', def); return () => {}; }
    const schema = def.inputSchema && typeof def.inputSchema === 'object' && !Array.isArray(def.inputSchema) ? Object.assign({ type: 'object' }, def.inputSchema) : { type: 'object', properties: {} };
    const t = { name: def.name, description: String(def.description || def.name).slice(0, 1000), inputSchema: schema, execute: def.execute };
    const i = EXT_TOOLS.findIndex((x) => x.name === t.name);
    if (i >= 0) EXT_TOOLS.splice(i, 1, t); else EXT_TOOLS.push(t);
    return () => { const k = EXT_TOOLS.indexOf(t); if (k >= 0) EXT_TOOLS.splice(k, 1); };
  }
  const TABS = ['overview', 'ats', 'interviews', 'contacts', 'docs', 'timeline'];
  const STAGE_KEYS = CB.STAGES.map((s) => s.key);

  // ───────────────────────── app knowledge (shared by both brains) ─────────────────────────
  const GUIDE = `Callback is the user's private job-search tracker (synced between their devices through their claude.ai account).
Views: Dashboard (KPIs, 3D pipeline tower, Action Center with due follow-ups/ghosting/thank-you notes, flow chart, weekly goal, heatmap, source response rates, upcoming interviews) · Pipeline board (drag cards between stages; each card shows ATS score and interview chance) · Spreadsheet (Excel-style grid: click a cell, Enter to edit, shift-click a column range to see Sum/Average; tabs for Interviews, Contacts, Timeline; exports .xlsx/.csv; imports an existing Excel/CSV tracker) · Calendar (interviews, follow-ups, apply-by deadlines, offer deadlines) · ATS Lab (upload resume PDF/DOCX/text, resume audit with grade, 3D opportunity space, scoreboard of every posting, strictness Brutal/Harsh/Standard, quick-check any JD) · Inbox Parser (paste recruiter emails; detects rejection/interview/assessment/offer/received and updates the application) · Reports & Export (Excel workbook with live formulas, Word report, CSV, JSON backup, import, funnel and source analytics) · Settings (eligibility for knockouts: sponsorship, clearance, remote-only, relocation, home location, years/degree override; goals; follow-up and ghost thresholds; theme; data).
Each application opens in a drawer with tabs: Overview (fields, offer details, job description), ATS report (score, verdict stamp, knockouts with codes DQ-AUTH/CLR/YOE/MQ/DEG/CERT/LANG/SEN/LOC/SCORE, component breakdown, must-have skills ✓ evidenced / ◐ listed only / ≈ transferable / ✗ missing, fixes, highlighted posting, Claude deep review), Interviews (schedule, outcome, thank-you, Claude prep), Contacts (Claude outreach drafts), Notes & docs (rich notes, cover letter with Word export), Timeline.
Pipeline statuses: saved → applied → screen (recruiter screen) → assessment → interview → final → offer → accepted, plus closed outcomes rejected, ghosted, withdrawn. Moving past Saved sets the applied date; the first move to screen or rejected records the response date; rejected records the stage and a reason.
ATS scoring: knockouts first (auto-reject), then weighted ranking — must-have skills 36%, experience 16%, title & seniority 12%, domain keywords 10%, nice-to-haves 8%, education 7%, resume quality 6%, logistics 5%. Skills only count fully when used in experience bullets. Brutal mode cutoff is 60, recruiter review 75+, shortlist 85+. Interview chance multiplies a logistic curve by source (referral ×3.2, recruiter outreach ×4, Easy Apply ×0.6), applicant volume and how fast they applied.
LinkedIn: the app cannot read LinkedIn pages by link (LinkedIn blocks it). Paste the link plus the posting text (Select All → Copy on the job page) into Add job; Callback strips LinkedIn clutter and extracts title, company, location, salary, applicants and requirements.
Keyboard (Mac): ⌘K command palette, N add job, 1–8 switch views, ⌘Z undo. On iPhone: Share → Add to Home Screen for an app icon.`;

  const FAQ = [
    [/linkedin|link\b|url/, 'Paste the LinkedIn link in **Add job**, then paste the posting text too — LinkedIn blocks other sites from reading its pages. On the job page use Select All → Copy (⌘A ⌘C on Mac, press-and-hold → Select All on iPhone). Callback extracts the title, company, salary, applicants and requirements and shows your ATS verdict before you save.'],
    [/excel|xlsx|spreadsheet|sheet/, 'Open **Spreadsheet** for the Excel-style grid (Enter edits a cell, shift-click sums a range). **Excel workbook** exports a real .xlsx with a live-formula Dashboard, status dropdowns, color-coded stages and ATS color scales. Import your old tracker from **Reports & Export → From Excel / CSV**.'],
    [/word|docx|report|dossier|cover letter/, '**Reports & Export → Word report** builds a formatted .docx of your whole search. Inside an application, the document icon exports a prep **dossier**, and **Notes & docs** has a Word-style cover letter page with .docx export.'],
    [/resume|cv|upload/, 'Go to **ATS Lab → Upload your resume** (PDF, Word or text). Every application is re-scored instantly, and the audit grades your resume A–F with the exact fixes.'],
    [/ats|score|knockout|reject|qualified|chance|odds/, 'The ATS runs knockouts first (work authorization, clearance, years, degree, licenses, languages, seniority, must-have coverage) — any knockout is an automatic rejection. Then it ranks you on skills, experience, title, keywords, education and resume quality. Open an application\'s **ATS report** tab for the breakdown and fixes.'],
    [/sync|iphone|mac|device|phone|install|backup|move|transfer/, CB.standalone ? 'This copy keeps your data on this device, with no account needed. To move it, use **Reports & Export → Backup (.json)** here, then **Restore backup** on the other device (AirDrop or iCloud Drive works well). On iPhone, open the app\'s web address in Safari → Share → **Add to Home Screen**.' : 'Your data syncs through your claude.ai account, so the same tracker shows on your iPhone and MacBook. On iPhone open the page in Safari → Share → **Add to Home Screen**.'],
    [/follow|ghost/, 'After ' + '7 days with no reply, the Action Center on the Dashboard suggests a follow-up; after 21 it suggests marking the application ghosted. Change both thresholds in **Settings → Goals & automations**.'],
    [/email|inbox|reject(ion)? email|invite/, 'Paste any recruiter email into **Inbox Parser**. It detects rejections, interview invites (with the proposed time), assessments, offers and confirmations, matches the application and updates it when you press Apply.'],
    [/undo|delete|remove/, 'Every change can be undone right after with the **Undo** button on the toast, or ⌘Z on Mac. Delete an application from the trash icon in its drawer.'],
    [/strict|brutal|harsh|standard/, '**Brutal** (default) rejects under 60, needs 45% of must-haves and 60% of the required years. **Harsh** and **Standard** relax those. Switch on the ATS Lab scoreboard or in Settings.'],
    [/shortcut|keyboard/, 'On Mac: ⌘K opens the command palette, N adds a job, 1–8 switch views, ⌘Z undoes, Esc closes panels.'],
  ];

  // ───────────────────────── helpers ─────────────────────────
  const job = (id) => { const j = S().get(String(id || '')); if (!j) throw new Error('No application with id ' + id + '. Use find_applications first.'); return j; };
  const ats = (j) => S().atsFor(j);
  const brief = (j) => { const a = ats(j); const n = UI().nextInterview(j); return { id: j.id, company: j.company, title: j.title, status: j.status, ats: a.score, verdict: a.verdict, chance: a.probability == null ? null : Math.round(a.probability * 1000) / 10 + '%', applied: j.appliedDate || null, nextInterview: n ? `${n.type} ${n.datetime}` : null, example: j.sample || undefined }; };
  const name = (j) => `${j.company} · ${j.title}`;
  function overview() {
    const jobs = S().list();
    const map = S().atsMap();
    const st = CB.Stats.compute(jobs, map);
    const acts = CB.Auto.compute(jobs, S().settings, map);
    const up = [];
    jobs.forEach((j) => (j.interviews || []).forEach((iv) => { if (iv.outcome === 'Scheduled' && iv.datetime >= CB.todayISO()) up.push({ id: j.id, company: j.company, type: iv.type, datetime: iv.datetime, interviewId: iv.id }); }));
    up.sort((a, b) => a.datetime.localeCompare(b.datetime));
    const p = S().profile();
    return {
      totals: { tracked: st.total, applied: st.applied, active: st.active, responseRate: CB.pct(st.responseRate), interviewRate: CB.pct(st.interviewRate), offers: st.offers, avgAts: st.avgAts == null ? null : Math.round(st.avgAts), thisWeek: st.thisWeek, weeklyGoal: +S().settings.weeklyGoal, streakDays: st.streak, expectedInterviews: +st.expectedInterviews.toFixed(1) },
      byStatus: st.byStage, verdicts: st.verdicts,
      resume: S().resume ? { file: S().resume.fileName, example: !!S().resume.sample, years: p && p.totalYears, skills: p && p.skills.size } : null,
      examplesLoaded: jobs.filter((j) => j.sample).length,
      actionsDue: acts.slice(0, 10).map((a) => ({ id: a.jobId, what: a.title, job: a.detail, kind: a.kind })),
      upcomingInterviews: up.slice(0, 6),
      strictness: S().settings.strictness,
    };
  }
  function findJobs(query, status) {
    let jobs = S().list();
    if (status) jobs = jobs.filter((j) => j.status === status);
    const q = String(query || '').toLowerCase().trim();
    if (!q) return jobs;
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    return jobs.map((j) => {
      const hay = `${j.company} ${j.title} ${j.location} ${j.source}`.toLowerCase();
      let s = 0;
      if (j.company.toLowerCase() === q) s += 100;
      if (hay.includes(q)) s += 40;
      words.forEach((w) => { if (j.company.toLowerCase().includes(w)) s += 12; else if (hay.includes(w)) s += 4; });
      return { j, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.j);
  }

  // Action lines rendered inside Cal's current message
  function act(text, opts = {}) {
    const m = A.cur;
    if (!m) return;
    m.acts.push({ text, jobId: opts.jobId || null, undo: !!opts.undo, tab: opts.tab || null });
    renderLog();
  }

  // ───────────────────────── tools for Claude ─────────────────────────
  function tools() {
    const T = [];
    const add = (name, description, props, required, execute) => T.push({ name, description, inputSchema: { type: 'object', properties: props, required: required || [] }, execute });
    add('get_overview', 'Snapshot of the whole search: totals and rates, counts by status, resume status, action items due (follow-ups, ghosting, thank-you notes, outcomes, deadlines), upcoming interviews. Call it when asked how things are going or what to do next.', {}, [], () => overview());
    add('find_applications', 'Search tracked applications by text (company, title, location) and/or status. Returns up to 15 brief records with ids, ATS score and interview chance. Use before acting on a specific job.', { query: { type: 'string' }, status: { type: 'string', enum: STAGE_KEYS }, sort: { type: 'string', enum: ['relevance', 'ats', 'chance', 'applied', 'recent'] } }, [], (i) => {
      let r = findJobs(i.query, i.status);
      if (i.sort === 'ats') r.sort((a, b) => (ats(b).score ?? -1) - (ats(a).score ?? -1));
      if (i.sort === 'chance') r.sort((a, b) => (ats(b).probability ?? -1) - (ats(a).probability ?? -1));
      if (i.sort === 'applied') r.sort((a, b) => (b.appliedDate || '').localeCompare(a.appliedDate || ''));
      if (i.sort === 'recent') r.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return { count: r.length, results: r.slice(0, 15).map(brief) };
    });
    add('get_application', 'Full detail for one application: fields, salary, interviews (with interviewIds), contacts, last timeline events, and the ATS result (score, verdict, knockouts, missing must-haves, top fixes).', { id: { type: 'string' } }, ['id'], (i) => {
      const j = job(i.id); const a = ats(j);
      return {
        ...brief(j), location: j.location, workMode: j.workMode, source: j.source, url: j.url, salary: CB.fmtSalary(j), applicants: j.applicants, priority: j.priority, followUpDate: j.followUpDate, deadline: j.deadline, referral: j.referral,
        interviews: j.interviews.map((v) => ({ interviewId: v.id, type: v.type, datetime: v.datetime, outcome: v.outcome, interviewer: v.interviewer, thankYouSent: v.thankYouSent })),
        contacts: j.contacts.map((c) => ({ name: c.name, role: c.role, email: c.email })),
        timeline: j.timeline.slice(-6).map((t) => ({ when: t.ts.slice(0, 16), kind: t.kind, from: t.from, to: t.to, text: t.text })),
        offer: j.offer || undefined, rejectionReason: j.rejectionReason || undefined,
        atsDetail: a.score == null ? a.verdictLabel : { score: a.score, verdict: a.verdictLabel, knockouts: a.knockouts.map((k) => `${k.code} ${k.label}: ${k.detail}`), missingMustHaves: a.skills.required.filter((s) => s.status === 'missing').map((s) => s.name), listedOnly: a.skills.required.filter((s) => s.status === 'listed').map((s) => s.name), yearsRequired: a.yearsRequired, yearsOnResume: a.yearsCandidate, fixes: a.fixes.slice(0, 5).map((f) => f.text) },
        hasJobDescription: !!String(j.jd || '').trim(),
      };
    });
    add('open_in_app', 'Show something on screen: switch to a view, or open one application on a drawer tab.', { view: { type: 'string', enum: viewKeys() }, id: { type: 'string' }, tab: { type: 'string', enum: TABS } }, [], (i) => {
      if (i.id) { const j = job(i.id); setTimeout(() => { minimizeOnSmall(true); UI().openJob(j.id, i.tab || 'overview'); }, 250); act(`Opened ${name(j)}${i.tab ? ' · ' + i.tab : ''}`); return 'opened'; }
      if (i.view && viewKeys().includes(i.view)) { location.hash = i.view; minimizeOnSmall(); act(`Went to ${viewName(i.view)}`); return 'switched to ' + i.view; }
      throw new Error('Give a view or an id.');
    });
    add('create_application', 'Track a new job. Include the posting text when the user pasted it (it powers the ATS score). Status defaults to saved; use applied if they already applied (appliedDate defaults to today).', {
      company: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' }, url: { type: 'string' }, jobDescription: { type: 'string' },
      status: { type: 'string', enum: STAGE_KEYS }, source: { type: 'string', enum: CB.SOURCES }, workMode: { type: 'string', enum: CB.WORK_MODES }, salaryMin: { type: 'number' }, salaryMax: { type: 'number' }, appliedDate: { type: 'string', description: 'YYYY-MM-DD' }, referral: { type: 'boolean' },
    }, ['company', 'title'], (i) => {
      const dupe = findJobs(i.company + ' ' + i.title).find((j) => j.company.toLowerCase() === String(i.company).toLowerCase() && j.title.toLowerCase() === String(i.title).toLowerCase());
      if (dupe) return { duplicate: true, existing: brief(dupe), note: 'Already tracked — not created.' };
      const u = CB.ATS.parseJobUrl(i.url || '');
      let post = null;
      if (i.jobDescription) post = CB.ATS.extractPosting(i.jobDescription, i.url || '');
      const status = STAGE_KEYS.includes(i.status) ? i.status : 'saved';
      const j = S().add({
        company: String(i.company), title: String(i.title), location: i.location || (post && post.location) || '', url: u.canonical || i.url || '', linkedinJobId: u.isLinkedIn ? u.jobId : '',
        jd: post ? post.jd : '', source: i.source || (u.isLinkedIn ? 'LinkedIn' : u.vendor && u.vendor !== 'Company site' ? (CB.SOURCES.includes(u.vendor) ? u.vendor : 'Company site') : 'Other'),
        workMode: i.workMode || (post && post.workMode) || '', salaryMin: i.salaryMin ?? (post && post.salary ? post.salary.min : null), salaryMax: i.salaryMax ?? (post && post.salary ? post.salary.max : null),
        applicants: post && post.applicants ? post.applicants.n : null, referral: !!i.referral,
        status, appliedDate: CB.STAGE[status].order >= 1 ? i.appliedDate || CB.todayISO() : '', followUpDate: status === 'applied' ? CB.addDays(i.appliedDate || CB.todayISO(), +S().settings.followUpDays || 7) : '',
      }, { log: 'Added by Cal' });
      const a = ats(j);
      act(`Added ${name(j)} as ${CB.STAGE[status].label}${a.score != null ? ` · ATS ${a.score}` : ''}`, { jobId: j.id, undo: true, tab: a.score != null ? 'ats' : 'overview' });
      return { created: brief(j), atsKnockouts: a.knockouts.map((k) => k.code + ' ' + k.label) };
    });
    add('update_application', 'Change fields on an application (not status — use move_application). Allowed keys in fields: company, title, location, url, workMode, source, priority (High|Medium|Low), salaryMin, salaryMax, appliedDate, followUpDate, deadline, applicants, referral, referrerName, excitement (0-5), jobDescription, notesAppend (text appended to notes).', { id: { type: 'string' }, fields: { type: 'object' } }, ['id', 'fields'], (i) => {
      const j = job(i.id);
      const ok = ['company', 'title', 'location', 'url', 'workMode', 'source', 'priority', 'salaryMin', 'salaryMax', 'appliedDate', 'followUpDate', 'deadline', 'applicants', 'referral', 'referrerName', 'excitement'];
      const f = i.fields || {};
      const changed = [];
      S().update(j.id, (x) => {
        for (const k of Object.keys(f)) {
          if (ok.includes(k)) { x[k] = f[k]; changed.push(k); }
          else if (k === 'jobDescription') { x.jd = String(f[k]); changed.push('job description'); }
          else if (k === 'notesAppend') { x.notes = (x.notes || '') + `<p>${E(f[k])}</p>`; changed.push('notes'); }
        }
      }, { undoLabel: 'Cal edit' });
      if (!changed.length) throw new Error('No allowed fields given.');
      act(`Updated ${changed.join(', ')} on ${name(j)}`, { jobId: j.id, undo: true });
      return { updated: changed };
    });
    add('move_application', 'Change pipeline status using the app rules (applied/response dates, timeline). For rejected, pass a reason.', { id: { type: 'string' }, status: { type: 'string', enum: STAGE_KEYS }, reason: { type: 'string', enum: CB.REJECTION_REASONS }, note: { type: 'string' } }, ['id', 'status'], (i) => {
      const j = job(i.id);
      if (j.status === i.status) return 'already ' + i.status;
      S().move(j.id, i.status, { reason: i.reason || (i.status === 'rejected' ? 'No reason given' : ''), note: i.note || 'By Cal' });
      act(`Moved ${name(j)}: ${CB.STAGE[j.status].label} → ${CB.STAGE[i.status].label}`, { jobId: j.id, undo: true });
      return { from: j.status, to: i.status };
    });
    add('schedule_interview', 'Book an interview on an application; it appears on the calendar and in reminders, and the status advances when appropriate. datetime is the user\'s local time as YYYY-MM-DDTHH:mm.', { id: { type: 'string' }, type: { type: 'string', enum: CB.INTERVIEW_TYPES }, datetime: { type: 'string' }, durationMin: { type: 'number' }, interviewer: { type: 'string' }, link: { type: 'string' } }, ['id', 'type', 'datetime'], (i) => scheduleInterview(job(i.id), i));
    add('update_interview', 'Record an interview outcome, reschedule it, add notes or mark the thank-you note sent.', { id: { type: 'string' }, interviewId: { type: 'string' }, outcome: { type: 'string', enum: CB.INTERVIEW_OUTCOMES }, datetime: { type: 'string' }, thankYouSent: { type: 'boolean' }, notes: { type: 'string' } }, ['id', 'interviewId'], (i) => {
      const j = job(i.id);
      if (!j.interviews.find((v) => v.id === i.interviewId)) throw new Error('Interview not found; call get_application for interview ids.');
      S().update(j.id, (x) => {
        const v = x.interviews.find((y) => y.id === i.interviewId);
        if (i.outcome) v.outcome = i.outcome;
        if (i.datetime) v.datetime = i.datetime;
        if (i.thankYouSent != null) v.thankYouSent = !!i.thankYouSent;
        if (i.notes) v.notes = (v.notes ? v.notes + '\n' : '') + i.notes;
        x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'interview', text: `${v.type}: ${[i.outcome, i.datetime && 'rescheduled to ' + CB.fmtDateTime(i.datetime), i.thankYouSent && 'thank-you sent'].filter(Boolean).join(', ') || 'updated'}` });
      }, { undoLabel: 'Interview' });
      act(`Updated interview on ${name(j)}`, { jobId: j.id, undo: true, tab: 'interviews' });
      return 'ok';
    });
    add('log_activity', 'Add to an application timeline: a note, a follow-up you sent (also resets the follow-up reminder), or an email received.', { id: { type: 'string' }, kind: { type: 'string', enum: ['note', 'followup', 'email'] }, text: { type: 'string' } }, ['id', 'kind'], (i) => {
      const j = job(i.id);
      S().update(j.id, (x) => {
        x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: i.kind, text: i.text || (i.kind === 'followup' ? 'Followed up with the recruiter' : '') });
        if (i.kind === 'followup') x.followUpDate = CB.addDays(CB.todayISO(), +S().settings.followUpDays || 7);
      }, { undoLabel: 'Log' });
      act(`${i.kind === 'followup' ? 'Logged a follow-up' : i.kind === 'email' ? 'Logged an email' : 'Added a note'} on ${name(j)}`, { jobId: j.id, undo: true, tab: 'timeline' });
      return 'logged';
    });
    add('add_contact', 'Save a person (recruiter, hiring manager, referrer, interviewer) on an application.', { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', enum: ['Recruiter', 'Hiring manager', 'Referrer', 'Interviewer', 'Team member', 'Other'] }, email: { type: 'string' }, phone: { type: 'string' }, linkedin: { type: 'string' }, notes: { type: 'string' } }, ['id', 'name'], (i) => {
      const j = job(i.id);
      S().update(j.id, (x) => { x.contacts.push({ id: CB.uid('c_'), name: i.name, role: i.role || 'Other', email: i.email || '', phone: i.phone || '', linkedin: i.linkedin || '', notes: i.notes || '' }); }, { undoLabel: 'Contact' });
      act(`Saved ${i.name} on ${name(j)}`, { jobId: j.id, undo: true, tab: 'contacts' });
      return 'saved';
    });
    add('set_reminder', 'Set the follow-up date (shows on the calendar and in the Action Center) or the apply-by deadline for an application.', { id: { type: 'string' }, kind: { type: 'string', enum: ['followup', 'deadline'] }, date: { type: 'string', description: 'YYYY-MM-DD' } }, ['id', 'kind', 'date'], (i) => {
      const j = job(i.id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new Error('date must be YYYY-MM-DD');
      S().update(j.id, (x) => { if (i.kind === 'deadline') x.deadline = i.date; else x.followUpDate = i.date; }, { undoLabel: 'Reminder' });
      act(`${i.kind === 'deadline' ? 'Apply-by deadline' : 'Follow-up reminder'} set for ${CB.fmtDate(i.date, true)} · ${name(j)}`, { jobId: j.id, undo: true });
      return 'set';
    });
    add('export_file', 'Create a file for the user to save (they confirm the download): xlsx workbook, docx_report, csv, json_backup, or for one application a docx dossier or cover_letter.', { format: { type: 'string', enum: ['xlsx', 'docx_report', 'csv', 'json_backup', 'dossier', 'cover_letter'] }, id: { type: 'string' } }, ['format'], (i) => exportFile(i.format, i.id));
    add('update_settings', 'Change preferences. Keys: strictness (brutal|harsh|standard), weeklyGoal, followUpDays, ghostDays, needsSponsorship, hasClearance, remoteOnly, willingToRelocate, homeLocation, yearsOverride, theme (system|light|dark).', { settings: { type: 'object' } }, ['settings'], (i) => {
      const s = { ...(i.settings || {}) };
      if (s.theme) { UI().setTheme(['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system'); delete s.theme; }
      const allowed = Object.keys(CB.Store.DEFAULT_SETTINGS);
      const patch = Object.fromEntries(Object.entries(s).filter(([k]) => allowed.includes(k)));
      if (patch.strictness && !CB.ATS.STRICT[patch.strictness]) delete patch.strictness;
      if (Object.keys(patch).length) S().setSettings(patch);
      act(`Settings updated: ${Object.keys(i.settings || {}).join(', ')}`);
      return 'saved';
    });
    add('open_add_job_form', 'Open the Add application form prefilled with a link and/or posting text, so the user sees the live ATS verdict before saving. Use when the user shares a LinkedIn link without the posting text.', { url: { type: 'string' }, jobDescription: { type: 'string' } }, [], (i) => {
      setTimeout(() => { minimizeOnSmall(true); UI().addJob({ url: i.url || '', jd: i.jobDescription || '' }); }, 250);
      act('Opened the Add application form');
      return 'opened — the user finishes it there';
    });
    add('delete_application', 'Ask the user to confirm deleting an application in a dialog. Nothing is deleted unless they confirm. Only when the user explicitly asks to delete.', { id: { type: 'string' } }, ['id'], async (i) => {
      const j = job(i.id);
      const ok = await UI().confirm({ title: 'Delete application?', text: `Cal wants to delete ${name(j)}. Its interviews, contacts and notes go with it.`, ok: 'Delete', danger: true });
      if (!ok) return 'user cancelled';
      S().remove(j.id);
      act(`Deleted ${name(j)}`, { undo: true });
      return 'deleted';
    });
    // Registered tools come after the built-ins; the viewer's tool limit applies to the whole list.
    const names = new Set(T.map((t) => t.name));
    EXT_TOOLS.forEach((t) => {
      if (names.has(t.name)) return;
      names.add(t.name);
      T.push({
        name: t.name, description: t.description, inputSchema: t.inputSchema,
        execute: async (inp, ctx) => {
          try { return await t.execute(inp || {}, ctx); }
          catch (e) { CB.reportError(e, { where: 'cal:tool:' + t.name, silent: true }); throw e instanceof Error ? e : new Error(String((e && e.message) || e)); }
        },
      });
    });
    return T.slice(0, A.maxTools);
  }

  function scheduleInterview(j, i) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(i.datetime || ''))) throw new Error('datetime must be YYYY-MM-DDTHH:mm');
    const type = CB.INTERVIEW_TYPES.includes(i.type) ? i.type : 'Technical screen';
    S().update(j.id, (x) => {
      x.interviews.push({ id: CB.uid('i_'), round: x.interviews.length + 1, type, datetime: i.datetime, durationMin: +i.durationMin || (type === 'Panel / Onsite' ? 240 : 45), interviewer: i.interviewer || '', link: i.link || '', outcome: 'Scheduled', notes: '', thankYouSent: false });
      x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'interview', text: `${type} scheduled for ${CB.fmtDateTime(i.datetime)} (by Cal)` });
    }, { undoLabel: 'Interview' });
    const target = /recruiter/i.test(type) ? 'screen' : /panel|onsite|executive/i.test(type) ? 'final' : /take-home/i.test(type) ? 'assessment' : 'interview';
    const cur = S().get(j.id);
    let moved = '';
    if (CB.STAGE[target].order > CB.STAGE[cur.status].order || CB.STAGE[cur.status].order < 0) { S().move(j.id, target, { note: 'Interview scheduled', auto: true }); moved = ` · moved to ${CB.STAGE[target].label}`; }
    act(`Booked ${type} with ${j.company} · ${CB.fmtDateTime(i.datetime)}${moved}`, { jobId: j.id, undo: true, tab: 'interviews' });
    CB.emit('cal:react', { state: 'happy' });
    return { booked: type, when: i.datetime, statusNow: S().get(j.id).status };
  }

  function exportFile(format, id) {
    const data = () => ({ jobs: S().list(), atsById: S().atsMap(), stats: CB.Stats.compute(S().list(), S().atsMap()), resumeName: S().resume && S().resume.fileName });
    const labels = { xlsx: 'Excel workbook', docx_report: 'Word report', csv: 'CSV', json_backup: 'Backup', dossier: 'Dossier', cover_letter: 'Cover letter' };
    let p;
    if (format === 'xlsx') p = CB.IO.exportExcel(data());
    else if (format === 'docx_report') p = CB.IO.exportReportDocx(data());
    else if (format === 'csv') p = CB.IO.exportCSV(data());
    else if (format === 'json_backup') p = CB.IO.exportJSON({ jobs: S().list(), resume: S().resume, settings: S().settings });
    else if (format === 'dossier') { const j = job(id); p = CB.IO.exportJobDossierDocx(j, ats(j), S().resume && S().resume.fileName); }
    else if (format === 'cover_letter') {
      const j = job(id);
      if (!j.coverLetter) throw new Error('No cover letter drafted yet. Open the Notes & docs tab to draft one.');
      const s = S().settings; const pr = S().profile();
      p = CB.IO.exportCoverLetterDocx({ job: j, text: j.coverLetter, candidateName: s.candidateName || (pr && pr.name) || '', candidateEmail: s.candidateEmail || (pr && pr.contact.email) || '', candidatePhone: s.candidatePhone || (pr && pr.contact.phone) || '' });
    } else throw new Error('Unknown format');
    UI().save(p, `${labels[format]} ready`);
    act(`Prepared the ${labels[format]} — confirm the download when asked`);
    return 'file offered to the user';
  }

  // ───────────────────────── Claude brain ─────────────────────────
  function rules() {
    const now = new Date();
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'local time';
    return `You are Cal, the mascot and built-in assistant of Callback, the user's personal job-search tracker. You operate the app for them with the tools provided — you can find, create, update and move applications, book and update interviews, log follow-ups and notes, add contacts, set reminders, export Excel/Word/CSV files, change settings and open any view.

Now: ${now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${tz}). Today's date is ${CB.todayISO()}.

Rules:
- Act, don't just describe: when asked to add/book/schedule/move/log/remind/export/open something, call the tools and then confirm in one sentence what you did.
- Look up ids with find_applications (or the snapshot below) before acting on a specific job. If several match, ask which one in one short question.
- Never invent applications, people, dates or numbers. If something essential is missing (e.g. the interview time), ask for just that.
- Resolve relative dates ("tomorrow at 2", "next Tuesday morning") yourself against today; morning = 09:00, afternoon = 14:00, evening = 18:00.
- Deleting only through delete_application, and only when the user explicitly asks.
- The app cannot read LinkedIn pages by link. For a LinkedIn link without the posting text, call open_add_job_form with the url and tell them to paste the posting text there.
- Be honest and direct about weak odds; the ATS is deliberately brutal. Give the single most useful next step.
- Replies: short (1–4 sentences, or a tight list), plain language, no emoji, Markdown bold for names of buttons/views. "How do I…" questions: give the exact steps in this app.
- Items marked example are fictional sample data the user can clear on the Dashboard.

How the app works:
${GUIDE}${extViews().length ? '\nMore views: ' + extViews().map((v) => `${v.label} (open_in_app view "${v.key}")${v.crumb ? ' — ' + v.crumb : ''}`).join(' · ') : ''}

Current snapshot (JSON):
${JSON.stringify(overview())}`;
  }

  async function claudeBrain(text, sample) {
    if (A.toolsOk === null) {
      try { const lim = await sample.limits(); A.toolsOk = !!(lim && lim.tools); A.maxTools = lim && lim.tools ? Math.max(4, lim.tools.maxCount || 16) : 0; }
      catch (e) { A.toolsOk = false; }
    }
    A.turns.push({ role: 'user', content: text });
    if (A.turns.length > 16) A.turns = A.turns.slice(-16);
    while (A.turns.length && A.turns[0].role !== 'user') A.turns.shift();
    const input = [{ role: 'user', content: rules() }, ...A.turns];
    A.ctl = new AbortController();
    const m = A.cur;
    const opts = {
      modelTier: 'quick', cache: false, signal: A.ctl.signal,
      onText: ({ text: t }) => { m.text = t; m.thinking = false; setMascot('talking'); renderLog(); },
    };
    if (A.toolsOk) {
      delete opts.cache;
      opts.tools = tools().map((t) => ({ ...t, execute: async (inp, ctx) => { setMascot('thinking'); setStatus('Working: ' + t.name.replace(/_/g, ' ') + '…'); const r = await t.execute(inp || {}, ctx); return r; } }));
    }
    const r = await sample(input, opts);
    A.turns.push({ role: 'assistant', content: r.text });
    m.text = r.text;
    m.thinking = false;
    return r.text;
  }

  // ───────────────────────── local brain ─────────────────────────
  const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  /** Natural-language date/time → {date:'YYYY-MM-DD', time:'HH:mm', hasDate, hasTime} */
  function parseWhen(s) {
    const t = ' ' + s.toLowerCase() + ' ';
    const now = new Date();
    let d = null, hasDate = true;
    let m;
    if (/\bday after tomorrow\b/.test(t)) { d = new Date(now); d.setDate(d.getDate() + 2); }
    else if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(t)) { d = new Date(now); d.setDate(d.getDate() + 1); }
    else if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(t)) d = new Date(now);
    else if ((m = /\bin (\d{1,2}) (day|days|week|weeks)\b/.exec(t))) { d = new Date(now); d.setDate(d.getDate() + +m[1] * (m[2].startsWith('week') ? 7 : 1)); }
    else if ((m = /\b(next |this |on )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|sday|urday)?\b/.exec(t))) {
      const idx = DOW.findIndex((x) => x.startsWith(m[2].slice(0, 3)));
      d = new Date(now);
      let add = (idx - d.getDay() + 7) % 7;
      if (add === 0) add = 7;
      if (m[1] && m[1].trim() === 'next' && add < 7 && (idx - now.getDay() + 7) % 7 !== 0) { /* "next friday" = the coming friday unless it's tomorrow-ish; keep coming one */ }
      d.setDate(d.getDate() + add);
    }
    else if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(st|nd|rd|th)?(,? (\d{4}))?\b/.exec(t)) || (m = /\b(\d{1,2})(st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(t))) {
      const mon = isNaN(+m[1]) ? MON.indexOf(m[1].slice(0, 3)) : MON.indexOf(m[3].slice(0, 3));
      const day = isNaN(+m[1]) ? +m[2] : +m[1];
      const yr = isNaN(+m[1]) && m[5] ? +m[5] : now.getFullYear();
      d = new Date(yr, mon, day);
      if (!m[5] && d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(d.getFullYear() + 1);
    }
    else if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) d = new Date(+m[1], +m[2] - 1, +m[3]);
    else if ((m = /\b(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?\b/.exec(t))) { d = new Date(m[4] ? (+m[4] < 100 ? 2000 + +m[4] : +m[4]) : now.getFullYear(), +m[1] - 1, +m[2]); if (!m[4] && d < now) d.setFullYear(d.getFullYear() + 1); }
    else { hasDate = false; }
    let hh = 10, mm = 0, hasTime = true;
    if ((m = /\b(\d{1,2})(:(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)\b/.exec(t))) { hh = +m[1] % 12 + (/p/.test(m[4]) ? 12 : 0); mm = m[3] ? +m[3] : 0; }
    else if ((m = /\b(at|@) (\d{1,2})(:(\d{2}))?\b/.exec(t))) { hh = +m[2]; mm = m[4] ? +m[4] : 0; if (hh >= 1 && hh <= 7) hh += 12; }
    else if ((m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t))) { hh = +m[1]; mm = +m[2]; }
    else if (/\bnoon\b/.test(t)) hh = 12;
    else if (/\bmorning\b/.test(t)) hh = 9;
    else if (/\bafternoon\b/.test(t)) hh = 14;
    else if (/\bevening\b|\btonight\b/.test(t)) hh = 18;
    else hasTime = false;
    return { date: d ? CB.toISODate(d) : '', time: `${CB.pad(hh)}:${CB.pad(mm)}`, hasDate: hasDate && !!d, hasTime };
  }
  function jobFromText(text) {
    const low = text.toLowerCase();
    let best = null, bs = 0;
    for (const j of S().list()) {
      const c = j.company.toLowerCase().replace(/,? (inc|llc|ltd)\.?$/, '');
      let s = 0;
      if (c && low.includes(c)) s = 50 + c.length;
      else { const first = c.split(/\s+/)[0]; if (first.length > 3 && new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(low)) s = 20 + first.length; }
      if (s && j.title && low.includes(j.title.toLowerCase())) s += 30;
      if (s && !CB.CLOSED.includes(j.status)) s += 2;
      if (s > bs) { bs = s; best = j; }
    }
    return best;
  }
  const STAGE_WORDS = [['recruiter screen', 'screen'], ['phone screen', 'screen'], ['screening', 'screen'], ['screen', 'screen'], ['assessment', 'assessment'], ['take home', 'assessment'], ['take-home', 'assessment'], ['final round', 'final'], ['final', 'final'], ['onsite', 'final'], ['interviewing', 'interview'], ['interview', 'interview'], ['offer', 'offer'], ['accepted', 'accepted'], ['rejected', 'rejected'], ['rejection', 'rejected'], ['ghosted', 'ghosted'], ['withdrawn', 'withdrawn'], ['withdrew', 'withdrawn'], ['applied', 'applied'], ['saved', 'saved'], ['wishlist', 'saved']];
  function ivType(t) {
    t = t.toLowerCase();
    if (/recruiter|phone screen|intro call|hr/.test(t)) return 'Recruiter screen';
    if (/system design|design round/.test(t)) return 'System design';
    if (/behavio/.test(t)) return 'Behavioral';
    if (/hiring manager|\bhm\b|manager/.test(t)) return 'Hiring manager';
    if (/onsite|on-site|panel|final|loop/.test(t)) return 'Panel / Onsite';
    if (/case/.test(t)) return 'Case study';
    if (/take[- ]?home/.test(t)) return 'Take-home review';
    if (/exec|vp|ceo|cto/.test(t)) return 'Executive';
    return 'Technical screen';
  }

  /** Registered intents first; an async handler may resolve false to fall through. */
  function runIntents(text, from = 0) {
    const m = A.cur;
    for (let i = from; i < INTENTS.length; i++) {
      const it = INTENTS[i];
      let hit = false;
      try { it.re.lastIndex = 0; hit = it.re.test(text); } catch (e) { hit = false; }
      if (!hit) continue;
      let said = false;
      const say = (x) => { said = true; if (m) { m.text = String(x == null ? '' : x); m.thinking = false; renderLog(); } };
      const actFn = (x, opts = {}) => { if (!m) return; m.acts.push({ text: String(x), jobId: opts.jobId || null, undo: !!opts.undo, tab: opts.tab || null }); renderLog(); };
      try {
        const r = it.handler(text, say, actFn);
        if (r && typeof r.then === 'function') {
          return r.then((ok) => (ok === true || (ok !== false && said) ? true : runIntents(text, i + 1)), (e) => { CB.reportError(e, { where: 'cal:intent', silent: true }); return runIntents(text, i + 1); });
        }
        if (r === true || (r !== false && said)) return true;
      } catch (e) { CB.reportError(e, { where: 'cal:intent', silent: true }); }
    }
    return false;
  }
  function localBrain(text) {
    const r = runIntents(text);
    if (r === true) return undefined;
    if (r && typeof r.then === 'function') return r.then((ok) => { if (!ok) builtinBrain(text); });
    return builtinBrain(text);
  }
  function builtinBrain(text) {
    const t = text.toLowerCase().trim();
    const say = (s) => { A.cur.text = s; };
    const j = jobFromText(text);
    const url = (text.match(/https?:\/\/\S+/) || [''])[0];
    let m;
    // how-to questions
    if (/^(how|where|what('s| is| does)|can i|why|explain)\b/.test(t) && !/\b(doing|due|next|today)\b/.test(t)) {
      const hit = FAQ.find(([re]) => re.test(t));
      if (hit) return say(hit[1]);
    }
    if (/^(help|\?|what can you do|commands|menu)\b/.test(t)) return say('I can run the whole tracker for you. Try:\n- **"What\'s due today?"**\n- **"Schedule a technical interview with Lumen Bank tomorrow at 2pm"**\n- **"Mark Kestrel Security as rejected"**\n- **"I followed up with Cobalt AI"**\n- **"Add a job"** or paste a job link\n- **"How am I doing?"** · **"Score for Northwind"**\n- **"Export to Excel"** · **"Go to calendar"**\n- **"Remind me to follow up with Quarry Data on Friday"**');
    if (url || /\b(add|track|new|save|create)\b.{0,20}\b(job|application|role|position|posting)\b/.test(t)) {
      setTimeout(() => { minimizeOnSmall(true); UI().addJob({ url }); }, 250);
      act('Opened the Add application form');
      return say(url ? 'I opened **Add application** with your link. LinkedIn won\'t let apps read its pages, so paste the posting text there too — I\'ll show the ATS verdict before you save.' : 'Opened **Add application**. Paste the job link and the posting text; the verdict appears before you save.');
    }
    if ((m = /\b(export|download|save)\b.*\b(excel|xlsx|spreadsheet|word|docx|report|csv|backup|json|dossier)\b/.exec(t))) {
      const f = /excel|xlsx|spreadsheet/.test(m[2]) ? 'xlsx' : /csv/.test(m[2]) ? 'csv' : /backup|json/.test(m[2]) ? 'json_backup' : /dossier/.test(m[2]) && j ? 'dossier' : 'docx_report';
      try { exportFile(f, j && j.id); return say('Preparing it now — confirm the download when your browser asks.'); } catch (e) { return say(e.message); }
    }
    if (/\b(schedule|book|set up|arrange|add)\b.*\b(interview|screen|call|onsite|on-site|meeting|chat|round)\b/.test(t) || /\binterview (with|at)\b.*\b(on|at|tomorrow|today|next|mon|tue|wed|thu|fri|sat|sun)\b/.test(t)) {
      if (!j) return say('Which company is the interview with? Say it like **"Schedule a recruiter screen with Lumen Bank on Friday at 11am"**.');
      const w = parseWhen(text);
      if (!w.hasDate) return say(`When is the ${j.company} interview? For example: **"tomorrow at 2pm"** or **"Dec 3 at 10:30am"**.`);
      const r = scheduleInterview(j, { type: ivType(text), datetime: `${w.date}T${w.time}` });
      return say(`Booked: **${r.booked}** with **${j.company}**, ${CB.fmtDateTime(r.when)}${w.hasTime ? '' : ' (I used 10:00 — tell me if that\'s wrong)'}. It's on your calendar, and I'll remind you about the thank-you note afterwards.`);
    }
    if ((m = /\b(remind me|reminder)\b/.exec(t)) && j) {
      const w = parseWhen(text);
      if (!w.hasDate) return say('When should I remind you? e.g. **"on Friday"** or **"in 5 days"**.');
      S().update(j.id, (x) => { x.followUpDate = w.date; }, { undoLabel: 'Reminder' });
      act(`Follow-up reminder set for ${CB.fmtDate(w.date, true)} · ${name(j)}`, { jobId: j.id, undo: true });
      return say(`Done — I'll flag **${j.company}** for follow-up on ${CB.fmtDate(w.date, true)}.`);
    }
    if (/\bfollow(ed)?[- ]?up\b/.test(t) && j && !/\b(due|need|should|who)\b/.test(t)) {
      S().update(j.id, (x) => { x.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'followup', text: 'Followed up (logged by Cal)' }); x.followUpDate = CB.addDays(CB.todayISO(), +S().settings.followUpDays || 7); }, { undoLabel: 'Follow-up' });
      act(`Logged a follow-up on ${name(j)}`, { jobId: j.id, undo: true, tab: 'timeline' });
      return say(`Logged your follow-up with **${j.company}**. Next nudge in ${S().settings.followUpDays || 7} days if they stay quiet.`);
    }
    if (/\bthank[- ]?you\b/.test(t) && j) {
      const iv = [...j.interviews].reverse().find((v) => !v.thankYouSent);
      if (!iv) return say(`No interview at ${j.company} is waiting on a thank-you note.`);
      S().update(j.id, (x) => { const v = x.interviews.find((y) => y.id === iv.id); v.thankYouSent = true; if (v.outcome === 'Scheduled') v.outcome = 'Completed'; }, { undoLabel: 'Thank-you' });
      act(`Thank-you marked sent · ${name(j)}`, { jobId: j.id, undo: true });
      return say(`Marked the thank-you for your **${iv.type}** at **${j.company}** as sent.`);
    }
    if (j && (/\b(mark|move|set|change|update|put)\b/.test(t) || /\b(i got|got|received)\b.*\b(offer|rejected|rejection|interview|screen)\b/.test(t) || /\bi (applied|withdrew)\b/.test(t) || /\b(rejected|ghosted) me\b/.test(t))) {
      const hit = STAGE_WORDS.find(([w]) => t.includes(w));
      if (hit) {
        const to = hit[1];
        if (j.status === to) return say(`**${j.company}** is already at ${CB.STAGE[to].label}.`);
        const from = j.status;
        S().move(j.id, to, { reason: to === 'rejected' ? 'No reason given' : '', note: 'By Cal' });
        act(`Moved ${name(j)}: ${CB.STAGE[from].label} → ${CB.STAGE[to].label}`, { jobId: j.id, undo: true });
        return say(to === 'rejected' ? `Moved **${j.company}** to Rejected. If they gave a reason, add it in the drawer — it sharpens your reports.` : to === 'offer' ? `An offer from **${j.company}**! Add base, bonus and equity in the Overview tab and I'll compare it with the posted range.` : `Moved **${j.company}** to **${CB.STAGE[to].label}**.`);
      }
    }
    if (/\b(what (can|should|do) i do next|what next|now what|next (moves?|steps?)|after (uploading|my resume|the resume)|what('?s| is) next after|uploaded my resume)\b/.test(t) || (/\bresume\b/.test(t) && /\b(next|now|then|after)\b/.test(t))) {
      const p = S().profile();
      if (!p) return say('First upload your resume in **ATS Lab** (PDF, Word or pasted text). Every job gets scored against it the moment it\'s in.');
      const audit = CB.ATS.auditResume(p, (S().resume && S().resume.warnings) || []);
      const ex = S().list().filter((x) => x.sample).length;
      act('Opened ATS Lab · Your next moves');
      location.hash = 'ats';
      return say(`Your resume reads as **${CB.ATS.levelLabel(p.level)}** with ${p.totalYears} years and grades **${audit.grade}** (${audit.score}/100). Here's the order I'd go in:\n${[
        ex ? `**Clear the ${ex} example jobs** (Dashboard → Clear examples) so the numbers are yours.` : '',
        audit.fails ? `**Fix ${audit.fails} resume problem${audit.fails > 1 ? 's' : ''}**: ${audit.checks.filter((c) => c.status === 'fail').map((c) => c.label).slice(0, 3).join(', ')} — the **Bullet doctor** card has rewrites.` : '',
        '**Add the jobs you want**: tap **+**, paste the LinkedIn link and the posting text. You get a verdict before you apply.',
        '**Check Skill gaps** in ATS Lab — the skills your target jobs keep asking for that your resume lacks.',
        '**Apply where you score 75+**, then log every reply on the Pipeline (or paste the email into Inbox Parser).',
      ].filter(Boolean).map((x, i) => `${i + 1}. ${x}`).join('\n')}`);
    }
    if (/\b(due|to ?do|today|pending|tasks?|actions?|what should i do|what'?s next|next steps?)\b/.test(t) && !/interview/.test(t)) {
      const o = overview();
      if (!o.actionsDue.length) return say('Nothing is due. Good moment to apply to a posting scoring 75+ — open **ATS Lab** to see your best matches.');
      return say(`Here's what needs you:\n${o.actionsDue.slice(0, 7).map((a) => `- **${a.what}** — ${a.job}`).join('\n')}\n\nSay "follow up with …", "mark … as ghosted" or "thank-you sent for …" and I'll log it.`);
    }
    if (/\binterviews?\b/.test(t) && /\b(upcoming|next|this week|scheduled|coming|when|my)\b/.test(t)) {
      const o = overview();
      if (!o.upcomingInterviews.length) return say('No interviews booked yet. Tell me when one is set, e.g. **"recruiter screen with Lumen Bank Friday 11am"**.');
      return say(`Coming up:\n${o.upcomingInterviews.map((v) => `- **${v.company}** · ${v.type} — ${CB.fmtDateTime(v.datetime)}`).join('\n')}`);
    }
    if (/\b(how am i doing|stats|statistics|summary|response rate|interview rate|progress|numbers|overview)\b/.test(t)) {
      const o = overview().totals;
      return say(`You've applied to **${o.applied}** (${o.thisWeek} this week, goal ${o.weeklyGoal}). Response rate **${o.responseRate}**, interview rate **${o.interviewRate}**, **${o.offers}** offer${o.offers === 1 ? '' : 's'}. Average ATS fit ${o.avgAts ?? '—'}; about **${o.expectedInterviews}** more interviews expected from what's active.`);
    }
    if (/\b(score|ats|chance|odds|fit|qualified|match)\b/.test(t)) {
      if (j) {
        const a = ats(j);
        if (a.score == null) return say(`${j.company}: ${a.verdictLabel}.`);
        const miss = a.skills.required.filter((s) => s.status === 'missing').map((s) => s.name).slice(0, 5);
        act(`ATS report · ${name(j)}`, { jobId: j.id, tab: 'ats' });
        return say(`**${j.company}**: fit **${a.score}/100** — ${a.verdictLabel}, interview chance ${UI().prob(a)}.${a.knockouts.length ? ` Knockout: **${a.knockouts[0].code}** ${a.knockouts[0].detail}` : ''}${miss.length ? ` Missing must-haves: ${miss.join(', ')}.` : ''}`);
      }
      const list = S().list().map((x) => ({ x, a: ats(x) })).filter((r) => r.a.score != null && CB.STAGE[r.x.status].group !== 'closed').sort((p, q) => q.a.score - p.a.score);
      if (!list.length) return say('Nothing scored yet — upload your resume in **ATS Lab** and paste job descriptions.');
      return say(`Your best open matches:\n${list.slice(0, 5).map((r) => `- **${r.x.company}** · ${r.a.score} (${r.a.verdictLabel})`).join('\n')}${list.filter((r) => r.a.verdict === 'REJECTED').length ? `\n\n${list.filter((r) => r.a.verdict === 'REJECTED').length} open applications would be auto-rejected.` : ''}`);
    }
    if ((m = /\b(dark|light)\s*(mode|theme)\b/.exec(t))) { UI().setTheme(m[1]); return say(`Switched to ${m[1]} mode.`); }
    if ((m = /\b(brutal|harsh|standard)\b/.exec(t)) && /\b(mode|strict|ats)\b/.test(t)) { S().setSettings({ strictness: m[1] }); return say(`ATS strictness is now **${m[1]}**; everything was re-scored.`); }
    const views = [...extViews().map((v) => [v.key, new RegExp('\\b' + reEsc(String(v.label).toLowerCase()) + '\\b')]), ['dashboard', /dashboard|home/], ['board', /board|pipeline|kanban/], ['sheet', /sheet|spreadsheet|grid|excel view|table/], ['calendar', /calendar|schedule view/], ['ats', /\bats\b|resume|scoreboard|ats lab/], ['inbox', /inbox|email parser|emails?/], ['reports', /reports?|analytics|export page/], ['settings', /settings|preferences/]];
    if (/\b(go to|open|show|take me|switch to|view)\b/.test(t)) {
      if (j && !/\b(dashboard|board|sheet|calendar|ats lab|inbox|reports|settings)\b/.test(t)) { setTimeout(() => { minimizeOnSmall(true); UI().openJob(j.id); }, 200); act(`Opened ${name(j)}`, { jobId: j.id }); return say(`Opening **${name(j)}**.`); }
      const v = views.find(([, re]) => re.test(t));
      if (v) { location.hash = v[0]; minimizeOnSmall(); act(`Went to ${viewName(v[0])}`); return say(`Here's **${viewName(v[0])}**.`); }
    }
    if ((m = /\b(find|search|look up|show|list)\b\s+(.+)/.exec(t))) {
      const st = STAGE_WORDS.find(([w]) => m[2].includes(w));
      const r = st && !j ? findJobs('', st[1]) : findJobs(m[2].replace(/\b(my|the|jobs?|applications?|all)\b/g, '').trim());
      if (!r.length) return say('No matching applications.');
      return say(`${r.length} match${r.length > 1 ? 'es' : ''}:\n${r.slice(0, 8).map((x) => `- **${x.company}** · ${x.title} — ${CB.STAGE[x.status].label}${ats(x).score != null ? ', ATS ' + ats(x).score : ''}`).join('\n')}`);
    }
    if (j) { act(`Opened ${name(j)}`, { jobId: j.id }); return say(`**${name(j)}** is at **${CB.STAGE[j.status].label}**${ats(j).score != null ? `, ATS ${ats(j).score}` : ''}. I can schedule an interview, log a follow-up, move it, or show the ATS report — just say which.`); }
    const hit = FAQ.find(([re]) => re.test(t));
    if (hit) return say(hit[1]);
    return say('I didn\'t catch that. Try **"what\'s due today"**, **"schedule an interview with …"**, **"mark … as rejected"**, **"export to Excel"**, or type **help**.' + (CB.App.ai || CB.standalone ? '' : '\n\n_Full conversation needs this page open inside claude.ai; my built-in commands work everywhere._'));
  }

  // ───────────────────────── UI ─────────────────────────
  function setMascot(s, ms) { if (A.mascot) A.mascot.setState(s, ms); }
  function setStatus(s) { const el = $('#cal-status'); if (el) el.textContent = s; }
  const isSmall = () => window.innerWidth <= 560;
  function minimizeOnSmall(always) { if (isSmall() || always === true && window.innerWidth <= 900) close(); }

  function mount() {
    if ($('#cal')) return;
    let hidden = false;
    try { hidden = localStorage.getItem(LS + '.hidden') === '1'; } catch (e) { /* noop */ }
    const root = document.createElement('div');
    root.id = 'cal';
    root.className = 'calbot';
    root.hidden = hidden;
    root.innerHTML = `
      <div class="cal-bubble" id="cal-bubble" hidden role="status"></div>
      <button type="button" class="cal-dock" id="cal-dock" aria-label="Open Cal, your assistant" title="Cal — your Callback assistant"><span class="cal-dock-stage" id="cal-dock-stage"></span><span class="cal-badge" id="cal-badge" hidden></span></button>
      <section class="cal-panel" id="cal-panel" hidden role="dialog" aria-label="Cal assistant">
        <header class="cal-head">
          <div class="cal-stage" id="cal-stage"></div>
          <div class="cal-id"><b>Cal</b><span id="cal-status">Your Callback co-pilot</span></div>
          <div class="cal-head-actions">
            <button type="button" class="btn btn-ghost btn-icon" id="cal-voice" hidden title="Speak replies" aria-label="Speak replies" aria-pressed="false">${UI().icon('mute')}</button>
            <button type="button" class="btn btn-ghost btn-icon" id="cal-clear" title="New conversation" aria-label="New conversation">${UI().icon('trash')}</button>
            <button type="button" class="btn btn-ghost btn-icon" id="cal-close" title="Close" aria-label="Close">${UI().icon('x')}</button>
          </div>
        </header>
        <div class="cal-log" id="cal-log" aria-live="polite"></div>
        <div class="cal-chips" id="cal-chips"></div>
        <form class="cal-input" id="cal-form" autocomplete="off">
          <textarea class="input" id="cal-q" rows="1" placeholder="Ask Cal or tell it what to do…" aria-label="Message Cal"></textarea>
          <button type="button" class="btn btn-icon" id="cal-mic" hidden title="Talk to Cal" aria-label="Dictate">${UI().icon('mic')}</button>
          <button type="submit" class="btn btn-primary btn-icon" id="cal-send" aria-label="Send">${UI().icon('send')}</button>
        </form>
        <div class="cal-foot" id="cal-foot"></div>
      </section>`;
    document.body.appendChild(root);
    A.host = document.createElement('div');
    A.host.className = 'cal-host';
    $('#cal-dock-stage').appendChild(A.host);
    try { A.mascot = CB.Mascot.create(A.host, { onClick: () => { if (A.open) setMascot('happy', 1400); } }); } catch (e) { CB.reportError(e, { where: 'cal:mascot', silent: true, log: !!CB.Mascot }); }
    $('#cal-dock').onclick = () => (A.open ? close() : openPanel());
    $('#cal-close').onclick = close;
    $('#cal-clear').onclick = () => { if (A.ctl) A.ctl.abort(); A.turns = []; A.log = []; saveLog(); greet(); };
    $('#cal-form').onsubmit = (e) => { e.preventDefault(); send($('#cal-q').value); };
    const q = $('#cal-q');
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(q.value); } else if (e.key === 'Escape') close(); });
    q.addEventListener('input', () => { q.style.height = 'auto'; q.style.height = Math.min(120, q.scrollHeight) + 'px'; if (q.value) setMascot('listening'); else setMascot('idle'); });
    q.addEventListener('focus', () => setMascot('listening'));
    q.addEventListener('blur', () => { if (!A.busy) setMascot('idle'); });
    try { A.log = JSON.parse(localStorage.getItem(LS) || '[]').slice(-40); A.turns = A.log.filter((m) => m.text && !m.local).map((m) => ({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text })).slice(-12); } catch (e) { A.log = []; }
    voiceSetup();
    CB.on('moved', (d) => react(d));
    CB.on('resume:uploaded', (d) => setTimeout(() => { setMascot('happy', 2400); bubble(`Resume graded <b>${E(d.grade.grade)}</b> (${d.grade.score}/100). Next: add the jobs you're targeting — tap me and say <b>"what next?"</b>`, 9000); }, 5200));
    CB.on('cal:react', (d) => setMascot(d.state, 1600));
    CB.on('data', CB.debounce(nudge, 1500));
    setTimeout(nudge, 2500);
  }

  async function voiceSetup() {
    const [tts, dict] = await Promise.all([CB.cap('tts'), CB.cap('dictation')]);
    if (tts) {
      A.tts = tts;
      const b = $('#cal-voice');
      b.hidden = false;
      try { A.voice = localStorage.getItem(LS + '.voice') === '1'; } catch (e) { /* noop */ }
      b.setAttribute('aria-pressed', String(A.voice));
      b.innerHTML = UI().icon(A.voice ? 'speaker' : 'mute');
      b.onclick = () => { A.voice = !A.voice; b.setAttribute('aria-pressed', String(A.voice)); b.innerHTML = UI().icon(A.voice ? 'speaker' : 'mute'); try { localStorage.setItem(LS + '.voice', A.voice ? '1' : '0'); } catch (e) { /* noop */ } if (!A.voice) tts.stop().catch(() => {}); };
      try { tts.onState(({ state }) => { if (state === 'speaking') setMascot('talking'); else if (state === 'idle' && !A.busy) setMascot('idle'); }); } catch (e) { /* noop */ }
    }
    if (dict) {
      A.dict = dict;
      const mic = $('#cal-mic');
      mic.hidden = false;
      const q = $('#cal-q');
      let base = '';
      try {
        dict.onPartial(({ text }) => { q.value = (base + ' ' + text).trim(); });
        dict.onFinal(({ text }) => { base = (base + ' ' + text).trim(); q.value = base; });
        dict.onState(({ state }) => { mic.classList.toggle('btn-accent', state === 'listening'); if (state === 'listening') setMascot('listening'); if (state === 'idle' && base) { const v = base; base = ''; send(v); } });
      } catch (e) { /* noop */ }
      mic.onclick = () => {
        if (dict.active && dict.active()) { dict.stop().catch(() => {}); return; }
        base = q.value;
        dict.start().catch((e) => { if (e && e.code === 'not_granted') mic.hidden = true; });
      };
    }
  }

  function openPanel(prefill) {
    A.open = true;
    $('#cal-panel').hidden = false;
    $('#cal-dock').hidden = true;
    $('#cal-bubble').hidden = true;
    $('#cal-badge').hidden = true;
    $('#cal-stage').appendChild(A.host);
    if (!A.log.length) greet();
    renderLog();
    renderChips();
    renderFoot();
    setMascot('wave', 1600);
    const q = $('#cal-q');
    if (prefill) q.value = prefill;
    if (!isSmall()) setTimeout(() => q.focus(), 60);
  }
  function close() {
    if (!A.open) return;
    A.open = false;
    $('#cal-panel').hidden = true;
    $('#cal-dock').hidden = false;
    $('#cal-dock-stage').appendChild(A.host);
    setMascot('idle');
  }
  function greet() {
    const o = S().ready ? overview() : null;
    const due = o ? o.actionsDue.length : 0;
    const up = o ? o.upcomingInterviews[0] : null;
    A.log.push({ who: 'cal', local: true, text: `Hi, I'm **Cal**. I know every corner of Callback and can do the busywork for you — book interviews, move applications, log follow-ups, set reminders, export to Excel or Word, and tell you honestly where you stand.${due ? `\n\nRight now **${due} thing${due > 1 ? 's need' : ' needs'} you**${up ? `, and your next interview is **${up.company} · ${up.type}** on ${CB.fmtDateTime(up.datetime)}` : ''}.` : ''}`, acts: [] });
    renderLog();
  }
  function renderChips() {
    const o = S().ready ? overview() : null;
    const chips = [];
    if (o && o.actionsDue.length) chips.push("What's due today?");
    if (o && o.upcomingInterviews.length) chips.push('My upcoming interviews');
    chips.push('What next after my resume?', 'Schedule an interview', 'How am I doing?', 'Which jobs should I focus on?', 'Add a job from a link', 'Export to Excel', 'How does the ATS score work?', 'How do I add a LinkedIn job?');
    $('#cal-chips').innerHTML = chips.map((c) => `<button type="button" data-chip="${E(c)}">${E(c)}</button>`).join('');
    document.querySelectorAll('#cal-chips [data-chip]').forEach((b) => (b.onclick = () => {
      const c = b.dataset.chip;
      if (c === 'Schedule an interview' && !CB.App.ai) { const q = $('#cal-q'); q.value = 'Schedule a technical interview with '; q.focus(); return; }
      if (c === 'Add a job from a link') { send('Add a job'); return; }
      send(c);
    }));
  }
  function renderFoot() {
    $('#cal-foot').innerHTML = CB.App.ai ? 'Powered by Claude on your account · Cal acts only inside your tracker and every change can be undone.' : (CB.standalone ? 'Runs fully on this device · type **help** to see everything I can do.' : 'Built-in commands active. Open this page inside claude.ai for full conversation.');
  }
  function renderLog() {
    const el = $('#cal-log');
    if (!el) return;
    el.innerHTML = A.log.map((m, i) => m.who === 'me'
      ? `<div class="msg me">${E(m.text)}</div>`
      : `<div class="msg bot">${m.thinking && !m.text ? '<span class="thinking">Cal is on it…</span>' : `<div class="ai-out">${CB.AI.md(m.text || '')}</div>`}${(m.acts || []).length ? `<div class="msg-acts">${m.acts.map((a, k) => `<div class="msg-act"><span class="ok">✓</span><span>${E(a.text)}</span>${a.jobId && S().get(a.jobId) ? `<button type="button" class="btn btn-sm" data-open="${i}:${k}">Open</button>` : ''}${a.undo && i === A.log.length - 1 ? `<button type="button" class="btn btn-sm" data-undo="${i}:${k}">Undo</button>` : ''}</div>`).join('')}</div>` : ''}</div>`).join('');
    el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { const [i, k] = b.dataset.open.split(':').map(Number); const a = A.log[i].acts[k]; minimizeOnSmall(true); UI().openJob(a.jobId, a.tab || 'overview'); }));
    el.querySelectorAll('[data-undo]').forEach((b) => (b.onclick = () => { const u = S().undo(); b.disabled = true; b.textContent = u ? 'Undone' : 'Nothing to undo'; }));
    el.scrollTop = el.scrollHeight;
  }
  function saveLog() { try { localStorage.setItem(LS, JSON.stringify(A.log.slice(-40).map((m) => ({ who: m.who, text: m.text, local: m.local, acts: (m.acts || []).map((a) => ({ text: a.text, jobId: a.jobId, tab: a.tab })) })))); } catch (e) { /* noop */ } }

  async function send(raw) {
    const text = String(raw || '').trim();
    if (!text || A.busy) return;
    if (!A.open) openPanel();
    $('#cal-q').value = '';
    $('#cal-q').style.height = 'auto';
    A.log.push({ who: 'me', text });
    A.cur = { who: 'cal', text: '', thinking: true, acts: [] };
    A.log.push(A.cur);
    renderLog();
    A.busy = true;
    setMascot('thinking');
    setStatus('Thinking…');
    let sample = null;
    try { sample = CB.App && CB.App.ai && CB.AI ? await CB.AI.get() : null; } catch (e) { sample = null; }
    try {
      if (sample) {
        try { await claudeBrain(text, sample); }
        catch (e) {
          if (e && e.code === 'cancelled') { A.cur.text = A.cur.text || '_Stopped._'; }
          else {
            const msg = CB.AI.errText(e);
            await localBrain(text);
            A.cur.local = true;
            if (msg) A.cur.text += `\n\n_(${msg} I handled this with my built-in commands.)_`;
          }
        }
      } else { await localBrain(text); A.cur.local = true; }
    } catch (e) {
      CB.reportError(e, { where: 'cal', silent: true });
      A.cur.text = 'Something went wrong on my side: ' + (e.message || 'unknown error') + '.';
      setMascot('concerned', 2000);
    }
    A.cur.thinking = false;
    A.busy = false;
    setStatus('Your Callback co-pilot');
    renderLog();
    saveLog();
    renderChips();
    const happy = A.cur.acts.length > 0;
    setMascot(happy ? 'happy' : 'idle', happy ? 1600 : 0);
    if (A.voice && A.tts && A.cur.text) {
      const plain = A.cur.text.replace(/[*_`#>]/g, '').replace(/\n+/g, '. ').slice(0, 1900);
      A.tts.speak(plain, { voice: 'airy' }).catch(() => {});
    }
  }

  // Reactions + proactive nudges
  function bubble(text, ms = 6000) {
    if (A.open) return;
    const b = $('#cal-bubble');
    b.innerHTML = text;
    b.hidden = false;
    b.onclick = () => openPanel();
    clearTimeout(A.bt);
    A.bt = setTimeout(() => (b.hidden = true), ms);
    if (!A.bubbleWired) {
      A.bubbleWired = true;
      const hide = (e) => { const bb = $('#cal-bubble'); if (!bb || bb.hidden) return; if (e && e.target && e.target.closest && e.target.closest('.calbot')) return; bb.hidden = true; clearTimeout(A.bt); };
      document.addEventListener('pointerdown', hide, true);
      window.addEventListener('hashchange', () => hide(null));
    }
  }
  function react(d) {
    const j = S().get(d.id);
    if (!j) return;
    if (d.to === 'offer' || d.to === 'accepted') { setMascot('happy', 3000); bubble(`<b>${E(j.company)}</b> — ${d.to === 'offer' ? 'an offer! Want me to compare it with the posted range?' : 'accepted. Congratulations!'}`); }
    else if (d.to === 'rejected') { setMascot('concerned', 2600); bubble(`Sorry about <b>${E(j.company)}</b>. Logged it — your reports will show where rejections cluster.`, 5000); }
    else if (['screen', 'interview', 'final'].includes(d.to)) { setMascot('happy', 2000); bubble(`<b>${E(j.company)}</b> moved to ${E(CB.STAGE[d.to].label)}. Want me to prep you?`, 5000); }
  }
  function nudge() {
    if (!S().ready || A.open) return;
    const o = overview();
    const urgent = CB.Auto.compute(S().list(), S().settings, S().atsMap()).filter((a) => a.sev === 1);
    const badge = $('#cal-badge');
    if (badge) { badge.hidden = !urgent.length; badge.textContent = urgent.length; }
    const key = urgent.map((a) => a.id).join('|');
    if (!urgent.length || key === A.nudged) return;
    A.nudged = key;
    setMascot('wave', 2000);
    const iv = urgent.find((a) => a.kind === 'interview');
    bubble(iv ? `Heads up: <b>${E(iv.detail.split(' · ')[0])}</b> — ${E(iv.title)}. Tap me to prep.` : `<b>${urgent.length} thing${urgent.length > 1 ? 's' : ''}</b> need${urgent.length > 1 ? '' : 's'} you today. Tap me and I'll handle them.`);
    void o;
  }

  CB.Cal = { mount, open: openPanel, close, send, parseWhen, localBrain, registerIntent, registerTool, act, show: (on) => { const r = $('#cal'); if (r) r.hidden = !on; try { localStorage.setItem(LS + '.hidden', on ? '0' : '1'); } catch (e) { /* noop */ } } };
})();

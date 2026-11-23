/* Callback — data store, pipeline flow rules, analytics and automations.
 * Cloud mode: the claude.ai `db` capability (syncs iPhone ↔ MacBook; owner-only rules).
 * Local mode: localStorage (when the page runs outside claude.ai or the store is unavailable).
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  const LS_KEY = 'callback.v1';
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  const DEFAULT_SETTINGS = {
    strictness: 'brutal', weeklyGoal: 15, followUpDays: 7, ghostDays: 21,
    needsSponsorship: false, hasClearance: false, remoteOnly: false, willingToRelocate: true,
    homeLocation: '', yearsOverride: '', degreeOverride: '', candidateName: '', candidateEmail: '', candidatePhone: '',
  };

  const S = {
    mode: 'loading', // 'cloud' | 'local' | 'loading'
    stale: false,
    jobs: new Map(),
    resume: null,
    settings: { ...DEFAULT_SETTINGS },
    ready: false,
    error: '',
  };
  let db = null;
  const undoStack = [];
  const emit = (reason, extra) => CB.emit('data', { reason, ...extra });

  // ─────────── persistence ───────────
  const pending = new Map(), inflight = new Set();
  async function flush(path) {
    if (inflight.has(path)) return;
    inflight.add(path);
    try {
      while (pending.has(path)) {
        const body = pending.get(path);
        pending.delete(path);
        try {
          if (body === null) await db.doc(path).delete();
          else await db.doc(path).set(body);
        } catch (e) {
          if (e && e.code === 'unavailable') {
            await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
            try { body === null ? await db.doc(path).delete() : await db.doc(path).set(body); } catch (e2) { report(e2); }
          } else report(e);
        }
      }
    } finally { inflight.delete(path); }
  }
  function report(e) {
    const code = e && e.code;
    const msg = code === 'quota_exceeded' ? 'Storage is full. Delete old applications or export a backup and clear examples.'
      : code === 'invalid_argument' ? 'A change could not be saved (it may be too large or you only have view access).'
      : code === 'revoked' ? 'Access to sync was withdrawn. Changes are no longer saved.'
      : 'A change could not be saved. Check your connection.';
    S.error = msg;
    CB.emit('toast', { text: msg, tone: 'bad' });
  }
  function write(path, body) {
    if (S.mode === 'cloud') { pending.set(path, body); flush(path); }
    else saveLocal();
  }
  const saveLocal = CB.debounce(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ jobs: [...S.jobs.values()], resume: S.resume, settings: S.settings }));
    } catch (e) {
      CB.emit('toast', { text: 'This browser refused to save (private mode or storage full). Export a backup to keep your data.', tone: 'bad' });
    }
  }, 250);
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      S.jobs = new Map((d.jobs || []).map((j) => [j.id, j]));
      S.resume = d.resume || null;
      S.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
      return true;
    } catch (e) { return false; }
  }

  async function init() {
    db = await CB.cap('db');
    if (!db) {
      S.mode = 'local';
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* noop */ }
      const had = loadLocal();
      if (!had) seedLocal();
      S.ready = true;
      emit('init');
      return;
    }
    S.mode = 'cloud';
    let gotJobs = false, gotResume = false, gotSettings = false;
    let resolveReady;
    const readyP = new Promise((r) => (resolveReady = r));
    const check = () => { if (gotJobs && gotResume && gotSettings && !S.ready) { S.ready = true; resolveReady(); emit('init'); } };
    const timer = setTimeout(() => { if (!S.ready) { S.stale = true; S.ready = true; resolveReady(); emit('init', { stale: true }); } }, 10000);
    const onErr = (e) => {
      clearTimeout(timer);
      if (!S.ready) {
        // Fall back to this device so the app still works.
        S.mode = 'local'; db = null; loadLocal() || seedLocal(); S.ready = true; resolveReady(); emit('init', { fallback: true });
        CB.emit('toast', { text: 'Sync is unavailable right now — saving on this device instead.', tone: 'warn' });
      } else report(e);
    };
    try {
      db.collection('jobs').onSnapshot((snap) => {
        const m = new Map();
        snap.docs.forEach((d) => { const v = d.data(); if (v) m.set(d.id, v); });
        // keep local optimistic edits that haven't round-tripped
        for (const [path, body] of pending) { const id = path.split('/')[1]; if (path.startsWith('jobs/')) body === null ? m.delete(id) : m.set(id, body); }
        S.jobs = m;
        // Paint from a cached copy immediately; the sync dot says when it's confirmed.
        gotJobs = true;
        S.stale = !!snap.metadata.fromCache;
        if (S.ready) emit('remote'); else check();
      }, onErr);
      db.doc('profile/resume').onSnapshot((d) => {
        S.resume = d.exists ? d.data() : null;
        gotResume = true;
        S.ready ? emit('remote') : check();
      }, onErr);
      db.doc('profile/settings').onSnapshot((d) => {
        S.settings = { ...DEFAULT_SETTINGS, ...(d.exists ? d.data() : {}) };
        gotSettings = true;
        S.ready ? emit('remote') : check();
      }, onErr);
    } catch (e) { onErr(e); }
    await readyP;
    clearTimeout(timer);
  }
  function seedLocal() {
    // Standalone/offline use: start with clearly-marked example data.
    if (CB.Samples) {
      CB.Samples.jobs().forEach((j) => S.jobs.set(j.id, j));
      S.resume = CB.Samples.resume();
      saveLocal();
    }
  }

  // ─────────── job CRUD ───────────
  const list = () => [...S.jobs.values()];
  const get = (id) => S.jobs.get(id) || null;
  function pushUndo(id, label) {
    undoStack.push({ id, prev: clone(S.jobs.get(id) || null), label });
    if (undoStack.length > 30) undoStack.shift();
  }
  function put(job, { undoLabel, silent } = {}) {
    if (undoLabel) pushUndo(job.id, undoLabel);
    job.updatedAt = CB.nowISO();
    if (job.timeline && job.timeline.length > 250) job.timeline = job.timeline.slice(-250);
    S.jobs.set(job.id, job);
    write('jobs/' + job.id, job);
    if (!silent) emit('job', { id: job.id });
    return job;
  }
  /** Clone-mutate-save. `fn` receives a mutable copy. */
  function update(id, fn, opts = {}) {
    const cur = get(id);
    if (!cur) return null;
    const j = clone(cur);
    const r = fn(j);
    if (r === false) return cur;
    return put(j, { undoLabel: opts.undoLabel, silent: opts.silent });
  }
  function add(job, { log = 'Added to tracker' } = {}) {
    const j = CB.newJob(job);
    if (!j.timeline.length) j.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'created', text: log });
    if (CB.STAGE[j.status].order >= 1 && !j.appliedDate) j.appliedDate = CB.todayISO();
    pushUndo(j.id, 'Add');
    return put(j);
  }
  function remove(id) {
    if (!S.jobs.has(id)) return;
    pushUndo(id, 'Delete');
    S.jobs.delete(id);
    write('jobs/' + id, null);
    emit('job', { id, removed: true });
  }
  function removeMany(ids) { ids.forEach((id) => { if (S.jobs.has(id)) { pushUndo(id, 'Delete'); S.jobs.delete(id); write('jobs/' + id, null); } }); emit('bulk'); }
  function undo() {
    const u = undoStack.pop();
    if (!u) return null;
    if (u.prev) { S.jobs.set(u.id, u.prev); write('jobs/' + u.id, u.prev); }
    else { S.jobs.delete(u.id); write('jobs/' + u.id, null); }
    emit('undo', { id: u.id });
    return u;
  }

  /** The pipeline flow rules. Every status change goes through here. */
  function move(id, to, opts = {}) {
    const before = get(id);
    const res = moveInner(id, to, opts);
    if (before && res && before.status !== to) setTimeout(() => CB.emit('moved', { id, from: before.status, to }), 0);
    return res;
  }
  function moveInner(id, to, opts = {}) {
    return update(id, (j) => {
      const from = j.status;
      if (from === to || !CB.STAGE[to]) return false;
      const today = opts.date || CB.todayISO();
      const toSt = CB.STAGE[to], fromSt = CB.STAGE[from];
      j.status = to;
      const notes = [];
      if ((toSt.order >= 1 || (to !== 'withdrawn' && toSt.order === -1 && from !== 'saved')) && !j.appliedDate) {
        j.appliedDate = today;
        if (to !== 'applied') notes.push('applied date set to ' + CB.fmtDate(today));
      }
      if (to === 'applied' && !j.followUpDate) j.followUpDate = CB.addDays(j.appliedDate || today, (S.settings.followUpDays || 7));
      if (toSt.order > (j.maxStage || 0)) {
        const skipped = CB.PROGRESSION.filter((s) => s.order > Math.max(j.maxStage || 0, 1) && s.order < toSt.order && s.key !== 'assessment').map((s) => s.label);
        if (skipped.length && fromSt.order >= 0) notes.push('skipped ' + skipped.join(', '));
        j.maxStage = toSt.order;
      }
      if (!j.responseDate && j.appliedDate && (toSt.order >= 2 || to === 'rejected')) j.responseDate = today;
      if (to === 'rejected') { j.rejectionStage = from; j.rejectionReason = opts.reason || j.rejectionReason || 'No reason given'; }
      if (fromSt.group === 'closed' && toSt.group !== 'closed') { j.rejectionReason = ''; j.rejectionStage = ''; notes.push('reopened'); }
      if (to === 'offer' && !j.offer) j.offer = { base: j.salaryMax || j.salaryMin || null, bonus: null, equity: '', signOn: null, deadline: '', notes: '' };
      j.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind: opts.auto ? 'auto' : 'status', from, to, text: [opts.note, to === 'rejected' && j.rejectionReason ? 'Reason: ' + j.rejectionReason : '', notes.join('; ')].filter(Boolean).join(' · ') });
    }, { undoLabel: 'Move' });
  }
  function log(id, kind, text, extra = {}) {
    return update(id, (j) => { j.timeline.push({ id: CB.uid('t_'), ts: CB.nowISO(), kind, text, ...extra }); }, { undoLabel: 'Log' });
  }

  // ─────────── resume / settings ───────────
  function setResume(r) {
    S.resume = r ? { ...r, text: String(r.text || '').slice(0, 200000) } : null;
    if (S.mode === 'cloud') write('profile/resume', S.resume || null);
    else saveLocal();
    emit('resume');
  }
  function setSettings(patch) {
    S.settings = { ...S.settings, ...patch };
    if (S.mode === 'cloud') write('profile/settings', S.settings);
    else saveLocal();
    emit('settings');
  }

  function loadSamples() {
    if (!CB.Samples) return 0;
    const js = CB.Samples.jobs();
    js.forEach((j) => { S.jobs.set(j.id, j); write('jobs/' + j.id, j); });
    if (!S.resume) setResume(CB.Samples.resume());
    emit('bulk');
    return js.length;
  }
  function clearSamples() {
    const ids = list().filter((j) => j.sample).map((j) => j.id);
    ids.forEach((id) => { S.jobs.delete(id); write('jobs/' + id, null); });
    if (S.resume && S.resume.sample) setResume(null);
    emit('bulk');
    return ids.length;
  }
  function importJobs(jobs, mode = 'merge') {
    let added = 0, updated = 0;
    const existing = list();
    for (const raw of jobs) {
      const j = CB.newJob(raw);
      const dup = existing.find((e) => (j.linkedinJobId && e.linkedinJobId === j.linkedinJobId) || (e.company && e.title && e.company.toLowerCase() === (j.company || '').toLowerCase() && e.title.toLowerCase() === (j.title || '').toLowerCase()));
      if (dup && mode === 'merge') {
        const m = { ...clone(dup), ...Object.fromEntries(Object.entries(j).filter(([k, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length) && !['id', 'createdAt', 'timeline', 'contacts', 'interviews'].includes(k))) };
        m.timeline = [...(dup.timeline || []), ...(j.timeline || [])];
        S.jobs.set(m.id, m); write('jobs/' + m.id, m); updated++;
      } else { S.jobs.set(j.id, j); write('jobs/' + j.id, j); added++; }
    }
    emit('bulk');
    return { added, updated };
  }
  function restoreBackup(data) {
    const jobs = (data.jobs || []).map((j) => CB.newJob(j));
    for (const id of [...S.jobs.keys()]) if (!jobs.find((j) => j.id === id)) { S.jobs.delete(id); write('jobs/' + id, null); }
    jobs.forEach((j) => { S.jobs.set(j.id, j); write('jobs/' + j.id, j); });
    if (data.resume) setResume(data.resume);
    if (data.settings) setSettings(data.settings);
    emit('bulk');
    return jobs.length;
  }
  function clearAll() {
    for (const id of [...S.jobs.keys()]) { S.jobs.delete(id); write('jobs/' + id, null); }
    setResume(null);
    emit('bulk');
  }

  // ─────────── ATS cache ───────────
  let atsCache = new Map(), atsKey = '';
  function profile() {
    if (!S.resume || !S.resume.text) return null;
    const p = CB.ATS.parseResume(S.resume.text);
    return p;
  }
  function atsFor(job) {
    const p = profile();
    const key = CB.hash((S.resume && S.resume.text) || '') + JSON.stringify([S.settings.strictness, S.settings.needsSponsorship, S.settings.hasClearance, S.settings.remoteOnly, S.settings.willingToRelocate, S.settings.homeLocation, S.settings.yearsOverride, S.settings.degreeOverride]);
    if (key !== atsKey) { atsCache = new Map(); atsKey = key; }
    const jk = job.id + '|' + job.updatedAt;
    if (atsCache.has(jk)) return atsCache.get(jk);
    let r;
    try {
      r = CB.ATS.score(job, p, { ...S.settings, yearsOverride: S.settings.yearsOverride === '' ? null : S.settings.yearsOverride, resumeWarnings: (S.resume && S.resume.warnings) || [] });
    } catch (e) { console.error('ATS', e); r = { score: null, verdict: 'ERROR', verdictLabel: 'Could not score', knockouts: [], components: [], skills: { required: [], preferred: [] }, keywords: { matched: [], missing: [] }, fixes: [] }; }
    atsCache.set(jk, r);
    return r;
  }
  const atsMap = () => Object.fromEntries(list().map((j) => [j.id, atsFor(j)]));

  CB.Store = Object.assign(S, { init, list, get, add, put, update, remove, removeMany, move, log, undo, setResume, setSettings, loadSamples, clearSamples, importJobs, restoreBackup, clearAll, profile, atsFor, atsMap, DEFAULT_SETTINGS, canUndo: () => undoStack.length > 0 });

  // ═════════════════════════ analytics ═════════════════════════
  function computeStats(jobs, atsById = {}) {
    const today = CB.todayISO();
    const appliedJobs = jobs.filter((j) => j.appliedDate || (j.maxStage || 0) >= 1);
    const responded = appliedJobs.filter((j) => j.responseDate || (j.maxStage || 0) >= 2 || j.status === 'rejected');
    const reached = (o) => appliedJobs.filter((j) => (j.maxStage || 0) >= o).length;
    const byStage = Object.fromEntries(CB.STAGES.map((s) => [s.key, 0]));
    jobs.forEach((j) => (byStage[j.status] = (byStage[j.status] || 0) + 1));
    const applied = appliedJobs.length;
    const rate = (a, b) => (b ? a / b : null);
    const respDays = responded.filter((j) => j.responseDate && j.appliedDate).map((j) => CB.daysBetween(j.appliedDate, j.responseDate)).filter((d) => d != null && d >= 0);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

    const srcMap = {};
    appliedJobs.forEach((j) => {
      const k = j.referral ? 'Referral' : j.source || 'Other';
      const o = (srcMap[k] = srcMap[k] || { source: k, applied: 0, responses: 0, interviews: 0 });
      o.applied++;
      if (responded.includes(j)) o.responses++;
      if ((j.maxStage || 0) >= 4) o.interviews++;
    });
    const bySource = Object.values(srcMap).map((o) => ({ ...o, rate: rate(o.responses, o.applied), interviewRate: rate(o.interviews, o.applied) })).sort((a, b) => b.applied - a.applied);

    // activity by day
    const daily = {};
    appliedJobs.forEach((j) => { if (j.appliedDate) daily[j.appliedDate] = (daily[j.appliedDate] || 0) + 1; });
    const weekly = [];
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    for (let w = 11; w >= 0; w--) {
      const start = new Date(monday); start.setDate(start.getDate() - w * 7);
      let n = 0;
      for (let d = 0; d < 7; d++) { const x = new Date(start); x.setDate(x.getDate() + d); n += daily[CB.toISODate(x)] || 0; }
      weekly.push({ start: CB.toISODate(start), label: `${CB.MONTHS[start.getMonth()]} ${start.getDate()}`, value: n });
    }
    let streak = 0;
    for (let d = 0; d < 400; d++) {
      const iso = CB.addDays(today, -d);
      if (daily[iso]) streak++;
      else if (d === 0) continue;
      else break;
    }
    const scored = appliedJobs.map((j) => atsById[j.id]).filter((a) => a && a.score != null);
    const buckets = [];
    for (let b = 0; b < 10; b++) buckets.push({ from: b * 10, to: b * 10 + 10, count: 0, responded: 0, interviewed: 0 });
    appliedJobs.forEach((j) => {
      const a = atsById[j.id];
      if (!a || a.score == null) return;
      const bk = buckets[Math.min(9, Math.floor(a.score / 10))];
      bk.count++;
      if (responded.includes(j) && j.status !== 'rejected') bk.responded++;
      if ((j.maxStage || 0) >= 2) bk.interviewed++;
    });
    const rejStage = {};
    jobs.filter((j) => j.status === 'rejected').forEach((j) => { const k = j.rejectionStage || 'applied'; rejStage[k] = (rejStage[k] || 0) + 1; });
    const rejReason = {};
    jobs.filter((j) => j.status === 'rejected').forEach((j) => { const k = j.rejectionReason || 'No reason given'; rejReason[k] = (rejReason[k] || 0) + 1; });
    const verdicts = { STRONG: 0, COMPETITIVE: 0, LONG_SHOT: 0, REJECTED: 0 };
    jobs.forEach((j) => { const a = atsById[j.id]; if (a && verdicts[a.verdict] != null) verdicts[a.verdict]++; });
    const expectedInterviews = jobs.filter((j) => CB.STAGE[j.status].group === 'active' && (j.maxStage || 0) < 4).reduce((s, j) => s + ((atsById[j.id] && atsById[j.id].probability) || 0), 0);
    const salaries = jobs.map((j) => (j.salaryPeriod === 'hour' ? (j.salaryMax || j.salaryMin) * 2080 : j.salaryMax || j.salaryMin)).filter((x) => x > 0);

    return {
      total: jobs.length, applied, responses: responded.length, responseRate: rate(responded.length, applied),
      screens: reached(2), screenRate: rate(reached(2), applied),
      interviews: reached(4), interviewRate: rate(reached(4), applied),
      finals: reached(5), offers: reached(6), offerRate: rate(reached(6), applied), accepted: reached(7),
      active: jobs.filter((j) => CB.STAGE[j.status].group === 'active').length,
      saved: byStage.saved, rejected: byStage.rejected, ghosted: byStage.ghosted, withdrawn: byStage.withdrawn,
      byStage, bySource, daily, weekly, streak,
      thisWeek: weekly[weekly.length - 1].value,
      avgDaysToResponse: avg(respDays), medianDaysToResponse: med(respDays),
      avgAts: scored.length ? scored.reduce((a, x) => a + x.score, 0) / scored.length : null,
      atsBuckets: buckets, rejectionsByStage: rejStage, rejectionsByReason: rejReason, verdicts, expectedInterviews,
      medianSalary: med(salaries),
      funnel: [
        { key: 'saved', count: jobs.length },
        { key: 'applied', count: applied },
        { key: 'screen', count: reached(2) },
        { key: 'interview', count: reached(4) },
        { key: 'final', count: reached(5) },
        { key: 'offer', count: reached(6) },
        { key: 'accepted', count: reached(7) },
      ],
      dropoffs: { rejected: byStage.rejected, ghosted: byStage.ghosted, withdrawn: byStage.withdrawn },
    };
  }

  // ═════════════════════════ automations ═════════════════════════
  function computeActions(jobs, settings, atsById = {}) {
    const out = [];
    const today = CB.todayISO();
    const fu = +settings.followUpDays || 7, gd = +settings.ghostDays || 21;
    const lastActivity = (j) => {
      const ts = (j.timeline || []).filter((t) => t.kind !== 'note').map((t) => t.ts.slice(0, 10));
      return [j.appliedDate, ...ts].filter(Boolean).sort().pop() || j.createdAt.slice(0, 10);
    };
    for (const j of jobs) {
      const st = CB.STAGE[j.status];
      const name = `${j.company || 'Untitled'} · ${j.title || 'Role'}`;
      const a = atsById[j.id];
      // Interviews
      for (const iv of j.interviews || []) {
        if (!iv.datetime) continue;
        const hrs = (CB.parseDate(iv.datetime) - new Date()) / 3600000;
        if (iv.outcome === 'Scheduled' && hrs > 0 && hrs <= 72) out.push({ id: 'iv-' + iv.id, kind: 'interview', sev: 1, jobId: j.id, title: `${iv.type || 'Interview'} ${hrs < 24 ? 'in ' + Math.round(hrs) + 'h' : CB.fmtDateTime(iv.datetime)}`, detail: name, action: { type: 'open', tab: 'interviews', label: 'Prep' } });
        if (iv.outcome === 'Scheduled' && hrs < -2) out.push({ id: 'ivo-' + iv.id, kind: 'outcome', sev: 2, jobId: j.id, title: `Log the outcome of your ${iv.type || 'interview'}`, detail: `${name} · ${CB.fmtDateTime(iv.datetime)}`, action: { type: 'open', tab: 'interviews', label: 'Log outcome' } });
        if (!iv.thankYouSent && (iv.outcome === 'Completed' || (iv.outcome === 'Scheduled' && hrs < -1)) && hrs > -72) out.push({ id: 'ty-' + iv.id, kind: 'thanks', sev: 1, jobId: j.id, ivId: iv.id, title: 'Send a thank-you note within 24h', detail: `${name} · ${iv.interviewer || iv.type}`, action: { type: 'thanks', label: 'Mark sent' } });
      }
      if (j.status === 'applied' && j.appliedDate && !j.responseDate) {
        const d = CB.daysSince(j.appliedDate);
        const la = CB.daysSince(lastActivity(j));
        const lastFU = (j.timeline || []).filter((t) => t.kind === 'followup').map((t) => t.ts.slice(0, 10)).sort().pop();
        if (d >= gd && la >= gd) out.push({ id: 'gh-' + j.id, kind: 'ghost', sev: 2, jobId: j.id, title: `No reply in ${d} days — mark as ghosted`, detail: name, action: { type: 'move', to: 'ghosted', label: 'Mark ghosted' } });
        else if (d >= fu && (!lastFU || CB.daysSince(lastFU) >= fu)) out.push({ id: 'fu-' + j.id, kind: 'followup', sev: 1, jobId: j.id, title: `Follow up — applied ${d} days ago`, detail: name, action: { type: 'followup', label: 'Log follow-up' } });
      }
      if (st.group === 'active' && j.status !== 'applied' && CB.daysSince(lastActivity(j)) >= gd + 7) out.push({ id: 'st-' + j.id, kind: 'stale', sev: 2, jobId: j.id, title: `Silent for ${CB.daysSince(lastActivity(j))} days at ${st.label}`, detail: name, action: { type: 'move', to: 'ghosted', label: 'Mark ghosted' } });
      if (j.followUpDate && j.followUpDate <= today && st.group === 'active' && j.status !== 'applied') out.push({ id: 'fd-' + j.id, kind: 'followup', sev: 2, jobId: j.id, title: 'Follow-up date reached', detail: name, action: { type: 'followup', label: 'Log follow-up' } });
      if (j.status === 'saved') {
        if (j.deadline) { const d = CB.daysBetween(today, j.deadline); if (d != null && d >= 0 && d <= 3) out.push({ id: 'dl-' + j.id, kind: 'deadline', sev: 1, jobId: j.id, title: `Closes ${d === 0 ? 'today' : 'in ' + d + 'd'}`, detail: name, action: { type: 'open', tab: 'overview', label: 'Open' } }); }
        if (a && a.verdict === 'REJECTED') out.push({ id: 'ko-' + j.id, kind: 'knockout', sev: 2, jobId: j.id, title: `Don't apply yet — ${a.knockouts[0].code} ${a.knockouts[0].label}`, detail: name, action: { type: 'open', tab: 'ats', label: 'See why' } });
        else if (CB.daysSince(j.createdAt.slice(0, 10)) >= 10) out.push({ id: 'sv-' + j.id, kind: 'stale', sev: 3, jobId: j.id, title: `Saved ${CB.daysSince(j.createdAt.slice(0, 10))} days ago — apply or archive`, detail: name + (a && a.score != null ? ` · ATS ${a.score}` : ''), action: { type: 'move', to: 'applied', label: 'Mark applied' } });
      }
      if (j.status === 'offer' && j.offer && j.offer.deadline) { const d = CB.daysBetween(today, j.offer.deadline); if (d != null && d >= 0 && d <= 5) out.push({ id: 'od-' + j.id, kind: 'deadline', sev: 1, jobId: j.id, title: `Offer decision due ${d === 0 ? 'today' : 'in ' + d + 'd'}`, detail: name, action: { type: 'open', tab: 'overview', label: 'Review offer' } }); }
      if (!String(j.jd || '').trim() && !j.jdAI && st.group !== 'closed') out.push({ id: 'jd-' + j.id, kind: 'nojd', sev: 3, jobId: j.id, title: 'Paste the job description to get an ATS score', detail: name, action: { type: 'open', tab: 'ats', label: 'Add JD' } });
    }
    return out.sort((x, y) => x.sev - y.sev);
  }

  CB.Stats = { compute: computeStats };
  CB.Auto = { compute: computeActions };
})();

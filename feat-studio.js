/* Callback v3 — feat-studio (owned per docs/BUILD.md)
 * Message Studio (competitors.md rec 5): the offline replacement for the claude.ai-only outreach buttons.
 * 13 built-in templates (editable, duplicable, plus your own) with merge fields resolved from the selected job and the
 * parsed resume: {{company}} {{title}} {{contact.first}} {{interviewer}} {{round}} {{interviewDate}} {{myName}}
 * {{topSkill}} {{proofMetric}} {{appliedDate}}. Live preview, LinkedIn 300-character counter, Copy / Email / Share,
 * and "Log as sent" (timeline entry via CB.Store.log; thank-yous tick the interview, follow-ups move the next nudge).
 * Templates persist in CB.Store.kv('templates') = {v:1, custom:[...], overrides:{builtinId:{name,subject,body}}}.
 * Entry points: the Studio view, the drawer's "Write message" action, Cal ("write a thank-you note to Lumen Bank").
 * Public: CB.Studio {open({jobId, tplId}), templates(), resolve(job), fill(tpl, job)}.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  if (typeof document === 'undefined' || typeof CB.registerView !== 'function' || !CB.STAGE) return;

  const E = (s) => CB.esc(s);
  const S = () => CB.Store;
  const UI = () => CB.UI || {};
  const icon = (n) => (UI().icon ? UI().icon(n) : '');
  const toast = (t, o) => { if (UI().toast) UI().toast(t, o); };
  const ready = () => !!(S() && S().ready);
  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const PEN = '<path d="M14.5 4.5l5 5L9 20H4v-5L14.5 4.5z"/><path d="M12.5 6.5l5 5"/><path d="M4 20l5-5"/>';

  // ───────────────────────── built-in templates ─────────────────────────
  const T = (id, name, cat, hint, stages, logKind, subject, body, extra) => Object.assign({ id, name, cat, hint, stages, logKind, kind: 'email', subject, body }, extra || {});
  const BUILTIN = [
    T('followup7', 'Follow-up · day 7', 'Follow-up', '7 days after applying', ['applied'], 'followup', 'Following up on my {{title}} application',
      'Hi {{contact.first}},\n\nI applied for the {{title}} role at {{company}} on {{appliedDate}} and wanted to follow up. I\'m still very interested, and the work lines up closely with my experience in {{topSkill}}.\n\nOne recent example: I {{proofMetric}}.\n\nI\'m happy to share more detail or work samples. Is there anything else you need from me at this stage?\n\nThank you for your time,\n{{myName}}'),
    T('stayintouch', 'Stay in touch after silence', 'Follow-up', 'After three quiet weeks', ['ghosted'], 'followup', 'Checking in on the {{title}} role',
      'Hi {{contact.first}},\n\nI applied for the {{title}} role at {{company}} on {{appliedDate}} and haven\'t heard back, so I wanted to check in one last time. If the role has been filled or paused, no problem at all. I\'d still love to stay on your radar for future openings in {{topSkill}}.\n\nThanks for your time,\n{{myName}}'),
    T('thanks', 'Thank-you · within 24h', 'Interview', 'Within 24 hours', ['screen', 'assessment', 'interview', 'final'], 'followup', 'Thank you for the {{title}} conversation',
      'Hi {{interviewer}},\n\nThank you for taking the time to meet with me for the {{round}} on {{interviewDate}}. I enjoyed the conversation and came away even more excited about the work at {{company}}.\n\nIt reinforced how my experience in {{topSkill}} could help the team. For example, I {{proofMetric}}.\n\nPlease let me know if I can provide anything else. I look forward to hearing about next steps.\n\nBest regards,\n{{myName}}'),
    T('status', 'Post-interview status check', 'Interview', '5 to 7 days after', ['interview', 'final', 'screen'], 'followup', 'Checking in on the {{title}} role',
      'Hi {{contact.first}},\n\nI hope your week is going well. I wanted to check in on the {{title}} role following my {{round}} on {{interviewDate}}. I remain very interested in joining {{company}}.\n\nIs there an updated timeline for next steps, or anything further I can share?\n\nThanks again,\n{{myName}}'),
    T('referral', 'Referral ask', 'Networking', 'Before you apply', ['saved'], 'email', 'Quick question about {{company}}',
      'Hi {{contact.first}},\n\nI hope you\'re doing well. I\'m applying for the {{title}} role at {{company}} and wanted to ask whether you\'d be comfortable referring me.\n\nIn short: my recent work is in {{topSkill}}, and most recently I {{proofMetric}}.\n\nI\'m happy to send my resume and a two-line summary to make it easy. If a referral isn\'t a fit, I\'d still value fifteen minutes of your perspective on the team.\n\nThank you either way,\n{{myName}}'),
    T('linkedin', 'LinkedIn connection note', 'Networking', '300 characters max', ['saved', 'applied'], 'email', '',
      'Hi {{contact.first}}, I\'m exploring the {{title}} role at {{company}}. My background is in {{topSkill}}; recently I {{proofMetric}}. I\'d love to connect and learn how your team works. Thank you, {{myName}}', { kind: 'linkedin', limit: 300 }),
    T('cold', 'Recruiter cold email', 'Networking', 'Right after applying', ['saved', 'applied'], 'email', '{{title}} at {{company}}',
      'Hi {{contact.first}},\n\nI\'m reaching out about the {{title}} opening at {{company}}. I specialize in {{topSkill}}, and my experience maps closely to what the team needs.\n\nA recent result: I {{proofMetric}}.\n\nI\'ve applied through the careers site and would welcome a short call to learn more about the role. Would fifteen minutes this week or next work for you?\n\nBest,\n{{myName}}'),
    T('extension', 'Deadline extension', 'Offer', 'When you need more time', ['offer'], 'email', '{{title}} offer: timing',
      'Hi {{contact.first}},\n\nThank you again for the offer for the {{title}} role. I\'m genuinely excited about {{company}}.\n\nTo give you a clear, final answer, I\'d like to ask for a short extension of the decision deadline, to [new date]. I\'m completing conversations I committed to before your offer arrived, and I want to make a decision I can stand behind fully.\n\nPlease let me know if that works. I\'m grateful for your flexibility.\n\nBest regards,\n{{myName}}'),
    T('counter', 'Offer counter', 'Offer', 'Once, in writing', ['offer'], 'email', '{{title}} offer',
      'Hi {{contact.first}},\n\nThank you for the offer to join {{company}} as {{title}}. I\'m excited about the role and the team, and I want to make this work.\n\nBased on the scope we discussed, my experience in {{topSkill}}, and market data for similar roles, I was hoping for a base salary closer to [target base]. For context on impact: I {{proofMetric}}.\n\nIf we can get there, I\'m ready to sign. I\'m also open to discussing how a sign-on bonus or equity could bridge the gap.\n\nThank you,\n{{myName}}'),
    T('accept', 'Accept offer', 'Offer', 'Confirm in writing', ['offer'], 'email', 'Accepting the {{title}} offer',
      'Hi {{contact.first}},\n\nI\'m delighted to formally accept the offer to join {{company}} as {{title}}. Thank you to you and the team for a thoughtful process.\n\nPlease let me know the next steps for paperwork, background checks and start-date logistics. I\'m looking forward to getting started.\n\nWarm regards,\n{{myName}}'),
    T('decline', 'Decline gracefully', 'Closing', 'Keep the door open', ['offer'], 'email', 'Your offer for the {{title}} role',
      'Hi {{contact.first}},\n\nThank you so much for the offer to join {{company}} as {{title}}, and for the time the team invested in getting to know me.\n\nAfter careful thought, I\'ve decided to decline. It was a difficult decision, and I have a great deal of respect for the team and what you\'re building.\n\nI\'d very much like to stay in touch, and I hope our paths cross again.\n\nAll the best,\n{{myName}}'),
    T('withdraw', 'Withdraw application', 'Closing', 'After you sign elsewhere', ['applied', 'screen', 'assessment', 'interview', 'final'], 'email', 'Withdrawing my application for {{title}}',
      'Hi {{contact.first}},\n\nThank you for considering me for the {{title}} role at {{company}}. I\'m writing to withdraw my application, as I\'ve accepted another opportunity that is a closer fit for this stage of my career.\n\nI appreciated the conversations with the team and would be glad to stay in touch.\n\nBest regards,\n{{myName}}'),
    T('reconnect', 'Reconnect after rejection', 'Closing', 'Within a week of the no', ['rejected'], 'email', 'Thank you, and staying in touch',
      'Hi {{contact.first}},\n\nThank you for letting me know about the {{title}} role. While I\'m disappointed, I appreciated the process and everything I learned about {{company}}.\n\nIf you have a moment, I\'d welcome any feedback on where I could be stronger. I\'d also love to be considered for future roles, and I\'ll keep building in {{topSkill}} in the meantime.\n\nThanks again,\n{{myName}}'),
  ];
  const CATS = ['Follow-up', 'Interview', 'Networking', 'Offer', 'Closing', 'Custom'];
  const FIELDS = [
    ['company', 'Company'], ['title', 'Job title'], ['contact.first', 'Contact first name'], ['interviewer', 'Interviewer'], ['round', 'Interview'],
    ['interviewDate', 'Interview date'], ['appliedDate', 'Applied date'], ['myName', 'Your name'], ['topSkill', 'Top skill'], ['proofMetric', 'Proof metric'],
  ];
  const FIELD_LABEL = Object.fromEntries(FIELDS);
  const TOKEN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

  // ───────────────────────── template storage ─────────────────────────
  let tkv = null;
  const store = () => {
    if (!tkv && S() && typeof S().kv === 'function') { try { tkv = S().kv('templates'); } catch (e) { tkv = null; } }
    return tkv;
  };
  const docGet = () => {
    const d = store() && store().get();
    return d && typeof d === 'object' ? { v: 1, custom: Array.isArray(d.custom) ? d.custom : [], overrides: d.overrides && typeof d.overrides === 'object' ? d.overrides : {} } : { v: 1, custom: [], overrides: {} };
  };
  async function docSet(d) {
    const k = store();
    if (!k) { toast('Templates can\'t be saved right now.', { tone: 'bad' }); return false; }
    try { await k.set(d); return true; } catch (e) { toast((e && e.message) || 'The template could not be saved.', { tone: 'bad' }); return false; }
  }
  const str = (v) => (typeof v === 'string' ? v : '');
  function templates() {
    const d = docGet();
    const out = BUILTIN.map((t) => {
      const o = d.overrides[t.id];
      return o && typeof o === 'object' ? Object.assign({}, t, { name: str(o.name) || t.name, subject: typeof o.subject === 'string' ? o.subject : t.subject, body: typeof o.body === 'string' ? o.body : t.body, edited: true }) : Object.assign({}, t);
    });
    d.custom.forEach((c) => {
      if (!c || typeof c !== 'object' || !str(c.id)) return;
      out.push({ id: c.id, name: str(c.name) || 'Untitled template', cat: CATS.includes(c.cat) ? c.cat : 'Custom', hint: c.kind === 'linkedin' ? '300 characters max' : 'Your template', stages: [], logKind: c.logKind === 'followup' ? 'followup' : 'email', kind: c.kind === 'linkedin' ? 'linkedin' : 'email', limit: c.kind === 'linkedin' ? 300 : 0, subject: str(c.subject), body: str(c.body), custom: true });
    });
    return out;
  }

  // ───────────────────────── merge-field resolution ─────────────────────────
  const firstName = (s) => {
    s = String(s || '').replace(/\(.*?\)/g, '').trim();
    if (!s) return '';
    if (/[,&/+]|\sand\s/i.test(s)) return s;
    const w = s.split(/\s+/)[0];
    return /^[A-Z][A-Za-z'’-]+$/.test(w) ? w : s;
  };
  const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
  const IVP = { 'recruiter screen': 'recruiter screen', 'hiring manager': 'hiring manager interview', 'technical screen': 'technical screen', 'take-home review': 'take-home review', 'system design': 'system design interview', behavioral: 'behavioral interview', 'case study': 'case study interview', 'panel / onsite': 'onsite panel', executive: 'executive interview', 'reference check': 'reference check' };
  const roundPhrase = (iv) => {
    const t = String(iv.type || 'interview').trim().toLowerCase();
    let p = IVP[t] || (/(interview|screen|review|check|panel)$/.test(t) ? t : t + ' interview');
    const n = +iv.round || 1;
    if (n > 1 && ORD[n]) p = ORD[n] + '-round ' + p;
    return p;
  };
  function pickInterview(j) {
    const ivs = (j.interviews || []).filter((i) => i.datetime && i.outcome !== 'Cancelled').slice().sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
    const now = new Date();
    const past = ivs.filter((i) => { const d = CB.parseDate(i.datetime); return d && d <= now; });
    return past[past.length - 1] || ivs.find((i) => i.outcome === 'Scheduled') || null;
  }
  function pickContact(j) {
    const cs = (j.contacts || []).filter((c) => c && c.name);
    return cs.find((c) => /recruit|talent|sourc|people|hr\b/i.test(c.role || '')) || cs.find((c) => /hiring|manager/i.test(c.role || '')) || cs[0] || null;
  }
  const normW = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ');
  function topSkill(j) {
    try {
      const a = j && S().atsFor ? S().atsFor(j) : null;
      const req = a && a.skills && Array.isArray(a.skills.required) ? a.skills.required : [];
      const ev = req.filter((s) => s && s.status === 'evidenced' && s.kind !== 'soft').sort((x, y) => (y.jdCount || 0) - (x.jdCount || 0) || (y.weight || 0) - (x.weight || 0));
      if (ev.length) return { v: (ev[0].best && ev[0].best.name) || ev[0].name, src: 'ATS match' };
      const p = S().profile && S().profile();
      if (p && p.skills && typeof p.skills.values === 'function') {
        const arr = [...p.skills.values()].filter((s) => s.kind !== 'soft' && s.kind !== 'cert' && (s.evidence === 'experience' || s.evidence === 'project')).sort((x, y) => (y.recent - x.recent) || (y.count - x.count));
        if (arr.length) return { v: arr[0].name, src: 'Resume' };
      }
    } catch (e) { /* resume not parsed */ }
    return { v: '', src: '' };
  }
  function proofMetric(j) {
    try {
      const p = S().profile && S().profile();
      if (!p || !Array.isArray(p.bullets)) return { v: '', src: '' };
      const jdw = new Set(normW(j && j.jd).split(' ').filter((w) => w.length > 3));
      let best = '', score = -1e9;
      p.bullets.forEach((b) => {
        if (!b || !b.quantified) return;
        const t = String(b.text || '').replace(/^[\s•\-–—*·▪◦●]+/, '').replace(/[\s.;]+$/, '');
        if (t.length < 24) return;
        let sc = (/[%$€£]|\d+(\.\d+)?x\b/i.test(t) ? 3 : 0) + (b.action ? 2 : 0);
        sc += Math.min(4, normW(t).split(' ').filter((w) => jdw.has(w)).length * 0.5);
        if (t.length > 140) sc -= (t.length - 140) / 20;
        if (sc > score) { score = sc; best = t; }
      });
      if (!best) return { v: '', src: '' };
      if (/^[A-Z][a-z]/.test(best)) best = best.charAt(0).toLowerCase() + best.slice(1);
      return { v: best, src: 'Resume' };
    } catch (e) { return { v: '', src: '' }; }
  }
  /** Every merge field for `job` (null = template only): {field: {v, src}}. Empty v = unresolved. */
  function resolve(j) {
    const out = {};
    const set = (k, v, src) => { out[k] = { v: v == null ? '' : String(v).trim(), src: v ? src : '' }; };
    const st = (S() && S().settings) || {};
    const p = (S() && S().profile && S().profile()) || null;
    set('company', j && j.company, 'Application');
    set('title', j && j.title, 'Application');
    const c = j ? pickContact(j) : null;
    if (c) set('contact.first', firstName(c.name), 'Contact');
    else out['contact.first'] = { v: 'there', src: 'Default' };
    const iv = j ? pickInterview(j) : null;
    set('interviewer', iv && iv.interviewer ? firstName(iv.interviewer) : '', 'Interview');
    set('round', iv ? roundPhrase(iv) : '', 'Interview');
    const d = iv && CB.parseDate(iv.datetime);
    set('interviewDate', d ? `${WEEKDAY[d.getDay()]}, ${CB.MONTHS[d.getMonth()]} ${d.getDate()}` : '', 'Interview');
    set('appliedDate', j && j.appliedDate ? CB.fmtDate(j.appliedDate) : '', 'Application');
    const nm = str(st.candidateName) || (p && str(p.name)) || '';
    set('myName', nm, st.candidateName ? 'Settings' : 'Resume');
    const ts = topSkill(j);
    set('topSkill', ts.v, ts.src);
    const pm = proofMetric(j);
    set('proofMetric', pm.v, pm.src);
    return out;
  }
  /** Split a template string into literal text and fields. */
  function parts(s, vals, over) {
    const out = [];
    let last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(s))) {
      if (m.index > last) out.push({ t: s.slice(last, m.index) });
      const k = m[1];
      const ov = over && over[k] != null ? String(over[k]).trim() : null;
      const v = ov != null && ov !== '' ? ov : vals[k] ? vals[k].v : '';
      out.push({ k, v, miss: !v, def: !(ov != null && ov !== '') && !!vals[k] && vals[k].src === 'Default' });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: s.slice(last) });
    return out;
  }
  const label = (k) => (FIELD_LABEL[k] ? FIELD_LABEL[k].toLowerCase() : k);
  const toText = (ps) => ps.map((x) => (x.t != null ? x.t : x.miss ? `[${label(x.k)}]` : x.v)).join('');
  const toHtml = (ps) => ps.map((x) => {
    if (x.t != null) return E(x.t).replace(/\[([^\]\n]{1,40})\]/g, '<mark class="sd-miss" title="Fill this in before sending">[$1]</mark>');
    return x.miss ? `<mark class="sd-miss" title="Missing: add it in the fields panel">[${E(label(x.k))}]</mark>` : `<mark class="sd-v${x.def ? ' is-def' : ''}" title="{{${E(x.k)}}}${x.def ? ' (default)' : ''}">${E(x.v)}</mark>`;
  }).join('');
  function fill(tpl, job, over) {
    const vals = resolve(job || null);
    const sp = parts(tpl.subject || '', vals, over), bp = parts(tpl.body || '', vals, over);
    return { subject: toText(sp), body: toText(bp), subjectHtml: toHtml(sp), bodyHtml: toHtml(bp), vals, used: [...new Set(sp.concat(bp).filter((x) => x.k).map((x) => x.k))] };
  }

  // ───────────────────────── studio state ─────────────────────────
  const st = { jobId: undefined, tplId: null, editing: false, draft: null, isNew: false, over: {} };
  let mounted = null;
  const job = () => (st.jobId ? S().get(st.jobId) : null);
  const curTpl = () => { const all = templates(); return all.find((t) => t.id === st.tplId) || all[0]; };
  const overFor = (j) => (st.over[(j && j.id) || '_'] = st.over[(j && j.id) || '_'] || {});
  function suggest(j) {
    if (!j) return 'followup7';
    const iv = pickInterview(j);
    if (iv && ['screen', 'assessment', 'interview', 'final'].includes(j.status)) {
      const d = CB.parseDate(iv.datetime);
      const hrs = d ? (Date.now() - d.getTime()) / 3600000 : null;
      if (hrs != null && hrs >= 0 && hrs < 72 && !iv.thankYouSent) return 'thanks';
      if (hrs != null && hrs >= 72) return 'status';
    }
    const t = BUILTIN.find((x) => x.stages.includes(j.status));
    return t ? t.id : 'followup7';
  }
  const GROUPS = [['In progress', (s) => s.group === 'active'], ['Offers', (s) => s.group === 'won'], ['Saved', (s) => s.group === 'pre'], ['Closed', (s) => s.group === 'closed']];
  const byRecent = (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  function defaultJob() {
    const all = S().list().slice().sort(byRecent);
    const pick = all.find((j) => CB.STAGE[j.status].group === 'active') || all.find((j) => CB.STAGE[j.status].group === 'won') || all[0];
    return pick ? pick.id : null;
  }

  function open(o = {}) {
    if (o.jobId !== undefined) st.jobId = o.jobId || null;
    st.tplId = o.tplId || (o.jobId ? suggest(S().get(o.jobId)) : st.tplId);
    st.editing = false; st.draft = null; st.isNew = false;
    try { if (CB.Drawer && document.getElementById('drawer')) CB.Drawer.close(); } catch (e) { /* noop */ }
    if (decodeURIComponent((location.hash || '').slice(1)) === 'studio' && mounted && mounted.root.querySelector('.sd')) mounted.update(true);
    else location.hash = 'studio';
  }

  // ───────────────────────── view ─────────────────────────
  function render(root, opts) {
    if (!ready()) { root.innerHTML = '<div class="sd-wait muted">Loading your applications…</div>'; return; }
    if (st.jobId === undefined || (st.jobId && !S().get(st.jobId))) st.jobId = defaultJob();
    if (!templates().find((t) => t.id === st.tplId)) st.tplId = suggest(job());
    const k = store();
    if (k && opts && opts.cleanup) opts.cleanup(k.on(() => { if (mounted && mounted.root.querySelector('.sd')) mounted.update(false); }));
    if (opts && opts.refresh && mounted && mounted.root === root && root.querySelector('.sd')) { mounted.update(false); return; }
    root.innerHTML = `<div class="sd">
      <aside class="sd-rail card" aria-label="Templates">
        <div class="sd-rail-h"><span class="eyebrow">Templates</span><button class="btn btn-ghost btn-sm" data-new title="New template">${icon('plus')}New</button></div>
        <div class="sd-list" data-list role="listbox" aria-label="Templates"></div>
      </aside>
      <div class="sd-main">
        <div class="sd-top card">
          <label class="field sd-jobf"><span>Application</span><select class="input" data-job aria-label="Application"></select></label>
          <label class="field sd-tself"><span>Template</span><select class="input" data-tsel aria-label="Template"></select></label>
          <div class="sd-to" data-to></div>
        </div>
        <div class="sd-work">
          <section class="sd-paper card" data-paper></section>
          <section class="sd-side card" data-side></section>
        </div>
      </div>
    </div>`;
    const q = (s) => root.querySelector(s);
    let sideMode = '';
    const update = (full) => {
      if (!root.querySelector('.sd')) return;
      if (st.jobId && !S().get(st.jobId)) st.jobId = defaultJob();
      if (!st.editing && !templates().find((t) => t.id === st.tplId)) st.tplId = suggest(job());
      drawRail(); drawJobs(); drawTo();
      if (st.editing) { if (sideMode !== 'editor' || full) drawEditor(); }
      else if (full || sideMode !== 'fields' || !q('[data-side]').contains(document.activeElement)) drawFields();
      drawPaper();
    };
    mounted = { root, update };

    function drawRail() {
      const all = templates(), j = job();
      const sug = j ? suggest(j) : null;
      const stg = j ? CB.STAGE[j.status] : null;
      q('[data-list]').innerHTML = CATS.map((c) => {
        const ts = all.filter((t) => t.cat === c);
        if (!ts.length) return '';
        return `<div class="sd-grp"><div class="sd-grp-l">${E(c)}</div>${ts.map((t) => `<button type="button" class="sd-tpl${t.id === st.tplId ? ' is-on' : ''}" data-tpl="${E(t.id)}" role="option" aria-selected="${t.id === st.tplId}">
          <span class="sd-tpl-n">${E(t.name)}${t.edited ? '<em>Edited</em>' : ''}</span>
          <span class="sd-tpl-m">${t.kind === 'linkedin' ? 'LinkedIn' : 'Email'} · ${E(t.hint || '')}</span>
          ${t.id === sug ? `<i class="sd-sug" title="Suggested for ${E(stg ? stg.label : '')}"></i>` : ''}</button>`).join('')}</div>`;
      }).join('');
      q('[data-list]').classList.toggle('is-locked', st.editing);
      q('[data-list]').querySelectorAll('[data-tpl]').forEach((b) => (b.onclick = () => { if (st.editing) return; st.tplId = b.dataset.tpl; update(true); }));
      q('[data-tsel]').innerHTML = CATS.map((c) => { const ts = all.filter((t) => t.cat === c); return ts.length ? `<optgroup label="${E(c)}">${ts.map((t) => `<option value="${E(t.id)}"${t.id === st.tplId ? ' selected' : ''}>${E(t.name)}${t.id === sug ? '  (suggested)' : ''}</option>`).join('')}</optgroup>` : ''; }).join('');
      q('[data-tsel]').disabled = st.editing;
    }
    function drawJobs() {
      const jobs = S().list();
      const sel = q('[data-job]');
      const html = `<option value="">No application · template only</option>` + GROUPS.map(([g, f]) => {
        const js = jobs.filter((j) => f(CB.STAGE[j.status])).sort(byRecent);
        return js.length ? `<optgroup label="${E(g)}">${js.map((j) => `<option value="${E(j.id)}"${j.id === st.jobId ? ' selected' : ''}>${E((j.company || 'Untitled') + ' · ' + (j.title || 'Role'))}</option>`).join('')}</optgroup>` : '';
      }).join('');
      if (sel.dataset.h !== CB.hash(html)) { sel.innerHTML = html; sel.dataset.h = CB.hash(html); }
      sel.value = st.jobId || '';
    }
    function drawTo() {
      const j = job(), el = q('[data-to]');
      if (!j) { el.innerHTML = '<span class="sd-to-l">No application selected. Fields come from your resume only.</span>'; return; }
      const c = pickContact(j), stg = CB.STAGE[j.status];
      el.innerHTML = `${UI().chip ? UI().chip(j.status) : E(stg.label)}
        ${c ? `<span class="sd-to-l"><span class="lbl">To</span> <b>${E(c.name)}</b>${c.role ? ' · ' + E(c.role) : ''}${c.email ? ` · <span class="mono">${E(c.email)}</span>` : ''}</span>` : `<span class="sd-to-l">No contact saved for ${E(j.company || 'this job')}.</span><button type="button" class="btn btn-ghost btn-sm" data-addc>${icon('plus')}Add contact</button>`}`;
      const b = el.querySelector('[data-addc]');
      if (b) b.onclick = () => UI().openJob && UI().openJob(j.id, 'contacts');
    }
    function drawFields() {
      sideMode = 'fields';
      const t = curTpl(), j = job(), over = overFor(j);
      const f = fill(t, j, over);
      const used = FIELDS.filter(([k]) => f.used.includes(k)).concat(f.used.filter((k) => !FIELD_LABEL[k]).map((k) => [k, k]));
      q('[data-side]').innerHTML = `<div class="card-h"><h3>Merge fields</h3><span class="sub">${used.length} in this template</span></div>
        <div class="sd-fields">${used.map(([k, l]) => {
          const r = f.vals[k] || { v: '', src: '' };
          const v = over[k] != null ? over[k] : r.v;
          return `<label class="sd-f"><span class="sd-f-k"><span>${E(l)}</span><em>${over[k] != null && over[k] !== r.v ? 'Edited' : r.v ? E(r.src) : 'Missing'}</em></span>
            ${k === 'proofMetric' ? `<textarea class="input" rows="3" data-fk="${E(k)}" placeholder="Add ${E(l.toLowerCase())}">${E(v)}</textarea>` : `<input class="input" data-fk="${E(k)}" value="${E(v)}" placeholder="Add ${E(l.toLowerCase())}">`}</label>`;
        }).join('') || '<p class="sd-note">This template has no merge fields.</p>'}</div>
        <p class="sd-note">Changes here apply to this message only. Missing values show as <mark class="sd-miss">[brackets]</mark> in the preview.${!S().resume ? ' Upload your resume in ATS Lab to fill top skill and proof metric.' : ''}</p>`;
      q('[data-side]').querySelectorAll('[data-fk]').forEach((inp) => (inp.oninput = () => { overFor(job())[inp.dataset.fk] = inp.value; drawPaper(); }));
    }
    function drawEditor() {
      sideMode = 'editor';
      const d = st.draft;
      const builtin = !d.custom;
      q('[data-side]').innerHTML = `<div class="card-h"><h3>${st.isNew ? 'New template' : 'Edit template'}</h3><span class="sub">${builtin ? 'Built-in · reset any time' : 'Your template'}</span></div>
        <div class="sd-ed">
          <label class="field"><span>Name</span><input class="input" data-e="name" value="${E(d.name)}" maxlength="60"></label>
          ${builtin ? '' : `<div class="grid2"><label class="field"><span>Group</span><select class="input" data-e="cat">${CATS.map((c) => `<option${c === d.cat ? ' selected' : ''}>${E(c)}</option>`).join('')}</select></label>
            <label class="field"><span>Type</span><select class="input" data-e="kind"><option value="email"${d.kind !== 'linkedin' ? ' selected' : ''}>Email</option><option value="linkedin"${d.kind === 'linkedin' ? ' selected' : ''}>LinkedIn note (300)</option></select></label></div>
            <label class="field"><span>Log as</span><select class="input" data-e="logKind"><option value="email"${d.logKind !== 'followup' ? ' selected' : ''}>Email on the timeline</option><option value="followup"${d.logKind === 'followup' ? ' selected' : ''}>Follow-up (resets the nudge)</option></select></label>`}
          <label class="field" data-subjw ${d.kind === 'linkedin' ? 'hidden' : ''}><span>Subject</span><input class="input" data-e="subject" value="${E(d.subject)}"></label>
          <label class="field"><span>Message</span><textarea class="input sd-ta" data-e="body" rows="13">${E(d.body)}</textarea></label>
          <div class="sd-ins"><span class="lbl">Insert field</span>${FIELDS.map(([k]) => `<button type="button" class="sd-tok" data-ins="${E(k)}">${E(k)}</button>`).join('')}</div>
          <div class="sd-ed-a">
            <button type="button" class="btn btn-primary" data-save>Save template</button>
            <button type="button" class="btn" data-cancel>Cancel</button>
            <span class="sd-sp"></span>
            ${d.custom && !st.isNew ? `<button type="button" class="btn btn-ghost btn-danger" data-del>${icon('trash')}Delete</button>` : ''}
            ${builtin && curTpl().edited ? '<button type="button" class="btn btn-ghost" data-reset>Reset to default</button>' : ''}
          </div>
        </div>`;
      const side = q('[data-side]');
      let lastFocus = side.querySelector('[data-e="body"]');
      side.querySelectorAll('[data-e]').forEach((inp) => {
        const on = () => { st.draft[inp.dataset.e] = inp.value; if (inp.dataset.e === 'kind') { side.querySelector('[data-subjw]').hidden = inp.value === 'linkedin'; } drawPaper(); };
        inp.oninput = on; inp.onchange = on;
        if (inp.dataset.e === 'subject' || inp.dataset.e === 'body') inp.onfocus = () => { lastFocus = inp; };
      });
      side.querySelectorAll('[data-ins]').forEach((b) => {
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = () => {
          const el = lastFocus;
          const s = el.selectionStart == null ? el.value.length : el.selectionStart, e2 = el.selectionEnd == null ? s : el.selectionEnd;
          const prev = el.value.slice(0, s), tok = (prev && !/[\s(\[]$/.test(prev) ? ' ' : '') + `{{${b.dataset.ins}}}`;
          el.value = el.value.slice(0, s) + tok + el.value.slice(e2);
          el.focus();
          try { el.setSelectionRange(s + tok.length, s + tok.length); } catch (x) { /* noop */ }
          st.draft[el.dataset.e] = el.value;
          drawPaper();
        };
      });
      side.querySelector('[data-save]').onclick = saveDraft;
      side.querySelector('[data-cancel]').onclick = () => { st.editing = false; st.draft = null; st.isNew = false; update(true); };
      const del = side.querySelector('[data-del]');
      if (del) del.onclick = deleteTpl;
      const rs = side.querySelector('[data-reset]');
      if (rs) rs.onclick = resetTpl;
      setTimeout(() => { const n = side.querySelector('[data-e="name"]'); if (n && st.isNew) { n.focus(); n.select(); } }, 30);
    }
    function drawPaper() {
      const t = st.editing && st.draft ? Object.assign({}, curTpl(), st.draft, { limit: st.draft.kind === 'linkedin' ? 300 : 0 }) : curTpl();
      const j = job();
      const f = fill(t, j, overFor(j));
      const li = t.kind === 'linkedin';
      const n = Array.from(f.body).length, lim = t.limit || (li ? 300 : 0);
      const words = f.body.trim() ? f.body.trim().split(/\s+/).length : 0;
      const missing = (f.subjectHtml + f.bodyHtml).split('class="sd-miss"').length - 1;
      const c = j && pickContact(j);
      const share = typeof navigator.share === 'function';
      q('[data-paper]').innerHTML = `<div class="sd-paper-h">
          <div class="sd-paper-t"><div class="eyebrow">${li ? 'LinkedIn note' : 'Email'} · ${E(t.cat || 'Custom')}${st.editing ? ' · Editing' : ''}</div><h2 class="sd-title">${E(t.name || 'Untitled template')}</h2></div>
          ${st.editing ? '' : `<div class="sd-tools"><button type="button" class="btn btn-ghost btn-sm" data-edit>${UI().icon ? UI().icon(PEN) : ''}Edit</button><button type="button" class="btn btn-ghost btn-sm" data-dup>${icon('doc')}Duplicate</button></div>`}
        </div>
        <div class="sd-letter">
          ${li ? '' : `<div class="sd-subj"><span class="lbl">Subject</span><span class="sd-subj-t">${f.subjectHtml || '<span class="muted">No subject</span>'}</span>${f.subject ? `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-copys title="Copy subject" aria-label="Copy subject">${icon('doc')}</button>` : ''}</div>`}
          <div class="sd-body">${f.bodyHtml || '<span class="muted">Empty message</span>'}</div>
        </div>
        ${lim ? `<div class="sd-count${n > lim ? ' over' : ''}"><span class="mono"><b>${n}</b> / ${lim}</span><span class="sd-cbar"><i style="width:${Math.min(100, Math.round((n / lim) * 100))}%"></i></span><span class="sd-cmsg">${n > lim ? `${n - lim} over LinkedIn's limit. Trim the proof metric or the closing.` : `${lim - n} characters left`}</span></div>`
          : `<div class="sd-meta mono">${words} words · about ${Math.max(10, Math.round(words / 3.6 / 5) * 5)} seconds to read${missing ? ` · <span class="sd-mcount">${missing} to fill in</span>` : ''}</div>`}
        <div class="sd-acts">
          <button type="button" class="btn btn-accent" data-copy>${icon('doc')}Copy ${li ? 'note' : 'message'}</button>
          ${!li && c && c.email ? `<a class="btn" data-mail href="mailto:${E(c.email)}?subject=${E(encodeURIComponent(f.subject))}&body=${E(encodeURIComponent(f.body))}">${icon('mail')}Email</a>` : ''}
          ${share ? `<button type="button" class="btn" data-share>${icon('send')}Share</button>` : ''}
          <button type="button" class="btn" data-log ${j ? '' : 'disabled title="Pick an application first"'}>${icon('check')}Log as sent</button>
        </div>
        <p class="sd-foot">${j ? `Log as sent adds ${t.logKind === 'followup' ? 'a follow-up' : 'an email'} to ${E(j.company || 'the job')}'s timeline${t.logKind === 'followup' && CB.STAGE[j.status].group === 'active' ? ` and moves the next follow-up to ${E(CB.fmtDate(CB.addDays(CB.todayISO(), +S().settings.followUpDays || 7)))}` : ''}${t.id === 'thanks' ? ', and ticks the thank-you for that interview' : ''}.` : 'Pick an application to fill the fields and log the message.'}</p>`;
      const P = q('[data-paper]');
      P.querySelector('[data-copy]').onclick = () => UI().copy && UI().copy(f.body);
      const cs = P.querySelector('[data-copys]');
      if (cs) cs.onclick = () => UI().copy && UI().copy(f.subject);
      const sh = P.querySelector('[data-share]');
      if (sh) sh.onclick = async () => { try { await navigator.share(li ? { text: f.body } : { title: f.subject, text: f.body }); } catch (e) { if (!e || e.name !== 'AbortError') toast('Sharing is not available here. Use Copy instead.', { tone: 'warn' }); } };
      P.querySelector('[data-log]').onclick = () => logSent(t, f);
      const ed = P.querySelector('[data-edit]');
      if (ed) ed.onclick = () => { const c0 = curTpl(); st.editing = true; st.isNew = false; st.draft = { id: c0.id, name: c0.name, cat: c0.cat, kind: c0.kind, logKind: c0.logKind, subject: c0.subject, body: c0.body, custom: !!c0.custom }; update(true); };
      const du = P.querySelector('[data-dup]');
      if (du) du.onclick = duplicate;
    }

    async function saveDraft() {
      const d = st.draft;
      if (!d) return;
      if (!String(d.body || '').trim()) { toast('The message is empty.', { tone: 'warn' }); return; }
      const doc = docGet();
      if (d.custom) {
        const rec = { id: d.id, name: String(d.name || '').trim().slice(0, 60) || 'Untitled template', cat: CATS.includes(d.cat) ? d.cat : 'Custom', kind: d.kind === 'linkedin' ? 'linkedin' : 'email', logKind: d.logKind === 'followup' ? 'followup' : 'email', subject: d.kind === 'linkedin' ? '' : String(d.subject || ''), body: String(d.body || ''), updatedAt: CB.nowISO() };
        const i = doc.custom.findIndex((x) => x && x.id === d.id);
        if (i >= 0) doc.custom[i] = Object.assign({}, doc.custom[i], rec); else doc.custom.push(Object.assign({ createdAt: CB.nowISO() }, rec));
      } else {
        doc.overrides[d.id] = { name: String(d.name || '').trim().slice(0, 60), subject: String(d.subject || ''), body: String(d.body || '') };
      }
      if (await docSet(doc)) {
        st.tplId = d.id; st.editing = false; st.draft = null; st.isNew = false;
        update(true);
        toast('Template saved');
      }
    }
    async function duplicate() {
      const t = curTpl();
      const doc = docGet();
      const rec = { id: CB.uid('tpl_'), name: (t.name + ' (copy)').slice(0, 60), cat: t.cat === 'Custom' ? 'Custom' : t.cat, kind: t.kind, logKind: t.logKind, subject: t.subject, body: t.body, createdAt: CB.nowISO(), updatedAt: CB.nowISO() };
      doc.custom.push(rec);
      if (await docSet(doc)) {
        st.tplId = rec.id; st.editing = true; st.isNew = false;
        st.draft = Object.assign({ custom: true }, rec);
        update(true);
        toast('Duplicated. Edit your copy, then save.');
      }
    }
    async function deleteTpl() {
      const d = st.draft;
      if (!d || !d.custom) return;
      if (UI().confirm && !(await UI().confirm({ title: 'Delete template?', text: `"${d.name}" will be removed from every device.`, ok: 'Delete', danger: true }))) return;
      const doc = docGet();
      doc.custom = doc.custom.filter((x) => x && x.id !== d.id);
      if (await docSet(doc)) { st.editing = false; st.draft = null; st.tplId = suggest(job()); update(true); toast('Template deleted'); }
    }
    async function resetTpl() {
      const d = st.draft;
      if (!d) return;
      const doc = docGet();
      delete doc.overrides[d.id];
      if (await docSet(doc)) { st.editing = false; st.draft = null; update(true); toast('Restored the original template'); }
    }

    root.querySelector('[data-job]').onchange = (e) => { st.jobId = e.target.value || null; if (!st.editing) st.tplId = suggest(job()); update(true); };
    root.querySelector('[data-tsel]').onchange = (e) => { if (st.editing) return; st.tplId = e.target.value; update(true); };
    root.querySelector('[data-new]').onclick = () => {
      if (st.editing) return;
      st.editing = true; st.isNew = true;
      st.draft = { id: CB.uid('tpl_'), name: 'Untitled template', cat: 'Custom', kind: 'email', logKind: 'email', subject: '', body: 'Hi {{contact.first}},\n\n\n\nBest,\n{{myName}}', custom: true };
      update(true);
    };
    update(true);
  }

  function logSent(t, f) {
    const j = t && f && st.jobId ? S().get(st.jobId) : null;
    if (!j) { toast('Pick an application first.'); return; }
    const kind = t.logKind === 'followup' ? 'followup' : 'email';
    const c = pickContact(j);
    const text = `${t.name}: ${t.kind === 'linkedin' ? 'LinkedIn note' : 'email'} sent${c ? ' to ' + c.name : ''}${f.subject ? ` · "${f.subject.slice(0, 90)}"` : ''}`;
    S().log(j.id, kind, text);
    const iv = pickInterview(j);
    const fu = +S().settings.followUpDays || 7;
    const next = CB.addDays(CB.todayISO(), fu);
    let ticked = false, moved = false;
    S().update(j.id, (x) => {
      if (t.id === 'thanks' && iv) {
        const i = (x.interviews || []).find((v) => v.id === iv.id);
        if (i && !i.thankYouSent) { i.thankYouSent = true; const d = CB.parseDate(i.datetime); if (i.outcome === 'Scheduled' && d && d < new Date()) i.outcome = 'Completed'; ticked = true; }
      }
      if (kind === 'followup' && CB.STAGE[x.status].group === 'active') { x.followUpDate = next; moved = true; }
      return ticked || moved ? undefined : false;
    }, { silent: true });
    toast(`Logged on ${j.company || 'the job'}'s timeline${moved ? ' · next follow-up ' + CB.fmtDate(next) : ''}${ticked ? ' · thank-you ticked' : ''}`, { undo: true });
  }

  CB.registerView({ key: 'studio', label: 'Studio', icon: PEN, sec: 'Analyze', crumb: 'Messages written from your own data', order: 25, render });
  CB.registerDrawerAction({ key: 'msg', icon: 'mail', title: 'Write message', order: 41, run: (j) => open({ jobId: j.id }) });

  // Cal: "write a thank-you note to Lumen Bank", "write a follow-up for Cobalt AI"
  function findJob(who) {
    const q = ' ' + String(who || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\b(the|my|at|role|job|position|recruiter|hiring manager|team|interviewer|application|people|folks)\b/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    if (!q.trim()) return null;
    let best = null, bs = 0;
    S().list().forEach((j) => {
      const co = String(j.company || '').toLowerCase().trim();
      let s = 0;
      if (co && q.includes(' ' + co + ' ')) s += 100;
      else if (co && q.trim() && co.includes(q.trim())) s += 60;
      co.split(/\s+/).filter((w) => w.length > 2).forEach((w) => { if (q.includes(' ' + w + ' ')) s += 12; });
      (j.contacts || []).forEach((c) => { const fn = String(c.name || '').toLowerCase().split(/\s+/)[0]; if (fn.length > 2 && q.includes(' ' + fn + ' ')) s += 10; });
      if (s && CB.STAGE[j.status].group !== 'closed') s += 2;
      if (s > bs || (s === bs && s > 0 && best && byRecent(j, best) < 0)) { bs = s; best = j; }
    });
    return bs >= 10 ? best : null;
  }
  if (CB.Cal && typeof CB.Cal.registerIntent === 'function') {
    const RE = /(?:write|draft|compose) (a |an |my )?(follow[- ]?up|thank[- ]?you|message|note|email)(?: (?:note|email|message|letter))? (to|for) (.+)/i;
    CB.Cal.registerIntent(RE, (text, say) => {
      if (!ready()) return false;
      const m = RE.exec(text);
      if (!m) return false;
      const who = m[4].replace(/[.?!]+$/, '').replace(/\b(note|email|message)\b/gi, ' ').trim();
      const j = findJob(who);
      if (!j) { say(`I couldn't find an application for **${who}**. Use the company name as it appears on your board, or open **Studio** and pick it there.`); return true; }
      const kind = m[2].toLowerCase();
      const tplId = /^follow/.test(kind) ? (['interview', 'final', 'screen', 'assessment'].includes(j.status) ? 'status' : j.status === 'ghosted' ? 'stayintouch' : 'followup7') : /^thank/.test(kind) ? 'thanks' : kind === 'note' && j.status === 'saved' ? 'linkedin' : suggest(j);
      open({ jobId: j.id, tplId });
      const t = templates().find((x) => x.id === tplId);
      say(`Opened **Studio** with the **${t ? t.name : 'template'}** for **${j.company}**. The fields come from the application and your resume. Copy it, send it, then tap **Log as sent**.`);
      return true;
    });
  }

  CB.css('feat-studio', `
.sd{display:grid;grid-template-columns:264px minmax(0,1fr);gap:16px;align-items:start}
.sd-wait{padding:40px 0}
.sd-rail{padding:14px 10px 10px;position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto;overscroll-behavior:contain}
.sd-rail-h{display:flex;align-items:center;justify-content:space-between;padding:0 6px 8px}
.sd-list.is-locked{opacity:.45;pointer-events:none}
.sd-grp{display:grid;gap:1px;padding:6px 0}
.sd-grp+.sd-grp{border-top:1px solid var(--line-1);margin-top:4px;padding-top:10px}
.sd-grp-l{padding:2px 8px 6px;font:500 10px/14px var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)}
.sd-tpl{position:relative;display:grid;gap:3px;width:100%;padding:8px 26px 8px 10px;border:0;border-radius:var(--r-sm);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background var(--dur-1) var(--ease-out)}
.sd-tpl:hover{background:var(--surface-2)}
.sd-tpl:focus-visible{outline:none;box-shadow:var(--focus)}
.sd-tpl.is-on{background:var(--surface-3);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-2),inset 2px 0 0 var(--gold-300)}
.sd-tpl-n{font-weight:540;font-size:13px;line-height:17px;color:var(--ink-1)}
.sd-tpl-n em{margin-left:6px;font:500 9px/1 var(--f-mono);font-style:normal;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-text);vertical-align:1px}
.sd-tpl-m{font:450 10.5px/14px var(--f-mono);color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sd-sug{position:absolute;right:10px;top:13px;width:6px;height:6px;border-radius:50%;background:var(--gold-300);box-shadow:0 0 0 3px var(--gold-soft)}
.sd-main{display:grid;gap:16px;min-width:0}
.sd-top{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 18px;padding:14px 18px}
.sd-jobf{flex:1 1 300px;max-width:440px}
.sd-tself{display:none}
.sd-to{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:38px;font-size:13px;color:var(--ink-2)}
.sd-to-l{display:inline-flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.sd-to-l b{font-weight:560;color:var(--ink-1)}
.sd-to .mono{font-size:12px;color:var(--ink-3)}
.sd-work{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}
.sd-paper{padding:22px 24px 18px}
.sd-paper-h{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.sd-paper-t{min-width:0}
.sd-title{margin:8px 0 0;font:400 28px/1.12 var(--f-display);letter-spacing:-.015em;color:var(--ink-1)}
.sd-tools{display:flex;gap:4px}
.sd-letter{position:relative;padding:22px 24px 24px;border-radius:var(--r-md);background:var(--surface-2);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-1)}
.sd-letter::before{content:"";position:absolute;left:24px;right:24px;top:0;height:1px;background:linear-gradient(90deg,transparent,var(--gold-line) 18%,var(--gold-line) 50%,transparent)}
.sd-subj{display:flex;align-items:center;gap:12px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--line-1)}
.sd-subj-t{flex:1;min-width:0;font-weight:560;font-size:14.5px;line-height:1.45;color:var(--ink-1)}
.sd-body{max-width:68ch;font-size:14.5px;line-height:1.72;color:var(--ink-1);white-space:pre-wrap;overflow-wrap:anywhere}
.sd-v{background:none;color:inherit;text-decoration:underline;text-decoration-color:var(--gold-line);text-decoration-thickness:1px;text-underline-offset:4px}
.sd-v.is-def{text-decoration-style:dotted}
.sd-miss{background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);border-radius:4px;padding:0 3px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--warning) 28%,transparent)}
.sd-meta{margin:12px 2px 0;font-size:11px;color:var(--ink-3)}
.sd-mcount{color:var(--warning)}
.sd-count{display:grid;grid-template-columns:auto minmax(80px,1fr);gap:6px 12px;align-items:center;margin:14px 2px 0;font-size:12px;color:var(--ink-3)}
.sd-count b{font-weight:500;color:var(--ink-1)}
.sd-cbar{height:3px;border-radius:2px;background:var(--track);overflow:hidden}
.sd-cbar i{display:block;height:100%;border-radius:inherit;background:var(--metal-cta);transition:width var(--dur-2) var(--ease-out)}
.sd-cmsg{grid-column:1/-1;font-size:11.5px}
.sd-count.over b,.sd-count.over .sd-cmsg{color:var(--danger)}
.sd-count.over .sd-cbar i{background:var(--danger)}
.sd-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.sd-foot{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--ink-3)}
.sd-side{padding:16px 16px 14px}
.sd-fields{display:grid;gap:12px}
.sd-f{display:grid;gap:5px}
.sd-f-k{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:500;color:var(--ink-2)}
.sd-f-k em{font:500 9.5px/16px var(--f-mono);font-style:normal;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-4)}
.sd-f .input{font-size:13px}
.sd-f textarea.input{resize:vertical;line-height:1.45}
.sd-note{margin:12px 0 0;font-size:11.5px;line-height:1.55;color:var(--ink-3)}
.sd-ed{display:grid;gap:12px}
.sd-ta{min-height:260px;resize:vertical;font-size:13px;line-height:1.6}
.sd-ins{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.sd-ins .lbl{width:100%;margin-bottom:2px}
.sd-tok{height:22px;padding:0 7px;border:0;border-radius:var(--r-xs);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-2);font:450 10.5px/1 var(--f-mono);color:var(--ink-2);cursor:pointer}
.sd-tok:hover{color:var(--gold-text);box-shadow:inset 0 0 0 1px var(--gold-line)}
.sd-ed-a{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:4px}
.sd-sp{flex:1}
@media (max-width:1180px){
  .sd{grid-template-columns:minmax(0,1fr)}
  .sd-rail{display:none}
  .sd-tself{display:grid;flex:1 1 220px;max-width:340px}
  .sd-work{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:560px){
  .sd-top{padding:14px}
  .sd-jobf,.sd-tself{flex-basis:100%;max-width:none}
  .sd-paper{padding:16px 14px 14px}
  .sd-title{font-size:24px}
  .sd-letter{padding:16px 16px 18px}
  .sd-letter::before{left:16px;right:16px}
  .sd-body{font-size:14px;line-height:1.66}
  .sd-acts .btn{flex:1 1 auto}
}
`);

  CB.Studio = { open, templates, resolve, fill, suggest };
})();

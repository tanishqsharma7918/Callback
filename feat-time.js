/* Callback v3 — feat-time (owned per docs/BUILD.md)
 * 1. Reminders that actually fire (competitors.md rec 2): RFC 5545 calendar files with VALARM alarms for interviews
 *    (-P1D, -PT1H), follow-ups (all-day, 9:00), offer decisions and apply-by deadlines (9:00 the day before + on the day).
 *    Standalone PWA → CB.saveFile(.ics, text/calendar) (iOS share sheet / download). claude.ai → zipped with JSZip
 *    because the viewer's downloads capability rejects .ics. Home Screen badge = Action Center items due (sev 1–2).
 * 2. Apply Next queue + ghost-job risk (rec 3): Saved jobs ranked by EV = P × F × S × X × R × (1 − 0.6·G), every
 *    ghost signal shown as a chip with its weight; jobs are never hidden.
 * Public: CB.ICS (pure generator; node-testable), CB.Time {events, exportEvents, exportAll, exportJob, rank, insight, dueCount, updateBadge}.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});

  // ═════════════════════════ RFC 5545 generator (pure, no DOM) ═════════════════════════
  const ICS = (CB.ICS = {});
  const CRLF = '\r\n';
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  /** TEXT value escaping (RFC 5545 §3.3.11): \\ \; \, and newlines → \n. Control characters are dropped. */
  ICS.escape = (v) => String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
  const octets = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
  /** Fold a content line at 75 octets (UTF-8), never inside a multi-byte character: CRLF + one space. */
  ICS.fold = (line) => {
    let out = '', n = 0;
    for (const ch of String(line)) {
      const k = octets(ch.codePointAt(0));
      if (n + k > 75) { out += CRLF + ' '; n = 1; }
      out += ch;
      n += k;
    }
    return out;
  };
  ICS.utc = (d) => d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  const ymd = (iso) => /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  ICS.dateValue = (iso) => { const m = ymd(iso); return m ? m[1] + m[2] + m[3] : ''; };
  ICS.nextDateValue = (iso) => {
    const m = ymd(iso);
    if (!m) return '';
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
    return t.getUTCFullYear() + p2(t.getUTCMonth() + 1) + p2(t.getUTCDate());
  };
  ICS.uid = (s) => (String(s || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120) || 'x' + Date.now().toString(36)) + '@callback';
  const URI_RE = /^https?:\/\/[^\s"<>\\^`{|}]+$/i;
  /**
   * ev: {uid, seq, summary, description, location, url, category, alarms:['-P1D', ...], alarmText,
   *      start: Date, end: Date  (timed, written in UTC)  |  allDay: 'YYYY-MM-DD' (DATE, DTEND = next day)}
   */
  ICS.vevent = (ev, stamp) => {
    const L = ['BEGIN:VEVENT', 'UID:' + ICS.uid(ev.uid), 'SEQUENCE:' + Math.max(0, ev.seq | 0), 'DTSTAMP:' + stamp];
    if (ev.allDay) L.push('DTSTART;VALUE=DATE:' + ICS.dateValue(ev.allDay), 'DTEND;VALUE=DATE:' + ICS.nextDateValue(ev.allDay));
    else {
      const s = ev.start instanceof Date ? ev.start : new Date(ev.start);
      let e = ev.end instanceof Date ? ev.end : new Date(ev.end);
      if (!(e > s)) e = new Date(s.getTime() + 45 * 60000); // DTEND must never equal DTSTART
      L.push('DTSTART:' + ICS.utc(s), 'DTEND:' + ICS.utc(e));
    }
    L.push('SUMMARY:' + ICS.escape(ev.summary || 'Callback'));
    if (ev.location) L.push('LOCATION:' + ICS.escape(ev.location));
    if (ev.url && URI_RE.test(ev.url)) L.push('URL:' + ev.url);
    if (ev.description) L.push('DESCRIPTION:' + ICS.escape(ev.description));
    if (ev.category) L.push('CATEGORIES:' + ICS.escape(ev.category));
    L.push('STATUS:CONFIRMED', 'TRANSP:' + (ev.allDay ? 'TRANSPARENT' : 'OPAQUE'));
    (ev.alarms || []).forEach((t) => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + ICS.escape(ev.alarmText || ev.summary || 'Reminder'), 'TRIGGER:' + t, 'END:VALARM'));
    L.push('END:VEVENT');
    return L;
  };
  /** Whole VCALENDAR, folded, CRLF line endings (including the last line). opts: {now: Date, name} */
  ICS.build = (events, opts = {}) => {
    const stamp = ICS.utc(opts.now instanceof Date ? opts.now : new Date());
    let L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Callback//Job Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + ICS.escape(opts.name || 'Callback')];
    (events || []).forEach((ev) => { L = L.concat(ICS.vevent(ev, stamp)); });
    L.push('END:VCALENDAR');
    return L.map(ICS.fold).join(CRLF) + CRLF;
  };

  // Everything below needs the app (browser + platform registries).
  if (typeof document === 'undefined' || typeof CB.registerDashCard !== 'function' || !CB.STAGE) return;

  const E = (s) => CB.esc(s);
  const S = () => CB.Store;
  const UI = () => CB.UI || {};
  const icon = (n) => (UI().icon ? UI().icon(n) : '');
  const toast = (t, o) => { if (UI().toast) UI().toast(t, o); else console.warn(t); };
  const ready = () => !!(S() && S().ready);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pct = (p) => (p < 0.1 ? (Math.round(p * 1000) / 10).toFixed(1) : Math.round(p * 100)) + '%';
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const at9 = (iso) => { const m = ymd(iso); return m ? new Date(+m[1], +m[2] - 1, +m[3], 9) : new Date(); };
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'events';
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hm = (d) => { let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${p2(d.getMinutes())} ${ap}`; };
  const rel = (n) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

  // ═════════════════════════ calendar events ═════════════════════════
  const KIND = {
    interview: { label: 'Interview', c: 'var(--st-interview)' },
    followup: { label: 'Follow-up', c: 'var(--info)' },
    offer: { label: 'Offer decision', c: 'var(--st-offer)' },
    apply: { label: 'Apply by', c: 'var(--warning)' },
  };
  function appUrl() {
    try { if (CB.standalone && /^https?:$/.test(location.protocol)) return location.origin + location.pathname; } catch (e) { /* noop */ }
    return '';
  }
  /** Upcoming calendar events for `jobs` (sorted). Interviews: Scheduled + in the future. Dates: today or later. */
  function events(jobs, opts = {}) {
    const now = opts.now || new Date();
    const today = CB.toISODate(now);
    const url = appUrl();
    const out = [];
    for (const j of jobs || []) {
      const st = CB.STAGE[j.status];
      if (!st) continue;
      const co = j.company || 'Company', ti = j.title || 'Role';
      if (st.group !== 'closed') {
        for (const iv of j.interviews || []) {
          if (iv.outcome !== 'Scheduled' || !iv.datetime) continue;
          const start = CB.parseDate(iv.datetime);
          if (!start || !(start > now)) continue;
          const dur = Math.max(15, +iv.durationMin || 45);
          const link = String(iv.link || '').trim();
          const d = [`${ti} at ${co}`, `Round ${iv.round || 1} · ${iv.type || 'Interview'}${iv.interviewer ? ' with ' + iv.interviewer : ''} · ${dur} min`];
          if (link) d.push('Join: ' + link);
          d.push('', 'Prep checklist', '- Re-read the job description and your notes', '- Pick 3 stories with numbers that prove the must-haves', '- Prepare 3 questions to ask', '- Test the link, camera and audio 10 minutes early', '- Send a thank-you note within 24 hours');
          if (iv.notes) d.push('', 'Notes: ' + iv.notes);
          if (url) d.push('', 'Open Callback: ' + url);
          out.push({
            key: 'iv:' + iv.id, uid: iv.id, kind: 'interview', jobId: j.id, company: co, title: ti, start, end: new Date(start.getTime() + dur * 60000), at: start,
            label: iv.type || 'Interview', summary: `Interview · ${iv.type || 'Interview'} · ${co}`, location: link, url: link, description: d.join('\n'),
            category: 'Interview', alarms: ['-P1D', '-PT1H'],
          });
        }
      }
      if (st.group === 'active' && ISO_RE.test(j.followUpDate || '') && j.followUpDate >= today) {
        const d = [`${ti} at ${co}`, j.appliedDate ? `Applied ${CB.fmtDate(j.appliedDate, true)}.` : '', 'Send a short, specific follow-up. Callback\'s Studio has a ready template; log it as sent so the next nudge moves.'].filter(Boolean);
        if (url) d.push('', 'Open Callback: ' + url);
        out.push({ key: 'fu:' + j.id, uid: 'fu-' + j.id, kind: 'followup', jobId: j.id, company: co, title: ti, allDay: j.followUpDate, at: at9(j.followUpDate), label: 'Follow up', summary: `Follow up · ${co}`, description: d.join('\n'), category: 'Follow-up', alarms: ['PT9H'] });
      }
      if (j.status === 'offer' && j.offer && ISO_RE.test(j.offer.deadline || '') && j.offer.deadline >= today) {
        const d = [`${ti} at ${co}`, 'Offer decision due today. Compare, negotiate once, then answer in writing.'];
        if (url) d.push('', 'Open Callback: ' + url);
        out.push({ key: 'of:' + j.id, uid: 'offer-' + j.id, kind: 'offer', jobId: j.id, company: co, title: ti, allDay: j.offer.deadline, at: at9(j.offer.deadline), label: 'Offer decision due', summary: `Offer decision due · ${co}`, description: d.join('\n'), category: 'Offer', alarms: ['-PT15H', 'PT9H'] });
      }
      if (j.status === 'saved' && ISO_RE.test(j.deadline || '') && j.deadline >= today) {
        const d = [`${ti} at ${co}`, 'Last day to apply.'];
        if (j.url) d.push('Posting: ' + j.url);
        if (url) d.push('', 'Open Callback: ' + url);
        out.push({ key: 'ap:' + j.id, uid: 'apply-' + j.id, kind: 'apply', jobId: j.id, company: co, title: ti, allDay: j.deadline, at: at9(j.deadline), label: 'Apply by', summary: `Apply by · ${ti} · ${co}`, url: j.url || '', description: d.join('\n'), category: 'Deadline', alarms: ['-PT15H', 'PT9H'] });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // SEQUENCE per UID (re-exports replace the old event) + last export time, synced like every other kv doc.
  let calKv = null;
  const calStore = () => {
    if (!calKv && S() && typeof S().kv === 'function') { try { calKv = S().kv('calendar'); } catch (e) { calKv = null; } }
    return calKv;
  };
  function assignSeq(evs) {
    const k = calStore();
    const doc = (k && k.get()) || {};
    const seq = Object.assign({}, doc.seq || {});
    evs.forEach((ev) => { const id = ICS.uid(ev.uid); ev.seq = seq[id] == null ? 0 : (+seq[id] || 0) + 1; delete seq[id]; seq[id] = ev.seq; });
    const keys = Object.keys(seq);
    if (keys.length > 400) keys.slice(0, keys.length - 400).forEach((x) => delete seq[x]);
    if (k) k.set({ seq, lastExportAt: CB.nowISO(), lastCount: evs.length }).catch(() => { /* re-export still works, SEQUENCE just repeats */ });
  }

  function fallback(text, name, why) {
    if (!UI().modal) { toast(why || 'The calendar file could not be saved here.', { tone: 'bad' }); return; }
    UI().modal({
      title: 'Add to Calendar',
      body: `<p class="ics-fb-p">${E(why || 'The file could not be saved here.')} Copy the text below into a file named <b>${E(name)}</b> and open it, or export again from the installed app.</p><textarea class="input ics-fb-t" readonly rows="9" aria-label="Calendar file text">${E(text)}</textarea>`,
      foot: '<button class="btn" data-c>Close</button><button class="btn btn-primary" data-copy>Copy calendar text</button>',
      onMount: (m, api) => { m.querySelector('[data-c]').onclick = () => api.close(); m.querySelector('[data-copy]').onclick = () => UI().copy(text); },
    });
  }
  let busy = false;
  /** Build one .ics for `evs` and hand it to the user. Resolves {ok, n, zipped} | {ok:false, code}. */
  async function exportEvents(evs, slug, emptyMsg) {
    if (!evs || !evs.length) { toast(emptyMsg || 'Nothing upcoming yet. Interviews, follow-up dates and deadlines appear here once they have dates.'); return { ok: false, code: 'empty' }; }
    if (busy) return { ok: false, code: 'busy' };
    busy = true;
    try {
      assignSeq(evs);
      const text = ICS.build(evs, { name: 'Callback' });
      const name = 'callback-' + slugify(slug) + '.ics';
      const n = evs.length, what = n + ' event' + (n === 1 ? '' : 's');
      if (CB.standalone) {
        const r = await CB.saveFile(name, text, 'text/calendar');
        if (r && r.ok === false) { if (r.code !== 'declined') fallback(text, name, r.message); return r; }
        toast(`Calendar file ready · ${what} with alarms. Open it to add ${n === 1 ? 'it' : 'them'} to your calendar.`, { ms: 6500 });
        CB.emit('calendar:exported', { n });
        return { ok: true, n };
      }
      // claude.ai: the downloads capability rejects .ics, so the calendar travels inside a .zip.
      let blob;
      try {
        await CB.loadScript(CB.LIBS.jszip);
        const zip = new window.JSZip();
        zip.file(name, text, { date: new Date() });
        blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
      } catch (e) {
        fallback(text, name, 'The zip helper could not load here, so the calendar text is below instead.');
        return { ok: false, code: 'zip' };
      }
      const zname = name.replace(/\.ics$/, '.zip');
      const r = await CB.saveFile(zname, blob, 'application/zip');
      if (r && r.ok === false) { if (r.code !== 'declined') fallback(text, name, r.message); return r; }
      toast(`Saved ${zname} · claude.ai can't download .ics files, so ${what} are zipped. Unzip it and open the .ics to add them with alarms.`, { ms: 9000 });
      CB.emit('calendar:exported', { n, zipped: true });
      return { ok: true, n, zipped: true };
    } catch (e) {
      CB.reportError(e, { where: 'calendar:export' });
      return { ok: false, code: 'error' };
    } finally { busy = false; }
  }
  const exportAll = () => (ready() ? exportEvents(events(S().list()), 'upcoming') : Promise.resolve({ ok: false, code: 'loading' }));
  const exportJob = (job) => {
    const j = job && S().get(job.id || job);
    if (!j) return Promise.resolve({ ok: false, code: 'missing' });
    return exportEvents(events([j]), (j.company || 'job') + '-' + (j.title || ''), `Nothing upcoming for ${j.company || 'this job'} yet. Add an interview, a follow-up date or a deadline first.`);
  };

  // ═════════════════════════ app badge ═════════════════════════
  let badgeLast = -1;
  function dueCount() {
    if (!ready() || !CB.Auto) return 0;
    const s = S();
    return CB.Auto.compute(s.list(), s.settings || {}, s.atsMap()).filter((a) => a.sev <= 2).length;
  }
  function updateBadge(force) {
    const nav = navigator;
    if (typeof nav.setAppBadge !== 'function' || !ready()) return;
    let n = 0;
    try { n = dueCount(); } catch (e) { return; }
    if (n === badgeLast && !force) return;
    badgeLast = n;
    try {
      const p = n > 0 ? nav.setAppBadge(n) : typeof nav.clearAppBadge === 'function' ? nav.clearAppBadge() : nav.setAppBadge(0);
      if (p && typeof p.catch === 'function') p.catch(() => { /* not installed / not allowed */ });
    } catch (e) { /* unsupported */ }
  }
  CB.on('data', CB.debounce(() => updateBadge(false), 700));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateBadge(true); });

  // ═════════════════════════ Apply Next: EV + ghost-job risk ═════════════════════════
  // Huntr 2025 interview rate by source (competitors.md). Everything else → .04.
  const BENCH = [[/google/i, 0.113, 'Google Jobs'], [/government\s?jobs|usajobs/i, 0.087, 'GovernmentJobs'], [/wellfound|angel/i, 0.06, 'Wellfound'], [/glassdoor/i, 0.055, 'Glassdoor'], [/handshake/i, 0.051, 'Handshake'], [/indeed/i, 0.045, 'Indeed'], [/welcome to the jungle|wttj/i, 0.045, 'Welcome to the Jungle'], [/linkedin/i, 0.031, 'LinkedIn'], [/ziprecruiter/i, 0.028, 'ZipRecruiter'], [/\bdice\b/i, 0.0035, 'Dice']];
  const bench = (src) => { for (const b of BENCH) if (b[0].test(src || '')) return { rate: b[1], name: b[2] }; return { rate: 0.04, name: 'all sources' }; };
  const EVERGREEN = /talent (pool|community)|future opportunit|evergreen|always (hiring|accepting)/i;
  // Pay-transparency jurisdictions (posting must carry a range). VA from 2026-07-01, ME from 2026-07-29.
  const PAY = { CA: 'California', CO: 'Colorado', WA: 'Washington', NY: 'New York', IL: 'Illinois', MN: 'Minnesota', MD: 'Maryland', HI: 'Hawaii', VT: 'Vermont', MA: 'Massachusetts', NJ: 'New Jersey', DC: 'Washington, DC', VA: 'Virginia', ME: 'Maine' };
  const PAY_FROM = { VA: '2026-07-01', ME: '2026-07-29' };
  const PAY_NAMES = [[/\bcalifornia\b/i, 'CA'], [/\bcolorado\b/i, 'CO'], [/\bwashington,?\s*d\.?\s?c\b|district of columbia/i, 'DC'], [/\bwashington\b/i, 'WA'], [/\bnew york\b|\bnyc\b|brooklyn|manhattan/i, 'NY'], [/\billinois\b|\bchicago\b/i, 'IL'], [/\bminnesota\b|minneapolis|st\.? paul/i, 'MN'], [/\bmaryland\b|baltimore/i, 'MD'], [/\bhawaii\b|honolulu/i, 'HI'], [/\bvermont\b/i, 'VT'], [/\bmassachusetts\b|\bboston\b/i, 'MA'], [/\bnew jersey\b|jersey city|hoboken|newark/i, 'NJ'], [/\bvirginia\b/i, 'VA'], [/\bmaine\b/i, 'ME'], [/seattle|bellevue|redmond|tacoma|spokane/i, 'WA'], [/san francisco|los angeles|san diego|san jose|oakland|palo alto|mountain view|sunnyvale|santa monica|irvine|sacramento/i, 'CA'], [/denver|boulder/i, 'CO']];
  function payState(loc, today) {
    const s = String(loc || '');
    if (!s.trim()) return null;
    let code = null;
    const m = /(?:^|,\s*|\(\s*)(CA|CO|WA|NY|IL|MN|MD|HI|VT|MA|NJ|DC|VA|ME)\b/.exec(s);
    if (m) code = m[1];
    if (!code) for (const [re, c] of PAY_NAMES) if (re.test(s)) { code = c; break; }
    if (!code || (PAY_FROM[code] && today < PAY_FROM[code])) return null;
    return code;
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const seenDate = (j) => (ISO_RE.test(j.firstSeenDate || '') ? j.firstSeenDate : ISO_RE.test(j.postedDate || '') ? j.postedDate : String(j.createdAt || '').slice(0, 10)) || CB.todayISO();
  function groupCtx(jobs) {
    const ghosted = {}, seen = {};
    for (const j of jobs) {
      const co = norm(j.company);
      if (!co) continue;
      if (j.status === 'ghosted') ghosted[co] = (ghosted[co] || 0) + 1;
      (seen[co + '|' + norm(j.title)] = seen[co + '|' + norm(j.title)] || []).push({ id: j.id, d: seenDate(j) });
    }
    return { ghosted, seen };
  }
  /** Ghost-job risk: capped sum of transparent signals. {score 0..1, level, signals:[{code,label,detail,weight}], age} */
  function ghostRisk(j, g, today) {
    const sig = [];
    const add = (code, label, detail, weight) => sig.push({ code, label, detail, weight });
    const jd = String(j.jd || '');
    if (j.reposted === true || /\breposted\b/i.test(jd) || (j.tags || []).some((t) => /repost/i.test(t))) add('reposted', 'Reposted', 'The posting says it was reposted, which often means a requisition that never closed.', 0.25);
    const ref = ISO_RE.test(j.postedDate || '') ? j.postedDate : ISO_RE.test(j.firstSeenDate || '') ? j.firstSeenDate : '';
    const age = ref ? CB.daysBetween(ref, today) : null;
    if (age != null && age > 60) add('age', `Posted ${age} days ago`, 'Older than 60 days. Most roles fill or close within six to eight weeks.', 0.35);
    else if (age != null && age > 30) add('age', `Posted ${age} days ago`, 'Older than 30 days, past the window where most interviews are given.', 0.2);
    if (j.evergreen === true || EVERGREEN.test(jd)) add('evergreen', 'Evergreen wording', 'Phrases like "talent pool" or "always accepting" usually mean there is no open headcount.', 0.3);
    const words = jd.trim() ? jd.trim().split(/\s+/).length : 0;
    if (words && words < 150) add('thin', `Thin description · ${words} words`, 'Under 150 words. Real openings usually describe the work in detail.', 0.1);
    const code = payState(j.location, today);
    if (code && !(+j.salaryMin > 0 || +j.salaryMax > 0)) add('nosalary', `No salary in ${code}`, `${PAY[code]} requires a pay range on postings, yet none is listed.`, 0.15);
    const key = norm(j.company) + '|' + norm(j.title);
    const mine = seenDate(j);
    const older = (g.seen[key] || []).some((x) => x.id !== j.id && CB.daysBetween(x.d, mine) > 90);
    const selfOld = ISO_RE.test(j.firstSeenDate || '') && ISO_RE.test(j.postedDate || '') && CB.daysBetween(j.firstSeenDate, j.postedDate) > 90;
    if (norm(j.company) && norm(j.title) && (older || selfOld)) add('repeat', 'Same role 90+ days ago', `You saw ${j.company}'s ${j.title} more than 90 days earlier, and it is back.`, 0.2);
    const gc = (g.ghosted[norm(j.company)] || 0) - (j.status === 'ghosted' ? 1 : 0);
    if (gc >= 2) add('ghoster', `Ghosted you ${gc}×`, `${j.company} has gone silent on you ${gc} times before.`, 0.15);
    const score = Math.round(Math.min(1, sig.reduce((s, x) => s + x.weight, 0)) * 100) / 100;
    return { score, level: score >= 0.45 ? 'High' : score >= 0.2 ? 'Medium' : score > 0 ? 'Low' : 'None', signals: sig, age, words };
  }
  function sourceTable(jobs) {
    const t = {};
    for (const j of jobs) {
      const k = j.source || 'Other';
      const r = (t[k] = t[k] || { applied: 0, hits: 0 });
      if (j.appliedDate || (j.maxStage || 0) >= 1) { r.applied++; if ((j.maxStage || 0) >= 2) r.hits++; }
    }
    return t;
  }
  function makeCtx(jobs, atsById, settings) {
    return { ats: atsById || {}, g: groupCtx(jobs), src: sourceTable(jobs), k: Math.max(1, +((settings || {}).sourceBenchK) || 20), today: CB.todayISO() };
  }
  function evFor(j, c) {
    const a = c.ats[j.id] || null;
    const ko = !!(a && a.knockouts && a.knockouts.length);
    const hasP = !!a && a.probability != null && isFinite(a.probability);
    const P = hasP ? clamp(+a.probability, 0, 1) : 0.05;
    const ghost = ghostRisk(j, c.g, c.today);
    const ageKnown = ghost.age != null;
    const age = Math.max(0, ageKnown ? ghost.age : CB.daysBetween(String(j.createdAt || '').slice(0, 10) || c.today, c.today) || 0);
    const F = age <= 4 ? 1 : Math.max(0.2, Math.pow(0.72, age - 4));
    const b = bench(j.source);
    const st = c.src[j.source || 'Other'] || { applied: 0, hits: 0 };
    const blended = (st.hits + c.k * b.rate) / (st.applied + c.k);
    const Sx = blended / 0.04;
    const ex = j.excitement == null || !isFinite(+j.excitement) ? 3 : +j.excitement;
    const X = 1 + 0.12 * (ex - 3);
    const R = j.referral ? 3 : 1;
    const Gf = 1 - 0.6 * ghost.score;
    const ev = P * F * Sx * X * R * Gf;
    const dl = ISO_RE.test(j.deadline || '') ? CB.daysBetween(c.today, j.deadline) : null;
    return { job: j, a, ko, hasP, P, F, S: Sx, b, blended, st, k: c.k, X, ex, R, G: ghost.score, Gf, ghost, age, ageKnown, dl, ev, idx: Math.round(ev * 1000) / 10 };
  }
  function freshness(r) {
    if (r.dl != null && r.dl >= 0 && r.dl <= 7) return { text: r.dl === 0 ? 'Closes today' : `Closes in ${r.dl}d`, tone: 'warn' };
    if (r.age <= 4) { const left = 5 - r.age; return { text: left <= 1 ? 'Apply today' : `Apply within ${left} days`, tone: 'fresh' }; }
    return { text: `${r.age}d old · ${Math.round(r.F * 100)}% fresh`, tone: r.F < 0.35 ? 'bad' : '' };
  }
  function whyText(r) {
    const pos = [], neg = [];
    if (r.R > 1) pos.push('referral ×3');
    if (r.hasP && r.P >= 0.25) pos.push('ATS chance ' + pct(r.P));
    if (r.ageKnown && r.age <= 4) pos.push('fresh posting');
    if (r.S >= 1.15) pos.push(`${r.job.source} converts well`);
    if (r.X > 1.1) pos.push('you are excited');
    if (r.ko) neg.push('knockout, fix it before applying');
    else if (r.hasP && r.P < 0.1) neg.push('low ATS chance ' + pct(r.P));
    if (!r.hasP) neg.push('no ATS score yet');
    if (r.G >= 0.2) neg.push(`ghost risk ${r.ghost.level.toLowerCase()}`);
    if (r.F < 0.5) neg.push('aging posting');
    if (r.S < 0.85) neg.push(`${r.job.source || 'source'} converts below average`);
    const parts = pos.slice(0, 2).concat(neg.slice(0, pos.length ? 1 : 2));
    const s = parts.join(' · ') || 'average on every factor';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  /** Saved jobs ranked by expected value (knockouts last). Never filters a job out. */
  function rank(jobs, atsById, settings) {
    if (!jobs) { if (!ready()) return []; jobs = S().list(); atsById = S().atsMap(); settings = S().settings; }
    const c = makeCtx(jobs, atsById, settings);
    const list = jobs.filter((j) => j.status === 'saved').map((j) => evFor(j, c));
    list.sort((x, y) => (x.ko - y.ko) || (y.ev - x.ev) || String(x.job.company).localeCompare(String(y.job.company)));
    const top = list.reduce((m, r) => (r.ko ? m : Math.max(m, r.ev)), 0);
    list.forEach((r, i) => { r.rank = i + 1; r.rel = top > 0 ? clamp(r.ev / top, 0, 1) : 0; r.fresh = freshness(r); r.why = whyText(r); });
    return list;
  }
  /** EV + ghost risk for any one job (rank among Saved when it is saved). */
  function insight(job) {
    const jobs = S().list();
    const c = makeCtx(jobs, S().atsMap(), S().settings);
    const r = evFor(job, c);
    r.fresh = freshness(r);
    r.why = whyText(r);
    if (job.status === 'saved') { const rk = rank(jobs, c.ats, S().settings); const me = rk.find((x) => x.job.id === job.id); r.rank = me ? me.rank : null; r.of = rk.length; r.rel = me ? me.rel : 0; }
    return r;
  }

  // ═════════════════════════ UI pieces ═════════════════════════
  const chip = (text, tone, title) => `<span class="gr-chip${tone ? ' ' + tone : ''}"${title ? ` title="${E(title)}"` : ''}>${text}</span>`;
  const sigChip = (s) => chip(`${E(s.label)} <b>+${Math.round(s.weight * 100)}% risk</b>`, s.weight >= 0.25 ? 'bad' : 'warn', s.detail);
  const riskChips = (r, max) => {
    const sg = r.ghost.signals.slice().sort((a, b) => b.weight - a.weight);
    const shown = sg.slice(0, max).map(sigChip).join('');
    return shown + (sg.length > max ? chip(`+${sg.length - max} more`, 'more') : '');
  };
  function setHeadRight(el, html) {
    const sec = el.closest('section');
    const h = sec && sec.querySelector('.card-h');
    if (!h) return null;
    let r = h.querySelector('.cbx-right');
    if (!r) { r = document.createElement('div'); r.className = 'right cbx-right'; h.appendChild(r); }
    r.innerHTML = html;
    return r;
  }

  // Dashboard: Apply next
  CB.registerDashCard({
    key: 'applynext', order: 20, span: 7, title: 'Apply next',
    sub: 'Saved jobs ranked by expected value',
    render(el, ctx) {
      const all = rank(ctx.jobs, ctx.ats, S().settings);
      setHeadRight(el, all.length ? `<span class="an-count mono">${all.length} saved</span>` : '');
      if (!all.length) {
        el.innerHTML = `<div class="an-empty"><p>No saved jobs yet. Save postings you are weighing, and Callback ranks them by expected value: ATS chance, freshness, source, excitement, referral and ghost risk.</p><button class="btn btn-sm" data-add>${icon('plus')}Add a job</button></div>`;
        el.querySelector('[data-add]').onclick = () => UI().addJob && UI().addJob();
        return;
      }
      el.innerHTML = `<div class="an-list">${all.slice(0, 5).map((r) => `
        <button type="button" class="an-row${r.ko ? ' is-ko' : ''}" data-open="${E(r.job.id)}" aria-label="${E((r.job.company || 'Untitled') + ', rank ' + r.rank)}">
          <span class="an-rank">${p2(r.rank)}</span>
          ${UI().mono ? UI().mono(r.job.company, 34) : ''}
          <span class="an-main">
            <span class="an-co">${E(r.job.company || 'Untitled')}<span class="an-ti"> · ${E(r.job.title || 'Role')}</span></span>
            <span class="an-why">${E(r.why)}</span>
            <span class="an-chips">${chip(E(r.fresh.text), r.fresh.tone)}${r.ko ? chip('Knockout', 'bad', 'The ATS knocks this resume out. See the ATS report.') : ''}${riskChips(r, 2)}</span>
          </span>
          <span class="an-ev" title="Expected-value index (relative)"><span class="an-evn"><small>EV</small>${r.idx.toFixed(1)}</span><span class="an-bar"><i style="width:${Math.max(3, Math.round(r.rel * 100))}%"></i></span></span>
        </button>`).join('')}</div>
        <p class="an-foot">Ghost risk is an estimate, never a verdict: every signal is shown and nothing is hidden.${all.length > 5 ? ` ${all.length - 5} more in the Signals tab of each job.` : ''}</p>`;
      el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => UI().openJob && UI().openJob(b.dataset.open, 'signals')));
    },
  });

  // Dashboard: Upcoming (next 5 events with alarms)
  CB.registerDashCard({
    key: 'upcoming', order: 21, span: 5, title: 'Upcoming',
    sub: 'Calendar alarms included',
    render(el, ctx) {
      const evs = events(ctx.jobs);
      const right = setHeadRight(el, evs.length ? `<button class="btn btn-sm" data-ics-all title="Export every upcoming event as one calendar file">${icon('calendar')}Export ${evs.length}</button>` : '');
      if (right && evs.length) right.querySelector('[data-ics-all]').onclick = () => exportEvents(events(S().list()), 'upcoming');
      if (!evs.length) {
        el.innerHTML = '<div class="an-empty"><p>Nothing scheduled. Interviews, follow-up dates, offer decisions and apply-by deadlines show here, ready to add to your calendar with alarms.</p></div>';
        return;
      }
      const today = CB.todayISO();
      el.innerHTML = `<div class="up-list">${evs.slice(0, 5).map((ev) => {
        const d = ev.at, n = CB.daysBetween(today, CB.toISODate(d));
        const when = ev.allDay ? `${WD[d.getDay()]} · all day` : `${WD[d.getDay()]} ${hm(d)}`;
        return `<div class="up-row" style="--c:${KIND[ev.kind].c}">
          <span class="up-date" aria-hidden="true"><b>${d.getDate()}</b><span>${CB.MONTHS[d.getMonth()]}</span></span>
          <button type="button" class="up-main" data-open="${E(ev.jobId)}" data-tab="${ev.kind === 'interview' ? 'interviews' : 'overview'}">
            <span class="up-t"><i></i>${E(ev.kind === 'interview' ? ev.label : KIND[ev.kind].label)}<span class="up-co"> · ${E(ev.company)}</span></span>
            <span class="up-d">${E(when)} · ${rel(n)}</span>
          </button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-ics="${E(ev.key)}" title="Add to Calendar" aria-label="Add ${E(ev.summary)} to Calendar">${icon('calendar')}</button>
        </div>`;
      }).join('')}</div>${evs.length > 5 ? `<p class="an-foot">${evs.length - 5} more after these. Export adds all ${evs.length}.</p>` : ''}`;
      el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => UI().openJob && UI().openJob(b.dataset.open, b.dataset.tab)));
      el.querySelectorAll('[data-ics]').forEach((b) => (b.onclick = () => {
        const ev = events(S().list()).find((x) => x.key === b.dataset.ics);
        if (ev) exportEvents([ev], ev.company + '-' + ev.kind);
      }));
    },
  });

  // Drawer: Add to Calendar (this job's upcoming events)
  CB.registerDrawerAction({ key: 'ics', icon: 'calendar', title: 'Add to Calendar', order: 40, run: (job) => exportJob(job) });

  // Drawer: Signals (ghost risk + EV breakdown)
  CB.registerDrawerTab({
    key: 'signals', order: 60,
    label: 'Signals',
    render(body, job) {
      const r = insight(job);
      const g = r.ghost;
      const lvlTone = g.level === 'High' ? 'bad' : g.level === 'Medium' ? 'warn' : 'good';
      const jdEmpty = !String(job.jd || '').trim();
      const fx = (v, d = 2) => (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
      const srcLine = `${E(job.source || 'Other')}: ${r.st.hits} of ${r.st.applied} application${r.st.applied === 1 ? '' : 's'} reached a screen, blended with Huntr 2025 ${E(r.b.name)} (${pct(r.b.rate)}) at k = ${r.k}`;
      const rows = [
        ['P', 'ATS interview chance', r.hasP ? pct(r.P) : '5% est.', r.ko ? 'A knockout applies. Fix it before applying (see the ATS report).' : r.hasP ? 'From the ATS report: knockouts first, then weighted ranking.' : 'No ATS score yet (needs your resume and the job description), so a neutral 5% is used.'],
        ['F', 'Freshness', fx(r.F), `${r.ageKnown ? 'Posted' : 'Saved'} ${r.age === 0 ? 'today' : r.age + ' day' + (r.age === 1 ? '' : 's') + ' ago'}${r.fresh.tone === 'fresh' || r.fresh.tone === 'warn' ? ' · ' + E(r.fresh.text) : ''}. Full value for 4 days, then −28% a day (floor 0.2).`],
        ['S', 'Source factor', fx(r.S), srcLine + ', divided by the 4% baseline.'],
        ['X', 'Excitement', fx(r.X), `${r.ex} of 5. Each point above 3 adds 12%.`],
        ['R', 'Referral boost', '×' + r.R, r.R > 1 ? `Referral${job.referrerName ? ' from ' + E(job.referrerName) : ''}: ×3, conservative against the 4–7× studies.` : 'No referral. A referral would triple this.'],
        ['G', 'Ghost-risk discount', fx(r.Gf), `1 − 0.6 × ${fx(r.G)}.`],
      ];
      body.innerHTML = `<div class="sig">
        <section class="sig-hero">
          <div><div class="eyebrow">Ghost-risk estimate</div><div class="sig-lvl">${E(g.level === 'None' ? 'No signals' : g.level)}</div></div>
          <div class="sig-score mono">${fx(g.score)}<small> / 1.00</small></div>
          <div class="sig-meter ${lvlTone}"><i style="width:${Math.max(g.score > 0 ? 3 : 0, Math.round(g.score * 100))}%"></i></div>
          <p class="sig-sub">${g.signals.length ? `${g.signals.length} signal${g.signals.length === 1 ? '' : 's'} found. A heuristic, shown so you can judge for yourself. Jobs are never hidden.` : 'Nothing suggests a ghost posting. The heuristic checks age, reposts, evergreen wording, thin descriptions, missing pay ranges, repeats and past silence.'}</p>
        </section>
        ${g.signals.length ? `<div class="sig-list">${g.signals.map((s) => `<div class="sig-row"><span class="sig-w">+${fx(s.weight)}</span><div><b>${E(s.label)}</b><span>${E(s.detail)}</span></div></div>`).join('')}</div>` : ''}
        ${jdEmpty ? '<p class="sig-note">No job description saved, so evergreen wording and thin postings can\'t be checked. Paste it in Overview.</p>' : ''}
        <section class="sig-ev">
          <div class="sig-ev-h"><span class="eyebrow">Expected value</span>${job.status === 'saved' && r.rank ? `<span class="tag">#${r.rank} of ${r.of} in Apply Next</span>` : '<span class="tag">For reference · Apply Next ranks Saved jobs</span>'}</div>
          <div class="ev-f" aria-label="EV formula">${rows.map(([k, , v], i) => `${i ? '<span class="op">×</span>' : ''}<span class="t"><small>${k}</small>${v}</span>`).join('')}<span class="op">=</span><span class="t res"><small>EV</small>${r.idx.toFixed(1)}</span></div>
          <div class="ev-rows">${rows.map(([k, l, v, d]) => `<div class="ev-row"><span class="ev-k mono">${k}</span><div><b>${l}</b><span>${d}</span></div><span class="ev-v mono">${v}</span></div>`).join('')}</div>
        </section>
        <div class="sig-acts">
          ${job.url ? `<a class="btn btn-sm" href="${E(job.url)}" target="_blank" rel="noopener">${icon('link')}Open posting</a>` : ''}
          ${job.status === 'saved' ? `<button class="btn btn-sm btn-primary" data-applied>${icon('check')}Mark applied</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-ics>${icon('calendar')}Add to Calendar</button>
        </div>
        <p class="sig-note">EV index = P × F × S × X × R × (1 − 0.6·G) × 100, a relative score for ranking, not a probability. Freshness follows TalentWorks (applying in the first 96 hours ≈ 8× the interview odds). Source rates: Huntr 2025 benchmarks shrunk toward your own results.</p>
      </div>`;
      const ap = body.querySelector('[data-applied]');
      if (ap) ap.onclick = () => UI().moveJob && UI().moveJob(job.id, 'applied');
      body.querySelector('[data-ics]').onclick = () => exportJob(job);
    },
  });

  // Action Center: the top two Apply Next jobs
  CB.registerAction((jobs, settings, atsById) => rank(jobs, atsById, settings).filter((r) => !r.ko && r.ev > 0).slice(0, 2).map((r) => ({
    id: 'an-' + r.job.id, kind: 'applynext', sev: 3, jobId: r.job.id,
    title: `Apply today: ${r.job.company || 'Untitled'}`,
    detail: `${r.job.title || 'Role'} · #${r.rank} in Apply Next · ${r.why}`,
    action: { type: 'open', tab: 'signals', label: 'Review' },
  })));

  // ⌘K + Cal
  CB.registerCommand({ key: 'ics-all', label: 'Export all upcoming to Calendar (.ics)', run: () => exportAll() });
  CB.registerCommand({ key: 'apply-next', label: 'Apply next: open the best saved job', run: () => { const r = rank()[0]; if (r) UI().openJob(r.job.id, 'signals'); else toast('No saved jobs to rank yet.'); } });
  if (CB.Cal && typeof CB.Cal.registerIntent === 'function') {
    CB.Cal.registerIntent(/\b(export|download|send)\b.*\b(calendar|ics|reminders?)\b|\badd (all|everything|them|my (interviews|deadlines|follow[- ]?ups))\b.*\bcalendar\b/i, (text, say) => {
      if (!ready()) return false;
      const evs = events(S().list());
      if (!evs.length) { say('Nothing upcoming has a date yet. Schedule an interview or set a follow-up date, then ask again.'); return true; }
      exportEvents(evs, 'upcoming');
      const n = (k) => evs.filter((e) => e.kind === k).length;
      say(`Preparing **${evs.length} calendar event${evs.length === 1 ? '' : 's'}**: ${n('interview')} interview${n('interview') === 1 ? '' : 's'} (alarms 1 day and 1 hour before), ${n('followup')} follow-up${n('followup') === 1 ? '' : 's'} and ${n('offer') + n('apply')} deadline${n('offer') + n('apply') === 1 ? '' : 's'} (alarms at 9:00).${CB.standalone ? '' : ' On claude.ai it arrives as a .zip; unzip it and open the .ics.'}`);
      return true;
    });
  }

  // Settings: Calendar & reminders
  CB.registerSettings({
    key: 'calendar', title: 'Calendar & reminders', order: 60,
    render(el) {
      if (!ready()) { el.innerHTML = '<p class="muted">Loading…</p>'; return; }
      const evs = events(S().list());
      const n = (k) => evs.filter((e) => e.kind === k).length;
      const doc = (calStore() && calStore().get()) || {};
      const badgeOk = typeof navigator.setAppBadge === 'function';
      let due = 0;
      try { due = dueCount(); } catch (e) { due = 0; }
      el.innerHTML = `<div class="cal-set">
        <p class="cal-lead">Web apps on iPhone can't schedule notifications without a server, so Callback writes your dates into your own calendar, alarms included. Export again after changes: events update in place.</p>
        <div class="cal-stats">
          <div><b class="mono">${n('interview')}</b><span>Interviews</span></div>
          <div><b class="mono">${n('followup')}</b><span>Follow-ups</span></div>
          <div><b class="mono">${n('offer') + n('apply')}</b><span>Deadlines</span></div>
        </div>
        <ul class="cal-alarms">
          <li><i style="--c:${KIND.interview.c}"></i><span>Interviews</span><em>1 day and 1 hour before</em></li>
          <li><i style="--c:${KIND.followup.c}"></i><span>Follow-ups</span><em>9:00 on the day</em></li>
          <li><i style="--c:${KIND.offer.c}"></i><span>Offer and apply-by deadlines</span><em>9:00 the day before and on the day</em></li>
        </ul>
        <div class="row cal-act"><button class="btn btn-accent" data-ics-all ${evs.length ? '' : 'disabled'}>${icon('calendar')}Export all upcoming (${evs.length})</button>
          <span class="cal-last mono">${doc.lastExportAt ? 'Last export ' + E(CB.fmtDateTime(doc.lastExportAt)) : 'Not exported yet'}</span></div>
        <p class="cal-note">${badgeOk ? `<b>Home Screen badge</b> shows items due in the Action Center: ${due} right now.` : '<b>Home Screen badge</b> needs the installed app (iOS 16.4+ or macOS).'}${CB.standalone ? '' : ' In claude.ai the calendar file arrives zipped, because the viewer blocks .ics downloads.'}</p>
      </div>`;
      el.querySelector('[data-ics-all]').onclick = () => exportAll();
    },
  });

  CB.css('feat-time', `
.gr-chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:var(--r-xs);font:450 10.5px/1 var(--f-mono);letter-spacing:.01em;color:var(--ink-2);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line-2);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.gr-chip b{font-weight:500;color:inherit;opacity:.85}
.gr-chip.warn{color:var(--warning);background:color-mix(in srgb,var(--warning) 8%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--warning) 26%,transparent)}
.gr-chip.bad{color:var(--danger);background:color-mix(in srgb,var(--danger) 8%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--danger) 26%,transparent)}
.gr-chip.fresh{color:var(--success);background:color-mix(in srgb,var(--success) 8%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--success) 26%,transparent)}
.gr-chip.more{color:var(--ink-3)}
.an-count{font-size:11px;color:var(--ink-3);letter-spacing:.04em}
.an-list{display:grid;margin:-6px -8px 0}
.an-row{position:relative;display:grid;grid-template-columns:20px 34px minmax(0,1fr) 104px;gap:12px;align-items:center;width:100%;padding:11px 8px;border:0;border-radius:var(--r-sm);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background var(--dur-1) var(--ease-out)}
.an-row:hover{background:var(--surface-2)}
.an-row:focus-visible{outline:none;box-shadow:var(--focus)}
.an-row+.an-row::before{content:"";position:absolute;left:74px;right:8px;top:0;height:1px;background:var(--line-1)}
.an-row:hover::before,.an-row:hover+.an-row::before{opacity:0}
.an-rank{font:500 11px/1 var(--f-mono);letter-spacing:.04em;color:var(--ink-4);font-variant-numeric:tabular-nums}
.an-row:first-child .an-rank{color:var(--gold-text)}
.an-main{display:grid;gap:5px;min-width:0}
.an-co{font-weight:560;font-size:13.5px;letter-spacing:-.01em;color:var(--ink-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.an-ti{font-weight:400;color:var(--ink-2)}
.an-why{font-size:12px;line-height:16px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.an-chips{display:flex;gap:5px;flex-wrap:wrap;min-width:0}
.an-ev{display:grid;gap:7px;justify-items:end;align-self:center}
.an-evn{font:500 16px/1 var(--f-mono);letter-spacing:-.02em;color:var(--ink-1);font-variant-numeric:tabular-nums}
.an-evn small{font:500 9px/1 var(--f-mono);letter-spacing:.12em;color:var(--ink-4);margin-right:5px;vertical-align:2px}
.an-row:first-child .an-evn{color:var(--gold-text)}
.an-bar{width:100%;height:3px;border-radius:2px;background:var(--track);overflow:hidden}
.an-bar i{display:block;height:100%;border-radius:inherit;background:var(--metal-cta)}
.an-row.is-ko .an-bar i{background:var(--ink-4)}
.an-row.is-ko .an-co{color:var(--ink-2)}
.an-foot{margin:12px 0 0;font-size:11.5px;line-height:1.5;color:var(--ink-4)}
.an-empty p{margin:0 0 12px;font-size:13px;line-height:1.55;color:var(--ink-3);max-width:52ch}
.up-list{display:grid;margin:-6px -8px 0}
.up-row{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center;padding:8px;border-radius:var(--r-sm);transition:background var(--dur-1) var(--ease-out)}
.up-row:hover{background:var(--surface-2)}
.up-row+.up-row::before{content:"";position:absolute;left:64px;right:8px;top:0;height:1px;background:var(--line-1)}
.up-row:hover::before,.up-row:hover+.up-row::before{opacity:0}
.up-date{display:grid;justify-items:center;gap:4px;padding:7px 0 6px;border-radius:var(--r-sm);background:var(--surface-2);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-1),inset 0 2px 0 color-mix(in srgb,var(--c) 70%,transparent)}
.up-date b{font:400 18px/1 var(--f-ui);letter-spacing:-.02em;color:var(--ink-1);font-variant-numeric:tabular-nums}
.up-date span{font:500 9px/1 var(--f-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.up-main{display:grid;gap:4px;min-width:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.up-main:focus-visible{outline:none;box-shadow:var(--focus);border-radius:4px}
.up-t{display:flex;align-items:center;gap:7px;min-width:0;font-weight:540;font-size:13px;color:var(--ink-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.up-t i{width:6px;height:6px;border-radius:50%;background:var(--c);flex:none}
.up-co{font-weight:400;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis}
.up-d{font:450 11px/1.3 var(--f-mono);color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:13px}
.sig{display:grid;gap:18px}
.sig-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 16px;align-items:end;padding:18px;border-radius:var(--r-md);background:var(--surface-2);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-1)}
.sig-lvl{margin-top:6px;font:400 34px/1 var(--f-display);letter-spacing:-.02em;color:var(--ink-1)}
.sig-score{font-size:22px;letter-spacing:-.02em;color:var(--ink-1);font-variant-numeric:tabular-nums}
.sig-score small{font-size:11px;color:var(--ink-4);letter-spacing:0}
.sig-meter{grid-column:1/-1;height:4px;border-radius:2px;background:var(--track);overflow:hidden}
.sig-meter i{display:block;height:100%;border-radius:inherit;background:var(--success)}
.sig-meter.warn i{background:var(--warning)} .sig-meter.bad i{background:var(--danger)}
.sig-sub{grid-column:1/-1;margin:2px 0 0;font-size:12.5px;line-height:1.5;color:var(--ink-3)}
.sig-list{display:grid}
.sig-row{display:grid;grid-template-columns:46px minmax(0,1fr);gap:12px;padding:12px 0;border-top:1px solid var(--line-1)}
.sig-row:first-child{border-top:0;padding-top:0}
.sig-w{font:500 12px/19px var(--f-mono);color:var(--warning);text-align:right;font-variant-numeric:tabular-nums}
.sig-row b{display:block;font-weight:560;font-size:13px;color:var(--ink-1)}
.sig-row span{display:block;margin-top:2px;font-size:12.5px;line-height:1.5;color:var(--ink-3)}
.sig-note{margin:0;font-size:11.5px;line-height:1.55;color:var(--ink-4)}
.sig-ev{display:grid;gap:14px;padding-top:16px;border-top:1px solid var(--line-1)}
.sig-ev-h{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ev-f{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.ev-f .t{display:grid;gap:4px;padding:7px 9px 8px;border-radius:var(--r-xs);background:var(--surface-2);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-1);font:500 12.5px/1 var(--f-mono);color:var(--ink-1);font-variant-numeric:tabular-nums}
.ev-f .t small{font:500 9px/1 var(--f-mono);letter-spacing:.12em;color:var(--ink-3)}
.ev-f .op{font:400 12px/1 var(--f-mono);color:var(--ink-4)}
.ev-f .res{background:linear-gradient(180deg,var(--gold-soft),transparent),var(--surface-2);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--gold-line);color:var(--gold-text)}
.ev-f .res small{color:var(--gold-text)}
.ev-rows{display:grid}
.ev-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:12px;align-items:baseline;padding:10px 0;border-top:1px solid var(--line-1)}
.ev-k{font-size:11px;color:var(--gold-text)}
.ev-row b{display:block;font-weight:540;font-size:12.5px;color:var(--ink-1)}
.ev-row span{display:block;margin-top:2px;font-size:12px;line-height:1.5;color:var(--ink-3)}
.ev-v{font-size:12.5px;color:var(--ink-1);font-variant-numeric:tabular-nums;white-space:nowrap}
.sig-acts{display:flex;gap:8px;flex-wrap:wrap}
.cal-set{display:grid;gap:16px}
.cal-lead{margin:0;font-size:13px;line-height:1.55;color:var(--ink-2)}
.cal-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-radius:var(--r-md);background:var(--surface-2);box-shadow:inset 0 1px 0 var(--rim),inset 0 0 0 1px var(--line-1)}
.cal-stats>div{display:grid;gap:6px;padding:14px 16px}
.cal-stats>div+div{border-left:1px solid var(--line-1)}
.cal-stats b{font:300 28px/1 var(--f-ui);letter-spacing:-.03em;color:var(--ink-1);font-variant-numeric:tabular-nums}
.cal-stats span{font:500 10px/1 var(--f-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.cal-alarms{list-style:none;margin:0;padding:0;display:grid}
.cal-alarms li{display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line-1);font-size:13px;color:var(--ink-1)}
.cal-alarms li:first-child{border-top:0;padding-top:0}
.cal-alarms i{width:6px;height:6px;border-radius:50%;background:var(--c)}
.cal-alarms em{font:450 11.5px/1.3 var(--f-mono);font-style:normal;color:var(--ink-3);text-align:right}
.cal-act{gap:12px}
.cal-last{font-size:11px;color:var(--ink-3)}
.cal-note{margin:0;font-size:12px;line-height:1.55;color:var(--ink-3)}
.cal-note b{font-weight:560;color:var(--ink-2)}
.ics-fb-p{margin:0 0 12px;font-size:13px;line-height:1.55;color:var(--ink-2)}
.ics-fb-t{width:100%;min-height:200px;font:450 11px/1.5 var(--f-mono);white-space:pre;resize:vertical}
@media (max-width:560px){
  .an-row{grid-template-columns:34px minmax(0,1fr) 66px;gap:10px;padding:11px 6px}
  .an-rank{display:none}
  .an-row+.an-row::before{left:50px}
  .an-evn{font-size:14px}
  .cal-alarms li{grid-template-columns:8px minmax(0,1fr);row-gap:3px}
  .cal-alarms em{grid-column:2;text-align:left}
  .cal-stats b{font-size:24px}
  .cal-stats>div{padding:12px}
}
`);

  CB.Time = { events, exportEvents, exportAll, exportJob, rank, insight, ghostRisk: (j) => ghostRisk(j, groupCtx(S().list()), CB.todayISO()), dueCount, updateBadge, payState };
})();

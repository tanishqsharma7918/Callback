/* Callback — core constants, data model and shared utilities.
 * Loaded first. Every other module attaches to window.CB.
 *
 * ───────────────────────── JOB RECORD (the one data model) ─────────────────────────
 * {
 *   id: string                      unique id (CB.uid())
 *   sample: boolean                 true for example data
 *   createdAt, updatedAt: ISO datetime string
 *   company, title, location: string
 *   workMode: 'Remote'|'Hybrid'|'On-site'|''
 *   employmentType: 'Full-time'|'Part-time'|'Contract'|'Internship'|'Temporary'|''
 *   seniority: '' | one of CB.SENIORITY[].label
 *   source: one of CB.SOURCES
 *   url: string, linkedinJobId: string
 *   salaryMin, salaryMax: number|null   salaryCurrency: 'USD'|...   salaryPeriod: 'year'|'hour'|'month'
 *   status: stage key (CB.STAGES[].key)
 *   maxStage: number                highest progression `order` ever reached (funnel math)
 *   priority: 'High'|'Medium'|'Low'
 *   excitement: 0..5
 *   appliedDate, followUpDate, deadline, postedDate, responseDate: 'YYYY-MM-DD' | ''
 *   applicants: number|null         applicant count shown on the posting
 *   referral: boolean, referrerName: string
 *   jd: string                      full job description text
 *   jdAI: object|null               Claude-extracted requirements (overrides local parse)
 *   contacts:   [{id, name, role, email, phone, linkedin, notes}]
 *   interviews: [{id, round, type, datetime:'YYYY-MM-DDTHH:mm', durationMin, interviewer, link,
 *                 outcome:'Scheduled'|'Completed'|'Passed'|'Failed'|'Cancelled', notes, thankYouSent}]
 *   timeline:   [{id, ts, kind:'created'|'status'|'note'|'interview'|'email'|'followup'|'ats'|'auto'|'import',
 *                 from?, to?, text}]
 *   notes: string (HTML from the rich-text editor)
 *   coverLetter: string (plain text, paragraphs separated by blank lines)
 *   tags: string[]
 *   rejectionReason: string, rejectionStage: stage key | ''
 *   offer: {base, bonus, equity, signOn, deadline, notes} | null
 * }
 *
 * ───────────────────────── ATS RESULT (CB.ATS.score) ─────────────────────────
 * { score 0-100, verdict 'STRONG'|'COMPETITIVE'|'LONG_SHOT'|'REJECTED', verdictLabel,
 *   probability 0..1, knockouts:[{code,label,detail}], components:[{key,label,weight,score,detail}],
 *   skills:{required:[{name,status:'evidenced'|'listed'|'transferable'|'missing',jdCount}], preferred:[...]},
 *   keywords:{matched:[], missing:[]}, rank:{position,pool,percentile}|null, fixes:[{priority,text}],
 *   yearsRequired, yearsCandidate, reqs }
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});

  // Progression stages carry an `order` (funnel position). Closed outcomes have order -1.
  // Colors come from a CVD-validated categorical palette; chips always carry a text label too.
  CB.STAGES = [
    { key: 'saved',      label: 'Saved',            short: 'Saved',     order: 0,  group: 'pre',    color: '#7c8799', ink: '#fff' },
    { key: 'applied',    label: 'Applied',          short: 'Applied',   order: 1,  group: 'active', color: '#2a78d6', ink: '#fff' },
    { key: 'screen',     label: 'Recruiter Screen', short: 'Screen',    order: 2,  group: 'active', color: '#1baf7a', ink: '#fff' },
    { key: 'assessment', label: 'Assessment',       short: 'Assess.',   order: 3,  group: 'active', color: '#eda100', ink: '#0b0b0b' },
    { key: 'interview',  label: 'Interviewing',     short: 'Interview', order: 4,  group: 'active', color: '#6250d6', ink: '#fff' },
    { key: 'final',      label: 'Final Round',      short: 'Final',     order: 5,  group: 'active', color: '#eb6834', ink: '#fff' },
    { key: 'offer',      label: 'Offer',            short: 'Offer',     order: 6,  group: 'won',    color: '#0ca30c', ink: '#fff' },
    { key: 'accepted',   label: 'Accepted',         short: 'Accepted',  order: 7,  group: 'won',    color: '#d55181', ink: '#fff' },
    { key: 'rejected',   label: 'Rejected',         short: 'Rejected',  order: -1, group: 'closed', color: '#e34948', ink: '#fff' },
    { key: 'ghosted',    label: 'Ghosted',          short: 'Ghosted',   order: -1, group: 'closed', color: '#5d6470', ink: '#fff' },
    { key: 'withdrawn',  label: 'Withdrawn',        short: 'Withdrawn', order: -1, group: 'closed', color: '#a39e93', ink: '#0b0b0b' },
  ];
  CB.STAGE = Object.fromEntries(CB.STAGES.map((s) => [s.key, s]));
  CB.PROGRESSION = CB.STAGES.filter((s) => s.order >= 0); // saved → accepted
  CB.CLOSED = ['rejected', 'ghosted', 'withdrawn'];

  CB.SOURCES = ['LinkedIn', 'LinkedIn Easy Apply', 'Company site', 'Referral', 'Recruiter outreach', 'Indeed', 'Glassdoor', 'Wellfound', 'Hacker News', 'Job fair', 'Other'];
  CB.WORK_MODES = ['Remote', 'Hybrid', 'On-site'];
  CB.EMP_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];
  CB.PRIORITIES = ['High', 'Medium', 'Low'];
  CB.INTERVIEW_TYPES = ['Recruiter screen', 'Hiring manager', 'Technical screen', 'Take-home review', 'System design', 'Behavioral', 'Case study', 'Panel / Onsite', 'Executive', 'Reference check'];
  CB.INTERVIEW_OUTCOMES = ['Scheduled', 'Completed', 'Passed', 'Failed', 'Cancelled'];
  CB.SENIORITY = [
    { level: 0, label: 'Intern' },
    { level: 1, label: 'Entry level' },
    { level: 2, label: 'Mid level' },
    { level: 3, label: 'Senior' },
    { level: 4, label: 'Staff / Lead' },
    { level: 5, label: 'Principal' },
    { level: 6, label: 'Manager' },
    { level: 7, label: 'Director' },
    { level: 8, label: 'VP / Executive' },
  ];
  CB.REJECTION_REASONS = ['No reason given', 'Minimum qualifications', 'Not enough experience', 'Overqualified', 'Skills gap', 'Position filled', 'Role closed / on hold', 'Compensation mismatch', 'Location / work authorization', 'Failed assessment', 'Interview performance', 'Culture / team fit', 'Chose internal candidate'];

  // ───────── utilities ─────────
  CB.uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  CB.pad = (n) => String(n).padStart(2, '0');
  CB.toISODate = (d) => `${d.getFullYear()}-${CB.pad(d.getMonth() + 1)}-${CB.pad(d.getDate())}`;
  CB.todayISO = () => CB.toISODate(new Date());
  CB.nowISO = () => new Date().toISOString();
  /** Parse 'YYYY-MM-DD' (local) or any Date-able string. Returns Date|null. */
  CB.parseDate = (s) => {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s) ? null : s;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };
  CB.addDays = (iso, n) => {
    const d = CB.parseDate(iso) || new Date();
    d.setDate(d.getDate() + n);
    return CB.toISODate(d);
  };
  /** Whole days from a to b (b - a). Strings or Dates. */
  CB.daysBetween = (a, b) => {
    const da = CB.parseDate(a), db = CB.parseDate(b);
    if (!da || !db) return null;
    const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
    const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
    return Math.round((ub - ua) / 86400000);
  };
  CB.daysSince = (iso) => CB.daysBetween(iso, new Date());
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  CB.MONTHS = MON;
  CB.fmtDate = (iso, withYear) => {
    const d = CB.parseDate(iso);
    if (!d) return '—';
    const y = withYear === undefined ? d.getFullYear() !== new Date().getFullYear() : withYear;
    return `${MON[d.getMonth()]} ${d.getDate()}${y ? ', ' + d.getFullYear() : ''}`;
  };
  CB.fmtDateTime = (dt) => {
    const d = CB.parseDate(dt);
    if (!d) return '—';
    let h = d.getHours(), m = d.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${CB.fmtDate(CB.toISODate(d))} · ${h}:${CB.pad(m)} ${ap}`;
  };
  CB.relDays = (iso) => {
    const n = CB.daysSince(iso);
    if (n === null) return '';
    if (n === 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n === -1) return 'tomorrow';
    if (n < 0) return `in ${-n}d`;
    if (n < 7) return `${n}d ago`;
    if (n < 60) return `${Math.round(n / 7)}w ago`;
    return `${Math.round(n / 30)}mo ago`;
  };
  CB.fmtMoney = (n, cur = 'USD', compact = true) => {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '';
    const sym = { USD: '$', EUR: '€', GBP: '£', INR: '₹', CAD: 'C$', AUD: 'A$' }[cur] || '';
    if (compact && Math.abs(n) >= 1000) {
      const k = n / 1000;
      return sym + (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'K';
    }
    return sym + Number(n).toLocaleString();
  };
  CB.fmtSalary = (j) => {
    if (!j || (!j.salaryMin && !j.salaryMax)) return '';
    const per = j.salaryPeriod === 'hour' ? '/hr' : j.salaryPeriod === 'month' ? '/mo' : '';
    const c = j.salaryCurrency || 'USD';
    if (j.salaryMin && j.salaryMax && j.salaryMin !== j.salaryMax) return `${CB.fmtMoney(j.salaryMin, c)}–${CB.fmtMoney(j.salaryMax, c)}${per}`;
    return CB.fmtMoney(j.salaryMin || j.salaryMax, c) + per;
  };
  CB.pct = (x, digits = 0) => (x === null || x === undefined || isNaN(x) ? '—' : (x * 100).toFixed(digits) + '%');
  CB.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  CB.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CB.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  CB.hash = (s) => {
    let h = 2166136261;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  CB.initials = (s) => String(s || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  /** Deterministic hue for a company monogram. */
  CB.hueFor = (s) => parseInt(CB.hash(s).slice(0, 4), 36) % 360;
  CB.stripHtml = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent || ''; };

  /** Blank job with every field present. */
  CB.newJob = (patch = {}) => {
    const now = CB.nowISO();
    const j = {
      id: CB.uid('j_'), sample: false, createdAt: now, updatedAt: now,
      company: '', title: '', location: '', workMode: '', employmentType: 'Full-time', seniority: '',
      source: 'LinkedIn', url: '', linkedinJobId: '',
      salaryMin: null, salaryMax: null, salaryCurrency: 'USD', salaryPeriod: 'year',
      status: 'saved', maxStage: 0, priority: 'Medium', excitement: 3,
      appliedDate: '', followUpDate: '', deadline: '', postedDate: '', responseDate: '',
      applicants: null, referral: false, referrerName: '',
      jd: '', jdAI: null, contacts: [], interviews: [], timeline: [], notes: '', coverLetter: '', tags: [],
      rejectionReason: '', rejectionStage: '', offer: null,
    };
    Object.assign(j, patch);
    const st = CB.STAGE[j.status];
    if (st && st.order > j.maxStage) j.maxStage = st.order;
    return j;
  };

  // ───────── lazy CDN script loader (memoized) ─────────
  const scriptCache = {};
  CB.loadScript = (src) => {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => res();
        s.onerror = () => { delete scriptCache[src]; rej(new Error('Could not load ' + src.split('/').slice(-2).join('/'))); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  };
  // Standalone copy (no claude.ai): libraries ship in ./lib so everything works offline.
  CB.standalone = !(window.claude && typeof window.claude.use === 'function');
  const LB = window.CALLBACK_LIB_BASE;
  CB.LIBS = LB ? {
    exceljs: LB + 'exceljs.min.js', jszip: LB + 'jszip.min.js', pdfjs: LB + 'pdf.min.js', pdfworker: LB + 'pdf.worker.min.js', mammoth: LB + 'mammoth.browser.min.js',
  } : {
    exceljs: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfworker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  };

  // ───────── platform capabilities (claude.ai viewer) ─────────
  const capCache = {};
  /** Resolve a capability namespace or null. Never throws. */
  CB.cap = (name) => {
    if (!capCache[name]) {
      capCache[name] = (async () => {
        try {
          if (!window.claude || typeof window.claude.use !== 'function') return null;
          return (await window.claude.use(name)) || null;
        } catch (e) { return null; }
      })();
    }
    return capCache[name];
  };

  /**
   * Offer a generated file to the user. Uses the viewer's `downloads` capability when hosted
   * on claude.ai (the viewer confirms the save), else a normal browser download.
   * Resolves {ok:true} | {ok:false, code, message}.
   */
  CB.saveFile = async (filename, data, mime = 'application/octet-stream') => {
    const dl = await CB.cap('downloads');
    if (dl) {
      try {
        const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
        await dl.save({ filename, data: blob });
        return { ok: true };
      } catch (e) {
        if (e && e.code === 'declined') return { ok: false, code: 'declined', message: 'Save cancelled.' };
        if (!(e && (e.code === 'unavailable' || e.code === 'not_granted' || e.code === 'capability_disabled'))) {
          return { ok: false, code: e && e.code, message: (e && e.message) || 'The file could not be saved.' };
        }
      }
    }
    const blob0 = data instanceof Blob ? data : new Blob([data], { type: mime });
    // iPhone/iPad: the share sheet is the reliable way to save a file (Save to Files, open in Excel/Word).
    const touch = (navigator.maxTouchPoints || 0) > 1 && /iPhone|iPad|Macintosh|Android/.test(navigator.userAgent);
    if (touch && navigator.canShare && typeof File === 'function') {
      try {
        const f = new File([blob0], filename, { type: blob0.type || mime });
        if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: filename }); return { ok: true }; }
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, code: 'declined', message: 'Save cancelled.' };
      }
    }
    try {
      const blob = blob0;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      return { ok: true };
    } catch (e) {
      return { ok: false, code: 'unavailable', message: 'Downloads are not available in this view.' };
    }
  };

  // Tiny event bus
  const handlers = {};
  CB.on = (ev, fn) => ((handlers[ev] = handlers[ev] || []).push(fn), () => (handlers[ev] = handlers[ev].filter((f) => f !== fn)));
  CB.emit = (ev, data) => (handlers[ev] || []).slice().forEach((f) => { try { f(data); } catch (e) { console.error(e); } });
})();

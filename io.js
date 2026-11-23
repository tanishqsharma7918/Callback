/* Callback — file import / export.  Defines window.CB.IO.
 *
 * Files in
 *   CB.IO.extractText(file)        → {text, kind:'pdf'|'docx'|'txt', pages?, warnings[]}   (resume / JD text)
 *   CB.IO.importSpreadsheet(file)  → {jobs, mapped:{header:field}, skipped, sheet?}        (.xlsx / .csv / .tsv)
 *   CB.IO.importJSON(file)         → backup object made by exportJSON
 * Files out (each hands the file to CB.saveFile and resolves {filename, ok, code?, message?})
 *   CB.IO.exportExcel({jobs, atsById, stats, resumeName})
 *   CB.IO.exportCSV({jobs, atsById})
 *   CB.IO.exportJSON(state)
 *   CB.IO.exportReportDocx({jobs, atsById, stats, resumeName})
 *   CB.IO.exportJobDossierDocx(job, ats, resumeName)
 *   CB.IO.exportCoverLetterDocx({job, text, candidateName, candidateEmail, candidatePhone})
 *
 * ExcelJS, JSZip, pdf.js and mammoth are loaded lazily from CB.LIBS the first time a function needs them.
 * The .docx files are hand-written WordprocessingML (ECMA-376 element order) zipped with JSZip.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  const IO = (CB.IO = CB.IO || {});

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  // ═════════════════════════════ shared helpers ═════════════════════════════
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = () => CB.todayISO();
  const numOrNull = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !isFinite(+v) ? null : +v);
  const stageLabel = (key) => (CB.STAGE[key] ? CB.STAGE[key].label : str(key));
  const stageOrder = (key) => (CB.STAGE[key] ? CB.STAGE[key].order : -1);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const pctText = (x, d) => (isNum(x) ? (x * 100).toFixed(d || 0) + '%' : '—');
  const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function hex6(c) {
    let h = str(c).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((x) => x + x).join('');
    return /^[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : '000000';
  }
  const argb = (c) => 'FF' + hex6(c);

  /** Remove characters XML 1.0 cannot carry (control chars, lone surrogates). */
  function xmlSafe(s) {
    return str(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g, (m, pair) => pair || '');
  }
  function xmlEsc(s) {
    return xmlSafe(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  const safeName = (s, max) =>
    str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max || 40).replace(/-+$/, '');

  /** http(s)/mailto/tel URL or '' (bare domains get https://). */
  function safeUrl(u) {
    const s = str(u).trim();
    if (!s || /\s/.test(s)) return '';
    if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s;
    if (/^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$|\?)/i.test(s)) return 'https://' + s;
    return '';
  }

  async function lib(key, globalName) {
    if (window[globalName]) return window[globalName];
    await CB.loadScript(CB.LIBS[key]);
    if (!window[globalName]) throw new Error(`Could not load ${globalName}. Check your connection and try again.`);
    return window[globalName];
  }

  async function save(filename, blob, mime) {
    const res = await CB.saveFile(filename, blob, mime);
    return Object.assign({ filename }, res || {});
  }

  function readBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('Could not read the file.'));
      r.readAsArrayBuffer(file);
    });
  }
  /** Decode bytes as UTF-8 (BOM aware), falling back to UTF-16 / Windows-1252 for Excel-made text files. */
  function decodeText(buf) {
    const b = new Uint8Array(buf);
    try {
      if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
      if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    } catch (e) { /* fall through */ }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '');
    } catch (e) {
      try { return new TextDecoder('windows-1252').decode(b); } catch (e2) { return new TextDecoder('utf-8').decode(b).replace(/^﻿/, ''); }
    }
  }
  async function readText(file) { return decodeText(await readBuffer(file)); }

  // ───────── dates ─────────
  /** 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm' as LOCAL wall-clock; full ISO with zone via Date. */
  function parseLocal(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(v).trim());
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  const hasTime = (v) => /\d[T ]\d{1,2}:\d{2}/.test(str(v)) || /T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(str(v));
  /** Excel stores wall-clock serials; ExcelJS converts Dates via UTC, so build the Date from local parts in UTC. */
  function xlDate(v, withTime) {
    const d = parseLocal(v);
    if (!d) return null;
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), withTime ? d.getHours() : 0, withTime ? d.getMinutes() : 0));
  }
  const isoDate = (v) => { const d = parseLocal(v); return d ? CB.toISODate(d) : ''; };
  const isoDateTime = (v) => {
    const d = parseLocal(v);
    if (!d) return '';
    return hasTime(v) ? `${CB.toISODate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : CB.toISODate(d);
  };
  const fmtD = (v) => { const d = parseLocal(v); return d ? `${CB.MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : ''; };
  function fmtDT(v) {
    const d = parseLocal(v);
    if (!d) return '';
    if (!hasTime(v)) return fmtD(d);
    let h = d.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${fmtD(d)}, ${h}:${pad(d.getMinutes())} ${ap}`;
  }
  const longDate = (d) => `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  // ───────── text / HTML ─────────
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', times: '×', rarr: '→', larr: '←', check: '✓', euro: '€', pound: '£' };
  function decodeEntities(s) {
    return str(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; } catch (x) { return ''; }
      }
      const v = ENT[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }
  const looksHtml = (s) => /<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>/i.test(str(s));
  /** Rich-text HTML (or plain text) → [{text, bullet, heading}] — one block per paragraph / list item. */
  function htmlBlocks(html) {
    let s = str(html);
    if (!s.trim()) return [];
    if (looksHtml(s)) {
      s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li(\s[^>]*)?>/gi, '\n\u0001')
        .replace(/<h[1-6](\s[^>]*)?>/gi, '\n\u0002')
        .replace(/<\/?(p|div|h[1-6]|li|ul|ol|blockquote|pre|tr|table|section|article|header|footer)(\s[^>]*)?>/gi, '\n')
        .replace(/<\/(td|th)>/gi, '\t')
        .replace(/<\/?[a-z!][^>]*>/gi, '');
      s = decodeEntities(s);
    }
    const out = [];
    let pendBullet = false, pendHeading = false;
    s.replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
      if (raw.indexOf('\u0001') >= 0) pendBullet = true;
      if (raw.indexOf('\u0002') >= 0) pendHeading = true;
      let line = raw.replace(/[\u0001\u0002]/g, '').replace(/[ \t ]+/g, ' ').trim();
      if (!line) return;
      let bullet = pendBullet;
      const m = /^[•●▪◦‣∙·\-–*]\s+(.*)$/.exec(line);
      if (m) { bullet = true; line = m[1]; }
      out.push({ text: line, bullet, heading: pendHeading && !bullet });
      pendBullet = pendHeading = false;
    });
    return out;
  }
  const htmlText = (html) => htmlBlocks(html).map((b) => (b.bullet ? '• ' : '') + b.text).join('\n');
  const textToHtml = (t) => str(t).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${CB.esc(l)}</p>`).join('');

  const LIGS = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
  function cleanText(t) {
    return str(t)
      .replace(/\r\n?/g, '\n')
      .replace(/[ﬀ-ﬆ]/g, (c) => LIGS[c] || c)
      .replace(/[]/g, '•') // Symbol/Wingdings bullets
      .replace(/[-]/g, '') // icon-font glyphs (private use area)
      .replace(/[   ]/g, ' ')
      .replace(/­/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  /** Clean a string for an Excel cell (XML-safe, ≤ 32k chars); '' → null so COUNTA ignores it. */
  function cellText(v) {
    const s = xmlSafe(v).replace(/\r\n?/g, '\n').trim();
    if (!s) return null;
    return s.length > 32000 ? s.slice(0, 31990) + '…' : s;
  }

  // ───────── ATS + job helpers ─────────
  function atsFor(atsById, job) {
    if (!atsById || !job) return null;
    const a = typeof atsById.get === 'function' ? atsById.get(job.id) : atsById[job.id];
    return a && typeof a === 'object' ? a : null;
  }
  const hasScore = (a) => !!a && isNum(a.score);
  const prob = (a) => (hasScore(a) && isNum(a.probability) ? (a.probability > 1 ? a.probability / 100 : a.probability) : null);
  const VERDICT_TEXT = { STRONG: 'Strong match', COMPETITIVE: 'Competitive', LONG_SHOT: 'Long shot', REJECTED: 'Likely auto-rejected' };
  const VERDICT_COLOR = { STRONG: '0B7A3E', COMPETITIVE: '1E5FB4', LONG_SHOT: 'A35F00', REJECTED: 'B42318' };
  const verdictText = (a) => (hasScore(a) ? str(a.verdictLabel) || VERDICT_TEXT[a.verdict] || str(a.verdict) : '');
  const skillList = (a, kind) => (a && a.skills && Array.isArray(a.skills[kind]) ? a.skills[kind].filter((s) => s && s.name) : []);
  const missingRequired = (a) => skillList(a, 'required').filter((s) => s.status === 'missing').map((s, i) => ({ s, i }))
    .sort((x, y) => (y.s.jdCount || 0) - (x.s.jdCount || 0) || x.i - y.i).map((o) => o.s.name);
  const matchedRequired = (a) => skillList(a, 'required').filter((s) => s.status && s.status !== 'missing').map((s) => s.name);
  const knockouts = (a) => (a && Array.isArray(a.knockouts) ? a.knockouts.filter(Boolean) : []);
  const FIX_RANK = { critical: 0, high: 1, medium: 2, med: 2, low: 3 };
  function fixList(a) {
    const f = (a && Array.isArray(a.fixes) ? a.fixes : []).filter((x) => x && (typeof x === 'string' || x.text));
    return f.map((x, i) => ({ text: typeof x === 'string' ? x : str(x.text), priority: typeof x === 'string' ? '' : x.priority, i }))
      .sort((p, q) => (FIX_RANK[str(p.priority).toLowerCase()] ?? 2) - (FIX_RANK[str(q.priority).toLowerCase()] ?? 2) || p.i - q.i);
  }
  /** Component scores may be 0–100 or 0–1; normalise to 0–100. */
  function compScores(a) {
    const comps = a && Array.isArray(a.components) ? a.components.filter(Boolean) : [];
    const frac = comps.length && comps.every((c) => !isNum(c.score) || (c.score >= 0 && c.score <= 1)) && comps.some((c) => isNum(c.score) && c.score % 1 !== 0);
    return comps.map((c) => ({ key: c.key || c.label, label: c.label || c.key || 'Component', weight: c.weight, detail: c.detail, score: isNum(c.score) ? Math.round(frac ? c.score * 100 : c.score) : null }));
  }
  const weightText = (w) => (isNum(w) ? (w <= 1 ? Math.round(w * 100) : Math.round(w)) + '%' : '');
  function nextInterview(job) {
    const start = startOfToday();
    let best = null, bestD = null;
    (job.interviews || []).forEach((iv) => {
      if (!iv || iv.outcome === 'Cancelled') return;
      const d = parseLocal(iv.datetime);
      if (!d || d < start) return;
      if (!bestD || d < bestD) { best = iv; bestD = d; }
    });
    return best;
  }
  const stars = (n) => { if (n === null || n === undefined || n === '' || !isFinite(+n)) return ''; const k = Math.round(CB.clamp(+n, 0, 5)); return '★'.repeat(k) + '☆'.repeat(5 - k); };
  const roundText = (r) => (r === null || r === undefined || r === '' ? '' : isNum(r) ? `Round ${r}` : str(r));
  const contactNames = (j) => (j.contacts || []).map((c) => c && str(c.name).trim()).filter(Boolean).join('; ');

  /** Fallback stats from the jobs themselves; any non-null field in `given` wins. */
  function mergeStats(jobs, atsById, given) {
    const st = { total: jobs.length, applied: 0, responses: 0, interviews: 0, offers: 0, rejected: 0, ghosted: 0, byStage: {}, bySource: [] };
    CB.STAGES.forEach((s) => { st.byStage[s.key] = 0; });
    const src = {};
    let sum = 0, n = 0;
    jobs.forEach((j) => {
      st.byStage[j.status] = (st.byStage[j.status] || 0) + 1;
      const max = Math.max(j.maxStage || 0, stageOrder(j.status));
      const applied = !!j.appliedDate || max >= 1 || j.status === 'rejected' || j.status === 'ghosted';
      const responded = applied && (max >= 2 || j.status === 'rejected');
      if (applied) st.applied++;
      if (responded) st.responses++;
      if (max >= 4) st.interviews++;
      if (max >= 6) st.offers++;
      if (j.status === 'rejected') st.rejected++;
      if (j.status === 'ghosted') st.ghosted++;
      const a = atsFor(atsById, j);
      if (hasScore(a)) { sum += a.score; n++; }
      if (applied) {
        const k = j.source || 'Other';
        src[k] = src[k] || { source: k, applied: 0, responses: 0 };
        src[k].applied++;
        if (responded) src[k].responses++;
      }
    });
    st.responseRate = st.applied ? st.responses / st.applied : 0;
    st.interviewRate = st.applied ? st.interviews / st.applied : 0;
    st.offerRate = st.applied ? st.offers / st.applied : 0;
    st.avgAts = n ? sum / n : null;
    st.bySource = Object.values(src).map((s) => Object.assign(s, { rate: s.applied ? s.responses / s.applied : 0 })).sort((a, b) => b.applied - a.applied);
    if (given && typeof given === 'object') {
      Object.keys(given).forEach((k) => {
        const v = given[k];
        if (v === null || v === undefined) return;
        if (k === 'byStage' && typeof v === 'object') st.byStage = Object.assign({}, st.byStage, v);
        else if (k === 'bySource' && Array.isArray(v)) st.bySource = v;
        else st[k] = v;
      });
    }
    return st;
  }

  // ═════════════════════════════ FILES IN: resume / JD text ═════════════════════════════
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d{1,3}[\s.-]?\d[\d\s.-]{6,}\d/;

  IO.extractText = async function (file) {
    if (!file) throw new Error('No file selected.');
    const name = str(file.name).toLowerCase();
    const ext = name.indexOf('.') >= 0 ? name.split('.').pop() : '';
    const type = str(file.type).toLowerCase();
    let head = new Uint8Array(0);
    try { head = new Uint8Array(await readBuffer(file.slice(0, 8))); } catch (e) { /* ignore */ }
    const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
    const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
    const isZip = head[0] === 0x50 && head[1] === 0x4b;

    if (ext === 'doc' || type === 'application/msword' || (isOle && !/^(xls|ppt|msg)$/.test(ext))) {
      throw new Error('Save as .docx or PDF first — .doc is a legacy binary format.');
    }
    if (isPdf || ext === 'pdf' || type === 'application/pdf') return extractPdf(file);
    if (ext === 'docx' || ext === 'docm' || ext === 'dotx' || type.indexOf('wordprocessingml') >= 0 || (isZip && !ext)) return extractDocx(file);
    if (ext === 'pages') throw new Error('Export from Pages as PDF or .docx first (File › Export To).');
    if (ext === 'odt') throw new Error('Save as .docx or PDF first — .odt is not supported.');
    if (/^(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/.test(ext) || type.indexOf('image/') === 0) {
      throw new Error('That is an image — an ATS cannot read text in pictures. Upload the PDF or .docx version.');
    }
    if (isZip) throw new Error('Unsupported file type — upload a PDF, .docx or .txt file.');

    let text = await readText(file);
    if (ext === 'rtf' || /^\s*\{\\rtf/.test(text)) text = rtfToText(text);
    else if (ext === 'html' || ext === 'htm' || type === 'text/html') text = htmlText(text);
    const bad = (text.match(/[\uFFFD\u0000-\u0008\u000E-\u001F]/g) || []).length;
    if (text.length && bad / text.length > 0.02) throw new Error('This file does not look like text. Upload a PDF, .docx or .txt file.');
    return { text: cleanText(text), kind: 'txt', warnings: [] };
  };

  /** Rebuild reading-order lines from pdf.js text items. */
  function pdfLines(items, pageW) {
    const its = [];
    (items || []).forEach((it) => {
      // Whitespace-only items (some generators emit one spanning a column gap) carry no geometry we can trust;
      // word spaces are re-inferred from the x gaps below.
      if (!it || typeof it.str !== 'string' || !it.str.trim() || !it.transform) return;
      const t = it.transform;
      its.push({ s: it.str, x: t[4], y: t[5], w: Math.abs(it.width || 0), h: Math.abs(t[3]) || Math.abs(it.height || 0) || 10 });
    });
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const groups = [];
    its.forEach((it) => {
      const g = groups.length ? groups[groups.length - 1] : null;
      if (g && Math.abs(g.y - it.y) < 2) g.items.push(it);
      else groups.push({ y: it.y, items: [it] });
    });
    let split = 0;
    const lines = groups.map((g) => {
      g.items.sort((a, b) => a.x - b.x);
      let out = '', end = null, isSplit = false;
      g.items.forEach((it) => {
        if (end !== null) {
          const gap = it.x - end;
          if (gap > it.h * 2.5) {
            out = out.replace(/\s+$/, '') + '   ';
            if (pageW && gap > pageW * 0.05 && it.x > pageW * 0.25 && it.x < pageW * 0.7) isSplit = true;
          } else if (gap > it.h * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.s)) out += ' ';
        }
        out += it.s;
        end = it.x + it.w;
      });
      if (isSplit) split++;
      return out.replace(/\s+$/, '');
    }).filter((l) => l.trim());
    return { lines, split };
  }

  async function extractPdf(file) {
    await CB.loadScript(CB.LIBS.pdfjs);
    const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib || !pdfjsLib.getDocument) throw new Error('The PDF reader could not be loaded.');
    // Loading the worker script in-page defines globalThis.pdfjsWorker, so pdf.js 3.x runs its
    // "fake worker" on the main thread instead of creating a cross-origin Worker (blocked in the sandbox).
    try { await CB.loadScript(CB.LIBS.pdfworker); } catch (e) { /* pdf.js retries on its own */ }
    pdfjsLib.GlobalWorkerOptions.workerSrc = CB.LIBS.pdfworker;
    const data = new Uint8Array(await readBuffer(file));
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, disableStream: true, disableRange: true, verbosity: 0 }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password (or print it to a new PDF) and try again.');
      throw new Error('Could not read this PDF' + (e && e.message ? ` (${e.message})` : '') + '.');
    }
    const pages = pdf.numPages;
    const pageTexts = [];
    let lineCount = 0, splitCount = 0, charCount = 0;
    try {
      for (let p = 1; p <= pages; p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const r = pdfLines(tc.items, vp.width);
        lineCount += r.lines.length;
        splitCount += r.split;
        r.lines.forEach((l) => { charCount += l.trim().length; });
        pageTexts.push(r.lines.join('\n'));
        if (page.cleanup) page.cleanup();
      }
    } finally {
      try { await pdf.destroy(); } catch (e) { /* ignore */ }
    }
    const text = cleanText(pageTexts.join('\n\n'));
    const warnings = [];
    const visible = text.replace(/\s/g, '').length;
    if (visible < 200) {
      warnings.push(`Only ${visible} characters of text found — this looks like a scanned or image-only PDF: no selectable text; ATS sees an empty resume. Export a text-based PDF from Word or Google Docs.`);
    } else if ((lineCount >= 8 && splitCount / lineCount >= 0.25) || (lineCount >= 50 && charCount / lineCount < 28)) {
      warnings.push('Looks like a two-column layout — many ATS parsers read straight across the columns and scramble your sections. A single-column layout parses cleanly.');
    }
    if (pages > 2) warnings.push(`${pages} pages — keep a resume to 1–2 pages; recruiters skim and some ATS truncate long files.`);
    return { text, kind: 'pdf', pages, warnings };
  }

  const xmlText = (x) => decodeEntities(str(x).replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''));

  async function extractDocx(file) {
    const buf = await readBuffer(file);
    const mammoth = await lib('mammoth', 'mammoth');
    let res;
    try { res = await mammoth.extractRawText({ arrayBuffer: buf }); } catch (e) {
      throw new Error('Could not read this Word file — re-save it as .docx or export a PDF.');
    }
    // mammoth ends every paragraph with \n\n; keep paragraphs as lines and empty paragraphs as blank lines.
    const text = cleanText(str(res && res.value).replace(/\n\n/g, '\n'));
    const warnings = [];
    let pages;
    try {
      const JSZip = await lib('jszip', 'JSZip');
      const zip = await JSZip.loadAsync(buf);
      const docFile = zip.file('word/document.xml');
      const docXml = docFile ? await docFile.async('string') : '';
      if (/<w:tbl[\s>]/.test(docXml)) warnings.push('Tables: many ATS parsers read tables out of order — keep job titles, dates and skills as plain paragraphs.');
      if (/<w:txbxContent[\s>]/.test(docXml)) warnings.push('Text boxes are invisible to many ATS parsers — move that text into the main body.');
      const headers = zip.file(/^word\/header\d*\.xml$/);
      for (let i = 0; i < headers.length; i++) {
        const t = xmlText(await headers[i].async('string'));
        if (EMAIL_RE.test(t) || PHONE_RE.test(t)) {
          warnings.push('Contact info in the page header — some ATS skip headers. Put your name, email and phone in the body.');
          break;
        }
      }
      const app = zip.file('docProps/app.xml');
      if (app) {
        const m = /<Pages>(\d+)<\/Pages>/.exec(await app.async('string'));
        if (m && +m[1] > 0) pages = +m[1];
      }
    } catch (e) { /* the layout scan is best-effort */ }
    if (text.replace(/\s/g, '').length < 200) warnings.push('Very little text found — if the resume is built from text boxes, shapes or images, an ATS sees an almost empty resume.');
    if (pages > 2) warnings.push(`${pages} pages — keep a resume to 1–2 pages; recruiters skim and some ATS truncate long files.`);
    const out = { text, kind: 'docx', warnings };
    if (pages) out.pages = pages;
    return out;
  }

  // Basic RTF → text: skips non-text destinations (font tables, pictures, field codes…), decodes \'hh and \uN.
  const RTF_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'fldinst', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'filetbl', 'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'object', 'objdata', 'shp', 'shpinst', 'shppict', 'nonshppict', 'xmlnstbl', 'latentstyles', 'themedata', 'colorschememapping', 'datastore', 'generator', 'mmathpr', 'pntext', 'pntxta', 'pntxtb', 'bkmkstart', 'bkmkend', 'author', 'operator', 'title', 'subject', 'keywords', 'comment', 'doccomm', 'company', 'listtext', 'pgdsctbl', 'protusertbl', 'userprops', 'template', 'wgrffmtfilter', 'defchp', 'defpap', 'atnauthor', 'annotation']);
  const RTF_SPECIAL = { par: '\n', sect: '\n\n', page: '\n\n', line: '\n', tab: '\t', emdash: '—', endash: '–', emspace: ' ', enspace: ' ', qmspace: ' ', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', row: '\n', cell: '\t', nestcell: '\t' };
  const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
  function rtfToText(rtf) {
    const re = /\\([a-z]{1,32})(-?\d{1,10})?[ ]?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|[\r\n]+|(.)/gi;
    const stack = [];
    const out = [];
    let ignorable = false, ucskip = 1, curskip = 0, m;
    while ((m = re.exec(rtf))) {
      const word = m[1], arg = m[2], hex = m[3], ch = m[4], brace = m[5], tchar = m[6];
      if (brace) {
        curskip = 0;
        if (brace === '{') stack.push([ucskip, ignorable]);
        else if (stack.length) { const s = stack.pop(); ucskip = s[0]; ignorable = s[1]; }
      } else if (ch) {
        curskip = 0;
        if (ch === '*') ignorable = true;
        else if (!ignorable) {
          if (ch === '~') out.push(' ');
          else if (ch === '{' || ch === '}' || ch === '\\') out.push(ch);
          else if (ch === '_') out.push('-');
          else if (ch === '\n' || ch === '\r') out.push('\n');
        }
      } else if (word) {
        curskip = 0;
        const w = word.toLowerCase();
        if (RTF_DEST.has(w)) { if (w === 'listtext' && !ignorable) out.push('• '); ignorable = true; }
        else if (ignorable) { /* skip */ }
        else if (RTF_SPECIAL[w] !== undefined) out.push(RTF_SPECIAL[w]);
        else if (w === 'uc') ucskip = parseInt(arg || '1', 10);
        else if (w === 'u') {
          let c = parseInt(arg || '0', 10);
          if (c < 0) c += 0x10000;
          out.push(String.fromCharCode(c));
          curskip = ucskip;
        }
      } else if (hex) {
        if (curskip > 0) curskip--;
        else if (!ignorable) { const c = parseInt(hex, 16); out.push(CP1252[c] || String.fromCharCode(c)); }
      } else if (tchar) {
        if (curskip > 0) curskip--;
        else if (!ignorable) out.push(tchar);
      }
    }
    return out.join('').replace(/• \t/g, '• ');
  }

  // ═════════════════════════════ FILES IN: spreadsheets ═════════════════════════════
  const norm = (s) => str(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  const FIELD_SYNONYMS = [
    ['company', ['company', 'company name', 'employer', 'employer name', 'organization', 'organisation', 'org', 'firm', 'business', 'hiring company', 'companies']],
    ['title', ['title', 'job title', 'position', 'role', 'job', 'position title', 'role title', 'job role', 'job name', 'opening', 'job position', 'position applied for', 'role applied for']],
    ['status', ['status', 'stage', 'application status', 'current status', 'current stage', 'pipeline stage', 'progress', 'state', 'outcome']],
    ['appliedDate', ['applied', 'date applied', 'application date', 'applied on', 'applied date', 'date of application', 'submitted', 'submitted on', 'date submitted', 'submission date', 'app date', 'applied at', 'when applied', 'apply date', 'date']],
    ['location', ['location', 'city', 'office', 'office location', 'city state', 'job location', 'place', 'locale', 'country', 'region']],
    ['url', ['url', 'link', 'job link', 'posting', 'job posting', 'posting url', 'job url', 'listing', 'listing url', 'application link', 'posting link', 'job post', 'website', 'job page', 'careers page', 'apply link', 'link to posting', 'job listing']],
    ['source', ['source', 'platform', 'where', 'where applied', 'found via', 'found on', 'channel', 'job board', 'site', 'applied via', 'applied through', 'how found', 'how did you find', 'lead source', 'application method']],
    ['salaryMin', ['salary min', 'min salary', 'minimum salary', 'salary low', 'salary from', 'pay min', 'min pay', 'comp min', 'base min', 'salary minimum']],
    ['salaryMax', ['salary max', 'max salary', 'maximum salary', 'salary high', 'salary to', 'pay max', 'max pay', 'comp max', 'base max', 'salary maximum']],
    ['salary', ['salary', 'compensation', 'pay', 'salary range', 'comp', 'pay range', 'base salary', 'base', 'rate', 'expected salary', 'wage', 'total comp', 'tc', 'salary expectation', 'comp range', 'hourly rate', 'pay rate']],
    ['notes', ['notes', 'note', 'comments', 'comment', 'remarks', 'details', 'thoughts', 'next steps', 'misc', 'additional notes', 'info']],
    ['workMode', ['work mode', 'remote', 'remote hybrid', 'remote onsite', 'remote on site', 'work type', 'workplace', 'workplace type', 'arrangement', 'work arrangement', 'remote status', 'location type', 'onsite remote', 'on site remote', 'hybrid remote', 'work model', 'remote option']],
    ['priority', ['priority', 'importance', 'prio']],
    ['excitement', ['excitement', 'interest', 'interest level', 'excitement level', 'rating', 'enthusiasm', 'stars', 'how excited']],
    ['followUpDate', ['follow up', 'follow up date', 'followup', 'followup date', 'next follow up', 'follow up on', 'follow up by', 'reminder', 'reminder date', 'next action date', 'next step date', 'check in date']],
    ['contactEmail', ['contact email', 'recruiter email', 'email', 'e mail', 'hiring manager email', 'email address']],
    ['contactPhone', ['contact phone', 'recruiter phone', 'phone', 'phone number', 'telephone']],
    ['contactLinkedin', ['contact linkedin', 'recruiter linkedin', 'hiring manager linkedin', 'linkedin profile']],
    ['contact', ['contact', 'contacts', 'recruiter', 'hiring manager', 'contact name', 'recruiter name', 'point of contact', 'poc', 'contact person', 'recruiter contact', 'hiring contact']],
    ['jd', ['job description', 'jd', 'description', 'job desc', 'posting text', 'job details', 'requirements', 'job requirements', 'responsibilities', 'full description']],
    ['deadline', ['deadline', 'apply by', 'closing date', 'application deadline', 'due date', 'close date']],
    ['responseDate', ['response date', 'heard back', 'date heard back', 'reply date', 'date of response', 'responded on']],
    ['postedDate', ['date posted', 'posted', 'posted date', 'posting date', 'posted on']],
    ['employmentType', ['employment type', 'job type', 'type', 'contract type', 'position type', 'employment']],
    ['seniority', ['seniority', 'level', 'seniority level', 'job level', 'experience level']],
    ['rejectionReason', ['rejection reason', 'reason', 'reason rejected', 'why rejected', 'reason for rejection', 'decline reason']],
    ['tags', ['tags', 'tag', 'labels', 'label', 'category', 'categories', 'industry']],
    ['applicants', ['applicants', 'applicant count', 'number of applicants', 'applicants count', 'num applicants']],
    ['referrer', ['referral', 'referred by', 'referrer', 'referrer name', 'referral name']],
    ['interviewDate', ['interview date', 'next interview', 'interview', 'interview time', 'next interview date', 'interview datetime', 'interview scheduled']],
    ['linkedinJobId', ['linkedin job id']],
  ];
  // Columns of this app's own export that are derived (recomputed on import) plus generic counters.
  const HEADER_IGNORE = new Set(['no', 'id', 'ats score', 'ats', 'score', 'match score', 'interview chance', 'chance', 'verdict', 'days since applied', 'days since', 'days', 'age', 'interviews', 'knockouts', 'missing must haves', 'last updated', 'updated', 'updated at', 'created', 'created at', 'row', 'index', 'number', 'count', 'n']);
  const NO_CONTAINS = new Set(['where', 'base', 'rate', 'type', 'site', 'state', 'level', 'job', 'info', 'tc', 'poc', 'org', 'comp', 'pay', 'note', 'date', 'role', 'firm', 'misc', 'prio', 'place', 'label', 'tag', 'stars', 'link', 'office']);
  const MULTI_FIELDS = new Set(['notes', 'tags']);
  const FIELD_LABEL = { salary: 'salaryMin/salaryMax', contact: 'contacts', contactEmail: 'contacts.email', contactPhone: 'contacts.phone', contactLinkedin: 'contacts.linkedin', interviewDate: 'interviews', referrer: 'referrerName' };
  const EXACT = {};
  FIELD_SYNONYMS.forEach(([f, syns]) => syns.forEach((s) => { if (!(s in EXACT)) EXACT[s] = f; }));

  function containsField(h) {
    if (h.split(' ').length > 6) return null;
    if (/\bemail\b|\be mail\b/.test(h)) return 'contactEmail';
    if (/\bphone\b/.test(h)) return 'contactPhone';
    let best = null, bestLen = 0;
    const padded = ' ' + h + ' ';
    FIELD_SYNONYMS.forEach(([f, syns]) => syns.forEach((s) => {
      if (s.length < 4 || NO_CONTAINS.has(s) || s.length <= bestLen) return;
      if (padded.indexOf(' ' + s + ' ') >= 0) { best = f; bestLen = s.length; }
    }));
    return best;
  }
  /** header cells → [{field, header, norm} | undefined] */
  function mapHeaders(cells) {
    const norms = cells.map((c) => norm(plainCell(c) instanceof Date ? '' : plainCell(c)));
    const map = [];
    const used = {};
    const take = (i, f) => {
      if (!f || (used[f] && !MULTI_FIELDS.has(f))) return;
      used[f] = true;
      map[i] = { field: f, header: str(plainCell(cells[i])).trim(), norm: norms[i] };
    };
    norms.forEach((h, i) => { if (h && !HEADER_IGNORE.has(h) && EXACT[h]) take(i, EXACT[h]); });
    norms.forEach((h, i) => { if (h && !map[i] && !HEADER_IGNORE.has(h)) take(i, containsField(h)); });
    return map;
  }

  /** ExcelJS cell value → primitive (string | number | boolean | Date | ''). */
  function plainCell(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isNaN(v) ? '' : v;
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map((t) => str(t && t.text)).join('');
      if ('formula' in v || 'sharedFormula' in v) return plainCell(v.result);
      if ('error' in v) return '';
      if ('text' in v) return plainCell(v.text);
      return '';
    }
    return v;
  }
  const cellLink = (v) => (v && typeof v === 'object' && typeof v.hyperlink === 'string' && v.hyperlink.charAt(0) !== '#' ? v.hyperlink : '');
  const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || v === '';

  // ───────── RFC-4180 CSV ─────────
  function detectDelimiter(text) {
    let line = '', inQ = false;
    for (let i = 0; i < text.length && i < 20000; i++) {
      const c = text[i];
      if (c === '"') inQ = !inQ;
      else if ((c === '\n' || c === '\r') && !inQ) { if (line.trim()) break; line = ''; continue; }
      if (!inQ) line += c;
    }
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    for (let i = 0; i < line.length; i++) if (line[i] in counts) counts[line[i]]++;
    let best = ',', n = 0;
    [',', '\t', ';', '|'].forEach((d) => { if (counts[d] > n) { best = d; n = counts[d]; } });
    return best;
  }
  function parseCSV(text, delim) {
    text = str(text).replace(/^﻿/, '');
    const sep = /^sep=(.)\r?\n/i.exec(text);
    if (sep) { delim = sep[1]; text = text.slice(sep[0].length); }
    delim = delim || detectDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false, i = 0, quoted = false;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        let j = text.indexOf('"', i);
        if (j < 0) j = n;
        field += text.slice(i, j);
        i = j;
        continue;
      }
      if (c === '"' && !field && !quoted) { inQ = true; quoted = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; quoted = false; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(field); rows.push(row);
        row = []; field = ''; quoted = false;
        i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += c; i++;
    }
    if (field || quoted || row.length) { row.push(field); rows.push(row); }
    return { rows, delim };
  }

  // ───────── value parsers ─────────
  const MON3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  /** Any date-ish cell → {date:'YYYY-MM-DD', time:'HH:mm'|''} | null. JS Dates come from ExcelJS (UTC wall clock). */
  function parseDateValue(v) {
    if (isBlank(v) || typeof v === 'boolean') return null;
    let y, mo, d, hh = null, mi = null, m;
    const fromSerialDate = (t) => {
      const r = new Date(Math.round(t.getTime() / 1000) * 1000);
      y = r.getUTCFullYear(); mo = r.getUTCMonth() + 1; d = r.getUTCDate();
      if (r.getUTCHours() || r.getUTCMinutes()) { hh = r.getUTCHours(); mi = r.getUTCMinutes(); }
    };
    const s0 = typeof v === 'string' ? v.trim().replace(/^'/, '') : v;
    if (s0 instanceof Date) {
      if (isNaN(s0)) return null;
      fromSerialDate(s0);
    } else if (typeof s0 === 'number' || /^\d{5}(\.\d+)?$/.test(s0)) {
      const n = +s0;
      if (!(n > 20000 && n < 80000)) return null;
      fromSerialDate(new Date(Math.round((n - 25569) * 86400) * 1000));
    } else {
      let s = String(s0);
      const ampm = (h, ap) => { h = +h; if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; } return h; };
      if ((m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.exec(s))) {
        const t = new Date(s);
        if (isNaN(t)) return null;
        y = t.getFullYear(); mo = t.getMonth() + 1; d = t.getDate(); hh = t.getHours(); mi = t.getMinutes();
      } else if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(am|pm)?)?/i.exec(s))) {
        y = +m[1]; mo = +m[2]; d = +m[3];
        if (m[4]) { hh = ampm(m[4], m[6]); mi = +m[5]; }
      } else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?$/i.exec(s))) {
        const a = +m[1], b = +m[2];
        y = +m[3]; if (y < 100) y += 2000;
        if (a > 12 && b <= 12) { d = a; mo = b; } else { mo = a; d = b; }
        if (m[4]) { hh = ampm(m[4], m[6]); mi = +m[5]; }
      } else {
        s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
        let rest = '';
        if ((m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:\s+(\d{4}))?(.*)$/i.exec(s)) && MON3[m[1].slice(0, 3).toLowerCase()]) {
          mo = MON3[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = m[3] ? +m[3] : new Date().getFullYear(); rest = m[4];
        } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?(?:\s+(\d{4}))?(.*)$/i.exec(s)) && MON3[m[2].slice(0, 3).toLowerCase()]) {
          d = +m[1]; mo = MON3[m[2].slice(0, 3).toLowerCase()]; y = m[3] ? +m[3] : new Date().getFullYear(); rest = m[4];
        } else {
          if (!/[a-z]{3}/i.test(s) || !/\d/.test(s)) return null;
          const t = new Date(s);
          if (isNaN(t)) return null;
          y = t.getFullYear(); mo = t.getMonth() + 1; d = t.getDate();
        }
        const tm = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(rest);
        if (tm) { hh = ampm(tm[1], tm[3]); mi = +tm[2]; }
      }
    }
    if (!(y >= 1970 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(y, mo, 0).getDate())) return null;
    const ok = hh !== null && hh >= 0 && hh < 24 && mi >= 0 && mi < 60;
    return { date: `${y}-${pad(mo)}-${pad(d)}`, time: ok ? `${pad(hh)}:${pad(mi)}` : '' };
  }

  /** "$120k-150k", "120,000 - 150,000", "$55/hr", 85000 → {min, max, period, currency} | null */
  function parseSalary(v, thousands) {
    if (isBlank(v) || typeof v === 'boolean' || v instanceof Date) return null;
    if (typeof v === 'number') {
      if (!isFinite(v) || v <= 0) return null;
      const n = thousands && v < 5000 ? v * 1000 : v;
      return { min: Math.round(n * 100) / 100, max: null, period: n < 500 ? 'hour' : 'year', currency: '' };
    }
    const s = String(v).toLowerCase().replace(/\s+/g, ' ').trim();
    const currency = /€|\beur\b/.test(s) ? 'EUR' : /£|\bgbp\b/.test(s) ? 'GBP' : /₹|\binr\b/.test(s) ? 'INR' : /c\$|\bcad\b/.test(s) ? 'CAD' : /a\$|\baud\b/.test(s) ? 'AUD' : /\$|\busd\b/.test(s) ? 'USD' : '';
    let period = /\/\s*h(ou)?r\b|\/\s*h\b|per hour|hourly|\bhr\b|an hour|\bph\b/.test(s) ? 'hour' : /\/\s*mo(nth)?\b|per month|monthly|a month/.test(s) ? 'month' : 'year';
    const nums = [];
    const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|m)?(?![a-z])/g;
    let m;
    while ((m = re.exec(s)) && nums.length < 2) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (isFinite(n)) nums.push({ n, suf: m[2] || '' });
    }
    if (!nums.length) return null;
    const anyK = nums.some((x) => x.suf === 'k');
    const vals = nums.map((x) => (x.suf === 'k' ? x.n * 1000 : x.suf === 'm' ? x.n * 1e6 : (anyK || thousands) && x.n < 1000 ? x.n * 1000 : x.n));
    if (vals.every((x) => x < 500) && period === 'year') period = 'hour';
    let min = vals[0], max = vals.length > 1 ? vals[1] : null;
    if (max !== null && max < min) { const t = min; min = max; max = t; }
    const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);
    return { min: r2(min), max: r2(max), period, currency };
  }

  const STATUS_RULES = [
    ['withdrawn', /\b(withdr[ae]wn?|withdrawing|pulled out|declined (the )?offer|offer declined|turned down (the )?offer|no longer interested|not interested)\b/],
    ['accepted', /\b(accepted|signed|hired|joined)\b/],
    ['ghosted', /\b(ghost\w*|no response|no reply|never heard( back)?|unresponsive|no answer|crickets|radio silence)\b/],
    ['rejected', /\b(reject\w*|declined|denied|turned down|not selected|not moving forward|unsuccessful|no offer|closed|no|failed|dead|not a fit|did not get|didn t get|passed)\b/],
    ['offer', /\b(offer\w*)\b/],
    ['final', /\b(onsite|on site|final\w*|super ?day|loop|panel)\b/],
    ['assessment', /\b(oa|online assessment|assessment\w*|take ?home|coding challenge|challenge|test|hackerrank|codesignal|codility|case study|assignment|exercise)\b/],
    ['screen', /\b(phone screen|screen\w*|recruiter call|recruiter|hr call|intro call|phone call|first call|phone)\b/],
    ['interview', /\b(interview\w*|technical|hiring manager|hm|second round|2nd round|round \d|round)\b/],
    ['saved', /\b(not (yet )?applied|to apply|want to apply|need to apply|wish ?list|wishlist)\b/],
    ['applied', /\b(applied|submitted|application sent|sent|pending|in review|under review|in progress|waiting|awaiting|active)\b/],
    ['saved', /\b(saved|interested|bookmarked|considering|planned|planning|draft|todo|to do|researching|prospect|maybe|idea|lead)\b/],
  ];
  function mapStatus(v) {
    const s = norm(v);
    if (!s) return '';
    for (let i = 0; i < CB.STAGES.length; i++) {
      const st = CB.STAGES[i];
      if (s === st.key || s === norm(st.label) || s === norm(st.short)) return st.key;
    }
    for (let i = 0; i < STATUS_RULES.length; i++) if (STATUS_RULES[i][1].test(s)) return STATUS_RULES[i][0];
    return '';
  }
  function mapWorkMode(v) {
    const s = norm(v);
    if (!s) return '';
    if (/hybrid/.test(s)) return 'Hybrid';
    if (/remote|wfh|work from home|anywhere|distributed/.test(s)) return 'Remote';
    if (/on ?site|office|in person/.test(s)) return 'On-site';
    if (/^(yes|y|true|1|x)$/.test(s)) return 'Remote';
    if (/^(no|n|false|0)$/.test(s)) return 'On-site';
    return '';
  }
  function mapPriority(v) {
    const s = norm(v);
    if (!s) return '';
    if (/^(h|1|p0|p1|a|top|urgent|dream|must|very high)$/.test(s) || s.indexOf('high') === 0) return 'High';
    if (/^(l|3|p3|c|backup|maybe|very low)$/.test(s) || s.indexOf('low') === 0) return 'Low';
    if (/^(m|2|p2|b|med|medium|normal|mid)/.test(s)) return 'Medium';
    return 'Medium';
  }
  function mapExcitement(v) {
    if (isBlank(v)) return null;
    if (typeof v === 'number') return Math.round(CB.clamp(v > 5 && v <= 10 ? v / 2 : v, 0, 5));
    const s = String(v);
    const starCount = (s.match(/★|⭐/g) || []).length;
    if (starCount || /☆/.test(s)) return Math.min(5, starCount);
    const m = /(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?/.exec(s);
    if (m) { const n = +m[1], of = m[2] ? +m[2] : 5; return Math.round(CB.clamp((n / (of || 5)) * 5, 0, 5)); }
    const t = norm(s);
    if (/very high|dream|love/.test(t)) return 5;
    if (/high/.test(t)) return 4;
    if (/medium|mid|ok/.test(t)) return 3;
    if (/low/.test(t)) return 2;
    return null;
  }
  function mapSource(v) {
    const s = norm(v);
    if (!s) return '';
    for (let i = 0; i < CB.SOURCES.length; i++) if (s === norm(CB.SOURCES[i])) return CB.SOURCES[i];
    if (/easy ?apply/.test(s)) return CB.SOURCES.indexOf('LinkedIn Easy Apply') >= 0 ? 'LinkedIn Easy Apply' : 'LinkedIn';
    if (/linked ?in/.test(s)) return 'LinkedIn';
    if (/referr|referred|referral/.test(s)) return 'Referral';
    if (/recruit|agency|head ?hunter|inbound|reached out|outreach/.test(s)) return 'Recruiter outreach';
    if (/indeed/.test(s)) return 'Indeed';
    if (/glassdoor/.test(s)) return 'Glassdoor';
    if (/wellfound|angel/.test(s)) return 'Wellfound';
    if (/hacker ?news|\bhn\b|who is hiring|ycombinator/.test(s)) return 'Hacker News';
    if (/job fair|career fair|career expo|meetup|conference/.test(s)) return 'Job fair';
    if (/company|career|website|direct|official|site/.test(s)) return 'Company site';
    return 'Other';
  }
  function mapEmpType(v) {
    const s = norm(v);
    if (/intern/.test(s)) return 'Internship';
    if (/part/.test(s)) return 'Part-time';
    if (/contract|freelance|consult|1099|c2c/.test(s)) return 'Contract';
    if (/temp|seasonal/.test(s)) return 'Temporary';
    if (/full|permanent|fte|perm/.test(s)) return 'Full-time';
    return '';
  }
  function mapSeniority(v) {
    const s = norm(v);
    if (!s) return '';
    const rules = [[/intern/, 'Intern'], [/\bvp\b|vice president|exec|chief|\bc level\b|\bhead\b/, 'VP / Executive'], [/director/, 'Director'], [/manager|\bmgr\b/, 'Manager'], [/principal/, 'Principal'], [/staff|lead|architect/, 'Staff / Lead'], [/senior|\bsr\b|\biii\b/, 'Senior'], [/mid|intermediate|\bii\b/, 'Mid level'], [/entry|junior|\bjr\b|new grad|graduate|associate|\bi\b/, 'Entry level']];
    for (let i = 0; i < rules.length; i++) {
      if (rules[i][0].test(s)) { const lab = rules[i][1]; return CB.SENIORITY.some((x) => x.label === lab) ? lab : ''; }
    }
    const exact = CB.SENIORITY.find((x) => norm(x.label) === s);
    return exact ? exact.label : '';
  }
  function newContact(p) { return Object.assign({ id: CB.uid('c_'), name: '', role: '', email: '', phone: '', linkedin: '', notes: '' }, p); }
  function splitContacts(v) {
    return str(v).split(/\s*(?:;|\n|\|)\s*/).map((part) => {
      let s = part.trim();
      if (!s) return null;
      const c = newContact({});
      const em = EMAIL_RE.exec(s); if (em) { c.email = em[0]; s = s.replace(em[0], ' '); }
      const li = /(https?:\/\/)?([a-z]+\.)?linkedin\.com\/[^\s,;)]+/i.exec(s); if (li) { c.linkedin = safeUrl(li[0]); s = s.replace(li[0], ' '); }
      const ph = PHONE_RE.exec(s); if (ph) { c.phone = ph[0].trim(); s = s.replace(ph[0], ' '); }
      s = s.replace(/[<>[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      let rm = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(s);
      if (rm) { s = rm[1]; c.role = rm[2].trim(); } else if ((rm = /^(.*?)\s+[-–—]\s+(.+)$/.exec(s)) || (rm = /^(.*?),\s+(.+)$/.exec(s))) { s = rm[1]; c.role = rm[2].trim(); }
      c.name = s.replace(/^[\s,:-]+|[\s,:-]+$/g, '');
      return c.name || c.email || c.phone || c.linkedin ? c : null;
    }).filter(Boolean);
  }
  /** Cell → trimmed string; strips the CSV formula-guard apostrophe this module adds on export. */
  function cellString(v) {
    if (v instanceof Date) { const p = parseDateValue(v); return p ? p.date : ''; }
    const s = str(v).replace(/\r\n?/g, '\n').trim();
    return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
  }

  function rowToJob(vals, links, map, filename) {
    const rec = {};
    map.forEach((m, i) => {
      if (!m) return;
      const v = vals[i];
      const link = links[i] || '';
      if (isBlank(v) && !link) return;
      (rec[m.field] = rec[m.field] || []).push({ v, link, norm: m.norm });
    });
    const first = (f) => (rec[f] ? rec[f][0].v : '');
    const text = (f) => (rec[f] ? cellString(rec[f][0].v) : '');
    const dateOf = (f) => { const p = rec[f] ? parseDateValue(rec[f][0].v) : null; return p ? p.date : ''; };

    const patch = { company: text('company'), title: text('title'), location: text('location') };
    if (!patch.company && !patch.title) return null;

    patch.appliedDate = dateOf('appliedDate');
    let status = rec.status ? mapStatus(first('status')) : '';
    if (!status) status = patch.appliedDate ? 'applied' : 'saved';
    patch.status = status;
    patch.followUpDate = dateOf('followUpDate');
    patch.deadline = dateOf('deadline');
    patch.responseDate = dateOf('responseDate');
    patch.postedDate = dateOf('postedDate');

    // URL: prefer a real hyperlink, else the cell text if it looks like a URL
    if (rec.url) {
      const e = rec.url[0];
      patch.url = safeUrl(e.link) || safeUrl(cellString(e.v));
    }
    const lid = /linkedin\.com\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/i.exec(patch.url || '') || /currentJobId=(\d{6,})/.exec(patch.url || '');
    if (rec.linkedinJobId) patch.linkedinJobId = text('linkedinJobId').replace(/\D/g, '');
    else if (lid) patch.linkedinJobId = lid[1];

    // Salary
    let smin = null, smax = null, period = '', currency = '';
    const isK = (e) => /\bk\b|thousands?|000s/.test(e.norm);
    if (rec.salary) { const s = parseSalary(rec.salary[0].v, isK(rec.salary[0])); if (s) { smin = s.min; smax = s.max; period = s.period; currency = s.currency; } }
    if (rec.salaryMin) { const s = parseSalary(rec.salaryMin[0].v, isK(rec.salaryMin[0])); if (s) { smin = s.min; period = period || s.period; currency = currency || s.currency; } }
    if (rec.salaryMax) { const s = parseSalary(rec.salaryMax[0].v, isK(rec.salaryMax[0])); if (s) { smax = s.max !== null ? s.max : s.min; period = period || s.period; currency = currency || s.currency; } }
    if (smin !== null || smax !== null) {
      if (smin !== null && smax !== null && smax < smin) { const t = smin; smin = smax; smax = t; }
      patch.salaryMin = smin;
      patch.salaryMax = smax;
      patch.salaryPeriod = period || 'year';
      if (currency) patch.salaryCurrency = currency;
    }

    let wm = rec.workMode ? mapWorkMode(first('workMode')) : '';
    if (!wm && /\bremote\b/i.test(patch.location)) wm = 'Remote';
    else if (!wm && /\bhybrid\b/i.test(patch.location)) wm = 'Hybrid';
    patch.workMode = wm;

    const src = rec.source ? mapSource(first('source')) : '';
    patch.source = src || 'Other';
    if (rec.referrer) {
      const r = text('referrer');
      if (r && !/^(no|n|false|0|none|n\/a|-)$/i.test(r)) {
        patch.referral = true;
        if (!/^(yes|y|true|1|x)$/i.test(r)) patch.referrerName = r;
        if (!src) patch.source = 'Referral';
      }
    }
    if (patch.source === 'Referral') patch.referral = true;

    if (rec.priority) patch.priority = mapPriority(first('priority')) || 'Medium';
    if (rec.excitement) { const e = mapExcitement(first('excitement')); if (e !== null) patch.excitement = e; }
    if (rec.employmentType) { const t = mapEmpType(first('employmentType')); if (t) patch.employmentType = t; }
    if (rec.seniority) { const t = mapSeniority(first('seniority')); if (t) patch.seniority = t; }
    if (rec.rejectionReason) patch.rejectionReason = text('rejectionReason');
    if (rec.jd) patch.jd = cleanText(text('jd'));
    if (rec.applicants) { const n = parseInt(str(first('applicants')).replace(/[^\d]/g, ''), 10); if (isFinite(n)) patch.applicants = n; }
    if (rec.tags) {
      const tags = [];
      rec.tags.forEach((e) => cellString(e.v).split(/\s*[,;\n]\s*/).forEach((t) => { if (t && tags.indexOf(t) < 0) tags.push(t); }));
      patch.tags = tags;
    }
    if (rec.notes) {
      const parts = rec.notes.map((e) => cellString(e.v)).filter(Boolean);
      patch.notes = textToHtml(parts.join('\n'));
    }

    const contacts = rec.contact ? splitContacts(text('contact')) : [];
    const email = rec.contactEmail ? (EMAIL_RE.exec(text('contactEmail') + ' ' + (rec.contactEmail[0].link || '')) || [''])[0] : '';
    const phone = rec.contactPhone ? text('contactPhone') : '';
    const linkedin = rec.contactLinkedin ? safeUrl(rec.contactLinkedin[0].link) || safeUrl(text('contactLinkedin')) : '';
    if ((email || phone || linkedin) && !contacts.length) contacts.push(newContact({}));
    if (contacts.length) {
      if (email && !contacts[0].email) contacts[0].email = email;
      if (phone && !contacts[0].phone) contacts[0].phone = phone;
      if (linkedin && !contacts[0].linkedin) contacts[0].linkedin = linkedin;
      if (!contacts[0].name) contacts[0].name = contacts[0].email || 'Contact';
    }
    patch.contacts = contacts;

    const interviews = [];
    if (rec.interviewDate) {
      const p = parseDateValue(first('interviewDate'));
      if (p) {
        const dt = `${p.date}T${p.time || '09:00'}`;
        interviews.push({
          id: CB.uid('i_'), round: 1, type: '', datetime: dt, durationMin: 60, interviewer: '', link: '',
          outcome: parseLocal(dt) >= startOfToday() ? 'Scheduled' : 'Completed', notes: p.time ? '' : 'Imported without a time — check it.', thankYouSent: false,
        });
      }
    }
    patch.interviews = interviews;

    let ms = Math.max(0, stageOrder(status));
    if (patch.appliedDate || status === 'rejected' || status === 'ghosted') ms = Math.max(ms, 1);
    if (interviews.length) ms = Math.max(ms, 2);
    patch.maxStage = ms;
    patch.timeline = [{ id: CB.uid('t_'), ts: CB.nowISO(), kind: 'import', text: `Imported from ${filename}` }];

    const job = CB.newJob(patch);
    if (!job.rejectionStage && status === 'rejected' && ms > 1) {
      const st = CB.PROGRESSION.find((x) => x.order === ms);
      if (st) job.rejectionStage = st.key;
    }
    return job;
  }

  function rowsToJobs(rows, filename) {
    let header = null;
    for (let r = 0; r < Math.min(rows.length, 25); r++) {
      const map = mapHeaders(rows[r].vals);
      const fields = map.filter(Boolean).map((m) => m.field);
      if (fields.indexOf('company') >= 0 || fields.indexOf('title') >= 0) { header = { index: r, map }; break; }
    }
    if (!header) return null;
    const mapped = {};
    header.map.forEach((m) => { if (m) mapped[m.header || m.norm] = FIELD_LABEL[m.field] || m.field; });
    const body = rows.slice(header.index + 1);
    let last = body.length - 1;
    while (last >= 0 && body[last].vals.every(isBlank) && !body[last].links.some(Boolean)) last--;
    const jobs = [];
    let skipped = 0;
    for (let i = 0; i <= last; i++) {
      const row = body[i];
      if (row.vals.every(isBlank) && !row.links.some(Boolean)) { skipped++; continue; }
      const job = rowToJob(row.vals, row.links, header.map, filename);
      if (job) jobs.push(job); else skipped++;
    }
    return { jobs, mapped, skipped };
  }

  IO.importSpreadsheet = async function (file) {
    if (!file) throw new Error('No file selected.');
    const filename = str(file.name) || 'spreadsheet';
    const ext = filename.toLowerCase().split('.').pop();
    let head = new Uint8Array(0);
    try { head = new Uint8Array(await readBuffer(file.slice(0, 4))); } catch (e) { /* ignore */ }
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    const isOle = head[0] === 0xd0 && head[1] === 0xcf;
    const NO_HEADER = 'Could not find a header row with a Company or Title column. Make sure the first row names the columns (e.g. Company, Title, Status, Date Applied).';

    if (ext === 'xls' || (isOle && ext !== 'csv')) throw new Error('Old .xls workbooks are not supported — in Excel choose File › Save As › Excel Workbook (.xlsx) or CSV, then import that.');
    if (ext === 'numbers') throw new Error('Export from Numbers first (File › Export To › Excel or CSV), then import that file.');
    if (ext === 'ods') throw new Error('Save as .xlsx or CSV first, then import that file.');

    if (isZip || ext === 'xlsx' || ext === 'xlsm') {
      const ExcelJS = await lib('exceljs', 'ExcelJS');
      const wb = new ExcelJS.Workbook();
      try { await wb.xlsx.load(await readBuffer(file)); } catch (e) {
        throw new Error('Could not open this workbook — re-save it as .xlsx (or CSV) and try again.');
      }
      const sheets = wb.worksheets.filter((ws) => ws && ws.state !== 'hidden' && ws.state !== 'veryHidden');
      sheets.sort((a, b) => (b.name === 'Applications') - (a.name === 'Applications'));
      for (let s = 0; s < sheets.length; s++) {
        const ws = sheets[s];
        const nCols = Math.min(ws.columnCount || 0, 300);
        if (!nCols || !ws.rowCount) continue;
        const rows = [];
        for (let r = 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          const vals = [], links = [];
          for (let c = 1; c <= nCols; c++) {
            const v = row.getCell(c).value;
            vals.push(plainCell(v));
            links.push(cellLink(v));
          }
          rows.push({ vals, links });
        }
        const res = rowsToJobs(rows, filename);
        if (res) return Object.assign(res, { sheet: ws.name });
      }
      throw new Error(NO_HEADER);
    }

    const text = await readText(file);
    const parsed = parseCSV(text, ext === 'tsv' ? '\t' : undefined);
    const res = rowsToJobs(parsed.rows.map((r) => ({ vals: r, links: [] })), filename);
    if (!res) throw new Error(NO_HEADER);
    return res;
  };

  IO.importJSON = async function (file) {
    if (!file) throw new Error('No file selected.');
    let data;
    try { data = JSON.parse((await readText(file)).replace(/^﻿/, '')); } catch (e) {
      throw new Error('This file is not valid JSON — choose a backup made with Callback’s “Export backup”.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.app !== 'callback') {
      throw new Error('This is not a Callback backup (it has no app: "callback" marker).');
    }
    if (!Array.isArray(data.jobs)) throw new Error('This Callback backup has no jobs list — the file may be damaged.');
    data.jobs = data.jobs.filter((j) => j && typeof j === 'object' && !Array.isArray(j)).map((j) => {
      const job = CB.newJob(j);
      ['contacts', 'interviews', 'timeline', 'tags'].forEach((k) => { if (!Array.isArray(job[k])) job[k] = []; });
      return job;
    });
    return data;
  };

  // ═════════════════════════════ FILES OUT: Applications table model ═════════════════════════════
  const APP_COLS = [
    { h: '#', w: 5, kind: 'int', get: (j, a, i) => i + 1 },
    { h: 'Company', w: 24, get: (j) => j.company },
    { h: 'Title', w: 32, get: (j) => j.title },
    { h: 'Location', w: 20, get: (j) => j.location },
    { h: 'Status', w: 17, kind: 'status', get: (j) => stageLabel(j.status) },
    { h: 'ATS score', w: 9, kind: 'int', get: (j, a) => (hasScore(a) ? Math.round(a.score) : null) },
    { h: 'Interview chance', w: 11, kind: 'pct', get: (j, a) => prob(a) },
    { h: 'Verdict', w: 19, get: (j, a) => verdictText(a) },
    { h: 'Applied', w: 13, kind: 'date', get: (j) => j.appliedDate },
    { h: 'Days since applied', w: 10, kind: 'days', get: (j) => (j.appliedDate && parseLocal(j.appliedDate) ? CB.daysSince(j.appliedDate) : null) },
    { h: 'Source', w: 18, get: (j) => j.source },
    { h: 'Work mode', w: 11, get: (j) => j.workMode },
    { h: 'Salary min', w: 12, kind: 'money', get: (j) => numOrNull(j.salaryMin) },
    { h: 'Salary max', w: 12, kind: 'money', get: (j) => numOrNull(j.salaryMax) },
    { h: 'Priority', w: 10, get: (j) => j.priority },
    { h: 'Excitement', w: 11, get: (j) => stars(j.excitement) },
    { h: 'Follow-up', w: 13, kind: 'date', get: (j) => j.followUpDate },
    { h: 'Next interview', w: 21, kind: 'datetime', get: (j) => { const iv = nextInterview(j); return iv ? iv.datetime : ''; } },
    { h: 'Interviews', w: 10, kind: 'int', get: (j) => (j.interviews || []).length },
    { h: 'Contacts', w: 24, get: (j) => contactNames(j) },
    { h: 'Rejection reason', w: 20, get: (j) => j.rejectionReason },
    { h: 'Knockouts', w: 18, get: (j, a) => knockouts(a).map((k) => k.code || k.label).filter(Boolean).join(', ') },
    { h: 'Missing must-haves', w: 34, get: (j, a) => missingRequired(a).slice(0, 8).join(', ') },
    { h: 'URL', w: 14, kind: 'link', get: (j) => j.url },
    { h: 'Notes', w: 40, get: (j) => htmlText(j.notes) },
    { h: 'Last updated', w: 13, kind: 'date', get: (j) => j.updatedAt },
  ];
  const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const COL = {};
  APP_COLS.forEach((c, i) => { COL[c.h] = colLetter(i + 1); });

  // ═════════════════════════════ FILES OUT: Excel ═════════════════════════════
  const XL = {
    dark: 'FF1F2937', head: 'FF1F2937', white: 'FFFFFFFF', zebra: 'FFF6F8FA', line: 'FFD9DDE3', muted: 'FF6B7280', ink: 'FF111827', link: 'FF0563C1',
  };
  const xlFill = (c) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c }, bgColor: { argb: c } });
  const thin = { style: 'thin', color: { argb: XL.line } };
  const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
  const OUTCOME_XL = { Passed: ['FFC6EFCE', 'FF006100'], Failed: ['FFFFC7CE', 'FF9C0006'], Scheduled: ['FFDDEBF7', 'FF1F4E79'], Cancelled: ['FFE7E6E6', 'FF595959'], Completed: ['FFEDE7F6', 'FF4B2E83'] };
  const SCORE_SCALE = { type: 'colorScale', cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 60 }, { type: 'num', value: 100 }], color: [{ argb: 'FFF8696B' }, { argb: 'FFFFEB84' }, { argb: 'FF63BE7B' }] };

  function styleHeader(row, n, height) {
    row.height = height || 28;
    for (let c = 1; c <= n; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, color: { argb: XL.white }, size: 11 };
      cell.fill = xlFill(XL.head);
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = BORDER;
    }
  }
  function setLink(cell, url, text) {
    const u = safeUrl(url);
    if (!u) { cell.value = cellText(url); return; }
    cell.value = u.length < 250 ? { text: text || u, hyperlink: u, tooltip: u } : { text: text || u, hyperlink: u };
    cell.font = { color: { argb: XL.link }, underline: true };
  }
  /** Body rows with borders, zebra fill on even rows, middle alignment. */
  function styleBody(ws, fromRow, toRow, nCols) {
    for (let r = fromRow; r <= toRow; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= nCols; c++) {
        const cell = row.getCell(c);
        cell.border = BORDER;
        if (!cell.alignment) cell.alignment = { vertical: 'middle' };
        if (r % 2 === 0 && !cell.fill) cell.fill = xlFill(XL.zebra);
      }
    }
  }
  const listFormula = (arr) => ['"' + arr.map((s) => str(s).replace(/"/g, '""')).join(',') + '"'];
  function emptyNote(ws, text, nCols) {
    const row = ws.addRow([text]);
    row.getCell(1).font = { italic: true, color: { argb: XL.muted } };
    if (nCols > 1) ws.mergeCells(row.number, 1, row.number, Math.min(nCols, 6));
  }

  IO.exportExcel = async function (opts) {
    opts = opts || {};
    const jobs = (opts.jobs || []).filter(Boolean);
    const atsById = opts.atsById || {};
    const stats = mergeStats(jobs, atsById, opts.stats);
    const ExcelJS = await lib('exceljs', 'ExcelJS');
    const now = new Date();
    const nowXl = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Callback';
    wb.lastModifiedBy = 'Callback';
    wb.created = now;
    wb.modified = now;
    wb.title = 'Job Search Tracker';
    wb.subject = 'Job applications exported from Callback';
    wb.calcProperties = Object.assign({}, wb.calcProperties || {}, { fullCalcOnLoad: true });

    const landscape = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
    const dash = wb.addWorksheet('Dashboard', { properties: { tabColor: { argb: XL.dark } }, views: [{ showGridLines: false }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const apps = wb.addWorksheet('Applications', { properties: { tabColor: { argb: 'FF2A78D6' } }, views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }], pageSetup: landscape });
    const atsWs = wb.addWorksheet('ATS Breakdown', { properties: { tabColor: { argb: 'FF6250D6' } }, views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }], pageSetup: landscape });
    const ivWs = wb.addWorksheet('Interviews', { properties: { tabColor: { argb: 'FF1BAF7A' } }, views: [{ state: 'frozen', ySplit: 1 }], pageSetup: landscape });
    const tlWs = wb.addWorksheet('Timeline', { properties: { tabColor: { argb: 'FFEDA100' } }, views: [{ state: 'frozen', ySplit: 1 }], pageSetup: landscape });
    const ctWs = wb.addWorksheet('Contacts', { properties: { tabColor: { argb: 'FFEB6834' } }, views: [{ state: 'frozen', ySplit: 1 }], pageSetup: landscape });

    const rows = jobs.map((j, i) => ({ j, a: atsFor(atsById, j), i }));
    const n = rows.length;
    const lastData = n + 1;
    const dvLast = n + 201; // validation / formatting reaches 200 blank rows so new entries get dropdowns too
    const nC = APP_COLS.length;
    const lastCol = colLetter(nC);

    // ───── Applications ─────
    apps.columns = APP_COLS.map((c) => ({ width: c.w }));
    styleHeader(apps.addRow(APP_COLS.map((c) => c.h)), nC);
    rows.forEach(({ j, a, i }) => {
      const r = i + 2;
      const row = apps.getRow(r);
      APP_COLS.forEach((c, ci) => {
        const cell = row.getCell(ci + 1);
        const v = c.get(j, a, i);
        cell.alignment = { vertical: 'middle', horizontal: c.kind && c.kind !== 'status' && c.kind !== 'link' ? 'right' : 'left' };
        switch (c.kind) {
          case 'date': cell.value = xlDate(v); cell.numFmt = 'mmm d, yyyy'; break;
          case 'datetime': cell.value = xlDate(v, hasTime(v)); cell.numFmt = hasTime(v) ? 'mmm d, yyyy h:mm AM/PM' : 'mmm d, yyyy'; break;
          case 'days':
            cell.value = { formula: `IF(${COL.Applied}${r}="","",TODAY()-${COL.Applied}${r})`, result: isNum(v) ? v : '' };
            cell.numFmt = '0';
            break;
          case 'money': cell.value = isNum(v) ? v : null; cell.numFmt = '$#,##0'; break;
          case 'pct': cell.value = isNum(v) ? v : null; cell.numFmt = '0.0%'; break;
          case 'int': cell.value = isNum(v) ? v : null; cell.numFmt = '0'; break;
          case 'link': if (v) setLink(cell, v, 'Open posting'); break;
          default: cell.value = cellText(v);
        }
      });
      const st = CB.STAGE[j.status];
      if (st) {
        const sc = row.getCell(APP_COLS.findIndex((c) => c.h === 'Status') + 1);
        sc.fill = xlFill(argb(st.color));
        sc.font = { bold: true, color: { argb: argb(st.ink) } };
      }
    });
    styleBody(apps, 2, lastData, nC);
    apps.autoFilter = `A1:${lastCol}${lastData}`;
    const rng = (h) => `${COL[h]}2:${COL[h]}${dvLast}`;
    apps.dataValidations.add(rng('Status'), { type: 'list', allowBlank: true, formulae: listFormula(CB.STAGES.map((s) => s.label)), showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Status', error: 'Pick a stage from the list.', showInputMessage: false });
    apps.dataValidations.add(rng('Priority'), { type: 'list', allowBlank: true, formulae: listFormula(CB.PRIORITIES), showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Priority', error: 'Choose High, Medium or Low.' });
    apps.dataValidations.add(rng('Work mode'), { type: 'list', allowBlank: true, formulae: listFormula(CB.WORK_MODES), showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Work mode', error: 'Usually Remote, Hybrid or On-site.' });
    apps.dataValidations.add(rng('Source'), { type: 'list', allowBlank: true, formulae: listFormula(CB.SOURCES), showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Source', error: 'Not one of the usual sources — keep it anyway?' });
    apps.addConditionalFormatting({
      ref: rng('Status'),
      rules: CB.STAGES.map((s) => ({ type: 'expression', formulae: [`$${COL.Status}2="${s.label}"`], style: { fill: xlFill(argb(s.color)), font: { bold: true, color: { argb: argb(s.ink) } } } })),
    });
    apps.addConditionalFormatting({ ref: rng('ATS score'), rules: [Object.assign({}, SCORE_SCALE)] });
    apps.addConditionalFormatting({
      ref: rng('Interview chance'),
      rules: [{ type: 'dataBar', minLength: 0, maxLength: 100, gradient: false, border: false, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: 'FF5B8DEF' } }],
    });
    apps.addConditionalFormatting({
      ref: rng('Days since applied'),
      rules: [{ type: 'expression', formulae: [`AND($${COL.Status}2="Applied",ISNUMBER($${COL['Days since applied']}2),$${COL['Days since applied']}2>21)`], style: { fill: xlFill('FFFFC7CE'), font: { bold: true, color: { argb: 'FF9C0006' } } } }],
    });
    apps.pageSetup.printTitlesRow = '1:1';

    // ───── ATS Breakdown ─────
    const comps = [];
    const compIdx = {};
    rows.forEach(({ a }) => {
      if (!hasScore(a)) return;
      compScores(a).forEach((c) => { if (!(c.key in compIdx)) { compIdx[c.key] = comps.length; comps.push(c.label); } });
    });
    const atsHead = ['Company', 'Title', 'ATS score', 'Verdict', 'Interview chance'].concat(comps, ['Years required', 'Your years', 'Knockouts', 'Matched required skills', 'Missing required skills', 'Top 3 fixes']);
    atsWs.columns = atsHead.map((h, i) => ({ width: i === 0 ? 22 : i === 1 ? 30 : i === 3 ? 19 : i < 5 ? 11 : i < 5 + comps.length ? 13 : h === 'Top 3 fixes' ? 60 : h.indexOf('skills') >= 0 || h === 'Knockouts' ? 36 : 11 }));
    styleHeader(atsWs.addRow(atsHead), atsHead.length, 32);
    rows.forEach(({ j, a }) => {
      const scored = hasScore(a);
      const compVals = comps.map(() => null);
      if (scored) compScores(a).forEach((c) => { compVals[compIdx[c.key]] = c.score; });
      const fixes = fixList(a).slice(0, 3).map((f, k) => `${k + 1}. ${f.text}`);
      const row = atsWs.addRow([
        cellText(j.company), cellText(j.title), scored ? Math.round(a.score) : null, scored ? cellText(verdictText(a)) : 'No resume scored', prob(a),
      ].concat(compVals, [
        scored && isNum(a.yearsRequired) ? a.yearsRequired : null,
        scored && isNum(a.yearsCandidate) ? a.yearsCandidate : null,
        cellText(knockouts(a).map((k) => (k.label || k.code) + (k.code && k.label ? ` (${k.code})` : '')).join('; ')),
        cellText(matchedRequired(a).join(', ')),
        cellText(missingRequired(a).join(', ')),
        cellText(fixes.join('\n')),
      ]));
      row.getCell(5).numFmt = '0.0%';
      row.getCell(3).numFmt = '0';
      for (let k = 0; k < comps.length; k++) row.getCell(6 + k).numFmt = '0';
      const wrapLines = Math.max(1, fixes.reduce((s, f) => s + Math.ceil(f.length / 66), 0),
        Math.ceil(matchedRequired(a).join(', ').length / 40), Math.ceil(missingRequired(a).join(', ').length / 40));
      if (wrapLines > 1) row.height = Math.min(150, 15 * wrapLines);
      row.eachCell({ includeEmpty: true }, (cell, c) => { cell.alignment = { vertical: 'top', wrapText: c > 5 + comps.length + 2 }; });
      if (!scored) row.getCell(4).font = { italic: true, color: { argb: XL.muted } };
    });
    if (n) {
      styleBody(atsWs, 2, n + 1, atsHead.length);
      atsWs.addConditionalFormatting({ ref: `C2:C${n + 1}`, rules: [Object.assign({}, SCORE_SCALE)] });
      if (comps.length) atsWs.addConditionalFormatting({ ref: `F2:${colLetter(5 + comps.length)}${n + 1}`, rules: [Object.assign({}, SCORE_SCALE)] });
      atsWs.autoFilter = `A1:${colLetter(atsHead.length)}${n + 1}`;
    } else emptyNote(atsWs, 'No jobs yet.', atsHead.length);

    // ───── Interviews ─────
    const ivHead = ['Company', 'Title', 'Round', 'Type', 'Date & time', 'Duration (min)', 'Interviewer', 'Outcome', 'Thank-you sent', 'Notes', 'Meeting link'];
    ivWs.columns = [22, 28, 10, 18, 22, 10, 22, 13, 10, 50, 16].map((w) => ({ width: w }));
    styleHeader(ivWs.addRow(ivHead), ivHead.length);
    const ivs = [];
    jobs.forEach((j) => (j.interviews || []).forEach((iv) => { if (iv) ivs.push({ j, iv, d: parseLocal(iv.datetime) }); }));
    ivs.sort((x, y) => (x.d ? x.d.getTime() : Infinity) - (y.d ? y.d.getTime() : Infinity));
    ivs.forEach(({ j, iv }) => {
      const row = ivWs.addRow([
        cellText(j.company), cellText(j.title), cellText(roundText(iv.round)), cellText(iv.type), xlDate(iv.datetime, hasTime(iv.datetime)),
        numOrNull(iv.durationMin), cellText(iv.interviewer), cellText(iv.outcome), iv.thankYouSent ? 'Yes' : 'No', cellText(htmlText(iv.notes)), null,
      ]);
      row.getCell(5).numFmt = hasTime(iv.datetime) ? 'ddd mmm d, yyyy h:mm AM/PM' : 'ddd mmm d, yyyy';
      if (iv.link) setLink(row.getCell(11), iv.link, 'Join link');
      const oc = OUTCOME_XL[iv.outcome];
      if (oc) { row.getCell(8).fill = xlFill(oc[0]); row.getCell(8).font = { bold: true, color: { argb: oc[1] } }; }
    });
    if (ivs.length) {
      styleBody(ivWs, 2, ivs.length + 1, ivHead.length);
      ivWs.autoFilter = `A1:K${ivs.length + 1}`;
      ivWs.dataValidations.add(`H2:H${ivs.length + 200}`, { type: 'list', allowBlank: true, formulae: listFormula(CB.INTERVIEW_OUTCOMES), showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Outcome', error: 'Pick an outcome from the list.' });
      ivWs.addConditionalFormatting({
        ref: `H2:H${ivs.length + 200}`,
        rules: Object.keys(OUTCOME_XL).map((k) => ({ type: 'expression', formulae: [`$H2="${k}"`], style: { fill: xlFill(OUTCOME_XL[k][0]), font: { bold: true, color: { argb: OUTCOME_XL[k][1] } } } })),
      });
    } else emptyNote(ivWs, 'No interviews logged yet.', ivHead.length);

    // ───── Timeline ─────
    const tlHead = ['When', 'Company', 'Title', 'Event', 'From', 'To', 'Details'];
    tlWs.columns = [21, 22, 28, 12, 16, 16, 70].map((w) => ({ width: w }));
    styleHeader(tlWs.addRow(tlHead), tlHead.length);
    const evs = [];
    jobs.forEach((j) => (j.timeline || []).forEach((e) => { if (e) evs.push({ j, e, d: parseLocal(e.ts) }); }));
    evs.sort((x, y) => (y.d ? y.d.getTime() : -Infinity) - (x.d ? x.d.getTime() : -Infinity));
    evs.forEach(({ j, e, d }) => {
      const row = tlWs.addRow([
        d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes())) : null,
        cellText(j.company), cellText(j.title), cellText(cap1(str(e.kind))), cellText(e.from ? stageLabel(e.from) : ''), cellText(e.to ? stageLabel(e.to) : ''), cellText(htmlText(e.text)),
      ]);
      row.getCell(1).numFmt = 'mmm d, yyyy h:mm AM/PM';
      const to = CB.STAGE[e.to];
      if (to) { row.getCell(6).fill = xlFill(argb(to.color)); row.getCell(6).font = { color: { argb: argb(to.ink) } }; }
    });
    if (evs.length) { styleBody(tlWs, 2, evs.length + 1, tlHead.length); tlWs.autoFilter = `A1:G${evs.length + 1}`; } else emptyNote(tlWs, 'No timeline events yet.', tlHead.length);

    // ───── Contacts ─────
    const ctHead = ['Name', 'Role', 'Company', 'Job', 'Email', 'Phone', 'LinkedIn', 'Notes'];
    ctWs.columns = [24, 22, 22, 28, 30, 16, 14, 50].map((w) => ({ width: w }));
    styleHeader(ctWs.addRow(ctHead), ctHead.length);
    let nCt = 0;
    jobs.forEach((j) => (j.contacts || []).forEach((c) => {
      if (!c) return;
      nCt++;
      const row = ctWs.addRow([cellText(c.name), cellText(c.role), cellText(j.company), cellText(j.title), null, cellText(c.phone), null, cellText(htmlText(c.notes))]);
      if (c.email) setLink(row.getCell(5), /^mailto:/i.test(c.email) ? c.email : 'mailto:' + str(c.email).trim(), str(c.email).replace(/^mailto:/i, ''));
      if (c.linkedin) setLink(row.getCell(7), c.linkedin, 'Profile');
    }));
    if (nCt) { styleBody(ctWs, 2, nCt + 1, ctHead.length); ctWs.autoFilter = `A1:H${nCt + 1}`; } else emptyNote(ctWs, 'No contacts yet.', ctHead.length);

    // ───── Dashboard (live formulas over Applications, each with a cached result) ─────
    dash.columns = [{ width: 34 }, { width: 14 }, { width: 12 }, { width: 34 }];
    const A = 'Applications!';
    const S = `${A}$${COL.Status}$2:$${COL.Status}$5000`;
    const cif = (label) => `COUNTIF(${S},"${label}")`;
    const countLabel = (label) => jobs.filter((j) => stageLabel(j.status) === label).length;
    const respStages = CB.STAGES.filter((s) => s.order >= 2 || s.key === 'rejected');
    const intStages = CB.STAGES.filter((s) => s.order >= 4);
    const offerStages = CB.STAGES.filter((s) => s.order >= 6);

    const t = dash.addRow(['Job Search Dashboard']);
    dash.mergeCells('A1:D1');
    t.height = 34;
    t.getCell(1).font = { bold: true, size: 20, color: { argb: XL.ink } };
    t.getCell(1).alignment = { vertical: 'middle' };
    const g = dash.addRow(['Generated', nowXl]);
    g.getCell(1).font = { color: { argb: XL.muted } };
    g.getCell(2).numFmt = 'mmm d, yyyy h:mm AM/PM';
    g.getCell(2).alignment = { horizontal: 'left' };
    dash.mergeCells(`B${g.number}:D${g.number}`);
    if (opts.resumeName) {
      const rr = dash.addRow(['Resume scored', cellText(opts.resumeName)]);
      rr.getCell(1).font = { color: { argb: XL.muted } };
      dash.mergeCells(`B${rr.number}:D${rr.number}`);
    }
    dash.addRow([]);
    const section = (title, heads) => {
      const row = dash.addRow(heads || [title]);
      styleHeader(row, 4, 22);
      if (!heads) dash.mergeCells(`A${row.number}:D${row.number}`);
      return row;
    };
    section('Key metrics');
    const kpiRow = {};
    const tracked = jobs.filter((j) => cellText(j.company)).length;
    const sentCached = tracked - countLabel(stageLabel('saved'));
    const respCached = respStages.reduce((s, st) => s + countLabel(st.label), 0);
    const intCached = jobs.filter((j) => (j.interviews || []).length > 0 || stageOrder(j.status) >= 4).length;
    const offerCached = offerStages.reduce((s, st) => s + countLabel(st.label), 0);
    const scores = rows.filter((r) => hasScore(r.a)).map((r) => Math.round(r.a.score));
    const followDue = jobs.filter((j) => j.status === 'applied' && j.appliedDate && CB.daysSince(j.appliedDate) >= 7).length;
    const ratio = (x, y) => (y ? x / y : 0);
    const kpis = [
      ['tracked', 'Jobs tracked', `COUNTA(${A}$${COL.Company}$2:$${COL.Company}$5000)`, tracked, '0', 'Rows on the Applications sheet'],
      ['sent', 'Applications sent', `COUNTA(${A}$${COL.Company}$2:$${COL.Company}$5000)-${cif(stageLabel('saved'))}`, sentCached, '0', 'Everything past “Saved”'],
      ['awaiting', 'Awaiting a response', cif(stageLabel('applied')), countLabel(stageLabel('applied')), '0', 'Status is still “Applied”'],
      ['resp', 'Responses', respStages.map((s) => cif(s.label)).join('+'), respCached, '0', 'Screen or later, or a rejection'],
      ['respRate', 'Response rate', () => `IFERROR(B${kpiRow.resp}/B${kpiRow.sent},0)`, ratio(respCached, sentCached), '0.0%', 'Responses ÷ applications sent'],
      ['int', 'Interviewed', `SUMPRODUCT(--(((${A}$${COL.Interviews}$2:$${COL.Interviews}$5000>0)+${intStages.map((s) => `(${S}="${s.label}")`).join('+')})>0))`, intCached, '0', 'Logged an interview or reached the interview stage'],
      ['intRate', 'Interview rate', () => `IFERROR(B${kpiRow.int}/B${kpiRow.sent},0)`, ratio(intCached, sentCached), '0.0%', 'Interviewed ÷ applications sent'],
      ['offers', 'Offers', offerStages.map((s) => cif(s.label)).join('+'), offerCached, '0', 'Offer or Accepted'],
      ['offerRate', 'Offer rate', () => `IFERROR(B${kpiRow.offers}/B${kpiRow.sent},0)`, ratio(offerCached, sentCached), '0.0%', 'Offers ÷ applications sent'],
      ['rej', 'Rejected', cif(stageLabel('rejected')), countLabel(stageLabel('rejected')), '0', ''],
      ['ghost', 'Ghosted', cif(stageLabel('ghosted')), countLabel(stageLabel('ghosted')), '0', ''],
      ['ats', 'Average ATS score', `IFERROR(AVERAGE(${A}$${COL['ATS score']}$2:$${COL['ATS score']}$5000),0)`, scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : 0, '0', 'Across jobs scored against your resume'],
      ['follow', 'Follow-ups due', `COUNTIFS(${S},"${stageLabel('applied')}",${A}$${COL['Days since applied']}$2:$${COL['Days since applied']}$5000,">=7")`, followDue, '0', 'Applied 7+ days ago with no response'],
    ];
    kpis.forEach((k) => {
      const formula = typeof k[2] === 'function' ? k[2]() : k[2]; // rate rows reference rows added before them
      const row = dash.addRow([k[1], { formula, result: k[3] }, cellText(k[5])]);
      kpiRow[k[0]] = row.number;
      dash.mergeCells(`C${row.number}:D${row.number}`);
      row.getCell(1).font = { bold: true, color: { argb: XL.ink } };
      row.getCell(2).numFmt = k[4];
      row.getCell(2).font = { bold: true, size: 13, color: { argb: XL.ink } };
      row.getCell(2).alignment = { horizontal: 'right', vertical: 'middle' };
      row.getCell(3).font = { italic: true, size: 9, color: { argb: XL.muted } };
      row.getCell(3).alignment = { vertical: 'middle' };
      row.height = 20;
      [1, 2, 3, 4].forEach((c) => { row.getCell(c).border = { bottom: thin }; });
    });

    dash.addRow([]);
    const pipeHead = section(null, ['Pipeline by stage', 'Count', 'Share', '']);
    const firstStageRow = pipeHead.number + 1;
    const totalRow = firstStageRow + CB.STAGES.length;
    CB.STAGES.forEach((s) => {
      const c = countLabel(s.label);
      const share = ratio(c, n);
      const row = dash.addRow([s.label]);
      const r = row.number;
      row.getCell(2).value = { formula: `COUNTIF(${A}${COL.Status}:${COL.Status},"${s.label}")`, result: c };
      row.getCell(3).value = { formula: `IFERROR(B${r}/B${totalRow},0)`, result: share };
      row.getCell(4).value = { formula: `REPT("█",ROUND(C${r}*30,0))`, result: '█'.repeat(Math.round(share * 30)) };
      row.getCell(1).fill = xlFill(argb(s.color));
      row.getCell(1).font = { bold: true, color: { argb: argb(s.ink) } };
      row.getCell(2).numFmt = '0';
      row.getCell(3).numFmt = '0%';
      row.getCell(4).font = { color: { argb: argb(s.color) } };
      [1, 2, 3, 4].forEach((cc) => { row.getCell(cc).border = BORDER; });
    });
    const tot = dash.addRow(['Total', { formula: `SUM(B${firstStageRow}:B${totalRow - 1})`, result: n }, { formula: `IFERROR(B${totalRow}/B${totalRow},0)`, result: n ? 1 : 0 }, null]);
    tot.font = { bold: true };
    tot.getCell(3).numFmt = '0%';
    [1, 2, 3, 4].forEach((cc) => { tot.getCell(cc).border = { top: { style: 'medium', color: { argb: XL.ink } } }; });

    dash.addRow([]);
    section(null, ['By source', 'Applied', 'Responses', 'Response rate']);
    const bySrc = (stats.bySource || []).filter(Boolean);
    if (bySrc.length) {
      bySrc.forEach((s) => {
        const ap = numOrNull(s.applied) || 0, rs = numOrNull(s.responses) || 0;
        const rate = isNum(s.rate) ? (s.rate > 1 ? s.rate / 100 : s.rate) : ratio(rs, ap);
        const row = dash.addRow([cellText(s.source) || 'Other', ap, rs, rate]);
        row.getCell(4).numFmt = '0%';
        row.getCell(4).alignment = { horizontal: 'left' };
        [1, 2, 3, 4].forEach((cc) => { row.getCell(cc).border = BORDER; });
      });
      dash.addConditionalFormatting({ ref: `D${dash.rowCount - bySrc.length + 1}:D${dash.rowCount}`, rules: [{ type: 'dataBar', minLength: 0, maxLength: 100, gradient: false, border: false, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: 'FF1BAF7A' } }] });
    } else emptyNote(dash, 'No applications sent yet.', 4);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: XLSX_MIME });
    return save(`Callback-Job-Tracker-${stamp()}.xlsx`, blob, XLSX_MIME);
  };

  // ═════════════════════════════ FILES OUT: CSV + JSON ═════════════════════════════
  function csvValue(c, v) {
    switch (c.kind) {
      case 'date': return isoDate(v);
      case 'datetime': return isoDateTime(v);
      case 'pct': return isNum(v) ? String(Math.round(v * 1000) / 1000) : '';
      case 'money': case 'int': case 'days': return isNum(v) ? String(v) : '';
      default: return str(v);
    }
  }
  function csvCell(v, textual) {
    let s = xmlSafe(v).replace(/\r\n?/g, '\n');
    // Guard against spreadsheet formula injection in free text (stripped again on import).
    if (textual && /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  IO.exportCSV = async function (opts) {
    opts = opts || {};
    const jobs = (opts.jobs || []).filter(Boolean);
    const atsById = opts.atsById || {};
    const lines = [APP_COLS.map((c) => csvCell(c.h, false)).join(',')];
    jobs.forEach((j, i) => {
      const a = atsFor(atsById, j);
      lines.push(APP_COLS.map((c) => csvCell(csvValue(c, c.get(j, a, i)), !c.kind || c.kind === 'status')).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    return save(`callback-applications-${stamp()}.csv`, blob, 'text/csv');
  };

  IO.exportJSON = async function (state) {
    const out = Object.assign({ app: 'callback', version: 1, exportedAt: CB.nowISO() }, state || {});
    out.app = 'callback';
    if (!Array.isArray(out.jobs)) out.jobs = [];
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    return save(`callback-backup-${stamp()}.json`, blob, 'application/json');
  };

  // ═════════════════════════════ FILES OUT: Word (.docx) builder ═════════════════════════════
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const D = { ink: '1F2937', muted: '6B7280', head: '1F2937', zebra: 'F7F8FA', label: 'F3F4F6', line: 'D0D5DD', link: '0563C1' };
  const SKILL_UI = {
    evidenced: { text: '✓ Evidenced', fill: 'D1F2E0', color: '0B5D33' },
    listed: { text: '◐ Listed only', fill: 'FFF1CC', color: '7A4E00' },
    transferable: { text: '≈ Transferable', fill: 'DCE9FB', color: '1E4E8C' },
    missing: { text: '✗ Missing', fill: 'FBDADA', color: '9B1C1C' },
    alternative: { text: '∨ Either/or — covered', fill: 'EEF0F3', color: '374151' },
  };
  const OUTCOME_D = { Passed: ['C6EFCE', '006100'], Failed: ['FFC7CE', '9C0006'], Scheduled: ['DDEBF7', '1F4E79'], Cancelled: ['E7E6E6', '595959'], Completed: ['EDE7F6', '4B2E83'] };
  const scoreShade = (s) => (!isNum(s) ? null : s >= 75 ? ['D1F2E0', '0B5D33'] : s >= 60 ? ['FFF1CC', '7A4E00'] : s >= 40 ? ['FDE2CC', '8A3B00'] : ['FBDADA', '9B1C1C']);
  const stageCell = (key, extra) => {
    const st = CB.STAGE[key];
    return Object.assign(st ? { text: st.label, fill: hex6(st.color), color: hex6(st.ink), b: true } : { text: stageLabel(key) }, extra || {});
  };

  function runXml(r, base) {
    if (r === null || r === undefined || r === false) return '';
    if (typeof r !== 'object') r = { text: String(r) };
    const o = Object.assign({}, base || {}, r);
    const pr = [];
    if (o.hyper) pr.push('<w:rStyle w:val="Hyperlink"/>');
    if (o.font) pr.push(`<w:rFonts w:ascii="${xmlEsc(o.font)}" w:hAnsi="${xmlEsc(o.font)}" w:cs="${xmlEsc(o.font)}"/>`);
    if (o.b) pr.push('<w:b/><w:bCs/>');
    if (o.i) pr.push('<w:i/><w:iCs/>');
    if (o.caps) pr.push('<w:caps/>');
    const color = o.hyper ? D.link : o.color;
    if (color) pr.push(`<w:color w:val="${hex6(color)}"/>`);
    if (o.size) { const hp = Math.round(o.size * 2); pr.push(`<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`); }
    if (o.u || o.hyper) pr.push('<w:u w:val="single"/>');
    const rPr = pr.length ? `<w:rPr>${pr.join('')}</w:rPr>` : '';
    let inner = '';
    xmlSafe(o.text).replace(/\r\n?/g, '\n').split(/(\n|\t)/).forEach((part) => {
      if (part === '\n') inner += '<w:br/>';
      else if (part === '\t') inner += '<w:tab/>';
      else if (part) inner += `<w:t xml:space="preserve">${xmlEsc(part)}</w:t>`;
    });
    return inner ? `<w:r>${rPr}${inner}</w:r>` : '';
  }

  function paraXml(inner, o) {
    o = o || {};
    const pr = [];
    if (o.style) pr.push(`<w:pStyle w:val="${o.style}"/>`);
    if (o.keepNext) pr.push('<w:keepNext/>');
    if (o.keepLines) pr.push('<w:keepLines/>');
    if (o.numId) pr.push(`<w:numPr><w:ilvl w:val="${o.ilvl || 0}"/><w:numId w:val="${o.numId}"/></w:numPr>`);
    if (o.borderBottom) pr.push(`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${hex6(o.borderBottom)}"/></w:pBdr>`);
    if (o.shd) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex6(o.shd)}"/>`);
    if (o.before !== undefined || o.after !== undefined || o.line !== undefined) {
      pr.push('<w:spacing' + (o.before !== undefined ? ` w:before="${o.before}"` : '') + (o.after !== undefined ? ` w:after="${o.after}"` : '') + (o.line !== undefined ? ` w:line="${o.line}" w:lineRule="auto"` : '') + '/>');
    }
    if (o.indent) pr.push(`<w:ind w:left="${o.indent}" w:right="${o.indentRight || 0}"/>`);
    if (o.align) pr.push(`<w:jc w:val="${o.align}"/>`);
    if (o.size) { const hp = Math.round(o.size * 2); pr.push(`<w:rPr><w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/></w:rPr>`); }
    return `<w:p>${pr.length ? `<w:pPr>${pr.join('')}</w:pPr>` : ''}${inner || ''}</w:p>`;
  }

  function stylesXml(sz) {
    return XML_HEAD + `<w:styles xmlns:w="${W_NS}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
      `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
      '<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="${D.ink}"/></w:rPr></w:style>` +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
      '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/>' +
      '<w:pPr><w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="111827"/><w:kern w:val="28"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="11"/><w:qFormat/>' +
      `<w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:color w:val="${D.muted}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>` +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>' +
      `<w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${D.line}"/></w:pBdr><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>` +
      '<w:rPr><w:b/><w:bCs/><w:color w:val="111827"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="374151"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>' +
      '<w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
      `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="${D.link}"/><w:u w:val="single"/></w:rPr></w:style>` +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>' +
      `<w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="${D.muted}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>` +
      '<w:style w:type="table" w:styleId="CBTable"><w:name w:val="Callback Table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/>' +
      '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>' +
      `<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${D.line}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${D.line}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${D.line}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${D.line}"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${D.line}"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="${D.line}"/></w:tblBorders>` +
      '<w:tblCellMar><w:top w:w="45" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="45" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '</w:style></w:styles>';
  }

  function numberingXml(numberedIds) {
    const bulletLvl = (i, ch, left) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ch}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="270"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:hint="default"/></w:rPr></w:lvl>`;
    const decLvl = (i, left) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${i ? 'lowerLetter' : 'decimal'}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
    return XML_HEAD + `<w:numbering xmlns:w="${W_NS}">` +
      `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLvl(0, '•', 360)}${bulletLvl(1, '◦', 720)}${bulletLvl(2, '▪', 1080)}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${decLvl(0, 360)}${decLvl(1, 720)}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      numberedIds.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('') +
      '</w:numbering>';
  }

  function footerXml(text) {
    const rpr = `<w:rPr><w:color w:val="${D.muted}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>`;
    const r = (t) => `<w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
    const fld = (instr) => `<w:r>${rpr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rpr}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` +
      `<w:r>${rpr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rpr}<w:t>1</w:t></w:r><w:r>${rpr}<w:fldChar w:fldCharType="end"/></w:r>`;
    return XML_HEAD + `<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr>` +
      `${text ? r(text + '   ·   ') : ''}${r('Page ')}${fld('PAGE')}${r(' of ')}${fld('NUMPAGES')}</w:p></w:ftr>`;
  }

  /** Minimal WordprocessingML document builder. */
  function newDoc(o) {
    o = o || {};
    const margin = o.margin || 1152; // 0.8"
    const width = 12240 - 2 * margin; // US Letter
    const baseSize = o.size || 10.5;
    const footer = o.footer === false ? null : str(o.footer);
    const parts = [];
    const links = [];
    const numbered = [];
    const doc = { width };

    const linkRel = (url) => {
      const found = links.find((l) => l.url === url);
      if (found) return found.id;
      const id = 'rIdL' + (links.length + 1);
      links.push({ id, url });
      return id;
    };
    /** content: string | run | array of runs; a run with `link` becomes a hyperlink. */
    doc.runs = (content, base) => (Array.isArray(content) ? content : [content]).map((r) => {
      if (r && typeof r === 'object' && r.link) {
        const url = safeUrl(r.link);
        const rr = Object.assign({}, r, { text: r.text || url || r.link });
        if (url) return `<w:hyperlink r:id="${linkRel(url)}" w:history="1">${runXml(Object.assign(rr, { hyper: true }), base)}</w:hyperlink>`;
        return runXml(rr, base);
      }
      return runXml(r, base);
    }).join('');
    doc.p = (content, po) => { parts.push(paraXml(doc.runs(content), po)); return doc; };
    doc.title = (t) => doc.p(t, { style: 'Title' });
    doc.subtitle = (t) => doc.p(t, { style: 'Subtitle' });
    doc.h1 = (t) => doc.p(t, { style: 'Heading1' });
    doc.h2 = (t) => doc.p(t, { style: 'Heading2' });
    doc.muted = (t) => doc.p({ text: t, i: true, color: D.muted });
    doc.bullets = (items, ilvl) => { items.forEach((it) => doc.p(it, { style: 'ListParagraph', numId: 1, ilvl: ilvl || 0 })); return doc; };
    doc.numbered = (items) => {
      const id = 2 + numbered.length;
      numbered.push(id);
      items.forEach((it) => doc.p(it, { style: 'ListParagraph', numId: id }));
      return doc;
    };
    doc.spacer = (after) => { parts.push(paraXml('', { after: after === undefined ? 60 : after, line: 240, size: 6 })); return doc; };
    /**
     * spec: {widths:[fractions|twips], header?:[labels], rows:[[cell]], size?:pt, labelCol?:bool, zebra?:bool}
     * cell: string | number | {text|runs, fill, color, b, i, align, link}
     */
    doc.table = (spec) => {
      const nCol = spec.widths.length;
      let ws = spec.widths.map((w) => (w <= 1 ? w * width : w));
      const sum = ws.reduce((x, y) => x + y, 0) || 1;
      ws = ws.map((w) => Math.floor((w * width) / sum));
      ws[nCol - 1] += width - ws.reduce((x, y) => x + y, 0);
      const pt = spec.size || 9;
      const hp = Math.round(pt * 2);
      const bd = (tag) => `<w:${tag} w:val="single" w:sz="4" w:space="0" w:color="${D.line}"/>`;
      let x = '<w:tbl><w:tblPr><w:tblStyle w:val="CBTable"/>' + `<w:tblW w:w="${width}" w:type="dxa"/>` +
        `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(bd).join('')}</w:tblBorders>` +
        '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="45" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="45" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar>' +
        `<w:tblLook w:val="${spec.header ? '0420' : '0400'}" w:firstRow="${spec.header ? 1 : 0}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
      x += '<w:tblGrid>' + ws.map((w) => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>';
      const cellXml = (cell, ci, rowFill, isHead) => {
        const c = cell !== null && typeof cell === 'object' && !Array.isArray(cell) ? cell : { text: Array.isArray(cell) ? undefined : cell, runs: Array.isArray(cell) ? cell : undefined };
        const label = spec.labelCol && ci === 0 && !isHead;
        const fill = c.fill || (isHead ? D.head : label ? D.label : rowFill);
        const base = { size: pt, color: c.color || (isHead ? 'FFFFFF' : undefined), b: c.b || isHead || label, i: c.i };
        const content = c.runs || [c.link ? { text: str(c.text), link: c.link } : { text: c.text === null || c.text === undefined ? '' : String(c.text) }];
        const tcPr = `<w:tcPr><w:tcW w:w="${ws[ci]}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex6(fill)}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>`;
        const ppr = `<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${c.align ? `<w:jc w:val="${c.align}"/>` : ''}<w:rPr><w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/></w:rPr></w:pPr>`;
        return `<w:tc>${tcPr}<w:p>${ppr}${doc.runs(content, base)}</w:p></w:tc>`;
      };
      if (spec.header) x += '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + spec.header.map((h, ci) => cellXml(h, ci, null, true)).join('') + '</w:tr>';
      spec.rows.forEach((r, ri) => {
        const rowFill = spec.zebra !== false && ri % 2 === 1 ? D.zebra : null;
        const cells = r.slice(0, nCol);
        while (cells.length < nCol) cells.push('');
        x += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + cells.map((c, ci) => cellXml(c, ci, rowFill, false)).join('') + '</w:tr>';
      });
      parts.push(x + '</w:tbl>');
      doc.spacer(120);
      return doc;
    };

    doc.build = async (meta) => {
      meta = meta || {};
      const JSZip = await lib('jszip', 'JSZip');
      const zip = new JSZip();
      const nowW3 = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const sect = `<w:sectPr>${footer !== null ? '<w:footerReference w:type="default" r:id="rIdFtr"/>' : ''}<w:pgSz w:w="12240" w:h="15840"/>` +
        `<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="576" w:footer="576" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
      zip.file('[Content_Types].xml', XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        (footer !== null ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
      zip.file('_rels/.rels', XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
      zip.file('docProps/core.xml', XML_HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${xmlEsc(meta.title || '')}</dc:title><dc:subject>${xmlEsc(meta.subject || '')}</dc:subject><dc:creator>${xmlEsc(meta.author || 'Callback')}</dc:creator><cp:lastModifiedBy>Callback</cp:lastModifiedBy>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${nowW3}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${nowW3}</dcterms:modified></cp:coreProperties>`);
      zip.file('docProps/app.xml', XML_HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>Callback</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>');
      zip.file('word/document.xml', XML_HEAD + `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${parts.join('')}${sect}</w:body></w:document>`);
      zip.file('word/styles.xml', stylesXml(Math.round(baseSize * 2)));
      zip.file('word/settings.xml', XML_HEAD + `<w:settings xmlns:w="${W_NS}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>` +
        '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>');
      zip.file('word/numbering.xml', numberingXml(numbered));
      if (footer !== null) zip.file('word/footer1.xml', footerXml(footer));
      const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
      zip.file('word/_rels/document.xml.rels', XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rIdStyles" Type="${R}styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="${R}settings" Target="settings.xml"/>` +
        `<Relationship Id="rIdNumbering" Type="${R}numbering" Target="numbering.xml"/>` +
        (footer !== null ? `<Relationship Id="rIdFtr" Type="${R}footer" Target="footer1.xml"/>` : '') +
        links.map((l) => `<Relationship Id="${l.id}" Type="${R}hyperlink" Target="${xmlEsc(l.url)}" TargetMode="External"/>`).join('') +
        '</Relationships>');
      return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE', compressionOptions: { level: 6 } });
    };
    return doc;
  }

  /** Notes HTML → paragraphs / bullets / bold headings. */
  function addBlocks(doc, blocks) {
    let pendingBullets = [];
    const flush = () => { if (pendingBullets.length) { doc.bullets(pendingBullets); pendingBullets = []; } };
    blocks.forEach((b) => {
      if (b.bullet) { pendingBullets.push(b.text); return; }
      flush();
      if (b.heading) doc.p({ text: b.text, b: true }, { keepNext: true, before: 120, after: 40 });
      else doc.p(b.text);
    });
    flush();
  }
  /** Job description text → paragraphs, bullets, and bold heading-ish lines. */
  function addJD(doc, jd) {
    const lines = cleanText(jd).split('\n');
    let bullets = [];
    const flush = () => { if (bullets.length) { doc.bullets(bullets); bullets = []; } };
    lines.forEach((raw) => {
      const line = raw.trim();
      if (!line) { flush(); return; }
      const m = /^[•●▪◦‣∙·\-–*]\s*(.+)$/.exec(line);
      if (m && m[1].length > 1) { bullets.push(m[1]); return; }
      flush();
      const heading = line.length <= 70 && (/:$/.test(line) || (/[A-Z]{3}/.test(line) && line === line.toUpperCase()));
      if (heading) doc.p({ text: line.replace(/:$/, ''), b: true }, { keepNext: true, before: 160, after: 40 });
      else doc.p(line, { after: 80 });
    });
    flush();
  }

  // ───────── a. Job search report ─────────
  IO.exportReportDocx = async function (opts) {
    opts = opts || {};
    const jobs = (opts.jobs || []).filter(Boolean);
    const atsById = opts.atsById || {};
    const stats = mergeStats(jobs, atsById, opts.stats);
    const now = new Date();
    const d = newDoc({ footer: 'Callback · Job Search Report' });

    d.title('Job Search Report');
    d.subtitle(`Generated ${longDate(now)}` + (opts.resumeName ? ` · Scored against ${opts.resumeName}` : '') + ` · ${plural(jobs.length, 'job')} tracked`);

    d.h1('Summary');
    const num = (x) => (isNum(x) ? String(Math.round(x)) : '—');
    const rate = (x) => (isNum(x) ? pctText(x > 1 ? x / 100 : x, 1) : '—');
    d.table({
      widths: [0.62, 0.38], header: ['Metric', 'Value'], size: 10, labelCol: true,
      rows: [
        ['Jobs tracked', { text: num(stats.total), align: 'right' }],
        ['Applications sent', { text: num(stats.applied), align: 'right' }],
        ['Responses', { text: num(stats.responses), align: 'right' }],
        ['Response rate', { text: rate(stats.responseRate), align: 'right', b: true }],
        ['Interviews', { text: num(stats.interviews), align: 'right' }],
        ['Interview rate', { text: rate(stats.interviewRate), align: 'right', b: true }],
        ['Offers', { text: num(stats.offers), align: 'right' }],
        ['Offer rate', { text: rate(stats.offerRate), align: 'right', b: true }],
        ['Rejected', { text: num(stats.rejected), align: 'right' }],
        ['Ghosted', { text: num(stats.ghosted), align: 'right' }],
        ['Average ATS score', { text: isNum(stats.avgAts) ? `${Math.round(stats.avgAts)} / 100` : '—', align: 'right' }],
      ],
    });

    d.h1('Pipeline');
    const byStage = stats.byStage || {};
    const total = CB.STAGES.reduce((s, st) => s + (numOrNull(byStage[st.key]) || 0), 0);
    d.table({
      widths: [0.5, 0.25, 0.25], header: ['Stage', 'Count', 'Share'], size: 10,
      rows: CB.STAGES.map((st) => {
        const c = numOrNull(byStage[st.key]) || 0;
        return [stageCell(st.key), { text: String(c), align: 'right' }, { text: total ? pctText(c / total) : '—', align: 'right' }];
      }).concat([[{ text: 'Total', b: true }, { text: String(total), align: 'right', b: true }, { text: total ? '100%' : '—', align: 'right', b: true }]]),
    });

    d.h1('Applications');
    if (jobs.length) {
      const sorted = jobs.slice().sort((x, y) => str(y.appliedDate).localeCompare(str(x.appliedDate)) || str(x.company).localeCompare(str(y.company)));
      d.table({
        widths: [0.18, 0.26, 0.15, 0.07, 0.08, 0.12, 0.14], header: ['Company', 'Title', 'Status', 'ATS', 'Chance', 'Applied', 'Source'], size: 9,
        rows: sorted.map((j) => {
          const a = atsFor(atsById, j);
          const sh = hasScore(a) ? scoreShade(a.score) : null;
          return [
            { text: j.company || '—', b: true }, j.title || '—', stageCell(j.status),
            sh ? { text: String(Math.round(a.score)), align: 'center', fill: sh[0], color: sh[1], b: true } : { text: '—', align: 'center' },
            { text: prob(a) !== null ? pctText(prob(a)) : '—', align: 'right' },
            fmtD(j.appliedDate) || '—', j.source || '—',
          ];
        }),
      });
    } else d.muted('No jobs tracked yet.');

    d.h1('ATS risk list');
    const risky = jobs.map((j) => ({ j, a: atsFor(atsById, j) })).filter(({ a }) => hasScore(a) && (knockouts(a).length || a.verdict === 'REJECTED'));
    if (risky.length) {
      d.p('Jobs where an applicant-tracking system is likely to screen you out before a person reads your resume.', { after: 120 });
      d.table({
        widths: [0.34, 0.1, 0.18, 0.38], header: ['Job', 'ATS', 'Verdict', 'Knockouts'], size: 9,
        rows: risky.map(({ j, a }) => {
          const sh = scoreShade(a.score);
          const ko = knockouts(a).map((k) => (k.label || k.code) + (k.detail ? ` — ${k.detail}` : '')).join('\n');
          return [
            { runs: [{ text: j.company || '—', b: true }, { text: '\n' + (j.title || '') }] },
            { text: String(Math.round(a.score)), align: 'center', fill: sh[0], color: sh[1], b: true },
            { text: verdictText(a), color: VERDICT_COLOR[a.verdict] || D.ink, b: true },
            ko || (a.verdict === 'REJECTED' ? 'Overall score below the auto-reject line' : '—'),
          ];
        }),
      });
    } else d.muted('No knockout risks detected.');

    d.h1('Upcoming interviews');
    const horizon = new Date(now.getTime() + 30 * 86400000);
    const upcoming = [];
    jobs.forEach((j) => (j.interviews || []).forEach((iv) => {
      const dt = iv && parseLocal(iv.datetime);
      if (dt && dt >= now && dt <= horizon && iv.outcome !== 'Cancelled') upcoming.push({ j, iv, dt });
    }));
    upcoming.sort((x, y) => x.dt - y.dt);
    if (upcoming.length) {
      d.table({
        widths: [0.24, 0.2, 0.24, 0.16, 0.16], header: ['When', 'Company', 'Role', 'Round / type', 'Interviewer'], size: 9,
        rows: upcoming.map(({ j, iv }) => [{ text: fmtDT(iv.datetime), b: true }, j.company || '—', j.title || '—', [roundText(iv.round), iv.type].filter(Boolean).join(' · ') || '—', iv.interviewer || '—']),
      });
    } else d.muted('No interviews in the next 30 days.');

    d.h1('Follow-ups due');
    const due = jobs.filter((j) => j.status === 'applied' && j.appliedDate && CB.daysSince(j.appliedDate) >= 7 && !j.responseDate)
      .sort((x, y) => CB.daysSince(y.appliedDate) - CB.daysSince(x.appliedDate));
    if (due.length) {
      d.p('Applied a week or more ago with no response — a short, specific follow-up note often gets a reply.', { after: 120 });
      d.table({
        widths: [0.2, 0.28, 0.14, 0.08, 0.14, 0.16], header: ['Company', 'Title', 'Applied', 'Days', 'Follow-up', 'Contact'], size: 9,
        rows: due.map((j) => {
          const days = CB.daysSince(j.appliedDate);
          return [{ text: j.company || '—', b: true }, j.title || '—', fmtD(j.appliedDate), { text: String(days), align: 'right', b: days > 21, color: days > 21 ? '9C0006' : undefined }, fmtD(j.followUpDate) || '—', contactNames(j) || '—'];
        }),
      });
    } else d.muted('Nothing to follow up on right now.');

    const blob = await d.build({ title: 'Job Search Report', subject: 'Job search summary' });
    return save(`Callback-Job-Search-Report-${stamp()}.docx`, blob, DOCX_MIME);
  };

  // ───────── b. Job dossier (interview prep pack) ─────────
  IO.exportJobDossierDocx = async function (job, ats, resumeName) {
    if (job && job.job && typeof job.job === 'object' && ats === undefined) { ats = job.ats; resumeName = job.resumeName; job = job.job; }
    if (!job) throw new Error('No job selected.');
    const a = ats && typeof ats === 'object' ? ats : null;
    const d = newDoc({ footer: `${job.company || 'Job'} · Dossier` });

    d.title(job.title || 'Untitled role');
    d.subtitle([job.company, job.location, job.workMode].filter(Boolean).join(' · ') || ' ');

    const facts = [];
    const fact = (k, v) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) facts.push([k, v]); };
    fact('Company', job.company);
    fact('Role', job.title);
    fact('Location', [job.location, job.workMode].filter(Boolean).join(' · '));
    fact('Employment', [job.employmentType, job.seniority].filter(Boolean).join(' · '));
    fact('Salary', CB.fmtSalary(job));
    fact('Source', (job.source || '') + (job.referral ? ` (referral${job.referrerName ? ' from ' + job.referrerName : ''})` : ''));
    if (safeUrl(job.url)) fact('Posting', { text: job.url.length > 80 ? job.url.slice(0, 77) + '…' : job.url, link: job.url });
    fact('Status', stageCell(job.status));
    fact('Applied', fmtD(job.appliedDate));
    fact('Posted', fmtD(job.postedDate));
    fact('Deadline', fmtD(job.deadline));
    fact('Follow-up', fmtD(job.followUpDate));
    fact('Response', fmtD(job.responseDate));
    const nx = nextInterview(job);
    if (nx) fact('Next interview', fmtDT(nx.datetime) + ([roundText(nx.round), nx.type].filter(Boolean).length ? ` — ${[roundText(nx.round), nx.type].filter(Boolean).join(' · ')}` : ''));
    fact('Priority', job.priority);
    fact('Excitement', stars(job.excitement));
    if (isNum(job.applicants)) fact('Applicants', String(job.applicants));
    fact('Tags', (job.tags || []).join(', '));
    if (job.status === 'rejected') fact('Rejection', [job.rejectionReason, job.rejectionStage ? `at ${stageLabel(job.rejectionStage)}` : ''].filter(Boolean).join(' '));
    d.table({ widths: [0.24, 0.76], rows: facts, size: 10, labelCol: true, zebra: false });

    d.h1('ATS verdict');
    if (hasScore(a)) {
      const vc = VERDICT_COLOR[a.verdict] || D.ink;
      d.p([{ text: String(Math.round(a.score)), b: true, size: 26, color: vc }, { text: ' / 100     ', size: 12, color: D.muted }, { text: verdictText(a), b: true, size: 14, color: vc }], { after: 60 });
      const facts2 = [];
      if (prob(a) !== null) facts2.push(`Interview chance: ${pctText(prob(a))}`);
      if (a.rank && isNum(a.rank.position)) facts2.push(`Estimated rank: #${a.rank.position}${isNum(a.rank.pool) ? ' of ' + a.rank.pool : ''}${isNum(a.rank.percentile) ? ` (${Math.round(a.rank.percentile > 1 ? a.rank.percentile : a.rank.percentile * 100)}th percentile)` : ''}`);
      if (isNum(a.yearsRequired)) facts2.push(`Experience: ${a.yearsRequired}+ yrs required${isNum(a.yearsCandidate) ? `, you show ${a.yearsCandidate}` : ''}`);
      if (facts2.length) d.p({ text: facts2.join('   ·   '), color: D.muted }, { after: 120 });
      if (resumeName) d.p({ text: `Scored against ${resumeName}`, i: true, color: D.muted, size: 9 }, { after: 120 });

      d.h2('Knockouts');
      const ko = knockouts(a);
      if (ko.length) d.bullets(ko.map((k) => [{ text: k.code ? `${k.code} ` : '', b: true, color: '9B1C1C' }, { text: k.label || '', b: true }, { text: k.detail ? ` — ${k.detail}` : '' }]));
      else d.p({ text: '✓ No knockouts detected.', color: '0B5D33', b: true });

      const comps = compScores(a);
      if (comps.length) {
        d.h2('Score components');
        d.table({
          widths: [0.28, 0.1, 0.1, 0.52], header: ['Component', 'Weight', 'Score', 'Detail'], size: 9,
          rows: comps.map((c) => {
            const sh = scoreShade(c.score);
            return [{ text: c.label, b: true }, { text: weightText(c.weight), align: 'right' }, sh ? { text: String(c.score), align: 'center', fill: sh[0], color: sh[1], b: true } : { text: '—', align: 'center' }, str(c.detail)];
          }),
        });
      }
      const missKw = a.keywords && Array.isArray(a.keywords.missing) ? a.keywords.missing.filter(Boolean).slice(0, 20) : [];
      if (missKw.length) d.p([{ text: 'Missing keywords: ', b: true }, { text: missKw.join(', ') }]);
    } else {
      d.muted('No ATS analysis yet — add your resume in Callback to score this job.');
    }

    d.h1('Skills match');
    const skills = skillList(a, 'required').map((s) => ({ s, req: true })).concat(skillList(a, 'preferred').map((s) => ({ s, req: false })));
    if (skills.length) {
      d.table({
        widths: [0.38, 0.2, 0.26, 0.16], header: ['Skill', 'Required / Preferred', 'Status', 'JD mentions'], size: 9,
        rows: skills.map(({ s, req }) => {
          const ui = SKILL_UI[s.status] || { text: cap1(str(s.status)) || '—' };
          return [{ text: s.name, b: true }, req ? 'Required' : 'Preferred', { text: ui.text, fill: ui.fill, color: ui.color, b: true }, { text: isNum(s.jdCount) ? String(s.jdCount) : '—', align: 'right' }];
        }),
      });
    } else d.muted('No skills extracted yet.');

    d.h1('Fix before you apply');
    const fixes = fixList(a);
    if (fixes.length) {
      d.numbered(fixes.map((f) => {
        const pr = typeof f.priority === 'string' && f.priority ? cap1(f.priority.toLowerCase()) : '';
        return pr ? [{ text: `[${pr}] `, b: true, color: /high|critical/i.test(pr) ? '9B1C1C' : D.muted }, { text: f.text }] : f.text;
      }));
    } else d.muted(hasScore(a) ? 'No fixes suggested — your resume already covers this posting well.' : 'Score this job against your resume to get fixes.');

    d.h1('Interviews');
    const ivs = (job.interviews || []).filter(Boolean).slice().sort((x, y) => (parseLocal(x.datetime) || 0) - (parseLocal(y.datetime) || 0));
    if (ivs.length) {
      d.table({
        widths: [0.1, 0.15, 0.17, 0.15, 0.12, 0.08, 0.23], header: ['Round', 'Type', 'When', 'Interviewer', 'Outcome', 'Thank-you', 'Notes'], size: 8.5,
        rows: ivs.map((iv) => {
          const oc = OUTCOME_D[iv.outcome];
          return [roundText(iv.round) || '—', iv.type || '—', fmtDT(iv.datetime) || '—', iv.interviewer || '—',
            oc ? { text: iv.outcome, fill: oc[0], color: oc[1], b: true } : iv.outcome || '—', iv.thankYouSent ? '✓ Sent' : '—',
            safeUrl(iv.link) ? { runs: [{ text: htmlText(iv.notes) ? htmlText(iv.notes) + '\n' : '' }, { text: 'Join link', link: iv.link }] } : htmlText(iv.notes)];
        }),
      });
    } else d.muted('No interviews logged yet.');

    d.h1('Contacts');
    const cts = (job.contacts || []).filter(Boolean);
    if (cts.length) {
      d.table({
        widths: [0.18, 0.16, 0.22, 0.14, 0.1, 0.2], header: ['Name', 'Role', 'Email', 'Phone', 'LinkedIn', 'Notes'], size: 8.5,
        rows: cts.map((c) => [{ text: c.name || '—', b: true }, c.role || '—',
          c.email ? { text: str(c.email).replace(/^mailto:/i, ''), link: /^mailto:/i.test(c.email) ? c.email : 'mailto:' + str(c.email).trim() } : '—',
          c.phone || '—', safeUrl(c.linkedin) ? { text: 'Profile', link: c.linkedin } : '—', htmlText(c.notes)]),
      });
    } else d.muted('No contacts yet.');

    d.h1('Timeline');
    const tl = (job.timeline || []).filter(Boolean).slice().sort((x, y) => (parseLocal(x.ts) || 0) - (parseLocal(y.ts) || 0));
    if (tl.length) {
      d.table({
        widths: [0.22, 0.14, 0.64], header: ['When', 'Event', 'Details'], size: 8.5,
        rows: tl.map((e) => {
          const move = e.from || e.to ? `${e.from ? stageLabel(e.from) : '—'} → ${e.to ? stageLabel(e.to) : '—'}` : '';
          return [fmtDT(e.ts) || '—', cap1(str(e.kind)) || '—', [move, htmlText(e.text)].filter(Boolean).join(move && e.text ? ' · ' : '')];
        }),
      });
    } else d.muted('No events yet.');

    d.h1('Notes');
    const blocks = htmlBlocks(job.notes);
    if (blocks.length) addBlocks(d, blocks); else d.muted('No notes yet.');

    d.h1('Job description');
    if (str(job.jd).trim()) addJD(d, job.jd); else d.muted('No job description saved.');

    const blob = await d.build({ title: `${job.company || ''} — ${job.title || ''} dossier`, subject: 'Interview prep dossier' });
    const fname = [safeName(job.company, 40), safeName(job.title, 50)].filter(Boolean).join('-') || 'Job';
    return save(`${fname}-Dossier.docx`, blob, DOCX_MIME);
  };

  // ───────── c. Cover letter ─────────
  IO.exportCoverLetterDocx = async function (opts) {
    opts = opts || {};
    const job = opts.job || {};
    const body = str(opts.text || job.coverLetter).replace(/\r\n?/g, '\n').trim();
    const name = str(opts.candidateName).trim();
    const d = newDoc({ footer: false, margin: 1440, size: 11 });

    if (name) d.p({ text: name, b: true, size: 16, color: '111827' }, { after: 20 });
    const contact = [opts.candidateEmail, opts.candidatePhone].map((x) => str(x).trim()).filter(Boolean);
    if (contact.length) {
      const runs = [];
      contact.forEach((c, i) => {
        if (i) runs.push({ text: '  ·  ', color: D.muted });
        runs.push(EMAIL_RE.test(c) && c.indexOf('@') > 0 ? { text: c, link: 'mailto:' + c } : { text: c, color: D.muted });
      });
      d.p(runs, { after: 0, borderBottom: D.line });
    }
    d.spacer(240);
    d.p(longDate(new Date()), { after: 240 });
    d.p(['Hiring Team', job.company ? '\n' + job.company : '', job.location ? '\n' + job.location : ''].join(''), { after: 240 });
    if (job.title) d.p([{ text: 'Re: ', b: true }, { text: job.title, b: true }], { after: 240 });

    const paras = body ? body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
    if (!paras.length || !/^(dear|hi|hello|to whom|greetings)\b/i.test(paras[0])) {
      d.p(`Dear ${job.company ? job.company + ' ' : ''}Hiring Team,`, { after: 200 });
    }
    // A closing like "Best regards," / "Thanks,\nJane" — short, no sentence punctuation (so "Thank you for your time." is body text).
    const signOffRe = /^(sincerely|best|regards|kind regards|best regards|warm regards|warmly|respectfully|thank you|thanks|cheers|yours|with appreciation|all the best|with gratitude)\b[^.!?\n]{0,30},?\s*(\n|$)/i;
    paras.forEach((p) => d.p(p, { after: 200, line: 276 }));
    if (!paras.length || !signOffRe.test(paras[paras.length - 1])) {
      d.p('Sincerely,', { before: 120, after: name ? 480 : 0 });
      if (name) d.p({ text: name, b: true });
    }

    const blob = await d.build({ title: `Cover letter — ${job.title || ''}${job.company ? ' at ' + job.company : ''}`, subject: 'Cover letter', author: name || 'Callback' });
    return save(`Cover-Letter-${safeName(job.company, 50) || 'Company'}.docx`, blob, DOCX_MIME);
  };

  // Internal pieces exposed for diagnostics/tests (not part of the public API).
  IO._internal = { parseCSV, parseDateValue, parseSalary, mapStatus, mapHeaders, htmlBlocks, rtfToText, pdfLines, mergeStats };
})();

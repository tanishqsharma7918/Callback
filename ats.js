/* Callback — the ATS engine.
 * Deterministic, local, no network. Parses resumes and job descriptions, scores fit the way a
 * modern ATS + recruiter screen does (knockout questions first, then weighted ranking), and
 * estimates interview probability against today's applicant volumes.
 * Depends on CB.Taxonomy (skills.js).
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  const T = () => CB.Taxonomy;

  // ─────────────────────────── strictness profiles ───────────────────────────
  const STRICT = {
    brutal: { label: 'Brutal', curve: 1.15, gapPenalty: 3, gapCap: 18, koYoeRatio: 0.6, koYoeAbs: 3, koMQ: 0.45, koDegreeGap: 1, koLocation: true, floor: 60, strong: 85, competitive: 75, listedCredit: 0.5 },
    harsh: { label: 'Harsh', curve: 1.07, gapPenalty: 2, gapCap: 12, koYoeRatio: 0.5, koYoeAbs: 4, koMQ: 0.38, koDegreeGap: 2, koLocation: false, floor: 52, strong: 82, competitive: 70, listedCredit: 0.6 },
    standard: { label: 'Standard', curve: 1.0, gapPenalty: 1, gapCap: 6, koYoeRatio: 0.4, koYoeAbs: 5, koMQ: 0.3, koDegreeGap: 9, koLocation: false, floor: 42, strong: 78, competitive: 65, listedCredit: 0.7 },
  };

  const DISPOSITION = {
    'DQ-AUTH': 'Work authorization',
    'DQ-CLR': 'Security clearance',
    'DQ-YOE': 'Years of experience',
    'DQ-MQ': 'Minimum qualifications',
    'DQ-DEG': 'Education requirement',
    'DQ-CERT': 'Required license / certification',
    'DQ-LANG': 'Required language',
    'DQ-SEN': 'Seniority mismatch',
    'DQ-LOC': 'Location / on-site',
    'DQ-SCORE': 'Below screening threshold',
  };

  // ─────────────────────────── text helpers ───────────────────────────
  const NUMWORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15 };
  const wordsToNums = (s) => s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen)\b(?=\s*(\(\d+\)\s*)?\+?\s*(or more\s+)?(years?|yrs?))/gi, (m) => NUMWORDS[m.toLowerCase()]);
  const stem = (w) => {
    w = w.toLowerCase();
    if (w.length > 5) w = w.replace(/(ments?|ings?|ations?|ers?|ies|es|ed|ly)$/, '');
    else if (w.length > 3) w = w.replace(/s$/, '');
    return w;
  };
  const lines = (t) => String(t || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const BULLET_RE = /^([•●▪◦‣∙·*–—\-]|\d{1,2}[.)])\s*/;
  const wc = (s) => (String(s || '').match(/[A-Za-z0-9][A-Za-z0-9'’+#.\-]*/g) || []).length;

  // Keep list punctuation as a hard boundary so "performance, testing" never reads as "performance testing".
  const sep = (x) => String(x || '').replace(/[,;:!?()\[\]{}|•·]+/g, ' ¦ ');
  const findSkills = (x) => (x ? T().find(sep(x)) : new Map());
  // Generic skills are satisfied by any concrete member of these taxonomy families.
  const GENERIC = {
    'Message Queues': ['message-broker'], 'Observability': ['observability'], 'Logging': ['observability'], 'CI/CD': ['ci', 'gitops'],
    'Infrastructure as Code': ['iac'], 'NoSQL': ['nosql-document', 'wide-column', 'cache'], 'Relational Databases': ['relational-db'], 'SQL': ['relational-db', 'sql-dialect', 'warehouse'],
    'Data Warehousing': ['warehouse'], 'Frontend Development': ['frontend-framework', 'react-meta', 'vue-meta', 'svelte-meta'], 'Backend Development': ['python-web', 'node-web', 'mvc-web', 'spring', 'dotnet'],
    'Test Automation': ['e2e-test', 'js-unit-test', 'jvm-test'], 'Unit Testing': ['js-unit-test', 'jvm-test'], 'Configuration Management': ['config-mgmt'], 'Event-Driven Architecture': ['message-broker', 'stream-processing'],
    'Stream Processing': ['stream-processing', 'message-broker'], 'Data Pipelines': ['orchestration', 'etl-tool', 'stream-processing'], 'Business Intelligence': ['bi'], 'Data Visualization': ['bi'],
    'Deep Learning': ['dl-framework'], 'Vector Databases': ['vector-db'], 'LLMs': ['llm-framework', 'llm-provider'], 'CRM': ['crm'], 'Marketing Automation': ['marketing-automation'], 'ERP': ['erp'], 'EHR': ['ehr'],
    'Applicant Tracking Systems': ['ats'], 'Mobile Development': ['mobile-cross-platform', 'ios-lang', 'ios-ui'], 'Caching': ['cache'],
  };
  const memo = new Map();
  const memoGet = (key, fn) => {
    if (memo.has(key)) return memo.get(key);
    const v = fn();
    if (memo.size > 600) memo.delete(memo.keys().next().value);
    memo.set(key, v);
    return v;
  };

  // ─────────────────────────── dates ───────────────────────────
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MON_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|spring|summer|fall|autumn|winter)\\.?';
  const DATE_TOKEN = `(?:${MON_RE}\\s*'?\\d{2,4}|\\d{1,2}\\s*/\\s*(?:\\d{4}|\\d{2})|(?:19|20)\\d{2})`;
  const RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|until|through|thru|~)\\s*(${DATE_TOKEN}|present|current|now|today|ongoing|date)`, 'gi');
  const RANGE_TEST = new RegExp(RANGE_RE.source, 'i');
  const nowMonths = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); };
  function parseMonthToken(tok, isEnd) {
    const t = tok.toLowerCase().replace(/\s+/g, ' ').trim();
    if (/present|current|now|today|ongoing|date/.test(t)) return nowMonths();
    let m = /^([a-z]+)\.?\s*'?(\d{2,4})$/.exec(t);
    if (m) {
      let y = +m[2]; if (y < 100) y += y > 50 ? 1900 : 2000;
      const key = m[1].slice(0, 3);
      const season = { spr: 3, sum: 6, fal: 9, aut: 9, win: 0 }[key];
      const mon = MONTHS[key] ?? season ?? 0;
      return y * 12 + mon;
    }
    m = /^(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(t);
    if (m) { let y = +m[2]; if (y < 100) y += y > 50 ? 1900 : 2000; return y * 12 + CB.clamp(+m[1] - 1, 0, 11); }
    m = /^(\d{4})$/.exec(t);
    if (m) return +m[1] * 12 + (isEnd ? 11 : 0);
    return null;
  }
  function mergeIntervals(iv) {
    const s = iv.filter((x) => x[1] >= x[0]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const x of s) {
      if (out.length && x[0] <= out[out.length - 1][1] + 1) out[out.length - 1][1] = Math.max(out[out.length - 1][1], x[1]);
      else out.push([x[0], x[1]]);
    }
    return out;
  }

  // ─────────────────────────── sections ───────────────────────────
  const RESUME_HEADINGS = [
    ['summary', /^(professional |career |executive )?(summary|profile|objective|about( me)?|overview|highlights)$/],
    ['experience', /^(professional |work |relevant |industry |employment |career )?(experience|employment( history)?|work history|career history|history|positions held)$/],
    ['education', /^(education|academic background|academics|education (and|&) training|education (and|&) certifications?)$/],
    ['skills', /^((technical|core|key|relevant|professional|hard) )?(skills|competencies|technologies|tech stack|toolkit|tools|expertise|skills (and|&) (tools|technologies|interests|abilities)|technical proficiencies)$/],
    ['projects', /^((selected|personal|academic|key|side|notable) )?projects?$/],
    ['certifications', /^(certifications?|licenses?( (and|&) certifications?)?|certifications? (and|&) licenses?|credentials|courses|training)$/],
    ['awards', /^(awards?|honors?|honors (and|&) awards|achievements|accomplishments)$/],
    ['publications', /^(publications?|patents?|research|talks)$/],
    ['volunteer', /^(volunteer(ing)?( experience)?|leadership( experience)?|activities|community|extracurricular)$/],
    ['languages', /^languages?$/],
    ['interests', /^(interests|hobbies)$/],
  ];
  function headingKey(line, table) {
    if (!line || line.length > 60) return null;
    const h = line.replace(BULLET_RE, '').replace(/[:|\-–—_=*#]+$/g, '').replace(/^[#*\s]+/, '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!h || h.split(' ').length > 7) return null;
    for (const [k, re] of table) if (re.test(h)) return k;
    return null;
  }
  function splitSections(text, table) {
    const L = lines(text);
    const out = { _header: [] };
    let cur = '_header';
    const order = [];
    L.forEach((l) => {
      const k = headingKey(l, table);
      if (k) { cur = k; if (!out[k]) { out[k] = []; order.push(k); } return; }
      (out[cur] = out[cur] || []).push(l);
    });
    const res = {};
    for (const k in out) res[k] = out[k].join('\n').trim();
    res._order = order;
    return res;
  }

  // ─────────────────────────── role / seniority ───────────────────────────
  function roleFamilyOf(title) {
    if (!title) return null;
    const t = ' ' + T().normalize(title) + ' ';
    let best = null, bestLen = 0;
    for (const f of T().roleFamilies) {
      for (const p of f.titles) {
        const pn = ' ' + T().normalize(p) + ' ';
        if (t.includes(pn) && pn.length > bestLen) { best = f; bestLen = pn.length; }
      }
    }
    return best;
  }
  const IC_MANAGER = /\b(product|project|program|account|case|office|community|territory|customer success|success|relationship|content|brand|social media|channel|partner|category|portfolio|property|accounts?)\s+manager\b/;
  function levelFromTitle(title) {
    if (!title) return null;
    const t = ' ' + title.toLowerCase().replace(/[^a-z0-9.+# ]/g, ' ').replace(/\s+/g, ' ') + ' ';
    if (/\b(intern|internship|co op|apprentice|trainee)\b/.test(t)) return 0;
    if (/\b(chief|cto|ceo|cfo|coo|cmo|cio|ciso|cpo|vp|svp|evp|vice president|president|partner)\b/.test(t) && !/\bpartner (manager|success|engineer)/.test(t)) return 8;
    if (/\b(director|head of)\b/.test(t)) return 7;
    if (/\bmanager\b/.test(t) && !IC_MANAGER.test(t)) return 6;
    if (/\b(principal|distinguished|fellow)\b/.test(t)) return 5;
    if (/\b(staff|lead|architect)\b/.test(t)) return 4;
    if (/\b(senior|sr\.?|iii|iv)\b/.test(t)) return 3;
    if (/\b(junior|jr\.?|entry|graduate|new grad|associate|early career|apprentice)\b/.test(t) || / i $/.test(t)) return 1;
    if (/\b(ii|mid|intermediate)\b/.test(t)) return 2;
    if (IC_MANAGER.test(t)) return 3;
    return null;
  }
  const levelFromYears = (y) => (y == null ? null : y < 1 ? 1 : y < 3 ? 1 : y < 5 ? 2 : y < 8 ? 3 : y < 12 ? 4 : 5);
  const levelLabel = (l) => (CB.SENIORITY.find((s) => s.level === l) || {}).label || '—';
  const TITLE_WORD = /\b(engineer|developer|programmer|manager|analyst|designer|scientist|consultant|specialist|director|lead|associate|coordinator|intern|nurse|accountant|representative|executive|architect|administrator|officer|recruiter|writer|teacher|technician|strategist|researcher|advisor|owner|head|president|founder|sre|devops|marketer|editor|producer|agent|assistant|controller|auditor|planner|buyer|supervisor|instructor|therapist|pharmacist|physician|counsel|attorney|paralegal|partner)\b/i;

  // ─────────────────────────── resume parsing ───────────────────────────
  function parseResume(text) {
    text = String(text || '');
    return memoGet('r' + CB.hash(text), () => parseResumeRaw(text));
  }
  function parseResumeRaw(text) {
    const L = lines(text);
    const sec = splitSections(text, RESUME_HEADINGS);
    const header = sec._header || '';
    const contact = {
      email: (text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/) || [''])[0],
      phone: (text.match(/(?:\+?\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/) || [''])[0],
      linkedin: (text.match(/linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i) || [''])[0],
      github: (text.match(/github\.com\/[A-Za-z0-9\-_]+/i) || [''])[0],
      location: '',
    };
    const locM = (header || L.slice(0, 8).join('\n')).match(/\b([A-Z][a-zA-Z.]+(?: [A-Z][a-zA-Z.]+){0,2}),\s*([A-Z]{2})\b/);
    if (locM) contact.location = locM[0];
    let name = '';
    for (const l0 of L.slice(0, 6)) {
      const l = l0.replace(/\(.*?\)/g, '').trim();
      if (!l || /@|\d{3}|http|linkedin|github|resume|curriculum/i.test(l)) continue;
      const w = l.split(' ');
      if (w.length >= 2 && w.length <= 4 && /^[A-Za-z][A-Za-z.'\- ]+$/.test(l)) { name = l; break; }
    }

    // Experience roles from date ranges
    const expText = sec.experience || '';
    const eduText = sec.education || '';
    const scope = expText ? lines(expText) : L.filter((l) => !eduText.includes(l));
    const roles = [];
    const idxs = [];
    scope.forEach((l, i) => {
      RANGE_RE.lastIndex = 0;
      const m = RANGE_RE.exec(l);
      if (m) {
        const s = parseMonthToken(m[1], false), e = parseMonthToken(m[2], true);
        if (s != null && e != null && e >= s && s > 1960 * 12 && e - s < 50 * 12) idxs.push({ i, s, e, current: /present|current|now|today|ongoing/i.test(m[2]), line: l, match: m[0] });
      }
    });
    idxs.forEach((d, k) => {
      const next = idxs[k + 1] ? idxs[k + 1].i : scope.length;
      // Title: the date line itself (minus dates) or a neighbor that looks like a title.
      const cands = [d.line.replace(d.match, ''), scope[d.i - 1], scope[d.i + 1], scope[d.i - 2]].filter(Boolean).map((x) => x.replace(BULLET_RE, '').replace(/[|,–—\-]\s*$/, '').trim());
      let title = cands.find((c) => TITLE_WORD.test(c) && c.length < 90) || cands[0] || '';
      title = title.split(/\s+[|•·@—–]\s+|\s+-\s+|\s+at\s+|,\s+(?=[A-Z])/)[0].trim().slice(0, 80);
      const body = scope.slice(d.i + 1, next).join('\n');
      roles.push({ title, start: d.s, end: d.e, months: d.e - d.s + 1, current: d.current, text: d.line + '\n' + body });
    });
    roles.sort((a, b) => b.end - a.end || b.start - a.start);
    const merged = mergeIntervals(roles.map((r) => [r.start, r.end]));
    const totalMonths = merged.reduce((a, x) => a + (x[1] - x[0] + 1), 0);
    const gaps = [];
    for (let i = 1; i < merged.length; i++) {
      const g = merged[i][0] - merged[i - 1][1] - 1;
      if (g >= 6) gaps.push({ months: g, from: merged[i - 1][1], to: merged[i][0] });
    }
    const totalYears = Math.round((totalMonths / 12) * 10) / 10;

    // Bullets
    const bulletSrc = lines(expText + '\n' + (sec.projects || '')).filter(Boolean);
    const bullets = bulletSrc.filter((l) => BULLET_RE.test(l) || (l.length > 55 && !RANGE_TEST.test(l) && /[a-z]/.test(l)))
      .map((l) => l.replace(BULLET_RE, '').trim()).filter((l) => wc(l) >= 4);
    const AV = new Set(T().actionVerbs);
    const quantRe = /(\d+(\.\d+)?\s?(%|x\b|k\b|m\b|mm\b|b\b|\+|percent|ms\b|hrs?\b|hours|days|weeks|users|customers|clients|people|engineers|reports|accounts|countries|stores|requests|transactions)|[$€£₹]\s?\d|\d{1,3}(,\d{3})+|\b(?!(19|20)\d{2}\b)\d{2,}\b)/i;
    const weakRe = new RegExp('^(' + T().weakPhrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
    let quantified = 0, actionStart = 0, weak = 0;
    const verbCounts = {};
    const bulletInfo = bullets.map((b) => {
      const first = (b.match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
      const q = quantRe.test(b), a = AV.has(first), w = weakRe.test(b);
      if (q) quantified++;
      if (a) actionStart++;
      if (w) weak++;
      if (first) verbCounts[first] = (verbCounts[first] || 0) + 1;
      return { text: b, quantified: q, action: a, weak: w, words: wc(b) };
    });
    const lowerText = text.toLowerCase();
    const buzz = T().buzzwords.filter((b) => new RegExp('(^|[^a-z])' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]/g, '[- ]?') + '([^a-z]|$)').test(lowerText));
    const pronouns = (text.match(/\b(I|me|my|mine|myself)\b/g) || []).length;

    // Skills with evidence context
    const find = findSkills;
    const expRolesText = roles.map((r) => r.text).join('\n') || expText;
    const recentText = roles.length ? roles.filter((r) => nowMonths() - r.end <= 36).map((r) => r.text).join('\n') : expText;
    const inExp = find(expRolesText);
    const inProj = find(sec.projects);
    const inRecent = find(recentText);
    const all = find(text);
    const skills = new Map();
    for (const [nm, v] of all) {
      let evidence = 'listed';
      if (inExp.has(nm)) evidence = 'experience';
      else if (inProj.has(nm)) evidence = 'project';
      else if ((sec.summary || '').toLowerCase().includes(nm.toLowerCase()) && !(sec.skills || '').toLowerCase().includes(nm.toLowerCase())) evidence = 'summary';
      skills.set(nm, { name: nm, kind: v.skill.kind, cat: v.skill.cat, count: v.count, evidence, recent: inRecent.has(nm) });
    }

    // Education
    const eduSrc = eduText || L.filter((l) => /(degree|university|college|institute|school|bachelor|master|b\.?s\.?|m\.?s\.?|ph\.?d|mba|b\.?tech|diploma)/i.test(l)).join('\n');
    const edu = detectDegree(eduSrc, false);
    const certs = [...skills.values()].filter((s) => s.kind === 'cert').map((s) => s.name);

    const titles = roles.map((r) => r.title).filter(Boolean);
    const recentTitle = titles[0] || (sec.summary || '').split(/[.\n]/)[0] || '';
    const tl = levelFromTitle(recentTitle);
    const yl = levelFromYears(totalYears);
    let level = tl ?? yl ?? 1;
    if (tl != null && yl != null && tl < 6 && tl > yl + 1) level = yl + 1;
    const families = [...new Set(titles.map((t) => (roleFamilyOf(t) || {}).key).filter(Boolean))];
    const words = wc(text);
    const nonAscii = (text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;

    return {
      name, contact, sections: Object.keys(sec).filter((k) => !k.startsWith('_') && sec[k]), sectionText: sec,
      roles: roles.map((r) => ({ title: r.title, start: r.start, end: r.end, months: r.months, current: r.current })),
      roleTexts: roles.map((r) => r.text),
      totalYears, gaps, titles, recentTitle, level, families,
      bullets: bulletInfo, quantified, actionStart, weak, verbCounts, buzzwords: buzz, pronouns,
      skills, certs, education: edu, words, chars: text.length, emoji: nonAscii,
      normalized: T().normalize(text), stems: new Set(T().normalize(text).split(' ').map(stem)),
    };
  }

  // ─────────────────────────── degree detection ───────────────────────────
  const DEG = [
    [5, 'Doctorate', /\b(ph\.?\s?d\b\.?|doctorate|doctoral|d\.phil|doctor of (?!medicine))/i],
    [4, "Master's", /\b(master'?s?\b|masters\b|m\.s\.(?![a-z])|m\.sc\.?|msc\b|ms(?=\s+(in|degree|of)\b)|m\.eng\b|meng\b|mba\b|m\.b\.a\.?|m\.tech\b|mtech\b|mfa\b|mph\b|mpa\b|m\.a\.(?=\s)|graduate degree|advanced degree)/i],
    [3, "Bachelor's", /\b(bachelor'?s?\b|bachelors\b|b\.s\.(?![a-z])|b\.sc\.?|bsc\b|bs(?=\s+(in|degree|of)\b)|b\.a\.(?![a-z])|ba(?=\s+(in|degree|of)\b)|b\.eng\b|beng\b|b\.tech\b|btech\b|b\.e\.(?![a-z])|bba\b|b\.com\b|bcom\b|undergraduate degree|(4|four)[- ]year degree|college degree|university degree|ba\/bs|bs\/ba|bs\/ms|bs or ms)/i],
    [2, 'Associate / bootcamp', /\b(associate'?s? degree|associate of|a\.a\.s?\.|a\.s\. degree|bootcamp|boot camp|nanodegree|technical diploma)/i],
    [1, 'High school', /\b(high school|ged\b|secondary school|hs diploma)/i],
  ];
  function detectDegree(text, forJD) {
    const out = { level: 0, label: 'None found', field: '' };
    if (!text) return out;
    const found = DEG.filter(([, , re]) => re.test(text)).map(([lv, lb]) => ({ lv, lb }));
    if (!found.length) return out;
    // A JD's requirement is the MINIMUM listed ("BS or MS" → BS). A resume's level is the max held.
    const pick = forJD ? found.reduce((a, b) => (b.lv < a.lv ? b : a)) : found.reduce((a, b) => (b.lv > a.lv ? b : a));
    out.level = pick.lv;
    out.label = pick.lb;
    const f = text.match(/\b(?:in|of)\s+((?:computer science|computer engineering|software engineering|electrical engineering|mechanical engineering|engineering|mathematics|math|statistics|physics|economics|finance|accounting|business administration|business|information systems|information technology|data science|nursing|marketing|communications|psychology|biology|chemistry|design|human resources|public health|supply chain|operations research)[A-Za-z ,/&]{0,40})/i);
    if (f) out.field = f[1].replace(/\s+(or|and)\s*$/, '').trim();
    return out;
  }

  // ─────────────────────────── JD parsing ───────────────────────────
  const JD_HEADINGS = [
    ['preferred', /(preferred|bonus|nice[ -]to[ -]haves?|desired|desirable|additional (qualifications|skills)|pluses?|extra credit|it'?s a plus|even better|ideally|good to have|great to have|we'?d love)/],
    ['required', /(minimum|basic|required|must[ -]haves?|essential|key) (qualifications|requirements|skills|experience)|^requirements|^qualifications|^(job |position )?requirements|what you('ll)? (need|bring)|who you are|you (have|bring|are)|what we('re| are)? looking for|your (background|experience|skills|profile|qualifications)|about you|skills (&|and) (experience|qualifications)|the ideal candidate|^experience$|^skills$|competencies|what it takes|to be successful|you might be a (good|great) fit|is this you/],
    ['responsibilities', /(responsibilities|what you('ll)? (do|own|work on)|the role|your (role|impact|mission|day)|day[ -]to[ -]day|in this role|you will|key duties|job duties|duties|what you'll be doing|the opportunity|job summary|position summary|role overview|scope|accountabilities|what the job involves)/],
    ['about', /(about (us|the company|the team|our team|[a-z]+$)|benefits|perks|compensation|pay (range|transparency)|salary|equal (opportunity|employment)|eeo|our (values|culture|mission|story)|why (join|work)|life at|what we offer|we offer|diversity|accommodation|privacy|total rewards|location$)/],
  ];
  const SECTION_WEIGHT = { required: 1.0, responsibilities: 0.75, preferred: 0.5, _header: 0.7, about: 0 };
  const LINE_PREF = /(nice to have|a plus\b|is a plus|are a plus|bonus|preferred|desirable|ideally|not required|helpful|advantageous|good to have)/i;
  const LINE_SOFT = /(familiarity with|familiar with|exposure to|awareness of|basic understanding)/i;
  const JD_SKIP = /^(about the job|job description|description|overview|full job description|job details)$/i;
  const LINE_REQ = /(required|must|minimum|at least|proficien|expert|strong|deep|solid|extensive|demonstrated|proven|hands[ -]on)/i;

  function parseJD(text, ai) {
    text = String(text || '');
    return memoGet('j' + CB.hash(text) + (ai ? CB.hash(JSON.stringify(ai)) : ''), () => mergeAI(parseJDRaw(text), ai));
  }
  function parseJDRaw(text) {
    const tx = wordsToNums(text);
    const L = lines(tx);
    const sectLines = { _header: [], required: [], preferred: [], responsibilities: [], about: [] };
    let cur = '_header';
    let sectionsFound = false;
    for (const l of L) {
      if (!l) continue;
      const h = l.replace(BULLET_RE, '').replace(/[:\-–—]+$/, '').trim().toLowerCase();
      if (JD_SKIP.test(h)) continue;
      let k = null;
      if (l.length < 70 && h.split(' ').length <= 9 && !/[.;]$/.test(l)) {
        for (const [key, re] of JD_HEADINGS) if (re.test(h)) { k = key; break; }
      }
      if (k) { cur = k; sectionsFound = true; continue; }
      sectLines[cur].push(l);
    }
    // Skills with weights from where they appear (line-level cues override section).
    const skillAgg = new Map();
    let altSeq = 0;
    const consider = (lineText, baseW, section) => {
      const found = findSkills(lineText);
      if (!found.size) return;
      const groups = altGroups(lineText, found);
      let w = baseW;
      let req = section === 'required';
      if (LINE_PREF.test(lineText)) { w = Math.min(w, 0.5); req = false; }
      else if (LINE_SOFT.test(lineText)) { w = Math.min(w, 0.78); }
      else if (LINE_REQ.test(lineText) && section !== 'about') { w = Math.max(w, 0.9); if (section !== 'preferred') req = true; }
      for (const [nm, v] of found) {
        const a = skillAgg.get(nm) || { name: nm, kind: v.skill.kind, cat: v.skill.cat, weight: 0, count: 0, sections: new Set(), hardReq: false, line: '', alt: null };
        if (groups.has(nm) && !a.alt) a.alt = 'g' + (altSeq + groups.get(nm));
        a.count += v.count;
        if (w > a.weight) { a.weight = w; a.line = lineText; }
        a.sections.add(section);
        if (req && /(required|must|active|current|valid|licensed|certified)/i.test(lineText)) a.hardReq = true;
        skillAgg.set(nm, a);
      }
      altSeq += 100;
    };
    for (const sec of ['required', 'responsibilities', 'preferred', '_header']) {
      const base = sectionsFound ? SECTION_WEIGHT[sec] : 0.85;
      sectLines[sec].forEach((l) => consider(l, base, sectionsFound ? sec : 'required'));
    }
    const skills = [...skillAgg.values()].map((s) => {
      let w = s.weight * (1 + 0.12 * Math.min(s.count - 1, 4));
      if (s.kind === 'soft') w *= 0.35;
      return { name: s.name, kind: s.kind, cat: s.cat, weight: Math.round(w * 100) / 100, count: s.count, required: s.weight >= 0.75 && s.kind !== 'soft', hardReq: s.hardReq, sections: [...s.sections], alt: s.alt };
    }).sort((a, b) => b.weight - a.weight || b.count - a.count);

    const reqText = sectionsFound ? [...sectLines.required, ...sectLines._header, ...sectLines.responsibilities].join('\n') : L.join('\n');
    const prefText = sectLines.preferred.join('\n');
    const bodyNoAbout = L.filter((l) => !sectLines.about.includes(l)).join('\n');

    // Years of experience
    const yrs = extractYears(reqText);
    const yrsPref = extractYears(prefText);
    // Degree
    const degLines = (sectionsFound ? [...sectLines.required, ...sectLines._header] : L).filter((l) => /(degree|bachelor|master|ph\.?d|doctorate|b\.?s\.?\b|m\.?s\.?\b|bs\/|ba\/|\/ms|mba|diploma|ged|high school|graduate)/i.test(l));
    const degPrefLines = sectLines.preferred.filter((l) => /(degree|bachelor|master|ph\.?d|mba)/i.test(l));
    const deg = detectDegree(degLines.join('\n'), true);
    const degreeRequired = deg.level > 0 && !degLines.every((l) => LINE_PREF.test(l));
    const equivalentOk = /(or equivalent|equivalent (practical |work |professional |combination of |relevant )?(experience|education)|or related experience|in lieu of|or comparable|or (an )?equivalent combination|or relevant experience|degree or experience)/i.test(degLines.join(' '));
    const degPref = detectDegree(degPrefLines.join('\n'), true);

    const low = text.toLowerCase();
    const clearance = /\b(ts\/sci|top secret|secret clearance|security clearance|active clearance|public trust|dod clearance|clearance is required|clearance required|polygraph|q clearance|l clearance)\b/i.exec(text);
    const noSponsor = /(not|unable to|cannot|can'?t|won'?t|will not|does not|do not|is not able to)\s+(currently\s+)?(provide\s+|offer\s+|support\s+)?(visa\s+|immigration\s+|employment\s+)?sponsor|without (the need for )?(current or future |now or in the future |future )?(visa |employment |work )?sponsorship|no (visa |h-?1b )?sponsorship|sponsorship (is )?not (available|offered|provided)|must be (legally )?authori[sz]ed to work in the (u\.?s\.?|united states|uk|canada)[^.]{0,60}without/i.test(text);
    const yesSponsor = /((will|can|able to) (provide |offer )?(visa )?sponsor|visa sponsorship (is )?(available|offered|provided)|sponsorship available|h-?1b (transfer|sponsorship) (available|welcome))/i.test(text) && !noSponsor;
    const citizenship = /(u\.?s\.? citizen(ship)? (is )?required|must be (a )?(u\.?s\.? )?citizen|citizenship (is )?required|only u\.?s\.? citizens|us persons? only|itar)/i.test(text);

    const header = sectLines._header.slice(0, 6).join(' ').toLowerCase();
    let workMode = '';
    if (/\((remote)\)|\bremote\b.{0,3}(·|\|)|^remote$|fully remote|100% remote|remote[- ]first|work from anywhere|remote \(us\)|remote in /.test(low) || /\bremote\b/.test(header)) workMode = 'Remote';
    if (/\((hybrid)\)|\bhybrid\b/.test(header) || /\bhybrid (role|schedule|work|position|model)|\bhybrid\b.{0,40}(days|office)/.test(low)) workMode = 'Hybrid';
    if (/\((on-?site)\)|\bon-?site\b/.test(header) || /\b(fully on-?site|100% on-?site|in[- ]office (5|five) days|onsite role|on-?site position|must work on-?site|this (role|position) is on-?site)/.test(low)) workMode = workMode || 'On-site';
    if (!workMode && /\bremote\b/.test(low) && !/not remote|no remote|non-remote/.test(low)) workMode = 'Remote';

    const certsRequired = skills.filter((s) => s.kind === 'cert' && s.required && s.hardReq && !/clearance|polygraph|secret|ts.sci/i.test(s.name)).map((s) => s.name);
    const languagesRequired = skills.filter((s) => s.kind === 'language' && s.required).map((s) => s.name);

    // Domain keywords (non-taxonomy vocabulary the posting repeats)
    const keywords = domainKeywords(bodyNoAbout);

    // Posting signals (red flags)
    const flags = [];
    if (/\b(rock ?star|ninja|guru|wizard|unicorn)\b/i.test(text)) flags.push('Uses "rockstar/ninja" language — often signals poor scoping or long hours.');
    if (/wear (many|multiple|a lot of) hats/i.test(text)) flags.push('"Wear many hats" — expect an under-resourced team and a blurred scope.');
    if (/\b(commission[- ]only|unpaid|equity[- ]only)\b/i.test(text)) flags.push('Commission-only / unpaid compensation mentioned.');
    if (/competitive (salary|pay|compensation)/i.test(text) && !/\$\s?\d/.test(text)) flags.push('"Competitive salary" with no number — ask for the band in the first call.');
    if (yrs.min >= 7 && /\b(entry|junior|associate|graduate)\b/i.test(sectLines._header.join(' '))) flags.push(`Asks for ${yrs.min}+ years on a junior-titled role.`);
    const reqCount = skills.filter((s) => s.required).length;
    if (reqCount > 22) flags.push(`${reqCount} must-have skills listed — a wish list; real hiring bar is usually the top 5–8.`);

    return {
      sectionsFound, skills,
      requiredSkills: skills.filter((s) => s.required).map((s) => s.name),
      preferredSkills: skills.filter((s) => !s.required).map((s) => s.name),
      minYears: yrs.min, yearsLine: yrs.line, minYearsPreferred: yrsPref.min,
      degree: { level: degreeRequired ? deg.level : 0, label: degreeRequired ? deg.label : 'Not required', required: degreeRequired, equivalentOk, field: deg.field, preferredLevel: degPref.level, preferredLabel: degPref.level ? degPref.label : '' },
      clearance: { required: !!clearance, level: clearance ? clearance[0] : '' },
      sponsorship: noSponsor ? 'no' : yesSponsor ? 'yes' : 'unknown', citizenship,
      workMode, salary: extractSalary(text), applicants: extractApplicants(text), postedDaysAgo: extractPostedAgo(text),
      certsRequired, languagesRequired, keywords, flags,
      words: wc(text), source: 'local',
    };
  }

  /** Group skills a line lists as alternatives: "Go or Python", "Kafka or similar brokers", "observability tools such as Datadog". */
  function altGroups(lineText, found) {
    const out = new Map();
    if (found.size < 2) return out;
    const norm = T().normalize(sep(lineText));
    const spans = [];
    for (const [nm, v] of found) {
      const al = [v.skill.name, ...(v.skill.aliases || [])].map((a) => T().normalize(a.replace(/^[=!]/, ''))).filter(Boolean).sort((a, b) => b.length - a.length);
      const p = (v.positions && v.positions.length ? v.positions : [norm.indexOf(al[al.length - 1])])[0];
      if (p == null || p < 0) continue;
      let start = p;
      if (norm[start] === ' ' || norm[start] === '¦') start++;
      const a = al.find((x) => norm.startsWith(x, start)) || al[al.length - 1];
      spans.push({ nm, start, end: start + a.length });
    }
    spans.sort((a, b) => a.start - b.start);
    const conn = (g) => {
      g = g.replace(/¦/g, ' ').replace(/\s+/g, ' ').trim();
      if (!g) return 'list';
      if (/^(or|and or|either|or similar|or equivalent|or comparable|or other|or another|or any|or a similar|or related)$/.test(g)) return 'or';
      if (/^(and|&|as well as|plus)$/.test(g)) return 'and';
      if (/^(such as|like|including|incl.?|e\.?g\.?|i\.?e\.?|especially|particularly|for example|for instance|ideally|preferably)$/.test(g)) return 'such';
      return 'break';
    };
    let run = [spans[0]], links = [];
    const flush = () => {
      if (run.length >= 2) {
        const si = links.indexOf('such');
        if (si >= 0) run.slice(si).forEach((x) => out.set(x.nm, si));
        else if (links.includes('or') && !links.includes('and')) run.forEach((x) => out.set(x.nm, 50));
        else if (links.includes('or')) {
          let segStart = 0;
          links.forEach((l, i) => { if (l === 'and') { if (links.slice(segStart, i).includes('or')) run.slice(segStart, i + 1).forEach((x) => out.set(x.nm, 60 + segStart)); segStart = i + 1; } });
          if (links.slice(segStart).includes('or')) run.slice(segStart).forEach((x) => out.set(x.nm, 60 + segStart));
        }
      }
    };
    for (let i = 1; i < spans.length; i++) {
      const c = spans[i].start < spans[i - 1].end ? 'list' : conn(norm.slice(spans[i - 1].end, spans[i].start));
      if (c === 'break') { flush(); run = [spans[i]]; links = []; }
      else { run.push(spans[i]); links.push(c); }
    }
    flush();
    return out;
  }

  function extractYears(text) {
    const res = { min: null, line: '' };
    if (!text) return res;
    const sentences = text.split(/[.;!?]\s+|\n/);
    let best = null;
    for (const s of sentences) {
      const re = /(?:(at least|minimum(?: of)?|min\.?|over|more than|a minimum of)\s+)?(\d{1,2})(?:\.\d)?\s*(?:\(\d+\)\s*)?(\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:or more\s+)?(?:years?|yrs?)\b/gi;
      let m, nums = [];
      while ((m = re.exec(s))) {
        const after = s.slice(m.index + m[0].length, m.index + m[0].length + 90).toLowerCase();
        const before = s.slice(Math.max(0, m.index - 50), m.index).toLowerCase();
        if (/(old|history|in business|anniversary|warranty|of age|of growth|vesting|ago|cliff)/.test(after.slice(0, 25))) continue;
        if (/(founded|vest|company|business|history|since|anniversary|warranty|tenure|over the (past|last|next)|growth|serving|been around|for over)\s*$/.test(before.slice(-30))) continue;
        const n = +m[2];
        if (n < 1 || n > 20) continue;
        nums.push(n);
      }
      if (nums.length) {
        const n = /\bor\b/i.test(s) && nums.length > 1 ? Math.min(...nums) : Math.max(...nums);
        if (best === null || n > best) { best = n; res.line = s.trim().slice(0, 200); }
      }
    }
    res.min = best;
    return res;
  }
  function extractSalary(text) {
    const k = (v) => { if (!v) return null; let s = v.replace(/[$,\s]/g, ''); let mult = 1; if (/k$/i.test(s)) { mult = 1000; s = s.slice(0, -1); } const n = parseFloat(s) * mult; return isNaN(n) ? null : n; };
    let m = /[$£€]\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s?[kK]?)\s*(?:\/\s*(?:yr|year|hr|hour))?\s*(?:-|–|—|to)\s*[$£€]?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s?[kK]?)\s*(\/\s*(yr|year|hr|hour)|per (year|hour|annum)|annually|hourly|an hour|a year)?/i.exec(text);
    if (m) {
      let a = k(m[1]), b = k(m[2]);
      const hourly = /hr|hour/i.test(m[0]) || (b && b < 500);
      if (a && b && a > b) [a, b] = [b, a];
      return { min: a, max: b, period: hourly ? 'hour' : 'year' };
    }
    m = /[$£€]\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s?[kK]?)\s*(\/\s*(yr|year|hr|hour)|per (year|hour)|annually|hourly)/i.exec(text);
    if (m) { const a = k(m[1]); return { min: a, max: a, period: /hr|hour/i.test(m[2]) ? 'hour' : 'year' }; }
    return null;
  }
  function extractApplicants(text) {
    let m = /(over|more than)\s+(\d{1,4})\s+applicants/i.exec(text);
    if (m) return { n: +m[2], over: true };
    m = /among the first\s+(\d{1,4})\s+applicants/i.exec(text);
    if (m) return { n: Math.round(+m[1] / 2), over: false };
    m = /\b(\d{1,4})\s+applicants\b/i.exec(text);
    if (m) return { n: +m[1], over: false };
    m = /(\d{1,4})\s+people clicked apply/i.exec(text);
    if (m) return { n: +m[1], over: false };
    return null;
  }
  function extractPostedAgo(text) {
    const m = /(reposted\s+)?(\d{1,3})\s+(minute|hour|day|week|month)s?\s+ago/i.exec(text);
    if (!m) return null;
    const n = +m[2];
    const days = { minute: 0, hour: 0, day: n, week: n * 7, month: n * 30 }[m[3].toLowerCase()];
    return { days, reposted: !!m[1] };
  }
  function domainKeywords(text) {
    const tx = T();
    const stop = new Set([...tx.stopwords, ...tx.jdFiller]);
    const norm = tx.normalize(text).replace(/[0-9.+#]+/g, ' ');
    const found = tx.find(text);
    const skillWords = new Set();
    for (const [nm] of found) tx.normalize(nm).split(' ').forEach((w) => skillWords.add(w));
    const toks = norm.split(' ').filter((w) => w.length > 2 && !stop.has(w) && /^[a-z]+$/.test(w));
    const uni = {}, bi = {};
    toks.forEach((w, i) => {
      if (!skillWords.has(w)) uni[w] = (uni[w] || 0) + 1;
      const n = toks[i + 1];
      if (n && !skillWords.has(w) && !skillWords.has(n)) { const k = w + ' ' + n; bi[k] = (bi[k] || 0) + 1; }
    });
    const cand = [];
    for (const k in bi) if (bi[k] >= 2) cand.push({ term: k, n: bi[k] * 1.8 });
    for (const k in uni) if (uni[k] >= 2 && k.length > 3) cand.push({ term: k, n: uni[k] * (k.length > 7 ? 1.2 : 1) });
    cand.sort((a, b) => b.n - a.n);
    const out = [];
    for (const c of cand) {
      if (out.some((o) => o.includes(c.term) || c.term.includes(o))) continue;
      out.push(c.term);
      if (out.length >= 18) break;
    }
    return out;
  }

  function mergeAI(local, ai) {
    if (!ai || typeof ai !== 'object') return local;
    const r = { ...local, source: 'claude' };
    const toNames = (arr) => (Array.isArray(arr) ? arr : []).map((s) => String(s || '').trim()).filter(Boolean);
    const mapSkill = (s, required) => {
      const f = T().find(s);
      if (f.size) { const [nm, v] = [...f.entries()][0]; return { name: nm, kind: v.skill.kind, cat: v.skill.cat }; }
      return { name: s, kind: 'hard', cat: 'custom', custom: true };
    };
    const seen = new Map();
    toNames(ai.requiredSkills).forEach((s) => { const m = mapSkill(s, true); if (!seen.has(m.name)) seen.set(m.name, { ...m, weight: m.kind === 'soft' ? 0.35 : 1, count: 1, required: m.kind !== 'soft', hardReq: false, sections: ['required'] }); });
    toNames(ai.preferredSkills).forEach((s) => { const m = mapSkill(s, false); if (!seen.has(m.name)) seen.set(m.name, { ...m, weight: m.kind === 'soft' ? 0.2 : 0.5, count: 1, required: false, hardReq: false, sections: ['preferred'] }); });
    // keep local frequency info
    for (const s of local.skills) { const a = seen.get(s.name); if (a) a.count = s.count; }
    if (seen.size) {
      r.skills = [...seen.values()];
      r.requiredSkills = r.skills.filter((s) => s.required).map((s) => s.name);
      r.preferredSkills = r.skills.filter((s) => !s.required).map((s) => s.name);
    }
    if (Number.isFinite(+ai.minYears) && +ai.minYears > 0) r.minYears = +ai.minYears;
    if (ai.degreeLevel != null && Number.isFinite(+ai.degreeLevel)) {
      const lv = +ai.degreeLevel;
      r.degree = { ...r.degree, level: lv, required: lv > 0 && !!ai.degreeRequired, label: (DEG.find((d) => d[0] === lv) || [0, 'Not required'])[1], equivalentOk: ai.equivalentExperienceOk != null ? !!ai.equivalentExperienceOk : r.degree.equivalentOk };
    }
    if (ai.clearanceRequired != null) r.clearance = { required: !!ai.clearanceRequired, level: ai.clearanceLevel || r.clearance.level };
    if (['no', 'yes', 'unknown'].includes(ai.sponsorship)) r.sponsorship = ai.sponsorship;
    if (ai.citizenshipRequired != null) r.citizenship = !!ai.citizenshipRequired;
    if (Array.isArray(ai.certificationsRequired)) r.certsRequired = toNames(ai.certificationsRequired).map((c) => mapSkill(c).name);
    if (Array.isArray(ai.languagesRequired)) r.languagesRequired = toNames(ai.languagesRequired).map((c) => mapSkill(c).name);
    if (Array.isArray(ai.keywords) && ai.keywords.length) r.keywords = toNames(ai.keywords).slice(0, 18).map((k) => k.toLowerCase());
    if (Array.isArray(ai.redFlags)) r.flags = [...new Set([...r.flags, ...toNames(ai.redFlags)])];
    return r;
  }

  // ─────────────────────────── posting / URL extraction ───────────────────────────
  const VENDORS = [
    ['LinkedIn', /linkedin\.com|lnkd\.in/i],
    ['Greenhouse', /greenhouse\.io/i],
    ['Lever', /lever\.co/i],
    ['Ashby', /ashbyhq\.com/i],
    ['Workday', /myworkdayjobs\.com|workday\.com/i],
    ['iCIMS', /icims\.com/i],
    ['SmartRecruiters', /smartrecruiters\.com/i],
    ['Taleo', /taleo\.net/i],
    ['SuccessFactors', /successfactors|jobs\.sap\.com/i],
    ['Jobvite', /jobvite\.com/i],
    ['BambooHR', /bamboohr\.com/i],
    ['Workable', /workable\.com/i],
    ['Indeed', /indeed\.com/i],
    ['Glassdoor', /glassdoor\./i],
    ['Wellfound', /wellfound\.com|angel\.co/i],
  ];
  const VENDOR_TIPS = {
    Workday: 'Workday re-keys your resume into its own form. Use a single-column layout, standard headings, and dates as "Mon YYYY – Mon YYYY". Knockout questions here are enforced automatically.',
    Greenhouse: 'Greenhouse shows recruiters the parsed resume next to scorecards. Keyword search is literal — mirror the exact terms used in the posting.',
    Lever: 'Lever ranks by recruiter search. Exact-match skill names and the posting title in your headline matter.',
    iCIMS: 'iCIMS parsing is strict with tables, text boxes and headers. Keep contact info in the body, not the page header.',
    Taleo: 'Taleo is the most brittle parser in common use. Plain .docx, no columns, no graphics, standard section names.',
    SuccessFactors: 'SuccessFactors relies on screening questions — expect hard knockouts on years and degree.',
    Ashby: 'Ashby supports AI-assisted review — evidence in bullets (scope + metric) outranks a long skills list.',
    LinkedIn: 'LinkedIn shows the hirer a match summary of your profile vs. the posting. Easy Apply volume is high, so the first 48 hours matter.',
  };
  function parseJobUrl(url) {
    const out = { url: String(url || '').trim(), vendor: '', jobId: '', company: '', title: '', canonical: '', isLinkedIn: false };
    if (!out.url) return out;
    let u;
    try { u = new URL(/^https?:/i.test(out.url) ? out.url : 'https://' + out.url); } catch (e) { return out; }
    out.vendor = (VENDORS.find(([, re]) => re.test(u.hostname)) || [''])[0];
    const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b(sr|jr)\b/gi, (m) => m.toUpperCase() + '.').replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(And|Of|At|In|For|The|To)\b/g, (m) => m.toLowerCase()).trim();
    if (out.vendor === 'LinkedIn') {
      out.isLinkedIn = true;
      const id = u.searchParams.get('currentJobId') || (u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1] || (u.pathname.match(/(\d{8,})/) || [])[1] || '';
      out.jobId = id;
      if (id) out.canonical = `https://www.linkedin.com/jobs/view/${id}/`;
      const slug = (u.pathname.match(/\/jobs\/view\/([a-z0-9-]+)-\d{6,}/i) || [])[1];
      if (slug) {
        const at = slug.lastIndexOf('-at-');
        if (at > 0) { out.title = titleCase(slug.slice(0, at)); out.company = titleCase(slug.slice(at + 4)); }
        else out.title = titleCase(slug);
      }
    } else if (out.vendor === 'Greenhouse') {
      const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/) || [];
      out.company = m[1] ? titleCase(m[1]) : (u.searchParams.get('for') ? titleCase(u.searchParams.get('for')) : '');
      out.jobId = m[2] || u.searchParams.get('gh_jid') || '';
    } else if (out.vendor === 'Lever' || out.vendor === 'Ashby') {
      const m = u.pathname.split('/').filter(Boolean);
      out.company = m[0] ? titleCase(m[0]) : '';
      out.jobId = m[1] || '';
    } else if (out.vendor === 'Workday') {
      out.company = titleCase(u.hostname.split('.')[0]);
      const m = u.pathname.match(/\/job\/[^/]+\/([^/]+?)_([A-Z0-9-]+)$/i);
      if (m) { out.title = titleCase(m[1]); out.jobId = m[2]; }
    } else if (out.vendor === 'Indeed') {
      out.jobId = u.searchParams.get('jk') || u.searchParams.get('vjk') || '';
    } else if (out.vendor === 'SmartRecruiters') {
      const m = u.pathname.split('/').filter(Boolean);
      out.company = m[0] ? titleCase(m[0]) : '';
      if (m[1]) { const t = m[1].replace(/^\d+-/, ''); out.title = titleCase(t); out.jobId = (m[1].match(/^\d+/) || [''])[0]; }
    } else if (!out.vendor) {
      const host = u.hostname.replace(/^(www|careers|jobs|boards|apply)\./, '');
      out.company = titleCase(host.split('.')[0]);
      out.vendor = 'Company site';
    }
    return out;
  }

  const LI_CHROME = /^(easy apply|apply|save|saved|share|show more|show less|see more|see less|… more|more|message|follow|following|premium|try premium.*|meet the hiring team|people you can reach out to|see how you compare.*|get ai-powered advice.*|show match details|tailor my resume|help me stand out|use ai to assess.*|am i a good fit.*|how can i best position myself.*|promoted by hirer|promoted|responses managed off linkedin|actively reviewing applicants|your profile matches.*|skills:.*|matches your job preferences.*|exclusive job seeker insights|about the company|job poster|report this job|set alert for similar jobs|job search faster with premium.*|access company insights.*|\d+ (school )?alumni work here|\d+ connections? work here|reactivate premium.*|retry premium.*|on-?site|remote|hybrid|full-time|part-time|contract|internship|temporary|•)$/i;

  /** Pull company/title/location/etc. from a pasted job posting (LinkedIn copy-all works). */
  function extractPosting(text, url) {
    const t = String(text || '');
    const L = lines(t).filter(Boolean);
    const out = { title: '', company: '', location: '', workMode: '', employmentType: '', seniority: '', jd: t.trim(), applicants: null, postedDaysAgo: null, salary: null };
    const u = parseJobUrl(url);
    // Body after "About the job" (LinkedIn) is the description.
    const aIdx = L.findIndex((l) => /^about the job$|^job description$|^description$|^the role$|^overview$/i.test(l));
    const headerLines = (aIdx >= 0 ? L.slice(0, aIdx) : L.slice(0, 12)).filter((l) => !LI_CHROME.test(l) && !/^\d+ (notifications?|new)$/i.test(l));
    if (aIdx >= 0) {
      let body = L.slice(aIdx + 1);
      const stop = body.findIndex((l) => /^(about the company|set alert for similar jobs|see more jobs like this|more jobs|similar jobs|people also viewed|looking for talent\?)$/i.test(l));
      if (stop > 0) body = body.slice(0, stop);
      out.jd = body.filter((l) => !LI_CHROME.test(l)).join('\n');
    }
    // LinkedIn meta line: "Company · Location (Hybrid) · 2 days ago · Over 100 applicants"
    const metaIdx = headerLines.findIndex((l) => / · /.test(l) && /(ago|applicant|people clicked|reposted|\(remote\)|\(hybrid\)|\(on-?site\)|, [A-Z]{2}\b|united states|remote)/i.test(l));
    if (metaIdx >= 0) {
      const parts = headerLines[metaIdx].split(' · ').map((s) => s.trim());
      const looksLoc = (s) => /(, [A-Z]{2}\b|united states|remote|area|metropolitan|county|, [A-Z][a-z]+$|\((remote|hybrid|on-?site)\))/i.test(s) || /^[A-Z][a-z]+(?: [A-Z][a-z]+)*, [A-Z]/.test(s);
      if (parts[0] && !looksLoc(parts[0]) && !/ago|applicant/i.test(parts[0])) {
        out.company = parts[0];
        if (parts[1] && !/ago|applicant/i.test(parts[1])) out.location = parts[1];
      } else if (looksLoc(parts[0])) out.location = parts[0];
      // title: nearest previous meaningful line
      for (let i = metaIdx - 1; i >= 0; i--) {
        const l = headerLines[i];
        if (l && l !== out.company && l.length < 120 && !/ · /.test(l)) { out.title = l; break; }
      }
      if (!out.company && metaIdx >= 2) out.company = headerLines[metaIdx - 2];
    }
    if (!out.title) {
      const tl = headerLines.find((l) => l.length < 100 && (roleFamilyOf(l) || TITLE_WORD.test(l)) && !/ · /.test(l));
      if (tl) out.title = tl;
    }
    if (!out.company) {
      const m = t.match(/(?:^|\n)\s*(?:company|employer|organization)\s*[:\-]\s*(.+)/i) || t.match(/\babout ([A-Z][A-Za-z0-9&.\- ]{1,40})\s*\n/);
      if (m) out.company = m[1].trim();
    }
    if (!out.location) {
      const m = t.match(/(?:^|\n)\s*(?:location|based in)\s*[:\-]\s*(.+)/i) || headerLines.join('\n').match(/\b([A-Z][a-zA-Z.]+(?: [A-Z][a-zA-Z.]+){0,2}, (?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?))\b/);
      if (m) out.location = m[1].trim();
    }
    const wm = /\((remote|hybrid|on-?site)\)/i.exec(headerLines.join(' ')) || /(?:^|·\s*)(remote|hybrid|on-?site)(?:\s*·|$)/im.exec(L.slice(0, 15).join('\n'));
    if (wm) out.workMode = /remote/i.test(wm[1]) ? 'Remote' : /hybrid/i.test(wm[1]) ? 'Hybrid' : 'On-site';
    const et = /\b(full-time|part-time|contract|internship|temporary)\b/i.exec(L.slice(0, 15).join(' '));
    if (et) out.employmentType = { 'full-time': 'Full-time', 'part-time': 'Part-time', contract: 'Contract', internship: 'Internship', temporary: 'Temporary' }[et[1].toLowerCase()];
    out.applicants = extractApplicants(t);
    out.postedDaysAgo = extractPostedAgo(t);
    out.salary = extractSalary(t);
    // URL fills gaps
    if (!out.title && u.title) out.title = u.title;
    if (!out.company && u.company) out.company = u.company;
    out.title = out.title.replace(/\s+\|\s+.*$/, '').slice(0, 140);
    const lvl = levelFromTitle(out.title);
    if (lvl != null) out.seniority = levelLabel(lvl);
    if (!out.workMode) out.workMode = parseJDRaw(out.jd).workMode || '';
    out.url = u;
    return out;
  }

  // ─────────────────────────── resume audit ───────────────────────────
  function auditResume(p, warnings = []) {
    if (!p) return null;
    const checks = [];
    const add = (key, label, status, detail, weight = 1) => checks.push({ key, label, status, detail, weight });
    add('email', 'Email address', p.contact.email ? 'pass' : 'fail', p.contact.email || 'No email found. Recruiters cannot contact you and some ATS reject the record.', 1.5);
    add('phone', 'Phone number', p.contact.phone ? 'pass' : 'warn', p.contact.phone || 'No phone number found.');
    add('linkedin', 'LinkedIn URL', p.contact.linkedin ? 'pass' : 'warn', p.contact.linkedin || 'Add your linkedin.com/in/ URL. 87% of recruiters check it before a screen.');
    add('sec-exp', 'Experience section', p.sections.includes('experience') ? 'pass' : 'fail', p.sections.includes('experience') ? 'Found a standard "Experience" heading.' : 'No standard "Experience" heading. ATS parsers map content by heading names — use "Experience" or "Work Experience".', 2);
    add('sec-edu', 'Education section', p.sections.includes('education') ? 'pass' : 'warn', p.sections.includes('education') ? 'Found.' : 'No "Education" heading found.');
    add('sec-skills', 'Skills section', p.sections.includes('skills') ? 'pass' : 'warn', p.sections.includes('skills') ? 'Found.' : 'No "Skills" section. Keyword search depends on exact skill names.');
    add('dates', 'Parseable dates', p.roles.length ? 'pass' : 'fail', p.roles.length ? `${p.roles.length} roles dated · ${p.totalYears} years computed.` : 'No date ranges like "Jan 2021 – Present" found. The ATS cannot compute your years of experience, so you fail every years-based knockout.', 2);
    const w = p.words;
    add('length', 'Length', w < 250 ? 'fail' : w < 400 ? 'warn' : w <= 900 ? 'pass' : w <= 1200 ? 'warn' : 'fail', `${w} words (~${Math.max(1, Math.round(w / 475 * 10) / 10)} pages). ${w < 400 ? 'Too thin to rank on keywords.' : w > 900 ? 'Over two pages of content — recruiters skim for 7 seconds.' : 'Within the 1–2 page target.'}`);
    const nb = p.bullets.length;
    add('bullets', 'Achievement bullets', nb >= 10 ? 'pass' : nb >= 6 ? 'warn' : 'fail', `${nb} bullets found.`);
    const qr = nb ? p.quantified / nb : 0;
    add('quant', 'Quantified impact', qr >= 0.5 ? 'pass' : qr >= 0.3 ? 'warn' : 'fail', `${Math.round(qr * 100)}% of bullets contain a number (target ≥ 50%). Add %, $, time saved, scale, or volume.`, 2);
    const ar = nb ? p.actionStart / nb : 0;
    add('verbs', 'Action verbs', ar >= 0.7 ? 'pass' : ar >= 0.4 ? 'warn' : 'fail', `${Math.round(ar * 100)}% of bullets open with a strong verb (target ≥ 70%).`, 1.5);
    add('weak', 'Weak phrasing', p.weak === 0 ? 'pass' : p.weak <= 2 ? 'warn' : 'fail', p.weak ? `${p.weak} bullets start with "responsible for", "helped", "worked on" or similar.` : 'No passive openers.');
    add('buzz', 'Clichés', p.buzzwords.length <= 1 ? 'pass' : p.buzzwords.length <= 3 ? 'warn' : 'fail', p.buzzwords.length ? 'Found: ' + p.buzzwords.slice(0, 8).join(', ') : 'None found.');
    add('pronouns', 'First-person pronouns', p.pronouns <= 2 ? 'pass' : 'warn', p.pronouns <= 2 ? 'Clean.' : `${p.pronouns} uses of I/me/my. Resume convention drops them.`, 0.5);
    const hard = [...p.skills.values()].filter((s) => s.kind !== 'soft');
    add('skills', 'Hard skills detected', hard.length >= 12 ? 'pass' : hard.length >= 7 ? 'warn' : 'fail', `${hard.length} recognized hard skills/tools.`, 1.5);
    const listedOnly = hard.filter((s) => s.evidence === 'listed').length;
    const lr = hard.length ? listedOnly / hard.length : 0;
    add('evidence', 'Skills backed by experience', lr <= 0.35 ? 'pass' : lr <= 0.6 ? 'warn' : 'fail', `${hard.length - listedOnly} of ${hard.length} skills appear in experience or project bullets. Listed-only skills earn half credit.`, 1.5);
    const gaps = p.gaps.filter((g) => g.months >= 6);
    add('gaps', 'Employment gaps', gaps.length === 0 ? 'pass' : 'warn', gaps.length ? gaps.map((g) => `${g.months} months (${CB.MONTHS[g.from % 12]} ${Math.floor(g.from / 12)} – ${CB.MONTHS[g.to % 12]} ${Math.floor(g.to / 12)})`).join('; ') + ' — address briefly or expect the question.' : 'No gaps over 6 months.', 0.75);
    const avgWords = nb ? p.bullets.reduce((a, b) => a + b.words, 0) / nb : 0;
    add('bulletlen', 'Bullet length', avgWords <= 28 ? 'pass' : avgWords <= 36 ? 'warn' : 'fail', `Average ${Math.round(avgWords)} words per bullet (target ≤ 28, one or two lines).`, 0.75);
    const repeated = Object.entries(p.verbCounts).filter(([v, n]) => n >= 4 && T().actionVerbs.includes(v));
    add('repeat', 'Verb variety', repeated.length ? 'warn' : 'pass', repeated.length ? repeated.map(([v, n]) => `"${v}" ×${n}`).join(', ') : 'Good variety.', 0.5);
    add('emoji', 'Special characters', p.emoji ? 'warn' : 'pass', p.emoji ? `${p.emoji} emoji/icon characters. Many parsers drop or garble them.` : 'None.', 0.5);
    warnings.forEach((wn, i) => add('parse' + i, 'File parsing', /empty|scanned|no selectable/i.test(wn) ? 'fail' : 'warn', wn, 1.5));
    const tot = checks.reduce((a, c) => a + c.weight, 0);
    const got = checks.reduce((a, c) => a + c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
    let score = Math.round((got / tot) * 100);
    const critical = checks.filter((c) => c.status === 'fail' && c.weight >= 2).length;
    if (critical) score = Math.min(score, 64);
    const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
    return { score, grade, checks, fails: checks.filter((c) => c.status === 'fail').length, warns: checks.filter((c) => c.status === 'warn').length };
  }

  // ─────────────────────────── scoring ───────────────────────────
  const famIndex = () => memoGet('famidx', () => {
    const m = new Map();
    (T().families || []).forEach((f) => f.members.forEach((n) => (m.get(n) || m.set(n, []).get(n)).push(f)));
    return m;
  });
  function evidenceCredit(s, st, lastUsedPenalty) {
    if (!s) return 0;
    let c = s.evidence === 'experience' ? 1 : s.evidence === 'project' ? 0.75 : s.evidence === 'summary' ? 0.45 : st.listedCredit;
    if (s.evidence === 'experience' && !s.recent && lastUsedPenalty) c = 0.85;
    return c;
  }
  function skillStatus(name, profile, st) {
    const own = profile.skills.get(name);
    if (own) {
      return { status: own.evidence === 'experience' || own.evidence === 'project' ? 'evidenced' : 'listed', credit: evidenceCredit(own, st, true), via: '' };
    }
    // custom (Claude-extracted) skills that aren't in the taxonomy: literal search
    if (!T().byName.has(name)) {
      const n = T().normalize(name);
      if (n && (' ' + profile.normalized + ' ').includes(' ' + n + ' ')) return { status: 'listed', credit: 0.7, via: '' };
    }
    let best = { status: 'missing', credit: 0, via: '' };
    if (GENERIC[name]) {
      const groups = new Set(GENERIC[name]);
      for (const f of T().families || []) {
        if (!groups.has(f.group)) continue;
        for (const m of f.members) {
          const o = profile.skills.get(m);
          if (!o) continue;
          const c = 0.95 * evidenceCredit(o, st, false);
          if (c > best.credit) best = { status: o.evidence === 'experience' || o.evidence === 'project' ? 'evidenced' : 'listed', credit: c, via: m };
        }
      }
      if (best.credit) return best;
    }
    for (const f of famIndex().get(name) || []) {
      for (const m of f.members) {
        if (m === name) continue;
        const o = profile.skills.get(m);
        if (o) {
          const c = f.credit * evidenceCredit(o, st, false);
          if (c > best.credit) best = { status: 'transferable', credit: c, via: m };
        }
      }
    }
    return best;
  }

  const SOURCE_FACTOR = { 'LinkedIn': 0.85, 'LinkedIn Easy Apply': 0.6, 'Company site': 1.1, 'Referral': 3.2, 'Recruiter outreach': 4.0, 'Indeed': 0.7, 'Glassdoor': 0.75, 'Wellfound': 1.0, 'Hacker News': 1.15, 'Job fair': 1.4, 'Other': 0.9 };
  const DEFAULT_POOL = { 'LinkedIn': 180, 'LinkedIn Easy Apply': 320, 'Indeed': 250, 'Company site': 120, 'Referral': 60, 'Recruiter outreach': 25, 'Glassdoor': 200, 'Wellfound': 90, 'Hacker News': 70, 'Job fair': 40, 'Other': 150 };
  const normCdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

  function probability(score, job, reqs, knockouts) {
    if (score == null) return null;
    let p = 0.45 / (1 + Math.exp(-(score - 82) / 6));
    const notes = [];
    let sf = SOURCE_FACTOR[job.source] ?? 0.9;
    if (job.referral) sf = Math.max(sf, 3.2);
    if (sf !== 1) notes.push(`${job.referral ? 'Referral' : job.source || 'Source'} ×${sf.toFixed(2)}`);
    p *= sf;
    const apps = job.applicants ?? (reqs && reqs.applicants ? reqs.applicants.n : null);
    if (apps != null) {
      const af = apps < 25 ? 1.35 : apps < 50 ? 1.15 : apps < 100 ? 1.0 : apps < 200 ? 0.8 : apps < 500 ? 0.65 : 0.5;
      if (af !== 1) notes.push(`${apps}${apps >= 100 ? '+' : ''} applicants ×${af.toFixed(2)}`);
      p *= af;
    }
    const posted = job.postedDate && job.appliedDate ? CB.daysBetween(job.postedDate, job.appliedDate) : reqs && reqs.postedDaysAgo && !job.appliedDate ? reqs.postedDaysAgo.days : null;
    if (posted != null) {
      const tf = posted <= 2 ? 1.25 : posted <= 7 ? 1.05 : posted <= 21 ? 0.9 : posted <= 45 ? 0.7 : 0.55;
      if (tf !== 1) notes.push(`applied ${posted}d after posting ×${tf.toFixed(2)}`);
      p *= tf;
    }
    if (reqs && reqs.postedDaysAgo && reqs.postedDaysAgo.reposted) { p *= 0.85; notes.push('reposted ×0.85'); }
    if (knockouts.length) { p = Math.min(p, 0.004); notes.push('knockout caps chance at 0.4%'); }
    p = CB.clamp(p, 0.001, 0.8);
    return { p, notes };
  }

  function score(job, profile, settings = {}) {
    const st = STRICT[settings.strictness] || STRICT.brutal;
    const base = { score: null, verdict: 'NO_DATA', verdictLabel: '', probability: null, knockouts: [], components: [], skills: { required: [], preferred: [] }, keywords: { matched: [], missing: [] }, rank: null, fixes: [], yearsRequired: null, yearsCandidate: null, reqs: null, probabilityNotes: [] };
    if (!profile) return { ...base, verdict: 'NO_RESUME', verdictLabel: 'Upload a resume to score' };
    if (!job || (!String(job.jd || '').trim() && !job.jdAI)) return { ...base, verdict: 'NO_JD', verdictLabel: 'Paste the job description to score' };
    const reqs = parseJD(job.jd, job.jdAI);
    const knock = [];
    const ko = (code, detail) => knock.push({ code, label: DISPOSITION[code], detail });

    // 1 — required & preferred skills
    const mapSkill = (s) => ({ name: s.name, kind: s.kind, weight: s.weight, jdCount: s.count, alt: s.alt || null, ...skillStatus(s.name, profile, st) });
    const reqSkills = reqs.skills.filter((s) => s.required).map(mapSkill);
    const prefSkills = reqs.skills.filter((s) => !s.required).map(mapSkill);
    // Requirements listed as alternatives ("Go or Python") count once, satisfied by the best member.
    const unitize = (arr) => {
      const m = new Map();
      arr.forEach((x) => { const k = x.alt ? 'a' + x.alt : 's' + x.name; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
      return [...m.values()].map((ms) => {
        const best = ms.reduce((a, b) => (b.credit > a.credit ? b : a));
        if (ms.length > 1 && best.credit >= 0.5) ms.forEach((x) => { if (x !== best && x.credit < best.credit) { x.status = 'alternative'; x.via = best.name; } });
        return { members: ms, best, name: ms.map((x) => x.name).join(' or '), weight: Math.max(...ms.map((x) => x.weight)), credit: best.credit, kind: ms.every((x) => x.kind === 'soft') ? 'soft' : 'hard', status: best.status, jdCount: Math.max(...ms.map((x) => x.jdCount)), via: best.via };
      });
    };
    const reqUnits = unitize(reqSkills), prefUnits = unitize(prefSkills);
    const cov = (arr) => { const W = arr.reduce((a, s) => a + s.weight, 0); return W ? arr.reduce((a, s) => a + s.weight * s.credit, 0) / W : null; };
    const reqCov = cov(reqUnits);
    const prefCov = cov(prefUnits);
    const hardReq = reqUnits.filter((s) => s.kind !== 'soft');
    const hardMet = hardReq.filter((s) => s.credit >= 0.5).length;

    // 2 — years
    const candYears = settings.yearsOverride != null && settings.yearsOverride !== '' ? +settings.yearsOverride : profile.totalYears;
    const jdLevelTitle = levelFromTitle(job.title);
    const seniorityField = CB.SENIORITY.find((s) => s.label === job.seniority);
    const jdLevel = seniorityField ? seniorityField.level : jdLevelTitle ?? levelFromYears(reqs.minYears) ?? 2;
    const impliedYears = { 0: 0, 1: 0, 2: 2, 3: 5, 4: 8, 5: 10, 6: 6, 7: 10, 8: 12 }[jdLevel];
    const reqYears = reqs.minYears ?? null;
    const targetYears = reqYears ?? impliedYears;
    let expScore, expDetail;
    if (!targetYears) { expScore = 100; expDetail = `No minimum stated · you have ${candYears} yrs`; }
    else {
      const r = candYears / targetYears;
      expScore = r >= 1 ? 100 : Math.round(100 * Math.pow(Math.max(r, 0), 1.6));
      if (jdLevel <= 1 && candYears > Math.max(5, targetYears * 2.5)) { expScore = 75; }
      expDetail = `${reqYears != null ? 'Requires' : 'Level implies'} ${targetYears}+ yrs · resume shows ${candYears}${expScore === 75 ? ' (overqualified for a junior role)' : ''}`;
    }
    if (reqYears && reqYears >= 2 && (candYears < reqYears * st.koYoeRatio || (reqYears >= 5 && reqYears - candYears >= st.koYoeAbs))) ko('DQ-YOE', `Posting requires ${reqYears}+ years; your resume shows ${candYears}. ATS knockout questions auto-reject below the minimum.`);

    // 3 — title & seniority
    const jf = roleFamilyOf(job.title);
    let famScore = 50, famDetail = 'Role family unclear';
    if (jf) {
      if (profile.families.includes(jf.key)) { famScore = 100; famDetail = `Same role family (${jf.label})`; }
      else if (profile.families.some((k) => (jf.adjacent || []).includes(k))) {
        const generic = profile.families.includes('swe') && (jf.adjacent || []).includes('swe');
        famScore = generic ? 85 : 65; famDetail = generic ? `Related software role (${jf.label})` : `Adjacent role family (${jf.label})`;
      }
      else if (profile.families.length) {
        const jt = new Set(T().normalize(job.title).split(' ').map(stem));
        const ct = new Set(T().normalize(profile.titles.join(' ')).split(' ').map(stem));
        const inter = [...jt].filter((x) => ct.has(x) && x.length > 2).length;
        famScore = Math.round(25 + 50 * (inter / Math.max(jt.size, 1)));
        famDetail = `Different role family — posting is ${jf.label}`;
      }
    }
    const candLevel = profile.level;
    let diff = jdLevel - candLevel;
    if (jdLevel >= 6 && candLevel >= 4 && candLevel < 6) diff = Math.max(0, diff - 2);
    if (candLevel >= 6 && jdLevel >= 3 && jdLevel < 6) diff = Math.min(0, diff + 2);
    let senScore = diff <= 0 ? (candLevel - jdLevel >= 3 ? 60 : 100) : diff === 1 ? 70 : diff === 2 ? 35 : 10;
    if (diff >= 3) ko('DQ-SEN', `Posting is ${levelLabel(jdLevel)}; your resume reads as ${levelLabel(candLevel)}. A ${diff}-level jump is screened out.`);
    const titleScore = Math.round(famScore * 0.65 + senScore * 0.35);

    // 4 — education
    const dq = reqs.degree;
    const candDeg = settings.degreeOverride ? +settings.degreeOverride : profile.education.level;
    let eduScore = 100, eduDetail = 'No degree requirement';
    if (dq.required && dq.level) {
      const gap = dq.level - candDeg;
      if (gap <= 0) { eduScore = 100; eduDetail = `Requires ${dq.label} · you have ${profile.education.label}`; }
      else if (dq.equivalentOk) { eduScore = gap === 1 ? 72 : 50; eduDetail = `Requires ${dq.label} or equivalent experience · you have ${profile.education.label}`; }
      else {
        eduScore = gap === 1 ? 25 : 5;
        eduDetail = `Requires ${dq.label} · you have ${profile.education.label}`;
        if (gap >= st.koDegreeGap) ko('DQ-DEG', `Posting requires a ${dq.label} with no equivalent-experience clause; your resume shows ${profile.education.label}.`);
      }
    } else if (dq.preferredLevel && candDeg < dq.preferredLevel) { eduScore = 85; eduDetail = `${dq.preferredLabel} preferred · you have ${profile.education.label}`; }

    // 5 — domain keywords
    const kwMatched = [], kwMissing = [];
    for (const k of reqs.keywords) {
      const parts = k.split(' ').map(stem);
      (parts.every((p) => profile.stems.has(p)) ? kwMatched : kwMissing).push(k);
    }
    const kwScore = reqs.keywords.length ? Math.round((kwMatched.length / reqs.keywords.length) * 100) : null;

    // 6 — resume quality
    const audit = auditResume(profile, settings.resumeWarnings || []);
    const qScore = audit.score;

    // 7 — logistics: work mode, location, sponsorship, clearance, certs, languages
    let logScore = 100;
    const logNotes = [];
    if (settings.needsSponsorship && (reqs.sponsorship === 'no' || reqs.citizenship)) { ko('DQ-AUTH', reqs.citizenship ? 'Posting requires U.S. citizenship.' : 'Posting will not sponsor visas and you need sponsorship.'); logScore = 0; logNotes.push('Sponsorship'); }
    if (reqs.clearance.required && !settings.hasClearance) { ko('DQ-CLR', `Requires ${reqs.clearance.level || 'an active clearance'}; your settings say you don't hold one.`); logScore = 0; logNotes.push('Clearance'); }
    const missingCerts = reqs.certsRequired.filter((c) => !profile.skills.has(c));
    if (missingCerts.length) { ko('DQ-CERT', `Required: ${missingCerts.join(', ')}. Not found on your resume.`); logScore = Math.min(logScore, 20); }
    const missingLang = reqs.languagesRequired.filter((c) => !profile.skills.has(c));
    if (missingLang.length) { ko('DQ-LANG', `Requires ${missingLang.join(', ')}.`); logScore = Math.min(logScore, 30); }
    const mode = job.workMode || reqs.workMode;
    if (settings.remoteOnly && mode && mode !== 'Remote') { logScore = Math.min(logScore, 30); logNotes.push(`${mode} role, you want remote`); }
    if (mode && mode !== 'Remote' && settings.homeLocation && job.location && !settings.willingToRelocate) {
      const home = settings.homeLocation.toLowerCase().split(/[,·]/)[0].trim();
      const loc = job.location.toLowerCase();
      if (home && !loc.includes(home) && !/remote/.test(loc)) {
        logScore = Math.min(logScore, 40); logNotes.push(`${mode} in ${job.location}`);
        if (st.koLocation) ko('DQ-LOC', `${mode} role in ${job.location}; you're in ${settings.homeLocation} and not relocating.`);
      }
    }

    // Weighted total (weights redistribute when a component has no data)
    const comps = [
      { key: 'req', label: 'Must-have skills', weight: 0.36, score: reqCov == null ? null : Math.round(reqCov * 100), detail: reqCov == null ? 'No skills detected in posting' : `${hardMet} of ${hardReq.length} hard requirements met` },
      { key: 'pref', label: 'Nice-to-have skills', weight: 0.08, score: prefCov == null ? null : Math.round(prefCov * 100), detail: prefCov == null ? 'None listed' : `${prefUnits.filter((s) => s.credit >= 0.5).length} of ${prefUnits.length} matched` },
      { key: 'exp', label: 'Experience', weight: 0.16, score: expScore, detail: expDetail },
      { key: 'title', label: 'Title & seniority', weight: 0.12, score: titleScore, detail: `${famDetail} · ${levelLabel(jdLevel)} role vs. your ${levelLabel(candLevel)}` },
      { key: 'edu', label: 'Education', weight: 0.07, score: eduScore, detail: eduDetail },
      { key: 'kw', label: 'Domain keywords', weight: 0.1, score: kwScore, detail: kwScore == null ? 'Too few repeated terms' : `${kwMatched.length} of ${reqs.keywords.length} repeated posting terms` },
      { key: 'quality', label: 'Resume quality', weight: 0.06, score: qScore, detail: `Grade ${audit.grade} · ${audit.fails} fails, ${audit.warns} warnings` },
      { key: 'logistics', label: 'Logistics', weight: 0.05, score: logScore, detail: logNotes.length ? logNotes.join(' · ') : 'Location, authorization and credentials clear' },
    ];
    const live = comps.filter((c) => c.score != null);
    const W = live.reduce((a, c) => a + c.weight, 0);
    let raw = live.reduce((a, c) => a + c.weight * c.score, 0) / W;
    const topMissing = hardReq.filter((s) => s.status === 'missing' && s.weight >= 0.9);
    const gapPen = Math.min(st.gapCap, topMissing.length * st.gapPenalty);
    raw = Math.max(0, raw - gapPen);
    let final = Math.round(100 * Math.pow(raw / 100, st.curve));
    if (reqCov != null && hardReq.length >= 3 && reqCov < st.koMQ) ko('DQ-MQ', `Only ${hardMet} of ${hardReq.length} must-have skills found (${Math.round(reqCov * 100)}% weighted coverage; screen cutoff ${Math.round(st.koMQ * 100)}%).`);
    if (knock.length) final = Math.min(final, 49);
    if (final < st.floor && !knock.length) ko('DQ-SCORE', `Fit score ${final} is under the ${st.floor} cutoff a recruiter screen uses to rank this applicant pool.`);
    let verdict = knock.length ? 'REJECTED' : final >= st.strong ? 'STRONG' : final >= st.competitive ? 'COMPETITIVE' : 'LONG_SHOT';
    const verdictLabel = { REJECTED: 'Auto-rejected', STRONG: 'Shortlist', COMPETITIVE: 'Advance to review', LONG_SHOT: 'Long shot' }[verdict];

    const pr = probability(final, job, reqs, knock);
    let prob = pr.p;
    if (job.maxStage >= 4) prob = 1;
    else if (job.maxStage >= 2) prob = Math.max(prob, 0.45);

    // Rank in the applicant pool (pool scores modeled ~ N(57, 13))
    const pool = job.applicants ?? (reqs.applicants ? reqs.applicants.n : DEFAULT_POOL[job.source] ?? 150);
    const pct = normCdf((final - 57) / 13);
    const rank = { pool, percentile: Math.round(pct * 100), position: Math.max(1, Math.round(pool * (1 - pct)) + 1), estimatedPool: job.applicants == null && !reqs.applicants };

    // Fix list
    const fixes = [];
    const F = (priority, text) => fixes.push({ priority, text });
    knock.forEach((k) => {
      const tip = {
        'DQ-AUTH': 'This is a hard legal knockout. Skip unless your status changes; a referral cannot override it.',
        'DQ-CLR': 'Cleared roles only hire people who already hold the clearance. Skip.',
        'DQ-YOE': 'Check every role has "Mon YYYY – Mon YYYY" dates (internships, contract and freelance count). If you truly lack the years, apply only through a referral.',
        'DQ-DEG': 'No equivalent-experience clause means the knockout question filters you. Use a referral, or skip.',
        'DQ-CERT': 'Add the credential if you hold it (exact official name). Otherwise this posting is a no.',
        'DQ-LANG': 'List languages with proficiency (e.g. "Spanish — professional working").',
        'DQ-SEN': 'Target one level up at most. Look for the same title at your current level.',
        'DQ-LOC': 'Either mark yourself open to relocation in Settings, or skip on-site roles outside your area.',
        'DQ-MQ': 'Tailor before applying: the missing must-haves below are what the recruiter filters on.',
        'DQ-SCORE': 'You would be ranked below the cutoff. Tailor the resume using the fixes below or route through a referral.',
      }[k.code];
      F(1, `${k.code} · ${k.label}: ${tip}`);
    });
    topMissing.slice(0, 6).forEach((s) => F(1, `Missing must-have "${s.name}" (in the posting ${s.jdCount}×). If you've used it, add a bullet under your most recent role showing scope and outcome.`));
    hardReq.filter((s) => s.status === 'transferable').slice(0, 3).forEach((s) => F(2, `You have ${s.via}, not ${s.name}. Name the overlap explicitly ("${s.via} — similar to ${s.name}") so keyword search and the recruiter both see it.`));
    hardReq.filter((s) => s.status === 'listed').slice(0, 4).forEach((s) => F(2, `"${s.name}" is only in your skills list. Put it in an experience bullet; listed-only skills earn ${Math.round(st.listedCredit * 100)}% credit.`));
    if (expScore < 100 && targetYears) F(2, `${expDetail}. Make sure all relevant roles are dated so the ATS counts them.`);
    if (famScore < 65 && jf) F(2, `Your titles read as a different role family than ${jf.label}. If accurate, mirror "${job.title}" in your headline and summary.`);
    if (kwMissing.length) F(3, `Repeated posting terms not on your resume: ${kwMissing.slice(0, 6).join(', ')}.`);
    audit.checks.filter((c) => c.status === 'fail').slice(0, 3).forEach((c) => F(3, `Resume: ${c.label} — ${c.detail}`));

    return {
      score: final, raw: Math.round(raw), verdict, verdictLabel, probability: prob, probabilityNotes: pr.notes,
      knockouts: knock, components: comps, skills: { required: reqSkills, preferred: prefSkills },
      keywords: { matched: kwMatched, missing: kwMissing }, rank, fixes: fixes.slice(0, 12),
      yearsRequired: reqYears, yearsCandidate: candYears, jdLevel, candLevel, roleFamily: jf ? jf.label : '', reqs, audit,
      strictness: st.label, thresholds: { floor: st.floor, competitive: st.competitive, strong: st.strong },
    };
  }

  // ─────────────────────────── JD highlighter ───────────────────────────
  /** HTML of the JD with must-haves highlighted by status (matched / listed / transferable / missing). */
  function highlight(jdText, result) {
    const text = String(jdText || '');
    if (!result || !result.skills) return CB.esc(text);
    const status = new Map();
    [...result.skills.required, ...result.skills.preferred].forEach((s) => status.set(s.name, s.status));
    const ranges = [];
    for (const [name, stt] of status) {
      const sk = T().byName.get(name);
      const aliases = sk ? [sk.name, ...sk.aliases] : [name];
      for (let a of aliases) {
        const cs = a.startsWith('=');
        if (cs) a = a.slice(1);
        const pat = a.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\-/]+/g, '[\\s\\-/]+');
        if (!pat) continue;
        const re = new RegExp('(^|[^A-Za-z0-9+#])(' + pat + ')(?=[^A-Za-z0-9+#]|$)', cs ? 'g' : 'gi');
        let m;
        while ((m = re.exec(text))) {
          const s = m.index + m[1].length;
          ranges.push([s, s + m[2].length, stt, name]);
          if (re.lastIndex === m.index) re.lastIndex++;
        }
      }
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let out = '', pos = 0;
    for (const r of ranges) {
      if (r[0] < pos) continue;
      out += CB.esc(text.slice(pos, r[0]));
      out += `<mark class="hl hl-${r[2]}" title="${CB.esc(r[3])} · ${r[2]}">${CB.esc(text.slice(r[0], r[1]))}</mark>`;
      pos = r[1];
    }
    out += CB.esc(text.slice(pos));
    return out;
  }

  // ─────────────────────────── email classifier (auto-tracker) ───────────────────────────
  const EMAIL_RULES = [
    ['offer', 3, /(pleased|happy|excited|delighted) to (extend|offer)|offer letter|formal offer|compensation package|we('d| would) like to offer|verbal offer|offer of employment/i],
    ['rejection', 3, /(unfortunately|regret to inform|not (be )?moving forward|decided (not )?to (move|proceed|pursue) (forward )?with other|will not be moving|won'?t be moving|not selected|position has been filled|no longer (under consideration|being considered)|decided to go (in|with) a different|pursue other candidates|other candidates whose|not a (fit|match) at this time|after careful (consideration|review))/i],
    ['assessment', 2.5, /(assessment|coding (challenge|test|exercise)|take[- ]home|hackerrank|codesignal|codility|coderpad|testgorilla|hirevue|online (test|assessment)|technical exercise|skills test|work sample|case study)/i],
    ['interview', 2.4, /(schedule (a|an|your)|interview|availability|available times|calendly|goodtime|book a time|next (round|steps?)|phone screen|video call|zoom|google meet|teams meeting|speak with|chat with|meet with|onsite|on-site|panel)/i],
    ['received', 2, /(thank you for (applying|your application|your interest)|received your application|application (has been )?(received|submitted)|we have received|successfully applied|application confirmation|we('ll| will) review your (application|resume))/i],
    ['recruiter', 1.2, /(came across your profile|reaching out|opportunity (that|which) might|would you be (open|interested)|are you open to|i'?m a recruiter|talent (partner|acquisition))/i],
  ];
  function classifyEmail(text, jobs) {
    const t = String(text || '');
    const scores = {};
    const evidence = [];
    for (const [type, w, re] of EMAIL_RULES) {
      const m = t.match(new RegExp(re.source, 'gi'));
      if (m) { scores[type] = (scores[type] || 0) + w + 0.3 * (m.length - 1); evidence.push(...m.slice(0, 2).map((x) => ({ type, text: x }))); }
    }
    // rejection language dominates polite boilerplate ("thank you for applying... unfortunately")
    if (scores.rejection && scores.received) scores.received *= 0.3;
    if (scores.rejection && scores.interview) scores.interview *= 0.4;
    if (scores.offer && scores.interview) scores.interview *= 0.5;
    if (scores.assessment && scores.interview) scores.interview *= 0.7;
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const type = ranked.length ? ranked[0][0] : 'unknown';
    const conf = ranked.length ? CB.clamp(ranked[0][1] / (ranked[0][1] + (ranked[1] ? ranked[1][1] : 0.8)), 0.3, 0.98) : 0;
    // Match a tracked job by company name (longest match), then title.
    let match = null, best = 0;
    const low = t.toLowerCase();
    for (const j of jobs || []) {
      if (!j.company) continue;
      const c = j.company.toLowerCase().replace(/,? (inc|llc|ltd|corp|co)\.?$/, '').trim();
      if (c.length < 2) continue;
      const re = new RegExp('(^|[^a-z0-9])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
      if (re.test(low)) {
        let s = c.length;
        if (j.title && low.includes(j.title.toLowerCase())) s += 50;
        else if (j.title) { const tw = j.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3); s += 5 * tw.filter((w) => low.includes(w)).length; }
        if (!CB.CLOSED.includes(j.status)) s += 3;
        if (s > best) { best = s; match = j; }
      }
    }
    let company = match ? match.company : '';
    if (!company) {
      const m = t.match(/(?:interest in|applying (?:to|for|at)|position at|role at|team at|join|from the|here at|with)\s+([A-Z][A-Za-z0-9&.\-]+(?: [A-Z][A-Za-z0-9&.\-]+){0,3})/);
      const from = t.match(/^from:.*?@([a-z0-9\-]+)\./im);
      if (m) company = m[1].replace(/\b(Team|Talent|Recruiting|Careers|Inc|LLC)\b.*$/, '').trim();
      else if (from && !/(greenhouse|lever|workday|myworkday|icims|smartrecruiters|ashby|jobvite|gmail|outlook|yahoo|linkedin|indeed|noreply|no-reply)/i.test(from[1])) company = from[1].replace(/\b\w/g, (c) => c.toUpperCase());
    }
    let title = '';
    const tm = t.match(/(?:for the|for our|the)\s+([A-Z][A-Za-z/&\-,. ]{3,60}?)\s+(?:position|role|opening|opportunity)/);
    if (tm) title = tm[1].trim();
    // Interview date/time
    let datetime = '';
    const dm = t.match(/(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:\s*(?:at|@|,|from)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.))?/i);
    if (dm && (type === 'interview' || type === 'assessment')) {
      const now = new Date();
      let y = dm[3] ? +dm[3] : now.getFullYear();
      const mo = MONTHS[dm[1].toLowerCase().slice(0, 3)];
      if (!dm[3] && new Date(y, mo, +dm[2]) < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) y++;
      let h = dm[4] ? +dm[4] : 9; const mi = dm[5] ? +dm[5] : 0;
      if (dm[6] && /p/i.test(dm[6]) && h < 12) h += 12;
      if (dm[6] && /a/i.test(dm[6]) && h === 12) h = 0;
      datetime = `${y}-${CB.pad(mo + 1)}-${CB.pad(+dm[2])}T${CB.pad(h)}:${CB.pad(mi)}`;
    }
    const toStage = { offer: 'offer', rejection: 'rejected', assessment: 'assessment', interview: null, received: 'applied', recruiter: 'saved' }[type];
    let stage = toStage;
    if (type === 'interview') {
      const cur = match ? CB.STAGE[match.status].order : 1;
      stage = /(final|onsite|on-site|panel|last round|executive)/i.test(t) ? 'final' : /(recruiter|phone screen|intro(ductory)? call|initial (call|conversation|chat)|quick call)/i.test(t) && cur < 2 ? 'screen' : cur >= 4 ? (cur >= 5 ? 'final' : 'interview') : cur < 2 ? 'screen' : 'interview';
    }
    return { type, confidence: conf, company, title, jobId: match ? match.id : null, stage, datetime, evidence: evidence.slice(0, 5), scores };
  }

  CB.ATS = { STRICT, DISPOSITION, VENDOR_TIPS, parseResume, parseJD, parseJobUrl, extractPosting, auditResume, score, highlight, classifyEmail, levelFromTitle, levelLabel, roleFamilyOf, detectDegree, extractSalary };
})();

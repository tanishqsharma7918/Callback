/* Callback — optional Claude features through the claude.ai `sample` capability.
 * Every call is user-initiated. Nothing here is required: the local ATS engine works without it. */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});
  let disabled = false;

  async function get() {
    if (disabled) return null;
    return CB.cap('sample');
  }
  const errText = (e) => {
    const c = e && e.code;
    if (c === 'not_granted' || c === 'sampling_disabled' || c === 'not_declared' || c === 'capability_disabled' || c === 'capability_removed') { disabled = true; CB.emit('ai:off'); return 'Claude is turned off for this page. The local ATS engine still works.'; }
    if (c === 'rate_limited') return e.reason === 'usage_limit' ? 'You have reached your Claude usage limit. Try again later.' : 'Too many Claude requests at once. Wait a moment and try again.';
    if (c === 'session_expired') return 'Your claude.ai session expired. Sign in again, then retry.';
    if (c === 'prompt_too_large') return 'The text is too long for one request. Trim the job description or resume.';
    if (c === 'refused') return 'Claude declined this request. Edit the text and try again.';
    if (c === 'invalid_json') return 'Claude replied in an unexpected format. Try again.';
    if (c === 'cancelled') return '';
    return 'Claude could not finish. Check your connection and try again.';
  };
  const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '\n[…truncated]' : String(s || ''));

  async function extractJob(text, url) {
    const sample = await get();
    if (!sample) throw { code: 'not_granted' };
    const prompt = `You are an applicant tracking system's job-posting parser. Extract structured data from the job posting below (it may be copied from LinkedIn and include page chrome — ignore UI text like "Easy Apply", "Show more", "Meet the hiring team").

Reply with ONLY one JSON object with exactly these keys:
{"title": string, "company": string, "location": string, "workMode": "Remote"|"Hybrid"|"On-site"|"", "employmentType": "Full-time"|"Part-time"|"Contract"|"Internship"|"Temporary"|"", "seniority": "Intern"|"Entry level"|"Mid level"|"Senior"|"Staff / Lead"|"Principal"|"Manager"|"Director"|"VP / Executive"|"",
"salaryMin": number|null, "salaryMax": number|null, "salaryPeriod": "year"|"hour"|"month", "applicants": number|null, "postedDaysAgo": number|null,
"requiredSkills": [string], "preferredSkills": [string], "minYears": number|null, "degreeLevel": 0|1|2|3|4|5, "degreeRequired": boolean, "equivalentExperienceOk": boolean,
"clearanceRequired": boolean, "clearanceLevel": string, "sponsorship": "no"|"yes"|"unknown", "citizenshipRequired": boolean,
"certificationsRequired": [string], "languagesRequired": [string], "keywords": [string], "redFlags": [string], "summary": string}

Rules: requiredSkills = concrete hard skills/tools the posting treats as must-haves (max 15, canonical names like "Kubernetes", "PostgreSQL", "React"); preferredSkills = nice-to-haves (max 10). minYears = the minimum years of experience required (lowest number if a range). degreeLevel: 0 none, 1 high school, 2 associate, 3 bachelor's, 4 master's, 5 doctorate — the MINIMUM required. keywords = up to 12 domain terms the posting repeats that are not tools (e.g. "payments", "reconciliation", "underwriting"). redFlags = honest concerns a job seeker should know (max 4, may be empty). summary = 2 sentences on what the job actually is.
${url ? 'Posting URL: ' + url + '\n' : ''}
POSTING:
"""
${clip(text, 30000)}
"""`;
    return sample.json(prompt, { modelTier: 'default', cache: { gcTime: 3600000 } });
  }

  async function parseResume(text) {
    const sample = await get();
    if (!sample) throw { code: 'not_granted' };
    const prompt = `Parse this resume like an ATS. Reply with ONLY JSON:
{"name": string, "headline": string, "totalYears": number, "currentTitle": string, "seniority": "Intern"|"Entry level"|"Mid level"|"Senior"|"Staff / Lead"|"Principal"|"Manager"|"Director"|"VP / Executive",
"skills": [string], "titles": [string], "degree": string, "degreeLevel": 0|1|2|3|4|5, "certifications": [string], "strengths": [string], "weaknesses": [string]}
totalYears = professional years from dated roles (merge overlaps, exclude education). strengths/weaknesses = 3 short, blunt bullets each, from a hiring manager's view.

RESUME:
"""
${clip(text, 40000)}
"""`;
    return sample.json(prompt, { modelTier: 'default', cache: { gcTime: 3600000 } });
  }

  function atsSummary(ats) {
    if (!ats || ats.score == null) return 'No local ATS score.';
    return [
      `Local ATS score ${ats.score}/100 (${ats.verdictLabel}), strictness ${ats.strictness}. Interview chance ${CB.pct(ats.probability, 1)}.`,
      ats.knockouts.length ? 'Knockouts: ' + ats.knockouts.map((k) => `${k.code} ${k.label} — ${k.detail}`).join('; ') : 'No knockouts.',
      'Components: ' + ats.components.filter((c) => c.score != null).map((c) => `${c.label} ${c.score} (${c.detail})`).join('; '),
      'Missing must-haves: ' + (ats.skills.required.filter((s) => s.status === 'missing').map((s) => s.name).join(', ') || 'none'),
      'Listed-only skills: ' + (ats.skills.required.filter((s) => s.status === 'listed').map((s) => s.name).join(', ') || 'none'),
    ].join('\n');
  }

  function review(job, resumeText, ats, opts) {
    return run(async (sample) => sample(`You are a senior technical recruiter and hiring manager doing a brutally honest 60-second screen, the way it happens in today's market (hundreds of applicants, the top ~10% get a call). No encouragement padding, no hedging. Use plain language.

Write Markdown with exactly these sections:
## Verdict
One line: ADVANCE, HOLD, or REJECT — then the single biggest reason.
## Why a recruiter would pass
3–5 bullets, specific to this resume and this posting.
## What actually matches
2–4 bullets.
## Fix before applying
5 numbered, concrete edits ordered by impact. Where useful, include a rewritten resume bullet in quotes that the candidate could truthfully use if it matches their experience — never invent experience; mark assumptions with [if true].
## Odds
One sentence with a realistic interview probability and what would change it (e.g. a referral).

Context from our deterministic ATS:
${atsSummary(ats)}

JOB: ${job.title} at ${job.company} (${job.location || 'location n/a'}, ${job.workMode || 'mode n/a'}, source ${job.source}${job.referral ? ', referral' : ''})
POSTING:
"""
${clip(job.jd, 18000)}
"""
RESUME:
"""
${clip(resumeText, 18000)}
"""`, { ...opts, cache: false }));
  }

  function coverLetter(job, resumeText, name, opts) {
    return run(async (sample) => sample(`Write a concise cover letter (220–300 words, 4 short paragraphs) for ${name || 'the candidate'} applying to "${job.title}" at ${job.company}. Ground every claim in the resume — never invent employers, numbers or skills. Open with why this role and company (use specifics from the posting), then two proof paragraphs mapping the strongest resume evidence to the posting's must-haves, then a direct close. No clichés ("I am writing to express", "passionate", "team player"). Plain text only, paragraphs separated by a blank line, no greeting line and no signature (the app adds them).

POSTING:
"""
${clip(job.jd, 14000)}
"""
RESUME:
"""
${clip(resumeText, 14000)}
"""`, { ...opts, cache: false }));
  }

  function outreach(job, resumeText, opts) {
    return run(async (sample) => sample(`Write two short messages for "${job.title}" at ${job.company}:
1) A LinkedIn connection note to the hiring manager or a team engineer, max 280 characters.
2) A follow-up email to the recruiter for an application with no reply after a week, max 90 words, with a subject line.
Specific, warm, no flattery, one concrete proof point from the resume. Plain text with the headings "LinkedIn note" and "Follow-up email".

POSTING (excerpt):
"""
${clip(job.jd, 6000)}
"""
RESUME (excerpt):
"""
${clip(resumeText, 6000)}
"""`, { ...opts, modelTier: 'quick', cache: false }));
  }

  function interviewPrep(job, resumeText, round, opts) {
    return run(async (sample) => sample(`Prepare the candidate for a ${round || 'interview'} for "${job.title}" at ${job.company}. Markdown with sections:
## Likely questions
8 questions specific to this posting (mix technical and behavioral), each with a one-line hint of what a strong answer covers.
## Your stories to use
4 STAR stories to prepare, mapped to resume evidence (name the bullet), with the metric to lead with.
## Questions to ask them
4 sharp questions that show judgment about this team's problems.
## Gaps they'll probe
The 3 weakest spots of this resume against the posting and how to answer honestly.

POSTING:
"""
${clip(job.jd, 14000)}
"""
RESUME:
"""
${clip(resumeText, 14000)}
"""`, { ...opts, cache: false }));
  }

  async function classifyEmail(text, jobs) {
    const sample = await get();
    if (!sample) throw { code: 'not_granted' };
    const list = jobs.slice(0, 80).map((j) => `${j.id} | ${j.company} | ${j.title} | ${CB.STAGE[j.status].label}`).join('\n');
    return sample.json(`Classify this job-search email. Reply with ONLY JSON:
{"type": "rejection"|"interview"|"assessment"|"offer"|"received"|"recruiter"|"other", "jobId": string|null, "company": string, "title": string, "stage": "saved"|"applied"|"screen"|"assessment"|"interview"|"final"|"offer"|"rejected"|null, "datetime": "YYYY-MM-DDTHH:mm"|"", "summary": string}
jobId must be one of the ids below when the email clearly refers to that application, else null. stage = what the application's status should become. datetime = a proposed or confirmed interview time if stated (assume the next occurrence; today is ${CB.todayISO()}).

TRACKED APPLICATIONS (id | company | title | status):
${list}

EMAIL:
"""
${clip(text, 12000)}
"""`, { modelTier: 'quick', cache: false });
  }

  async function run(fn) {
    const sample = await get();
    if (!sample) throw { code: 'not_granted', message: 'Claude is not available on this page.' };
    return fn(sample);
  }

  /** Minimal, safe Markdown → HTML for Claude's answers (escapes everything first). */
  function md(src) {
    const lines = CB.esc(src || '').split('\n');
    let html = '', list = null;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const l of lines) {
      let m;
      if ((m = /^#{1,3}\s+(.*)$/.exec(l))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
      else if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
      else if (!l.trim()) { close(); }
      else { close(); html += `<p>${inline(l)}</p>`; }
    }
    close();
    return html;
  }

  CB.AI = { get, errText, extractJob, parseResume, review, coverLetter, outreach, interviewPrep, classifyEmail, md, isOff: () => disabled };
})();

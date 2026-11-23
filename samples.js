/* Callback — clearly-marked example data (sample: true). Fictional companies and people.
 * Dates are generated relative to today so the dashboard looks alive. */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});

  const RESUME = `Alex Rivera (Example)
Seattle, WA · alex.rivera@example.com · (206) 555-0142 · linkedin.com/in/alex-rivera-example · github.com/alex-rivera-example

SUMMARY
Backend-leaning software engineer with 6 years building payment, data and platform services in Python and Go on AWS. Shipped systems that handle 40M requests a day. Results-driven team player.

EXPERIENCE
Senior Software Engineer — Copperline Payments, Seattle, WA
Mar 2023 – Present
• Led the redesign of the ledger service in Go and PostgreSQL, cutting reconciliation time from 6 hours to 25 minutes across 40M daily transactions.
• Built an event-driven settlement pipeline on Kafka and AWS (ECS, SQS, Lambda) that processes $1.2B per month at 99.99% availability.
• Introduced Terraform modules and GitHub Actions CI/CD for 14 services, reducing deploy time by 70%.
• Mentored 4 engineers and ran the on-call rotation; cut P1 incidents by 45% with Datadog SLO alerts.
• Responsible for code reviews and design documentation across the payments org.

Software Engineer — Trellis Health, Remote
Jun 2020 – Feb 2023
• Developed REST APIs in Python (Django, FastAPI) serving 1.5M patients with HIPAA-compliant audit logging.
• Migrated a monolith to Docker and Kubernetes, moving deployment frequency from weekly to daily.
• Designed PostgreSQL schemas and Redis caching that lowered p95 latency from 820ms to 140ms.
• Built internal React and TypeScript dashboards used by 300 clinicians.
• Helped with data pipelines in Airflow.

Software Engineer Intern — Bluefin Analytics, Portland, OR
Jun 2019 – Aug 2019
• Built a Python ETL job that loaded 2M rows a day into Redshift.

EDUCATION
B.S. in Computer Science — University of Washington, 2020

SKILLS
Languages: Python, Go, TypeScript, JavaScript, SQL, Java
Backend: Django, FastAPI, gRPC, REST APIs, microservices, Kafka, Redis
Cloud & DevOps: AWS, Docker, Kubernetes, Terraform, GitHub Actions, Datadog, Linux
Data: PostgreSQL, Redshift, Airflow, Snowflake, Spark
Frontend: React, TypeScript`;

  const JD = {
    payments: `About the job
{C} moves money for 40,000 businesses. Our Payments Platform team owns the ledger, payouts and reconciliation systems that process billions of dollars a year.

What you'll do
- Design, build and operate high-throughput backend services in Go and Python
- Own the reliability of payment flows end to end, including on-call
- Evolve our event-driven architecture on Kafka and AWS
- Partner with product, risk and finance stakeholders to launch new payment methods

What you'll need
- 5+ years of professional software engineering experience
- Strong experience with Go or Python in production
- Deep knowledge of PostgreSQL and data modeling for financial systems
- Experience building distributed systems and microservices on AWS
- Experience with Kafka or similar message brokers
- Familiarity with Kubernetes, Docker and Terraform
- Bachelor's degree in Computer Science or equivalent practical experience

Nice to have
- Payments, ledger or reconciliation experience
- Experience with gRPC
- Exposure to PCI DSS compliance

Compensation: $185,000 - $235,000 plus equity. Hybrid, 2 days a week in office.`,
    paymentsJava: `About the job
{C} is rebuilding its core banking platform. You'll join the Accounts team building services that hold customer balances for 3 million members.

Responsibilities
- Build and maintain Java and Spring Boot microservices on AWS
- Improve reliability, observability and latency of the ledger and transfers systems
- Work with product managers and compliance stakeholders on regulated features

Minimum qualifications
- 5+ years of backend software engineering experience
- Strong Java and Spring Boot experience
- Experience with PostgreSQL or Oracle and data modeling
- Experience with Kafka and event-driven architecture
- Experience with AWS, Docker and Kubernetes
- Bachelor's degree in Computer Science, Engineering or equivalent experience

Preferred qualifications
- Experience in banking or payments
- Kotlin
- SOX compliance experience

The salary range for this role is $170,000 - $210,000.`,
    staff: `About the job
{C} runs the compute platform behind 600 engineers and 4,000 production services.

Responsibilities
- Set technical direction for our multi-region Kubernetes platform
- Lead multi-quarter initiatives across infrastructure and product teams
- Mentor senior engineers and raise the engineering bar

Minimum qualifications
- 10+ years of software engineering experience, including 3+ years as a technical lead
- Expert in Go or Rust
- Deep expertise in Kubernetes internals, Terraform and multi-region AWS or Google Cloud
- Experience with service mesh technologies such as Istio and Envoy
- Track record of leading cross-functional initiatives

Preferred qualifications
- Contributions to CNCF projects
- Experience with eBPF

$240,000 – $310,000 base salary.`,
    fullstack: `About the job
{C} builds scheduling and billing software used by 9,000 independent clinics.

What you'll do
- Ship features end to end across our React and TypeScript frontend and Python and Node.js backend
- Work directly with customers and designers to shape the product
- Improve performance, testing and developer experience

What we're looking for
- 3+ years of experience building web applications
- Strong proficiency in React and TypeScript
- Experience with Node.js or Python backends and REST APIs
- Solid understanding of PostgreSQL
- Experience with AWS
- Excellent communication skills

Nice to have
- Next.js and GraphQL
- Experience with Playwright or Cypress testing

Salary: $150,000–$185,000. Hybrid in Seattle, WA (2 days a week).`,
    ml: `About the job
{C} is building the inference and evaluation platform for our foundation models.

What you'll do
- Build and operate our LLM serving and evaluation platform
- Fine-tune and evaluate models and build retrieval-augmented generation (RAG) pipelines
- Partner with research to move models from notebook to production

Requirements
- 4+ years of experience in machine learning engineering
- Strong Python and PyTorch
- Experience deploying LLMs to production, RAG and vector databases such as Pinecone or pgvector
- MLOps experience with MLflow, Kubeflow or similar, on Kubernetes
- Master's degree or PhD in Computer Science, Machine Learning or a related field

Preferred
- Publications at NeurIPS or ICML
- CUDA programming experience

Over 200 applicants. $210,000 - $280,000.`,
    defense: `About the job
{C} builds mission software for national security customers.

Requirements
- Active TS/SCI clearance with polygraph is required
- U.S. citizenship required
- 3+ years of experience with Java or C++
- Experience with Linux and embedded systems
- Bachelor's degree in Computer Science, Computer Engineering or a related field

This position is on-site in Huntsville, AL.`,
    data: `About the job
{C} helps 2,000 retailers forecast demand.

Responsibilities
- Build batch and streaming pipelines with Spark, Airflow and dbt
- Model data in Snowflake for analytics and machine learning
- Own data quality and pipeline observability

Qualifications
- 4+ years of experience in data engineering
- Expert SQL and Python
- Hands-on experience with Spark, Airflow and dbt
- Experience with Snowflake or BigQuery
- Experience with Kafka streaming
- Strong understanding of data modeling and data quality

Nice to have
- Databricks or Flink
- Experience with Looker or Tableau

$160,000 - $195,000. Remote (US).`,
    em: `About the job
{C} is hiring an Engineering Manager for the Checkout team (7 engineers).

What you'll do
- Hire, coach and grow a team of backend and frontend engineers
- Own delivery, quality and on-call health for checkout
- Partner with product and design on the roadmap

Requirements
- 8+ years of software engineering experience, including 3+ years managing engineering teams
- Experience with hiring, coaching and performance management
- Strong background in distributed systems and AWS
- Excellent stakeholder management and communication
- Experience running Agile and Scrum teams

$220,000 - $260,000.`,
    frontend: `About the job
{C} makes collaborative whiteboards for 2 million teams.

What you'll need
- 4+ years of frontend engineering experience
- Expert in React, TypeScript and Next.js
- Strong CSS skills, including Tailwind CSS
- Experience building design systems and accessible UI (WCAG 2.1)
- Experience with Jest and Playwright
- Familiarity with GraphQL

Nice to have
- Figma and Storybook
- Web performance optimization

Over 500 applicants. $140,000 – $175,000. Remote.`,
    sre: `About the job
{C} protects 30,000 companies from account takeover.

What you'll do
- Keep our detection platform fast and available (99.99% SLO)
- Automate infrastructure with Terraform and Kubernetes
- Lead incident response and blameless postmortems

What you'll need
- 5+ years in SRE, DevOps or infrastructure engineering
- Strong Linux and networking fundamentals
- Production Kubernetes and Terraform experience
- Observability with Prometheus, Grafana, Datadog or OpenTelemetry
- Scripting in Python or Go
- Incident response and on-call experience

Preferred
- CKA certification
- Experience with Istio

$175,000 - $215,000. Remote within the US.`,
    health: `About the job
{C} connects 400 hospitals to their patients.

Requirements
- 3+ years of backend development in Python (Django or FastAPI)
- PostgreSQL and Redis
- AWS (ECS, Lambda, S3)
- Experience with HIPAA-regulated systems
- Strong communication skills

Nice to have
- HL7 or FHIR
- React

$145,000 - $180,000. Hybrid in Seattle, WA.`,
  };

  // [company, title, jdKey, status, appliedDaysAgo, source, applicants, salaryMin, salaryMax, workMode, location, extras]
  const ROWS = [
    ['Northwind Payments', 'Senior Backend Engineer, Payments', 'payments', 'interview', 18, 'Referral', 140, 185000, 235000, 'Hybrid', 'Seattle, WA', { referral: true, referrerName: 'Priya Natarajan', priority: 'High', excitement: 5, path: ['screen', 'interview'], ivs: [['Recruiter screen', -14, 'Passed', 'Dana Ortiz (Recruiter)'], ['Technical screen', -7, 'Passed', 'Marcus Lee'], ['System design', 2, 'Scheduled', 'Elena Park, Staff Engineer']] }],
    ['Helio Health', 'Backend Engineer, Platform', 'health', 'final', 26, 'Company site', 60, 145000, 180000, 'Hybrid', 'Seattle, WA', { priority: 'High', excitement: 4, path: ['screen', 'assessment', 'interview', 'final'], ivs: [['Recruiter screen', -21, 'Passed', 'Sam Whitaker'], ['Take-home review', -13, 'Passed', 'Ines Duarte'], ['Hiring manager', -8, 'Passed', 'Ravi Kumar'], ['Panel / Onsite', 5, 'Scheduled', '4 interviewers']] }],
    ['Quarry Data', 'Data Engineer', 'data', 'assessment', 11, 'LinkedIn', 210, 160000, 195000, 'Remote', 'Remote (US)', { excitement: 3, path: ['screen', 'assessment'], ivs: [['Recruiter screen', -6, 'Passed', 'Lena Fischer']] }],
    ['Fernway', 'Full Stack Engineer', 'fullstack', 'offer', 34, 'Recruiter outreach', 35, 150000, 185000, 'Hybrid', 'Seattle, WA', { priority: 'High', excitement: 4, path: ['screen', 'interview', 'final', 'offer'], ivs: [['Recruiter screen', -30, 'Passed', 'Tom Becker'], ['Technical screen', -24, 'Passed', 'Aisha Bello'], ['Panel / Onsite', -12, 'Passed', 'Team panel']], offer: { base: 176000, bonus: 10, equity: '0.08% over 4 years', signOn: 15000, deadDays: 4 } }],
    ['Tandem Robotics', 'Staff Software Engineer, Platform', 'staff', 'rejected', 29, 'LinkedIn', 320, 240000, 310000, 'On-site', 'Austin, TX', { path: ['rejected'], reason: 'Not enough experience' }],
    ['Atlas Defense Systems', 'Software Engineer II', 'defense', 'saved', null, 'Indeed', 45, 120000, 150000, 'On-site', 'Huntsville, AL', { savedDaysAgo: 4 }],
    ['Cobalt AI', 'Machine Learning Engineer, LLM Platform', 'ml', 'applied', 9, 'LinkedIn', 240, 210000, 280000, 'Remote', 'Remote (US)', { excitement: 5 }],
    ['Pinecrest Analytics', 'Senior Data Engineer', 'data', 'ghosted', 44, 'LinkedIn Easy Apply', 410, 165000, 200000, 'Remote', 'Remote (US)', { path: ['ghosted'] }],
    ['Lumen Bank', 'Senior Software Engineer, Accounts', 'paymentsJava', 'screen', 7, 'Company site', 90, 170000, 210000, 'Hybrid', 'Bellevue, WA', { path: ['screen'], ivs: [['Recruiter screen', 1, 'Scheduled', 'Grace Kim (Talent)']] }],
    ['Orbitly', 'Frontend Engineer', 'frontend', 'applied', 3, 'LinkedIn Easy Apply', 520, 140000, 175000, 'Remote', 'Remote (US)', {}],
    ['Kestrel Security', 'Site Reliability Engineer', 'sre', 'applied', 24, 'LinkedIn', 130, 175000, 215000, 'Remote', 'Remote (US)', {}],
    ['Juniper Commerce', 'Engineering Manager, Checkout', 'em', 'saved', null, 'LinkedIn', 95, 220000, 260000, 'Hybrid', 'San Francisco, CA', { savedDaysAgo: 12 }],
    ['Brightline Logistics', 'Senior Backend Engineer', 'payments', 'rejected', 38, 'Company site', 70, 175000, 215000, 'Remote', 'Remote (US)', { path: ['screen', 'interview', 'rejected'], reason: 'Interview performance', ivs: [['Recruiter screen', -33, 'Passed', 'Noah Price'], ['Technical screen', -26, 'Failed', 'Chen Wu']] }],
    ['Meridian Health Network', 'Software Engineer, Patient APIs', 'health', 'applied', 2, 'Company site', 40, 140000, 170000, 'Hybrid', 'Seattle, WA', {}],
    ['Vesper Labs', 'Full Stack Engineer', 'fullstack', 'withdrawn', 21, 'Wellfound', 80, 130000, 160000, 'On-site', 'Portland, OR', { path: ['screen', 'withdrawn'] }],
    ['Harbor & Finch', 'Platform Engineer', 'sre', 'rejected', 31, 'Referral', 55, 150000, 180000, 'Hybrid', 'Seattle, WA', { referral: true, referrerName: 'Jordan Blake', path: ['screen', 'rejected'], reason: 'Compensation mismatch', ivs: [['Recruiter screen', -27, 'Completed', 'Maya Patel']] }],
    ['Saltbox', 'Backend Engineer', 'payments', 'rejected', 47, 'LinkedIn Easy Apply', 600, 150000, 190000, 'Remote', 'Remote (US)', { path: ['rejected'], reason: 'No reason given' }],
    ['Granite Cloud', 'Senior Platform Engineer', 'sre', 'ghosted', 52, 'Indeed', 180, 160000, 200000, 'Remote', 'Remote (US)', { path: ['ghosted'] }],
    ['Tidewater Bank', 'Software Engineer III', 'paymentsJava', 'rejected', 58, 'LinkedIn', 260, 150000, 185000, 'On-site', 'Charlotte, NC', { path: ['rejected'], reason: 'Location / work authorization' }],
    ['Mosaic Learning', 'Full Stack Engineer', 'fullstack', 'rejected', 64, 'LinkedIn', 150, 135000, 165000, 'Remote', 'Remote (US)', { path: ['screen', 'rejected'], reason: 'Position filled', ivs: [['Recruiter screen', -58, 'Completed', 'Recruiter']] }],
    ['Arcadia Freight', 'Data Engineer II', 'data', 'ghosted', 69, 'LinkedIn Easy Apply', 350, 140000, 170000, 'Remote', 'Remote (US)', { path: ['ghosted'] }],
    ['Beacon Clinical', 'Backend Engineer', 'health', 'applied', 5, 'LinkedIn', 75, 140000, 175000, 'Remote', 'Remote (US)', {}],
  ];

  function jobs() {
    const today = CB.todayISO();
    const out = [];
    ROWS.forEach((r, idx) => {
      const [company, title, jdKey, status, appliedAgo, source, applicants, smin, smax, workMode, location, x] = r;
      const appliedDate = appliedAgo != null ? CB.addDays(today, -appliedAgo) : '';
      const createdDate = appliedDate ? CB.addDays(appliedDate, -1 - (idx % 3)) : CB.addDays(today, -(x.savedDaysAgo || 3));
      const ts = (iso, h = 10) => new Date(CB.parseDate(iso).getTime() + h * 3600000).toISOString();
      const j = CB.newJob({
        id: 'sample_' + idx, sample: true, company, title, location, workMode, source, applicants,
        salaryMin: smin, salaryMax: smax, status: 'saved', maxStage: 0,
        jd: JD[jdKey].replace(/\{C\}/g, company), url: `https://example.com/careers/${company.toLowerCase().replace(/[^a-z]+/g, '-')}/${1000 + idx}`,
        priority: x.priority || 'Medium', excitement: x.excitement || 3, referral: !!x.referral, referrerName: x.referrerName || '',
        postedDate: appliedDate ? CB.addDays(appliedDate, -(idx % 4) - 1) : CB.addDays(createdDate, -2),
        createdAt: ts(createdDate, 9), tags: ['example'],
      });
      j.timeline.push({ id: CB.uid('t_'), ts: ts(createdDate, 9), kind: 'created', text: 'Saved from ' + source + ' (example)' });
      if (appliedDate) {
        j.appliedDate = appliedDate;
        j.status = 'applied'; j.maxStage = 1;
        j.followUpDate = CB.addDays(appliedDate, 7);
        j.timeline.push({ id: CB.uid('t_'), ts: ts(appliedDate, 11), kind: 'status', from: 'saved', to: 'applied', text: '' });
      }
      const path = x.path || [];
      const span = appliedAgo || 1;
      path.forEach((to, k) => {
        const d = CB.addDays(appliedDate, Math.max(1, Math.round(((k + 1) / (path.length + 1)) * span)));
        const from = j.status;
        j.status = to;
        const o = CB.STAGE[to].order;
        if (o > j.maxStage) j.maxStage = o;
        if (!j.responseDate && (o >= 2 || to === 'rejected')) j.responseDate = d;
        if (to === 'rejected') { j.rejectionStage = from; j.rejectionReason = x.reason || 'No reason given'; }
        j.timeline.push({ id: CB.uid('t_'), ts: ts(d, 14), kind: 'status', from, to, text: to === 'rejected' ? 'Reason: ' + j.rejectionReason : to === 'ghosted' ? 'No reply after follow-up' : '' });
      });
      (x.ivs || []).forEach((iv, k) => {
        const date = CB.addDays(today, iv[1]);
        j.interviews.push({ id: CB.uid('i_'), round: k + 1, type: iv[0], datetime: `${date}T${CB.pad(10 + (k % 5))}:00`, durationMin: iv[0] === 'Panel / Onsite' ? 240 : 45, interviewer: iv[3], link: '', outcome: iv[2], notes: '', thankYouSent: iv[1] < -1 });
      });
      if (x.offer) {
        j.offer = { base: x.offer.base, bonus: x.offer.bonus, equity: x.offer.equity, signOn: x.offer.signOn, deadline: CB.addDays(today, x.offer.deadDays), notes: 'Verbal offer, written offer letter received.' };
      }
      if (x.ivs && x.ivs.length) j.contacts.push({ id: CB.uid('c_'), name: x.ivs[0][3].replace(/\s*\(.*\)$/, ''), role: 'Recruiter', email: 'recruiting@example.com', phone: '', linkedin: '', notes: 'Example contact' });
      if (x.referral) j.contacts.push({ id: CB.uid('c_'), name: x.referrerName, role: 'Referrer', email: '', phone: '', linkedin: '', notes: 'Former teammate (example)' });
      j.notes = status === 'interview' ? '<p><b>Prep:</b> review ledger idempotency, exactly-once vs at-least-once in Kafka, reconciliation design.</p><ul><li>Story: 6h → 25min reconciliation</li><li>Ask about on-call load</li></ul>' : '';
      j.updatedAt = new Date().toISOString();
      out.push(j);
    });
    return out;
  }

  const resume = () => ({ text: RESUME, fileName: 'Example resume — Alex Rivera.txt', uploadedAt: CB.nowISO(), warnings: [], sample: true });
  CB.Samples = { jobs, resume, JD };
})();

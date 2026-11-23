/* Callback — skills taxonomy for the ATS scorer (CB.Taxonomy).
 * Plain browser script, no modules. Loaded after core.js.
 *
 * Skill encoding: S(name, cat, kind, 'alias1|alias2', 'exclude1|exclude2')
 *   kind: h=hard, t=tool, s=soft, c=cert, l=language
 *   aliases are written naturally and normalized at compile time (see normalize()).
 *   '=Alias'  case-sensitive alias, matched against the case-preserving text.
 *   A leading '!' on the alias string (or an '=Name' alias) stops the bare canonical
 *   name from being matched automatically (for names that are ordinary words).
 *   exclude: phrases (normalized, lowercase) whose span cancels a match inside it,
 *   e.g. C excludes 'series c' and 'objective c'.
 */
(function () {
  'use strict';
  const CB = (window.CB = window.CB || {});

  const KIND = { h: 'hard', t: 'tool', s: 'soft', c: 'cert', l: 'language' };
  const skills = [];
  function S(name, cat, kind, aliases, exclude) {
    let a = aliases || '';
    let noName = false;
    if (a.charAt(0) === '!') { noName = true; a = a.slice(1); }
    const list = a ? a.split('|') : [];
    if (list.indexOf('=' + name) >= 0) noName = true;
    const o = { name: name, cat: cat, kind: KIND[kind] || kind, aliases: list };
    if (noName) o.noName = true;
    if (exclude) o.exclude = exclude.split('|');
    skills.push(o);
  }
  /** Batch helper: same cat/kind for many skills, one per line: `Name: alias|alias ~ exclude|exclude` */
  function G(cat, kind, block) {
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const i = t.indexOf(': ');
      const name = i < 0 ? t : t.slice(0, i);
      const rest = i < 0 ? '' : t.slice(i + 2);
      const j = rest.indexOf('~');
      S(name, cat, kind, (j < 0 ? rest : rest.slice(0, j)).trim(), j < 0 ? '' : rest.slice(j + 1).trim());
    }
  }
  /** Spoken language with the usual resume/JD phrasings generated. */
  function L(name, extra) {
    const n = name.toLowerCase();
    S(name, 'language', 'l', ['fluent in ' + n, n + ' speaking', 'bilingual ' + n, n + ' speaker', 'native ' + n, n + ' fluency', 'proficient in ' + n, 'business ' + n].join('|') + (extra ? '|' + extra : ''));
  }

  // --- programming languages ---
  G('lang', 'h', `
Python: python3|python 3|cpython|python programming
Java: java 8|java 11|java 17|java 21|core java|java se|java ee|jakarta ee|j2ee
JavaScript: ecmascript|es6|es2015|vanilla js|vanilla javascript|js es6|js ts
TypeScript: typescript 5
Go: golang|=Go|go programming|go language ~ go to market|go live|go getter|go no go|go forward|go to
Rust: =Rust|rustlang|rust programming|rust language
C: c programming|ansi c|=C|c language|embedded c|c99|c11 ~ series c|c suite|c level|objective c|obj c|c corp|vitamin c|c section|c suite executives|type c|usb c
C++: cpp|c plus plus|modern c++|c++11|c++14|c++17|c++20|c++23
C#: csharp|c sharp
Ruby: ruby programming
PHP: php 8|php8|php7
Kotlin: kotlin coroutines
Swift: =Swift|swift 5|swift programming|swift language
Objective-C: objc|obj c|objective c
Scala: scala 3
R: r programming|rstudio|=R|r language|tidyverse|ggplot2|r shiny|cran|dplyr ~ r&d|r & d|r squared|r and d
MATLAB: matlab programming
Julia: =Julia|julialang|julia language|julia programming
Dart: =Dart|dart language|dartlang
Elixir
Erlang: erlang otp
Haskell
Clojure: clojurescript
Perl: perl scripting
Lua: luau
Bash: bash scripting|shell scripting|shell scripts|shell script|unix shell|zsh|sh scripting
PowerShell: powershell scripting|pwsh
SQL: sql queries|ansi sql|structured query language|sql development|complex sql|advanced sql|sql programming
T-SQL: tsql|transact sql
PL/SQL: plsql
Solidity: smart contracts
Zig: ziglang
COBOL
Fortran
Assembly Language: x86 assembly|arm assembly|asm|assembly programming|mips assembly
VBA: visual basic for applications|excel vba|excel macros|vba macros
Visual Basic: vb.net|vb6|visual basic .net
Groovy
HTML: html5|semantic html|xhtml
CSS: css3|flexbox|css grid|responsive css|css modules
Sass: scss|less css
GraphQL: gql|graphql apis
F#: fsharp|f sharp
OCaml
WebAssembly: wasm
Verilog: systemverilog
VHDL
ABAP: sap abap
Apex: =Apex|salesforce apex|apex triggers|apex classes
Stata
JSON
XML: xslt|xpath
Regex: regular expressions|regexes
`);

  // --- frontend ---
  G('frontend', 't', `
React: =React|react.js|reactjs|react js|react hooks|react 18|react 19|react server components
Next.js: nextjs|next js|next.js app router
Vue.js: vue|vuejs|vue js|vue 3|vuex|pinia
Nuxt: nuxt.js|nuxtjs|nuxt 3
Angular: angularjs|angular.js|angular 2+
Svelte
SvelteKit: svelte kit
Remix: !remix run|remix.run|=Remix
Astro: =Astro|astro.js|astrojs|astro framework
Redux: redux toolkit|redux saga|rtk query
Zustand
Tailwind CSS: tailwind|tailwindcss
Webpack
Vite: vitejs
Babel: babel.js
jQuery
Bootstrap: =Bootstrap|bootstrap css|bootstrap 5|twitter bootstrap
Material UI: mui|material ui|material components
shadcn/ui: shadcn
Chakra UI
Storybook
RxJS: reactive extensions
Three.js: threejs
D3.js: d3|d3js
WebGL: webgpu
Web Components: custom elements|shadow dom|lit element
Responsive Design: responsive web design|mobile first design|mobile first|responsive layouts|adaptive design|breakpoints
Core Web Vitals: web vitals|lighthouse|web performance|frontend performance
Server-Side Rendering: ssr|server side rendering|static site generation|ssg
Progressive Web Apps: pwa|pwas|progressive web app
Micro-Frontends: micro frontends|microfrontends|module federation
Turborepo
Monorepo: monorepos|nx monorepo|lerna
ESLint: eslint|prettier
Electron: electron.js|electronjs
Tauri
Ember.js: emberjs|ember
Backbone.js: backbonejs
SolidJS: solid.js
Preact
Gatsby: gatsbyjs
htmx
Alpine.js: alpinejs
Styled Components: styled components|css in js
TanStack Query: react query|tanstack
Framer Motion: motion.dev
GSAP: greensock
Browser Extensions: chrome extensions|chrome extension|browser extension
DOM Manipulation: dom|dom apis|browser apis
Frontend Testing: frontend testing|component testing
`);

  // --- backend & general software engineering ---
  G('backend', 't', `
Node.js: nodejs|node js|=Node
Express.js: express.js|expressjs|=Express ~ american express
NestJS: nest.js|nest js
Fastify
Hono
Deno
Bun: !bun.js|bun runtime|bunjs
Django: django rest framework|drf
Flask: flask api
FastAPI: fast api
Spring Boot: springboot|spring boot 3
Spring Framework: spring framework|spring mvc|spring data|spring security|spring cloud|spring batch|spring webflux|=Spring ~ spring 2025|spring 2026|spring 2027|spring 2028|spring semester|spring break|spring internship|spring term|spring season|spring quarter
Hibernate: jpa|hibernate orm
.NET: dotnet|.net core|.net framework|.net 6|.net 8|.net 9
ASP.NET: asp.net core|asp.net mvc|aspnet|asp.net web api
Entity Framework: ef core|entity framework core
Ruby on Rails: rails|ror|rails 7
Laravel
Symfony
Phoenix Framework: !phoenix framework|elixir phoenix|phoenix liveview|liveview
gRPC: protobuf|protocol buffers
REST APIs: rest api|restful|restful apis|restful services|rest services|restful web services|rest endpoints
OpenAPI: swagger|openapi spec|api specifications
API Design: api development|api architecture|designing apis|api first
Microservices: microservice|microservices architecture|service oriented architecture|soa
Event-Driven Architecture: event driven|event driven architecture|event sourcing|cqrs|event driven systems
Domain-Driven Design: ddd|domain driven design
Apache Kafka: kafka|kafka streams|confluent kafka|confluent
RabbitMQ: amqp|rabbit mq
Message Queues: message queue|message queues|message brokers|message broker|pub sub messaging
NATS: nats.io|nats jetstream
ActiveMQ: apache activemq
Celery
Sidekiq
WebSockets: websocket|socket.io|server sent events
OAuth: oauth2|oauth 2.0|openid connect|oidc
JWT: json web tokens|json web token
Serverless: serverless architecture|serverless framework|faas|functions as a service
Concurrency: multithreading|multi threading|concurrent programming|parallel programming|async programming|asynchronous programming
Distributed Systems: distributed computing|distributed architecture|distributed databases
System Design: systems design|large scale systems|scalable systems|high scale systems|scalability
Data Structures & Algorithms: data structures|algorithms|dsa|data structures and algorithms|algorithm design
Object-Oriented Programming: oop|object oriented programming|object oriented design|ood|solid principles
Functional Programming: functional programming languages
Design Patterns: software design patterns|gang of four
Software Architecture: software architecture|clean architecture|hexagonal architecture|architecture design
Code Review: code reviews|peer code review|pull request reviews
Debugging: debug|debuggers|gdb|lldb
Performance Optimization: performance tuning|performance optimisation|profiling|latency optimization
Low-Latency Systems: low latency|low latency systems|high frequency trading systems|real time systems
Caching: caching strategies|cache invalidation|distributed caching
Redis: redis cache|redis cluster|valkey
Memcached
Kong: kong gateway
Apigee
Apache Tomcat: tomcat
JVM: jvm tuning|java virtual machine|garbage collection tuning
Maven: apache maven
Gradle
Apache Ant: apache ant|=Ant
Make: !gnu make|makefile|makefiles
CMake
Bazel: buck2|pants build
npm: yarn|pnpm|npm packages
Temporal: !temporal.io|temporal workflows|temporal workflow engine
Supabase
Firebase: firebase auth|firebase functions
Prisma: prisma orm
SQLAlchemy
ORM: orms|object relational mapping|object relational mappers|typeorm|drizzle orm|sequelize
Webhooks: webhook
SOAP: soap apis|soap web services|wsdl
Stripe: stripe api|stripe payments|stripe integration
Payment Systems: payment systems|payments infrastructure|payment processing|payment gateways|payment gateway
Twilio: twilio api
Auth0
Keycloak
Embedded Systems: embedded software|embedded development|firmware|rtos|microcontrollers|embedded linux
Linux Kernel: kernel development|device drivers|linux kernel development
Compilers: compiler|compiler design|llvm
Networking Protocols: http 2|http 3|quic|tcp udp|network programming|socket programming
Blockchain: web3|ethereum|smart contract development|defi|evm
Game Development: game development|game engines|gamedev
Unity: =Unity|unity3d|unity engine|unity 3d
Unreal Engine: ue5|ue4|unreal engine 5
Search Engines: search infrastructure|apache solr|solr|lucene
Backend Development: backend development|back end development|server side development|backend engineering
Full-Stack Development: full stack|fullstack|full stack development|fullstack development|mern|mean stack|lamp stack
Frontend Development: front end development|frontend development|frontend engineering|front end engineering|client side development
SDLC: software development lifecycle|software development life cycle|sdlc
Technical Documentation: technical documentation|api documentation|design docs|technical design documents|rfcs
Open Source: open source|open source contributions|oss contributions|open source software
`);

  // --- mobile ---
  G('mobile', 't', `
iOS: ios development|ios sdk|ipados|ios apps|ios engineering
Android: android sdk|android development|android apps|android engineering
React Native: react native|expo sdk|expo router
Flutter
SwiftUI: swift ui
UIKit
Jetpack Compose: jetpack|android jetpack
Xcode
Android Studio
Core Data
Kotlin Multiplatform: kmp|kmm|kotlin multiplatform mobile
Ionic: ionic framework|capacitor js|capacitorjs
Xamarin
.NET MAUI: maui|dotnet maui
Fastlane
TestFlight: app store connect|app store submission|google play console
Push Notifications: push notifications|apns|fcm|firebase cloud messaging
Mobile Development: mobile app development|mobile application development|mobile engineering|native mobile
ARKit: arcore|augmented reality|ar vr|virtual reality|xr development|visionos
Core ML: coreml|tensorflow lite|tflite|on device ml
Mobile CI/CD: mobile ci cd|bitrise|codemagic
Offline-First: offline first|offline sync
`);

  // --- data engineering & analytics ---
  G('data', 't', `
Apache Spark: =Spark|pyspark|spark sql|spark streaming|structured streaming|apache spark|spark jobs
Databricks: databricks lakehouse|databricks sql|unity catalog
Snowflake: snowflake data cloud|snowpark
BigQuery: google bigquery|big query
Amazon Redshift: redshift|aws redshift|redshift spectrum
Apache Airflow: =Airflow|apache airflow|airflow dag|airflow dags|mwaa|cloud composer
dbt: dbt core|dbt cloud|data build tool|dbt labs|dbt models
Fivetran
Airbyte
Apache Flink: flink|pyflink
Hadoop: hdfs|mapreduce|apache hadoop|hadoop ecosystem
Apache Hive: hive|hiveql|hive metastore
Trino: presto|prestodb|starburst
Pandas
NumPy
Polars
Dask
SciPy: statsmodels
Jupyter: jupyter notebooks|jupyter notebook|jupyterlab|ipython
ETL/ELT: etl|elt|extract transform load|etl pipelines|elt pipelines|etl processes|etl development
Data Pipelines: data pipeline|pipeline orchestration|batch processing|batch pipelines
Data Modeling: data modelling|dimensional modeling|dimensional modelling|star schema|snowflake schema|kimball|data vault|logical data models
Data Warehousing: data warehouse|data warehouses|edw|enterprise data warehouse
Data Lakehouse: lakehouse|data lake|data lakes|data lakehouses
Delta Lake
Apache Iceberg: iceberg tables|=Iceberg
Apache Parquet: parquet|avro|orc files
Data Governance: data stewardship|data catalog|data cataloging|data lineage|master data management|collibra|alation
Data Quality: great expectations|data validation|data observability|monte carlo data|data cleansing|data cleaning
Dagster
Prefect: =Prefect|prefect.io
Azure Data Factory: adf|data factory
AWS Glue: glue etl|glue jobs|glue catalog
Amazon Athena: athena|aws athena
Amazon EMR: aws emr|elastic mapreduce|emr clusters|emr serverless|emr on eks
Amazon Kinesis: kinesis|kinesis data streams|kinesis firehose
Google Dataflow: dataflow|apache beam|dataproc
Azure Synapse: synapse analytics|azure synapse analytics
Microsoft Fabric: ms fabric|fabric lakehouse|onelake
Informatica: informatica powercenter|iics
Talend
SSIS: sql server integration services
Alteryx
Matillion
Segment: !twilio segment|segment cdp|segment.io
Customer Data Platforms: cdp|customer data platform|rudderstack|mparticle
Reverse ETL: hightouch|census reverse etl
Stream Processing: streaming data|real time data|real time streaming|real time analytics|event streaming|kafka streaming
Change Data Capture: cdc|debezium
Data Mesh: data products|data contracts
Big Data: big data technologies|big data analytics|large datasets|large scale data
Data Engineering: data engineering
Data Analysis: data analytics|analyzing data|data analyses|analytical reporting|ad hoc analysis
Statistics: statistical analysis|statistical modeling|statistical modelling|applied statistics|statistical methods|descriptive statistics
Hypothesis Testing: statistical testing|statistical significance|t tests|t test|chi square|anova|power analysis
Regression Analysis: linear regression|logistic regression|regression models|multivariate regression
Time Series Analysis: time series|time series forecasting|arima|time series modeling
Bayesian Statistics: bayesian inference|bayesian methods|bayesian modeling|pymc|stan
Econometrics: econometric modeling|panel data
Causal Inference: causal analysis|uplift modeling|difference in differences|propensity score matching|causal ml|synthetic control
Experimentation: experiment design|experimental design|experimentation platform|online experiments|controlled experiments
Web Scraping: beautifulsoup|beautiful soup|scrapy|data scraping|web crawling
Excel Data Analysis: data analysis in excel|excel modeling|excel analytics
Survey Analysis: survey design|survey data|qualtrics|surveymonkey
GIS: arcgis|qgis|geospatial|geospatial analysis|esri|postgis
Data Migration: data migrations|database migration|database migrations|data conversion
SPSS: ibm spss
SAS: =SAS|sas programming|sas enterprise guide|sas base|sas eg|sas viya
`);

  // --- ML / AI ---
  G('ml', 'h', `
Machine Learning: ml|machine learning models|ml models|ml algorithms|applied machine learning|statistical learning
Deep Learning: neural networks|neural network|deep neural networks|dnns|cnns|rnns|lstm|convolutional neural networks
LLMs: llm|large language models|large language model|foundation models|foundation model|frontier models
Generative AI: genai|gen ai|generative ai|generative models|gen ai applications
RAG: retrieval augmented generation|retrieval augmented|rag pipelines|rag systems|graphrag
Prompt Engineering: prompt design|prompting|prompt engineer|prompt optimization|context engineering
Fine-Tuning: fine tuning|finetuning|fine tuned|lora|qlora|peft|sft|supervised fine tuning|instruction tuning|model fine tuning
RLHF: reinforcement learning from human feedback|dpo|rlaif|preference optimization|reward modeling
Reinforcement Learning: deep reinforcement learning|policy gradients|ppo|multi armed bandits|contextual bandits
LangChain: lang chain|langchain.js
LangGraph
LlamaIndex: llama index|gpt index
Vector Databases: vector database|vector db|vector dbs|vector store|vector stores|vector search|vector indexes
Pinecone
pgvector: pg vector
Weaviate
Chroma: chromadb|chroma db
Milvus: zilliz
Qdrant
FAISS
Embeddings: embedding models|text embeddings|vector embeddings|embedding model|sentence transformers
Semantic Search: hybrid search|reranking|re ranking|dense retrieval|information retrieval|bm25
Hugging Face: huggingface|hugging face transformers|transformers library|hf transformers|hugging face hub
PyTorch: torch|pytorch lightning|libtorch
TensorFlow: tensorflow 2|tf.keras|tensorflow serving|tfx
Keras
JAX: flax|=Jax
scikit-learn: sklearn|scikit learn|scikit
XGBoost: lightgbm|catboost|gradient boosting|gradient boosted trees|gbm|random forest|random forests
MLOps: ml ops|ml infrastructure|ml platform|ml pipelines|machine learning operations|llmops|llm ops
MLflow: ml flow
Kubeflow: kubeflow pipelines
Amazon SageMaker: sagemaker|aws sagemaker
Vertex AI: google vertex ai|vertex ai pipelines
Azure Machine Learning: azure ml|azureml
Amazon Bedrock: bedrock|aws bedrock
Azure OpenAI: azure openai service|azure ai foundry|azure ai studio
Weights & Biases: wandb|weights and biases|w&b
Computer Vision: image recognition|object detection|image classification|image segmentation|visual recognition|image processing|yolo
OpenCV
NLP: natural language processing|text classification|named entity recognition|ner|text mining|sentiment analysis|natural language understanding|nlu
Speech Recognition: asr|speech to text|automatic speech recognition|text to speech|tts|speech processing|whisper
Recommendation Systems: recommender systems|recommender system|recommendation engines|recommendation engine|recsys|collaborative filtering
Learning to Rank: ranking models|search ranking|ranking systems|ltr
Evals: llm evaluation|llm evaluations|model evaluation|llm evals|eval harness|evaluation frameworks|ai evaluation|red teaming llms
AI Agents: ai agents|agentic|agentic workflows|agentic ai|agentic systems|multi agent|multi agent systems|autonomous agents|llm agents|ai agent
Model Context Protocol: mcp|model context protocol|mcp servers|mcp server
Tool Calling: function calling|tool use|tool calling|structured outputs
OpenAI API: openai|gpt 4|gpt 4o|gpt 5|chatgpt api|openai sdk|openai apis
Anthropic Claude: =Claude|claude api|anthropic|anthropic api|claude sonnet|claude opus|claude code
Google Gemini: gemini api|gemini pro|google gemini
Llama: !llama 3|llama 2|meta llama|llama models|llama 4
Open-Weight Models: open source llms|open weight models|open source models|mistral|qwen|deepseek
Ollama
vLLM: sglang|tgi|text generation inference
TensorRT: tensorrt llm|trt llm
ONNX: onnx runtime
CUDA: cuda programming|gpu programming|cuda kernels|triton kernels|cudnn
Model Serving: model deployment|model inference|inference optimization|ml inference|inference serving|triton inference server|ray serve|bentoml
Model Quantization: quantization|model compression|knowledge distillation|distillation|pruning
Transformer Models: transformer architecture|transformer models|transformers architecture|attention mechanisms|self attention|bert|gpt models
Diffusion Models: stable diffusion|text to image|image generation
GANs: generative adversarial networks|generative adversarial network
Multimodal AI: multimodal|multimodal models|vision language models|vlm|vlms
Synthetic Data: synthetic data generation|data augmentation
Distributed Training: deepspeed|fsdp|megatron|model parallelism|data parallelism|multi gpu training|large scale training
LLM Pretraining: pretraining|pre training|llm pretraining|scaling laws
LLM Observability: langsmith|langfuse|arize|llm monitoring|helicone|braintrust
AI Guardrails: guardrails|llm guardrails|content moderation models|ai safety guardrails
Responsible AI: ai ethics|ai safety|responsible ai|ai governance|model fairness|bias mitigation|alignment research|interpretability|mechanistic interpretability|ai alignment
DSPy
CrewAI: crew ai
AutoGen: semantic kernel|openai agents sdk|claude agent sdk|agents sdk
AI-Assisted Development: github copilot|copilot|cursor ide|cursor ai|ai coding assistants|ai assisted coding|ai assisted development|ai pair programming|codex cli|windsurf
Feature Engineering: feature extraction|feature selection|feature store|feature stores|feast|tecton
Predictive Modeling: predictive analytics|predictive models|predictive model|propensity modeling|churn modeling
Clustering: k means|kmeans|unsupervised learning|dimensionality reduction|pca|anomaly detection|outlier detection
Data Science: data science|data scientist
Linear Algebra: matrix computations
Probability: probability theory|stochastic processes|probabilistic modeling
Mathematical Optimization: convex optimization|linear programming|integer programming|mixed integer programming|gurobi|cplex|optimization algorithms
Operations Research: operations research|simulation modeling|queueing theory
Knowledge Graphs: knowledge graph|ontologies|ontology|rdf|sparql
Ray: =Ray|ray.io|anyscale|ray tune
Robotics: robotics|ros|ros2|motion planning|slam
Autonomous Vehicles: autonomous driving|self driving|adas|sensor fusion|lidar
AI Product Development: ai products|ai powered products|ai features|llm applications|llm powered applications|ai applications
`);

  // --- cloud ---
  G('cloud', 't', `
AWS: amazon web services|aws cloud
Amazon EC2: ec2|aws ec2|auto scaling groups
Amazon S3: s3|aws s3|s3 buckets
AWS Lambda: lambda functions|=Lambda|aws lambdas
Amazon ECS: ecs|aws ecs|aws fargate|fargate|amazon ecr|ecr
Amazon RDS: rds|aws rds
Amazon Aurora: aurora|aws aurora|aurora postgresql|aurora mysql
Amazon CloudWatch: cloudwatch|aws cloudwatch|cloudwatch logs
AWS Step Functions: step functions
API Gateway: aws api gateway|amazon api gateway|api gateways
Amazon CloudFront: cloudfront
Amazon Route 53: route 53|route53
Amazon VPC: vpc|aws vpc|virtual private cloud|vpcs|transit gateway
Amazon SQS: sqs|aws sqs
Amazon SNS: sns|aws sns
Amazon EventBridge: eventbridge|aws eventbridge
AWS CDK: cdk|cloud development kit|aws cdk
AWS CloudFormation: cloudformation|cfn|aws sam|serverless application model
AWS Elastic Beanstalk: elastic beanstalk
Google Cloud: gcp|google cloud platform|google cloud services ~ ich gcp|gcp guidelines|gcp training
Google Cloud Run: cloud run
Google Cloud Functions: cloud functions|gcp cloud functions
Google Pub/Sub: pubsub|cloud pub sub|gcp pub sub|google pub sub
Cloud Spanner: spanner|google spanner
Cloud Bigtable: bigtable
Google Cloud Storage: gcs|cloud storage buckets
Firestore: cloud firestore
Microsoft Azure: azure|ms azure|azure cloud|azure services
Azure Functions: azure function
Azure DevOps: azure pipelines|vsts|tfs|team foundation server|azure repos|azure boards
Microsoft Entra ID: azure ad|azure active directory|entra id|microsoft entra|entra
Azure Cosmos DB: cosmos db|cosmosdb|azure cosmos
Azure SQL: azure sql database|azure sql managed instance
Azure Blob Storage: blob storage|azure storage|adls|azure data lake storage
ARM Templates: arm templates|bicep|azure resource manager
Azure App Service: app service|azure web apps
Azure Kubernetes Service: azure kubernetes service
Oracle Cloud: oci|oracle cloud infrastructure
IBM Cloud
DigitalOcean: digital ocean
Heroku
Vercel
Netlify
Cloudflare: cloudflare workers|cloudflare r2|cloudflare pages
Akamai
Fastly
CDN: cdns|content delivery network|content delivery networks|edge computing
OpenStack
VMware: vsphere|esxi|vcenter|vmware vsphere
Virtualization: hypervisor|hypervisors|hyper v|kvm|virtual machines
Kubernetes: k8s|eks|gke|aks|amazon eks|kubectl|kubernetes operators|kustomize
OpenShift: red hat openshift|openshift container platform
Docker: containerization|containerized|docker compose|dockerfile|dockerfiles|docker containers|podman
Helm: helm charts|helm chart
Service Mesh: istio|linkerd|envoy proxy|envoy|consul connect
HashiCorp Consul
HashiCorp Nomad
Cloud Architecture: cloud solutions architecture|cloud design|well architected framework|cloud infrastructure design
Cloud-Native: cloud native|cloud native applications|cncf
Cloud Migration: cloud migration|cloud migrations|lift and shift|migration to aws|migration to azure
Multi-Cloud: multi cloud|multicloud|hybrid cloud
FinOps: cloud cost optimization|cloud cost management|cloud cost|cost optimization in aws
Cloud Infrastructure: cloud infrastructure|cloud platforms|cloud computing|cloud services|public cloud
`);

  // --- devops / SRE / infra ---
  G('devops', 't', `
Terraform: terraform cloud|opentofu|terragrunt|hcl|terraform modules
Pulumi
Ansible: ansible playbooks|ansible tower|ansible automation platform
Chef: !chef infra|chef cookbooks|chef automate|opscode chef
Puppet: =Puppet|puppet enterprise|puppet labs
SaltStack: salt stack
Infrastructure as Code: iac|infrastructure as code|infrastructure automation
Jenkins: jenkins pipelines|jenkinsfile|jenkins pipeline
GitHub Actions: github workflows|gh actions
GitLab CI: gitlab ci|gitlab pipelines|gitlab runners|gitlab ci cd
GitLab
GitHub: github enterprise
Bitbucket: bitbucket pipelines
CircleCI: circle ci
Travis CI: travisci
TeamCity
Atlassian Bamboo: bamboo ci
Buildkite
Argo CD: argocd|argo|argo workflows|argo rollouts
Flux: !fluxcd|flux cd
GitOps
Spinnaker
CI/CD: cicd|ci cd pipelines|continuous integration|continuous delivery|continuous deployment|build pipelines|deployment pipelines
Prometheus: promql|alertmanager
Grafana: grafana loki|loki|grafana dashboards|mimir
Datadog: datadog apm
New Relic: newrelic
OpenTelemetry: otel|open telemetry
Distributed Tracing: jaeger|zipkin|tracing
Observability: monitoring and observability|monitoring and alerting|monitoring tools|apm|application performance monitoring
PagerDuty: opsgenie|incident io
Sentry
Honeycomb
Dynatrace
AppDynamics
ELK Stack: elk|elk stack|logstash|elastic stack|efk
Kibana
Fluentd: fluent bit|fluentbit|vector.dev
Logging: centralized logging|log aggregation|log management|structured logging
Site Reliability Engineering: sre|slo|slos|sli|slis|error budgets|reliability engineering
Incident Management: on call|on call rotation|incident management|postmortems|post mortems|blameless postmortems|runbooks|root cause analyses
Chaos Engineering: chaos monkey|gremlin|fault injection
Load Balancing: load balancers|load balancer|haproxy|elb|alb|nlb
Nginx: nginx ingress|openresty
Apache HTTP Server: apache httpd|apache web server|httpd
Linux: rhel|red hat enterprise linux|ubuntu|centos|debian|linux administration|linux systems|linux servers|fedora|amazon linux
Unix: solaris|aix|hp ux|freebsd
Windows Server: windows server administration|iis
Active Directory: ad ds|group policy|gpo|active directory administration
LDAP: openldap
Networking: tcp ip|tcp|dns|dhcp|networking fundamentals|computer networking|osi model|subnetting|bgp|ospf|vlans|routing and switching|lan wan
Cisco: cisco ios|cisco networking|cisco routers|cisco switches|meraki
VPN: vpns|wireguard|ipsec
Git: version control|source control|git flow|gitflow|git workflows
SVN: subversion|perforce|mercurial
Packer: hashicorp packer
Vagrant
Release Management: release engineering|build and release|release process|release cycles
Configuration Management: configuration management
Platform Engineering: internal developer platform|internal developer platforms|developer platform|backstage|developer experience|devex
DevOps: devops practices|devops culture|devops tooling|dev ops
High Availability: fault tolerance|fault tolerant|failover|highly available
Capacity Planning: capacity management
Disaster Recovery: bcdr|business continuity|business continuity planning|backup and recovery|backups|dr planning
Mainframe: z os|zos|jcl|cics|ibm mainframe|ibm z
Systems Administration: sysadmin|system administration|systems administrator|system administrator
IT Support: help desk|helpdesk|desktop support|service desk|it helpdesk|tier 1 support|tier 2 support
ServiceNow: service now|servicenow itsm
ITSM: it service management|itsm processes|change advisory board
Microsoft Intune: intune|mobile device management|endpoint management|sccm|mecm
Jamf: jamf pro
Storage Systems: storage area network|nas|netapp|storage administration|ceph
Performance Testing: load testing|stress testing|jmeter|k6|gatling|locust|performance tests|load tests
`);

  // --- databases ---
  G('db', 't', `
PostgreSQL: postgres|psql|postgresql 16|plpgsql
MySQL: mysql 8
SQL Server: microsoft sql server|mssql|ms sql|sql server management studio|ssms
Oracle Database: oracle db|oracle 19c|oracle rdbms|oracle dba|oracle sql
MariaDB
SQLite
MongoDB: mongo|mongodb atlas|mongoose
Amazon DynamoDB: dynamodb|dynamo db
Apache Cassandra: cassandra|cql|datastax
ScyllaDB: scylla
Couchbase: couchdb
Elasticsearch: elastic search|opensearch|amazon opensearch
Neo4j: cypher|graph databases|graph database|amazon neptune|tigergraph
ClickHouse
TimescaleDB: timescale|influxdb|time series databases|time series database
CockroachDB: cockroach db
PlanetScale: vitess
DuckDB
Teradata
IBM Db2: db2
Apache HBase: hbase
NoSQL: nosql databases|non relational databases|document databases|key value stores
Relational Databases: rdbms|relational database|relational database management systems
Database Design: schema design|database schema|database schemas|database modeling|normalization
Query Optimization: query tuning|sql tuning|sql performance tuning|query performance|indexing strategies|database performance tuning
Database Administration: dba|database administrator|database management|database maintenance
Stored Procedures: stored procedure|sql triggers|user defined functions
Database Replication: replication|sharding|database sharding|partitioning
`);

  // --- security ---
  G('security', 'h', `
SOC 2: soc2|soc 2 type ii|soc 2 type 2|soc ii|soc 1
ISO 27001: iso27001|iso iec 27001|iso 27002|isms
NIST: nist csf|nist 800 53|nist cybersecurity framework|nist 800 171|nist rmf|nist frameworks
PCI DSS: pci|pci compliance|payment card industry
GDPR: general data protection regulation|gdpr compliance
CCPA: cpra|california consumer privacy act
FedRAMP: fed ramp
CMMC: dfars|itar
HITRUST
SIEM: security information and event management|siem tools
Splunk: splunk enterprise security|splunk es|spl queries
Microsoft Sentinel: azure sentinel|sentinel siem
QRadar: ibm qradar
CrowdStrike: crowdstrike falcon
EDR: endpoint detection and response|xdr|endpoint security|sentinelone|carbon black|microsoft defender|defender for endpoint
Penetration Testing: pentesting|pen testing|penetration tests|pentest|pentests|ethical hacking|offensive security
Red Teaming: red team|adversary emulation|purple team
Vulnerability Management: vulnerability scanning|vulnerability assessment|vulnerability assessments|nessus|qualys|tenable|rapid7|cve remediation|patch management
Burp Suite: burp
Metasploit
Wireshark: packet analysis|tcpdump|packet capture
Nmap
Kali Linux: kali
Identity & Access Management: iam|identity and access management|aws iam|iam policies|identity management|access management|rbac|role based access control|access control
Okta
SSO: single sign on|saml|saml 2.0|scim
MFA: multi factor authentication|2fa|two factor authentication|passkeys|webauthn
Privileged Access Management: cyberark|beyondtrust
Zero Trust: zero trust architecture|ztna|zero trust security
OWASP: owasp top 10|owasp top ten|owasp asvs
Threat Modeling: threat modelling|threat models
Threat Intelligence: cyber threat intelligence|cti|threat intel
Threat Hunting: threat detection|detection engineering|detection rules|sigma rules|yara
Incident Response: dfir|incident handling|security incident response|security incidents|csirt
Digital Forensics: computer forensics|forensic analysis|memory forensics|encase
Malware Analysis: malware reverse engineering|malware
Reverse Engineering: ida pro|ghidra|binary analysis|binary exploitation
Application Security: appsec|secure coding|secure code review|secure sdlc|product security
SAST: static application security testing|checkmarx|veracode|fortify|semgrep|codeql
DAST: dynamic application security testing|owasp zap|zap
Snyk: software composition analysis|sca|dependabot|supply chain security|sbom
DevSecOps: dev sec ops|shift left security
Cloud Security: cspm|cnapp|wiz|prisma cloud|cloud security posture management|aws security|azure security
Container Security: kubernetes security|aqua security|falco|image scanning|trivy
Network Security: intrusion detection|intrusion prevention|network segmentation|suricata|snort
Firewalls: firewall|fortinet|fortigate|firewall management|next generation firewalls|ngfw|palo alto networks|pan os|check point
Cryptography: encryption|pki|public key infrastructure|tls|ssl|ssl tls|key management|kms|hsm
HashiCorp Vault: secrets management|secret management|aws secrets manager|azure key vault
GRC: governance risk and compliance|governance risk compliance|governance risk & compliance|it risk management
Security Audits: security audit|security auditing|security assessments|compliance audits|audit readiness
Security Awareness: security awareness training|phishing simulation|phishing simulations|knowbe4
Security Operations: security operations center|secops|soc operations|soc analysis|24x7 soc
SOAR: security orchestration|security automation|xsoar|tines
Data Loss Prevention: dlp
MITRE ATT&CK: mitre att&ck|mitre attack|att&ck|mitre framework
Security Architecture: security architecture|security design reviews|secure architecture|defense in depth
Data Privacy: privacy engineering|privacy compliance|privacy by design|pii|pii handling|data protection|privacy impact assessments
Cybersecurity: cyber security|information security|infosec|it security
Anti-Money Laundering: aml|anti money laundering|bsa aml|kyc|know your customer|sanctions screening|ofac
Fraud Prevention: fraud detection|fraud prevention|fraud analysis|fraud investigations|chargebacks
`);

  // --- testing / QA ---
  G('testing', 't', `
Jest
Cypress: cypress.io
Playwright
Selenium: selenium webdriver|webdriver|webdriverio|selenium grid
JUnit: junit 5|junit5
pytest: py.test|unittest
Mocha: jasmine js|karma runner|chai js
Vitest
Testing Library: react testing library|testing library
TestNG
Cucumber: gherkin|specflow
BDD: behavior driven development|behaviour driven development
TDD: test driven development|test first development
Unit Testing: unit tests|unit test|unit testing frameworks
Integration Testing: integration tests|integration test|system integration testing
End-to-End Testing: e2e testing|e2e tests|end to end testing|end to end tests|e2e
Test Automation: automated testing|automation testing|test automation frameworks|automated tests|automation frameworks|qa automation
Manual Testing: manual qa|exploratory testing|manual test cases
Regression Testing: regression tests|regression suites|regression suite
API Testing: rest assured|soapui|api tests
Postman: newman
Appium
XCTest: xcuitest
Espresso: !espresso testing|android espresso|espresso tests
Mockito: mocking|test doubles|wiremock
RSpec: minitest|capybara
PHPUnit
xUnit: nunit|mstest|xunit.net
Test Planning: test plans|test plan|test cases|test case design|test strategy|test strategies|test scenarios
Quality Assurance: qa|software quality assurance|qa processes|qa testing|software testing
Bug Tracking: defect tracking|defect management|bug reports|bug reporting|bug triage
TestRail: zephyr|zephyr scale|xray|qtest
BrowserStack: sauce labs|lambdatest|cross browser testing
Accessibility Testing: axe core|screen reader testing|axe devtools
Contract Testing: pact testing|pactflow|consumer driven contracts
Fuzzing: fuzz testing|property based testing
SonarQube: sonarcloud|sonar|code quality tools|static analysis
User Acceptance Testing: uat|user acceptance testing
Code Coverage: test coverage|coverage reports
Smoke Testing: smoke tests|sanity testing
Mobile Testing: mobile testing|device testing|mobile app testing
Game Testing: game qa|game testing|playtesting
`);

  // --- product management ---
  G('pm', 'h', `
Product Management: product management|product ownership|product owner
Product Strategy: product vision|product strategy
Roadmapping: product roadmap|product roadmaps|roadmaps|roadmap planning|roadmap|technical roadmap
PRDs: prd|product requirements documents|product requirements document|product specs|product specifications|requirements documents
A/B Testing: ab testing|a b testing|split testing|multivariate testing|ab tests|a b tests
User Research: user interviews|customer interviews|customer discovery|user insights
Product Analytics: product metrics|product data|usage analytics
Amplitude
Mixpanel
Heap: !heap analytics
Pendo
FullStory: full story|logrocket|session replay
Hotjar: heatmaps|microsoft clarity
Feature Flags: feature flagging|feature toggles|launchdarkly|feature flag
Statsig: growthbook|eppo
Optimizely: vwo|ab tasty
Go-to-Market: go to market|gtm|gtm strategy|go to market strategy|launch strategy
OKRs: okr|objectives and key results
KPIs: kpi|key performance indicators|key performance indicator|kpi tracking|success metrics
Product Discovery: continuous discovery|opportunity solution tree|problem discovery
Prioritization Frameworks: rice framework|rice scoring|kano model|backlog prioritization|weighted scoring|ice scoring
Backlog Management: backlog grooming|backlog refinement|product backlog|managing the backlog
User Stories: user story|acceptance criteria|story mapping
Jobs to Be Done: jtbd|jobs to be done
Product-Led Growth: plg|product led growth|self serve growth|freemium
Pricing Strategy: pricing and packaging|monetization strategy|monetization|pricing models|pricing analysis
Competitive Analysis: competitor analysis|competitive intelligence|competitive landscape|competitive research
Product Launches: product launch|launch planning|feature launches|launching products
Funnel Analysis: conversion funnel|funnel optimization|funnel metrics|funnels
Cohort Analysis: retention analysis|retention curves|ltv analysis
Customer Feedback: voice of customer|voc|customer feedback loops|feedback synthesis
NPS: net promoter score
Market Sizing: tam sam som|tam|total addressable market
Business Cases: business case|business case development
Requirements Gathering: requirements analysis|business requirements|brd|functional requirements|requirements elicitation|functional specifications
Productboard: aha.io|aha roadmaps|productplan
Dovetail
Platform Products: platform product management|api products|developer products|developer tools
Technical Product Management: technical product management|technical product manager
Product Operations: product ops|product operations
Growth Strategy: growth strategy|growth initiatives|growth experiments|growth loops
Unit Economics: cac|ltv|ltv cac|customer lifetime value|customer acquisition cost|contribution margin
SaaS Metrics: arr|mrr|net revenue retention|nrr|saas metrics|gross revenue retention|churn rate
`);

  // --- project & program delivery ---
  G('project', 't', `
Jira: atlassian jira|jira software|jira service management|jql|jira align
Confluence: atlassian confluence
Asana
Trello
Monday.com: monday.com|monday work management
Smartsheet
ClickUp: click up
Linear: !linear app|linear.app
Notion: =Notion|notion.so|notion ai
Airtable
Microsoft Project: ms project|mpp
Wrike
Basecamp
Primavera P6: primavera|oracle primavera|p6
`);
  G('project', 'h', `
Agile: agile methodology|agile methodologies|agile development|agile practices|agile environment|agile teams|agile delivery
Scrum: scrum methodology|sprint planning|daily standups|scrum ceremonies|sprints|sprint retrospectives|scrum master
Kanban: kanban boards
SAFe: =SAFe|scaled agile|scaled agile framework|safe agile|program increment planning|pi planning
Waterfall: waterfall methodology|waterfall model
Project Management: project planning|project delivery|managing projects|end to end project management|project execution|project coordination
Program Management: programme management|program delivery|multi project management
Risk Management: risk mitigation|risk register|risk management frameworks|managing risk|enterprise risk management|erm
Risk Assessment: risk assessments|risk analysis|risk identification
Change Management: organizational change|organisational change|ocm|prosci|adkar|change initiatives|change control
Scope Management: scope definition|scope creep|scoping
Gantt Charts: gantt|gantt chart
Release Planning: release planning|release schedules|launch readiness
Status Reporting: status reports|status reporting|executive reporting|project reporting|steering committee
PMO: project management office|pmo governance
Project Portfolio Management: ppm|portfolio planning|project portfolio management
PMBOK: pmbok guide
Agile Coaching: agile coach|agile transformation|agile transformations
Process Improvement: business process improvement|process optimization|process optimisation|process improvements|operational efficiency|process reengineering|streamlining processes
Process Mapping: bpmn|value stream mapping|process modeling|process documentation|swimlane diagrams
Workflow Automation: business process automation|workflow automations|process automation|no code automation
Zapier
n8n
Power Automate: microsoft power automate|microsoft flow|power platform|power apps|powerapps
RPA: robotic process automation|uipath|automation anywhere|blue prism
Resource Allocation: resource allocation|resource management|staffing plans
Dependency Management: cross team dependencies|managing dependencies|dependency tracking
Budget Management: project budgets|project budgeting|budget tracking|managing budgets|budget ownership|p&l ownership
Vendor Management: supplier management|vendor relations|supplier relationship management|third party management|vendor relationships|vendor selection|vendor negotiations
Contract Management: contract administration|clm|contract lifecycle management
Delivery Management: delivery management|software delivery|on time delivery
Technical Program Management: technical program management|tpm|technical program manager
`);

  // --- design / UX ---
  G('design', 't', `
Figma: figjam|figma prototyping|figma design
Sketch: =Sketch|sketch app|sketchapp|bohemian sketch
Adobe XD: xd
Adobe Creative Suite: adobe creative cloud|adobe cc|adobe suite|creative cloud|adobe creative suite
Photoshop: adobe photoshop
Illustrator: adobe illustrator
InDesign: adobe indesign
After Effects: adobe after effects
Premiere Pro: adobe premiere|adobe premiere pro
Lightroom: adobe lightroom
Final Cut Pro: final cut
DaVinci Resolve: davinci
Canva
Framer
Webflow
InVision
Zeplin
ProtoPie: principle app|origami studio
Miro: miro boards
Lucidchart: lucidspark|draw.io|diagrams.net
Microsoft Visio: visio|ms visio
Balsamiq
Axure: axure rp
Blender
3D Modeling: 3d modelling|3d design|cinema 4d|c4d|3ds max|zbrush|substance painter
`);
  G('design', 'h', `
Design Systems: design system|design tokens|component libraries|component library|ui kit|ui kits
Prototyping: prototypes|rapid prototyping|high fidelity prototypes|interactive prototypes|prototype|hi fi prototypes
Wireframing: wireframes|wireframe|low fidelity|lo fi wireframes|mockups|mock ups
Usability Testing: usability tests|usability studies|user testing|usability research|moderated testing|unmoderated testing
UX Research: user experience research|design research|ux researcher|qualitative research|quantitative ux research|ethnographic research|diary studies|contextual inquiry
Interaction Design: ixd|micro interactions|microinteractions
UX Design: ux|user experience|user experience design|ux ui|user centered design|ucd
UI Design: user interface design|ui ux|user interface|ui designs|interface design
Visual Design: visual design|visual hierarchy|layout design
Graphic Design: graphic design|print design|layout and typography
Information Architecture: information architecture|card sorting|tree testing|sitemaps|navigation design
User Flows: user flows|user journeys|task flows|user flow|journey maps|journey mapping|customer journey|customer journey mapping|customer journeys
Personas: user personas|persona development|buyer personas
Design Thinking: human centered design|human centred design|hcd|double diamond
Accessibility: web accessibility|wcag|wcag 2.1|wcag 2.2|a11y|section 508|wai aria|aria attributes|ada compliance|inclusive design|screen readers
Typography: type design|font pairing
Branding: brand identity|brand design|visual identity|logo design|brand guidelines
Motion Design: motion graphics|animation|ui animation|lottie
Material Design: material design 3|material you|human interface guidelines|hig
Mobile Design: mobile ui|mobile ux|app design|ios design|android design
UX Writing: content design|microcopy|ux copy
Service Design: service blueprint|service blueprints|service design
Heuristic Evaluation: heuristic analysis|ux audit|ux audits|expert review
Illustration: digital illustration|illustrations|iconography|icon design
Video Editing: video production|video editor|post production|editing video
Photography: photo editing|product photography|photo retouching
Design Critique: design critiques|design reviews|design crits
UserTesting: usertesting.com|maze.co|lookback
Data Visualization Design: information design|infographics|infographic design
`);

  // --- marketing & content ---
  G('marketing', 't', `
Google Ads: adwords|google adwords|google ads manager|youtube ads
Meta Ads: facebook ads|instagram ads|meta ads manager|facebook ads manager|meta advertising|facebook advertising
LinkedIn Ads: linkedin advertising|linkedin campaign manager
TikTok Ads: tiktok advertising
HubSpot: hubspot crm|hubspot marketing hub|hubspot sales hub|hubspot cms
Marketo: adobe marketo|marketo engage
Pardot: salesforce pardot|marketing cloud account engagement
Salesforce Marketing Cloud: sfmc|marketing cloud|exacttarget
Braze
Iterable
Klaviyo
Mailchimp
Customer.io
Eloqua: oracle eloqua
ActiveCampaign: active campaign
Google Analytics: ga4|google analytics 4|universal analytics|ga 4
Google Tag Manager: tag manager|tag management
Google Search Console: search console|bing webmaster tools
Semrush
Ahrefs: moz pro|screaming frog
Hootsuite: sprout social|later.com
WordPress: wordpress cms|woocommerce
Contentful: sanity cms|strapi|sanity.io
Drupal
Shopify: shopify plus|shopify liquid
Adobe Analytics: omniture|adobe experience cloud|adobe experience manager|aem
Unbounce: instapage|landing page builders
Sprinklr
`);
  G('marketing', 'h', `
SEO: search engine optimization|search engine optimisation|technical seo|on page seo|off page seo|seo strategy|keyword research|link building
SEM: search engine marketing|paid search|ppc|pay per click|cpc
Programmatic Advertising: programmatic|dsp|the trade desk|dv360|display advertising|display ads
Paid Social: social ads|paid social media|social advertising
Marketing Automation: marketing automation platforms|marketing automation platform|nurture campaigns|lead nurturing
Email Marketing: email campaigns|email newsletters|newsletters|email deliverability|drip campaigns
Lifecycle Marketing: retention marketing|lifecycle campaigns|crm marketing|customer lifecycle
Content Marketing: content strategy|content creation|content calendar|content calendars|editorial calendar
Copywriting: copy writing|ad copy|marketing copy|website copy|conversion copywriting
Social Media Marketing: social media management|social media strategy|social media campaigns|organic social|social media
Community Management: community building|online community|community engagement
Influencer Marketing: creator partnerships|influencer partnerships|creator marketing|ugc
Affiliate Marketing: affiliate programs|affiliate program|partnerstack|impact.com
Brand Marketing: brand strategy|brand management|brand awareness|brand positioning
Product Marketing: positioning and messaging|messaging and positioning|product positioning|messaging frameworks|sales enablement content
Demand Generation: demand gen|pipeline marketing
Lead Generation: lead gen|generating leads|mql|mqls
Account-Based Marketing: account based marketing|abm
Growth Marketing: growth hacking|growth marketer
Performance Marketing: paid acquisition|user acquisition|paid media|paid marketing|digital advertising|roas
Digital Marketing: digital marketing|online marketing|digital campaigns
Conversion Rate Optimization: cro|conversion optimization|landing page optimization
Marketing Attribution: multi touch attribution|attribution modeling|attribution|mmm|marketing mix modeling|incrementality testing
Marketing Analytics: marketing metrics|campaign analytics|campaign performance analysis
Market Research: market analysis|consumer research|consumer insights|market intelligence
Public Relations: media relations|press releases|press relations|earned media|crisis communications
Event Marketing: events marketing|field marketing|trade shows|tradeshows|conferences and events
Partner Marketing: co marketing|channel marketing
Marketing Strategy: marketing plans|marketing plan|integrated marketing|integrated campaigns|omnichannel marketing
Campaign Management: marketing campaigns|campaign execution|campaign planning|multi channel campaigns
Customer Segmentation: audience segmentation|market segmentation|segmentation
Marketing Operations: marketing ops|mops|martech|marketing technology
App Store Optimization: aso
Retargeting: remarketing
Media Buying: media planning|media plans|media buys
Video Marketing: youtube marketing|short form video|video content
E-commerce: ecommerce|e commerce|online retail|dtc|direct to consumer|d2c
Amazon Marketplace: amazon seller central|amazon vendor central|amazon fba|amazon ads
Content Management Systems: cms|headless cms|content management system
Localization: localisation|translation management|internationalization|i18n|l10n
Content Writing: blog writing|blogging|long form content|article writing|web content
Technical Writing: technical writer|developer documentation|user guides|user manuals|docs as code|knowledge base articles
Copy Editing: copyediting|proofreading|line editing|editorial
AP Style: associated press style|chicago manual of style
Journalism: news writing|reporting and writing|investigative reporting
Grant Writing: grant proposals|grant applications|grant management
Storytelling: brand storytelling|narrative development|data storytelling
Podcasting: podcast production|podcasts
Social Listening: brandwatch|meltwater|cision
`);

  // --- sales, customer success & support ---
  G('sales', 't', `
Salesforce: sfdc|salesforce crm|salesforce.com|sales cloud|service cloud|salesforce lightning
CRM: customer relationship management|crm systems|crm software|crm tools|crm platforms
Microsoft Dynamics 365: dynamics 365|microsoft dynamics|ms dynamics|dynamics crm|d365
Zoho CRM: zoho
Pipedrive
Outreach: !outreach.io|outreach sequences
Salesloft: sales loft
Gong: =Gong|gong.io
ZoomInfo: zoom info
LinkedIn Sales Navigator: sales navigator
Apollo.io: apollo io
Clari
Highspot: seismic|sales enablement platforms
CPQ: configure price quote|salesforce cpq
DocuSign: pandadoc
Gainsight: churnzero|totango|vitally
Zendesk: zendesk support
Intercom
Freshdesk: freshworks|freshservice
Salesforce Service Cloud: service console|salesforce support
`);
  G('sales', 'h', `
B2B Sales: b2b selling|business to business sales|b2b sales experience
SaaS Sales: software sales|selling saas|saas selling|technology sales|tech sales
Enterprise Sales: enterprise selling|enterprise accounts|enterprise deals|strategic accounts
SMB & Mid-Market Sales: smb sales|mid market sales|mid market|smb
Account Management: key account management|account manager|managing accounts|book of business|portfolio of accounts
Pipeline Management: pipeline generation|sales pipeline|pipeline building|building pipeline|pipeline development|pipeline hygiene
Outbound Prospecting: prospecting|cold outreach|cold emailing|outbound sales|outbound prospecting|outbound|sales sequences
Cold Calling: cold calls|cold call|dials
MEDDIC: meddpicc|meddicc
Challenger Sale: challenger selling|challenger methodology
SPIN Selling
Solution Selling: consultative selling|consultative sales|solution sales
Value Selling: value based selling|value selling framework|command of the message
Sandler Selling: sandler|sandler training
Quota Attainment: quota carrying|exceeded quota|met quota|quota|president s club|presidents club|exceeding targets
Closing Deals: deal closing|closed won|closing business|close deals
Sales Forecasting: forecast accuracy|pipeline forecasting|revenue forecasting
Territory Management: territory planning|territory development|account planning
Lead Qualification: qualifying leads|bant|lead scoring|sales qualified leads|sqls|sql handoff
Discovery Calls: discovery meetings|needs analysis|needs assessment
Product Demos: demos|product demonstrations|software demos|product demo|live demos
Upselling: upsell|cross selling|cross sell|expansion revenue|account expansion|land and expand
Renewals: contract renewals|renewal management
Customer Retention: churn reduction|reducing churn|churn prevention|customer churn|retention strategies
Customer Success: customer success management|customer success strategy|customer outcomes
Customer Onboarding: client onboarding|customer implementation|implementation management|customer implementations
Channel Sales: channel partnerships|partner management|reseller|resellers|var partners|indirect sales
Strategic Partnerships: partnerships|alliances|partner ecosystem|business partnerships|alliance management
Business Development: biz dev|bizdev|new business development|new business
Inside Sales: inside sales representative
Field Sales: outside sales|territory sales
Retail Sales: retail sales|clienteling
RFPs: rfp|rfp responses|request for proposal|requests for proposal|rfi|proposal writing|proposal management
Sales Enablement: sales training|sales coaching|sales playbooks|sales playbook
Revenue Operations: revops|sales operations|sales ops|gtm operations
Sales Engineering: presales|pre sales|solutions consulting|technical sales|solution engineering|proof of concept|technical validation
Sales Strategy: sales planning|sales plans|sales methodology|sales process
Full-Cycle Sales: full cycle sales|full sales cycle|end to end sales cycle|full cycle selling
Social Selling: linkedin selling
Contract Negotiation: contract negotiations|negotiating contracts|commercial negotiations|deal negotiation
Customer Service: client service|customer support|customer care|guest services|customer experience|cx
Technical Support: tech support|technical troubleshooting|application support|production support|l2 support|l3 support
Ticketing Systems: ticketing system|support tickets|ticket management|ticketing tools
SLAs: sla|service level agreements|service level agreement|sla management
Escalation Management: escalations|handling escalations|escalation handling
Customer Satisfaction: csat|customer satisfaction scores
QBRs: qbr|quarterly business reviews|quarterly business review|executive business reviews|ebr|ebrs
Client Relationship Management: client relationships|relationship building|relationship management|building relationships|trusted advisor
Call Center Operations: call center|contact center|inbound calls|high volume calls
Live Chat Support: chat support|email support|omnichannel support
Knowledge Base Management: knowledge base|help center|self service content
`);

  // --- finance & accounting ---
  G('finance', 't', `
NetSuite: oracle netsuite|netsuite erp
SAP: sap erp|s 4hana|s4hana|sap s 4hana|sap fico|sap fi co|sap hana|sap ecc|sap mm|sap sd
Oracle ERP: oracle erp|oracle fusion|oracle e business suite|oracle ebs|oracle financials|oracle cloud erp
JD Edwards: jde|jd edwards enterpriseone
QuickBooks: quickbooks online|qbo|quickbooks desktop
Xero
Sage Intacct: intacct|sage 50|sage 100
Bloomberg Terminal: bloomberg
FactSet
Capital IQ: capiq|s&p capital iq
PitchBook: preqin|crunchbase
Oracle Hyperion: hyperion|essbase|oracle epm
Anaplan
Adaptive Planning: workday adaptive|adaptive insights|workday adaptive planning|planful|vena solutions
BlackLine
Bill.com: tipalti|brex|ramp expense
SAP Concur: concur|expensify|navan
Coupa
SAP Ariba: ariba
Workiva: wdesk
Avalara: vertex tax
`);
  G('finance', 'h', `
Financial Modeling: financial models|financial modelling|financial model|three statement model|3 statement model|operating model|operating models
LBO Modeling: lbo|leveraged buyout|leveraged buyouts
FP&A: financial planning and analysis|financial planning & analysis|fp a
Budgeting: budget planning|annual budget|budgets|budget preparation|annual operating plan|aop
Forecasting: financial forecasting|rolling forecasts|rolling forecast|forecasts|reforecasting
Variance Analysis: budget vs actual|budget vs actuals|bva|variance reporting|flux analysis
GAAP: us gaap|generally accepted accounting principles
IFRS: international financial reporting standards
Financial Reporting: financial statements|management reporting|financial statement preparation|monthly reporting|board reporting
SEC Reporting: sec filings|10 k|10 q|8 k|sec compliance
Month-End Close: month end close|month end closing|financial close|close process|month end|quarter end close|year end close
General Ledger: gl|journal entries|gl accounting|chart of accounts|ledger
Accounts Payable: ap processing|invoice processing|three way match|3 way match|vendor payments
Accounts Receivable: ar collections|collections management|cash application|billing and collections|credit and collections
Reconciliation: account reconciliation|account reconciliations|bank reconciliation|bank reconciliations|reconciliations|balance sheet reconciliations
Payroll: payroll processing|payroll administration|multi state payroll
Valuation: valuations|business valuation|company valuation|valuation models|comparable companies|trading comps|precedent transactions
DCF: discounted cash flow|dcf models|dcf analysis
M&A: mergers and acquisitions|mergers & acquisitions|m&a transactions|corporate development|corp dev
Due Diligence: financial due diligence|commercial due diligence|diligence
Audit: auditing|audits|external audit|statutory audit|audit procedures|financial audits
Internal Audit: internal auditing|operational audits
Internal Controls: internal control|icfr|control testing|controls testing|coso
SOX Compliance: sox|sarbanes oxley|sox 404|sox controls
Tax: tax preparation|tax compliance|tax returns|corporate tax|income tax|sales tax|tax planning|tax provision
Treasury: treasury management|cash management|liquidity management|fx hedging
Cash Flow Management: cash flow analysis|cash flow forecasting|cash flow|working capital
P&L Management: p&l|profit and loss|p&l responsibility|profit & loss|income statement
Revenue Recognition: asc 606|rev rec|revenue accounting
Lease Accounting: asc 842|ifrs 16
Cost Accounting: standard costing|cost analysis|cost allocation|activity based costing|cogs
Accounting: accrual accounting|financial accounting|corporate accounting|accounting principles
Bookkeeping: book keeping|bookkeeper
Accruals: prepaids|prepaid expenses|accrued expenses
Fixed Assets: fixed asset accounting|depreciation
Intercompany Accounting: intercompany|intercompany reconciliations
Consolidation: financial consolidation|consolidations|consolidated financial statements
Equity Research
Investment Banking: investment banking|capital raising|pitch books|pitchbooks
Private Equity: private equity|portfolio companies
Venture Capital: venture capital|startup investing|deal sourcing
Portfolio Management: asset allocation|portfolio construction|wealth management|asset management
Credit Analysis: credit risk|underwriting|credit underwriting|commercial lending|loan underwriting
Financial Analysis: financial analytics|ratio analysis|financial statement analysis
Corporate Finance: capital allocation|capital budgeting|cost of capital|wacc
Capital Markets: debt capital markets|equity capital markets|ecm|dcm
Fixed Income: bonds|credit markets|rates trading
Derivatives: options pricing|futures|swaps|options trading
Quantitative Finance: quantitative analysis|quant|quantitative research|quantitative modeling|stochastic calculus
Algorithmic Trading: trading strategies|high frequency trading|hft|systematic trading|market making
Risk Modeling: market risk|var models|value at risk|stress testing models|credit risk modeling
Billing & Invoicing: billing|invoicing|billing operations
Expense Management: expense reports|t&e|travel and expense|expense reporting
Financial Compliance: regulatory reporting|basel iii|ccar|dodd frank|finra rules
Insurance: insurance underwriting|actuarial|actuarial science|claims processing|claims adjusting
Real Estate Finance: real estate finance|commercial real estate|cre|argus|property management
Fundraising: capital campaigns|donor relations|major gifts|development and fundraising
`);

  // --- HR, recruiting & education ---
  G('hr', 't', `
Workday: workday hcm|workday hris|workday financials|workday recruiting
Greenhouse: greenhouse ats|greenhouse.io
Lever: =Lever|lever ats|lever.co
iCIMS
Taleo: oracle taleo
SuccessFactors: sap successfactors
BambooHR: bamboo hr
ADP: adp workforce now|adp vantage|adp payroll
Gusto
Rippling
UKG: ultipro|kronos|ukg pro
Paylocity: paycom|paychex|paycor
Ashby: !ashby ats|ashbyhq
LinkedIn Recruiter: linkedin recruiter lite
Applicant Tracking Systems: ats|applicant tracking system|applicant tracking systems|ats platforms
Lattice: !lattice hr|lattice performance|culture amp|15five
LMS: learning management system|learning management systems|canvas lms|moodle|blackboard|docebo|cornerstone ondemand
Google Classroom: seesaw|schoology
Articulate Storyline: articulate 360|articulate rise|adobe captivate|camtasia
`);
  G('hr', 'h', `
Full-Cycle Recruiting: full cycle recruiting|full life cycle recruiting|end to end recruiting|full cycle recruitment|full lifecycle recruiting|360 recruiting
Candidate Sourcing: talent sourcing|boolean search|boolean sourcing|passive candidate sourcing|candidate pipelines|talent pipelines
Technical Recruiting: tech recruiting|engineering recruiting|technical recruitment
Talent Acquisition: recruiting|recruitment|hiring process
Interviewing: structured interviews|candidate screening|phone screens|behavioral interviewing|interview loops
Employer Branding: employer brand|talent branding
HRIS: human resources information system|human resources information systems|hcm|hris administration
Employee Onboarding: onboarding|new hire onboarding|new hire orientation
Compensation & Benefits: compensation and benefits|comp and benefits|comp & benefits|total rewards|compensation analysis|compensation planning|benefits administration|benefits enrollment|open enrollment
Employee Relations: workplace investigations|employee investigations|labor relations|union relations
Performance Management: performance reviews|performance appraisals|performance evaluations|performance improvement plans
Talent Management: succession planning|talent development|talent reviews|high potential programs
Learning & Development: l&d|learning and development|training and development|corporate training|training programs|employee training
HR Business Partnering: hrbp|hr business partner|hr business partnering|strategic hr
Employment Law: labor law|labour law|flsa|fmla|eeo|eeoc|title vii|employment regulations
HR Compliance: hr policies|hr policy|employee handbook|policy development
DEI: diversity equity and inclusion|diversity and inclusion|d&i|deib|dei initiatives|inclusion and belonging
Workforce Planning: headcount planning|strategic workforce planning|headcount forecasting
People Analytics: hr analytics|workforce analytics|hr metrics|attrition analysis
Employee Engagement: engagement surveys|employee experience|culture initiatives|employee retention
Organizational Development: org development|organizational design|org design|organizational effectiveness
HR Operations: hr operations|people operations|people ops|hr administration|hr generalist
Offboarding: exit interviews|separations
Background Checks: background screening|i 9|e verify|i9 compliance
Offer Management: offer negotiation|offer letters|closing candidates
Diversity Recruiting: diversity sourcing|inclusive hiring
Recruitment Marketing: recruitment marketing|talent marketing
Campus Recruiting: university recruiting|campus recruitment|early careers recruiting|early talent
Executive Search: executive recruiting|retained search
Curriculum Development: curriculum design|curriculum planning|course design|course development
Instructional Design: addie|instructional designer|elearning development|e learning|elearning|blended learning
Lesson Planning: lesson plans|lesson plan
Classroom Management: behavior management|classroom instruction
Differentiated Instruction: differentiated learning|instructional scaffolding|udl|universal design for learning
Special Education: iep|ieps|individualized education program|sped|504 plans
Student Assessment: formative assessment|summative assessment|student assessments|grading
Tutoring: tutor|academic tutoring|test prep
ESL Instruction: esl|ell|english language learners|teaching english|efl
Early Childhood Education: early childhood|preschool|pre k|montessori
STEM Education: stem education|stem curriculum
Educational Technology: edtech|educational technology|technology integration
Training Delivery: training facilitation|instructor led training|ilt|vilt|train the trainer
Coaching: executive coaching|leadership coaching|career coaching|coaching and development
`);

  // --- healthcare & life sciences ---
  G('health', 't', `
EHR: electronic health records|electronic health record|emr systems|emr ehr|ehr emr|electronic medical records|electronic medical record|ehr systems
Epic: =Epic|epic systems|epic ehr|epic emr|epiccare|epic certification|epic hyperspace
Cerner: oracle health|cerner millennium|cerner powerchart
Meditech
athenahealth: athenaone|athenaclinicals
eClinicalWorks: nextgen healthcare|allscripts
HL7: fhir|hl7 fhir|hl7 interfaces
Veeva: veeva vault|veeva crm
Medidata: medidata rave|rave edc|edc systems|electronic data capture
`);
  G('health', 'h', `
HIPAA: hipaa compliance|hipaa regulations|phi|protected health information
Patient Care: direct patient care|bedside care|patient centered care|quality patient care
Patient Assessment: patient assessments|vital signs|health assessments|nursing assessments
Medication Administration: med administration|med pass|medication management|medication reconciliation
ICD-10: icd10|icd 10 cm|icd 10 pcs|icd coding
CPT Coding: cpt|cpt codes|hcpcs
Medical Coding: hcc coding|risk adjustment coding|inpatient coding|outpatient coding|diagnosis coding
Medical Billing: revenue cycle management|rcm|revenue cycle|claims submission|denials management|denial management
Clinical Research: clinical trials|clinical studies|clinical trial management|clinical operations|site monitoring
Good Clinical Practice: good clinical practice|ich gcp guidelines|ich e6
Clinical Documentation: charting|nursing documentation|medical documentation|clinical notes|soap notes
Triage: patient triage|telephone triage
Critical Care: icu|intensive care|intensive care unit|critical care nursing|ccu
Emergency Care: emergency department|emergency room|emergency medicine|emergency nursing|trauma care
Med-Surg: med surg|medical surgical|medical surgical nursing
Pediatrics: pediatric nursing|pediatric care|picu|nicu|neonatal
Labor & Delivery: labor and delivery|obstetrics|l&d nursing|maternal health
Operating Room: perioperative|surgical services|scrub nurse
Oncology: oncology nursing|cancer care|chemotherapy administration
Phlebotomy: venipuncture|blood draws|specimen collection
IV Therapy: iv insertion|iv starts|iv administration|infusion therapy
Wound Care: wound management|wound assessment
Care Coordination: case management|care management|patient navigation|care transitions
Discharge Planning: discharge planning|transitions of care
Infection Control: infection prevention|sterile technique|aseptic technique
Patient Education: health education|patient teaching
Telehealth: telemedicine|virtual care|remote patient monitoring
Medical Terminology
Utilization Review: utilization management|medical necessity review
Prior Authorization: prior authorizations|prior auths|prior auth|pre authorization
Insurance Verification: eligibility verification|benefits verification
Patient Scheduling: medical scheduling|appointment scheduling|front desk operations
FDA Regulations: fda compliance|21 cfr part 11|21 cfr|510 k|pma submissions|fda submissions
Regulatory Affairs: regulatory submissions|regulatory strategy|ind submissions|nda submissions
GMP: cgmp|good manufacturing practice|good manufacturing practices|gxp
GLP: good laboratory practice
Pharmacovigilance: drug safety|adverse event reporting
Medical Devices: medical device|iso 13485|iec 62304|samd
Biostatistics: clinical statistics|survival analysis
Epidemiology: epidemiological research
Public Health: population health|community health
Behavioral Health: mental health|crisis intervention|substance abuse counseling|psychiatric nursing
Cognitive Behavioral Therapy: cbt|cognitive behavioural therapy
Dialectical Behavior Therapy
Social Work: clinical social work|psychosocial assessments|lcsw|lmsw
Laboratory Techniques: lab techniques|pcr|elisa assays|western blot|cell culture|tissue culture|flow cytometry|assay development
Molecular Biology: molecular cloning|crispr|ngs|next generation sequencing|genomics|dna sequencing
Bioinformatics: computational biology|biopython|sequence analysis
Pharmacy: pharmacy operations|dispensing|prescription processing|sterile compounding
Physical Therapy: physiotherapy|rehabilitation|occupational therapy
Radiology: medical imaging|x ray|ct scans|mri
Dental: dental assisting|dental hygiene|dentistry
Healthcare Administration: healthcare management|hospital administration|practice management|clinic operations
Quality Improvement in Healthcare: patient safety|healthcare quality|joint commission|cms regulations|hedis
Long-Term Care: long term care|skilled nursing|geriatrics|home health|hospice|palliative care
`);

  // --- operations, supply chain, engineering & legal ---
  G('ops', 't', `
ERP: erp systems|enterprise resource planning|erp implementation
Manhattan Associates: manhattan wms|manhattan scale
Blue Yonder: jda software
Kinaxis: kinaxis rapidresponse|o9 solutions
AutoCAD: autodesk autocad|autocad civil 3d
SolidWorks: solid works
Revit: autodesk revit|bim|building information modeling
CATIA: siemens nx|creo|ptc creo
CAD: computer aided design|cad software|cad modeling|cad drafting
ANSYS: finite element analysis|fea|cfd|computational fluid dynamics|abaqus
Simulink
LabVIEW
Westlaw
LexisNexis: lexis nexis|lexis
Relativity: ediscovery|e discovery|electronic discovery
Clio: legal practice management software
Ironclad: contract lifecycle software
`);
  G('ops', 'h', `
Supply Chain Management: supply chain|scm|end to end supply chain|supply chain operations|supply chain planning
Logistics: logistics management|3pl|third party logistics|logistics operations|reverse logistics
Transportation Management: tms|freight management|freight|shipping and receiving|carrier management|freight forwarding
Procurement: purchasing|strategic sourcing|sourcing strategy|indirect procurement|direct procurement|purchase orders|procure to pay
Inventory Management: inventory control|inventory planning|stock control|inventory optimization|cycle counts|cycle counting
Demand Planning: demand forecasting|s&op|sales and operations planning|supply planning|ibp
Six Sigma: dmaic|six sigma methodology
Lean Six Sigma: lean six sigma|lss
Lean Manufacturing: lean principles|lean methodology|lean production|5s|toyota production system|tps|lean operations
Continuous Improvement: kaizen|ci initiatives|continuous improvement initiatives|operational excellence
Warehouse Management: wms|warehouse operations|warehousing|distribution center operations|fulfillment center
Production Planning: production scheduling|mrp|material requirements planning|master production scheduling
Manufacturing: manufacturing operations|manufacturing processes|production operations|assembly line|shop floor
Quality Control: qc|quality inspection|quality inspections|inspection procedures
Quality Management Systems: qms|quality management system|quality systems|capa|corrective and preventive action
ISO 9001: iso 9001 2015|iso standards
Root Cause Analysis: rca|5 whys|five whys|fishbone|ishikawa|8d|root cause
FMEA: failure mode and effects analysis|pfmea|dfmea
Statistical Process Control: spc|control charts
GD&T: geometric dimensioning and tolerancing
CNC: cnc machining|cnc programming|machining|g code
PLC Programming: plc|plcs|programmable logic controllers|ladder logic|allen bradley|siemens plc
SCADA: hmi|industrial automation|dcs
Mechanical Design: mechanical engineering|product design engineering|tolerance analysis|dfm|design for manufacturing
Electrical Engineering: circuit design|pcb design|altium|schematic capture|power electronics|analog design
Civil Engineering: structural engineering|structural analysis|site development|stormwater
Operations Management: business operations|operational planning|ops management|day to day operations
Facilities Management: facility management|facilities operations|building operations|facilities maintenance
Fleet Management: fleet operations|dispatching|route planning|route optimization
Trade Compliance: customs compliance|import export|incoterms|customs brokerage|hts classification
EHS: environmental health and safety|hse|health and safety|workplace safety|safety programs|safety compliance
OSHA: osha regulations|osha compliance
Order Management: order fulfillment|fulfillment|order processing|order to cash|o2c
Project Scheduling: construction scheduling|schedule management|master schedules
Construction Management: construction project management|general contracting|site supervision|construction operations
Estimating: cost estimating|construction estimating|quantity takeoff|takeoffs|bid preparation
Event Planning: event management|event coordination|event logistics|corporate events
Office Management: office administration|office operations|front office
Calendar Management: calendaring|travel coordination|travel arrangements|executive support|executive assistance|diary management
Data Entry: data input|records management
Merchandising: visual merchandising|planograms|assortment planning|category management
Retail Operations: store operations|store management|loss prevention|pos systems|point of sale|cash handling
Food Safety: haccp|food handling|sanitation standards
Hospitality: hotel operations|front desk|guest relations|food and beverage|f&b
Contract Drafting: drafting contracts|contract review|contract drafting|commercial contracts|redlining|msas|ndas
Legal Research: case law research|statutory research
Litigation: litigation support|civil litigation|depositions|discovery requests|motions practice
Regulatory Compliance: compliance programs|compliance monitoring|compliance management|regulatory requirements|compliance frameworks
Corporate Governance: corporate law|board governance|corporate secretarial|entity management
Intellectual Property: patents|patent prosecution|trademarks|ip law|patent law|ip strategy
Legal Writing: brief writing|legal drafting|legal memoranda|legal memos
Paralegal Support: paralegal|legal assistance|legal support|case files
Privacy Law: privacy law|data protection law
Commercial Law: commercial transactions|technology transactions|saas agreements|licensing agreements
Lease Administration: lease administration|lease abstraction
`);

  // --- office productivity ---
  G('office', 't', `
Microsoft Excel: excel|ms excel|excel spreadsheets|spreadsheets
Advanced Excel: pivot tables|pivot table|pivottables|vlookup|xlookup|hlookup|index match|power query|power pivot|excel formulas|advanced excel|excel macros and formulas|sumifs
Microsoft Word: ms word
PowerPoint: microsoft powerpoint|ms powerpoint|ppt|powerpoint presentations|slide decks
Microsoft Outlook: ms outlook|=Outlook
Microsoft Office: ms office|microsoft office suite|ms office suite|office suite
Microsoft 365: office 365|o365|m365|microsoft 365 administration
Microsoft Teams: ms teams
SharePoint: sharepoint online|onedrive
Microsoft Access: ms access
Google Sheets: google spreadsheets|gsheets|google sheet
Google Docs: google slides|google forms|google drive
Google Workspace: g suite|gsuite|google apps|google suite
Google Apps Script: apps script
Slack: =Slack|slack workflows|slack administration
Zoom: =Zoom|zoom meetings|zoom video|webex|google meet
Keynote: =Keynote|apple keynote|apple iwork
Adobe Acrobat: acrobat|acrobat pro
Microsoft Copilot: microsoft 365 copilot|m365 copilot|copilot studio
ChatGPT: chatgpt enterprise|chat gpt|generative ai tools
Typing: typing speed|wpm|words per minute|10 key
`);

  // --- BI & visualization ---
  G('bi', 't', `
Tableau: tableau desktop|tableau server|tableau prep|tableau cloud
Power BI: powerbi|dax|power bi desktop|power bi service|power query m
Looker: lookml|looker explores ~ looker studio
Looker Studio: google data studio|data studio
Metabase
Mode Analytics: mode analytics
Sigma Computing: sigma computing|sigma bi
Apache Superset: superset|preset.io
Qlik: qlikview|qlik sense
MicroStrategy
Domo
ThoughtSpot
Hex: !hex.tech|hex notebooks
Sisense
SSRS: sql server reporting services|ssas|sql server analysis services
IBM Cognos: cognos
SAP BusinessObjects: business objects|businessobjects|sap bo|crystal reports
Dashboards: dashboarding|dashboard development|building dashboards|dashboard design|executive dashboards|kpi dashboards
Data Visualization: data visualisation|data viz|dataviz|visualizations|data visualizations|matplotlib|seaborn|plotly|ggplot
Business Intelligence: bi|bi tools|bi reporting|bi development|business intelligence tools ~ bi weekly|bi monthly|bi annual|bi annually|bi directional|bi lingual|bi coastal
Reporting & Analytics: reporting and analytics|analytics and reporting|ad hoc reporting|automated reporting|report development
Semantic Layer: metrics layer|cube.dev|metricflow|dbt semantic layer
`);

  // --- soft skills ---
  G('soft', 's', `
Communication: communication skills|written communication|verbal communication|written and verbal communication|oral communication|communicator|communicating complex|clear communication
Leadership: team leadership|people leadership|leading teams|leadership skills|technical leadership|thought leadership
Stakeholder Management: stakeholder engagement|managing stakeholders|stakeholder communication|stakeholder alignment|stakeholder relationships|stakeholders
Cross-Functional Collaboration: cross functional collaboration|cross functional teams|cross functional|collaboration|collaborative|cross team collaboration|partnering with engineering
Mentoring: mentorship|mentored|mentor|mentoring junior engineers|mentoring engineers
Problem Solving: problem solver|solving problems|complex problem solving|creative problem solving
Troubleshooting: troubleshoot|diagnosing issues|issue resolution
Critical Thinking: analytical thinking|analytical skills|analytical mindset|first principles thinking|structured thinking
Presentation Skills: presentations|public speaking|presenting|presentation|presenting to executives
Negotiation: negotiation skills|negotiating|negotiations
Ownership: accountability|bias for action|end to end ownership|sense of ownership
Time Management: prioritization|multitasking|multi tasking|managing multiple priorities|competing priorities|deadline driven
Adaptability: flexibility|adaptable|ambiguity|comfortable with ambiguity|navigating ambiguity|fast paced environment
Attention to Detail: attention to details|accuracy and attention to detail|meticulous
Teamwork: team collaboration|working in teams|collaborative team environment
Emotional Intelligence: eq|empathy|empathetic
Conflict Resolution: conflict management|resolving conflicts|de escalation
Decision Making: data driven decision making|data driven decisions|sound judgment|good judgment|judgment|decisiveness
Strategic Thinking: strategic mindset|big picture thinking|systems thinking
Strategic Planning: strategy development|long range planning|strategic initiatives|annual planning
Creativity: creative thinking|innovative thinking|ideation
Customer Focus: customer obsession|customer centric|customer centricity|customer first|client focus|user empathy
Influence: influencing|influence without authority|influencing without authority|persuasion|persuasive
Team Building: building teams|building high performing teams|scaling teams|hiring and developing|growing teams
People Management: direct reports|managing teams|team management|line management|managing managers|managing people
Executive Communication: executive presence|communicating with executives|executive stakeholders|exec communication
Facilitation: workshop facilitation|facilitating workshops|meeting facilitation|facilitating meetings
Active Listening: listening skills
Interpersonal Skills: interpersonal communication|people skills|rapport building
Writing Skills: business writing|strong writer|written skills|writing ability|clear writing|excellent writing
Remote Collaboration: remote work|distributed teams|async communication|asynchronous communication|remote teams
Business Acumen: commercial acumen|commercial awareness|business sense|financial acumen
Curiosity: intellectual curiosity|growth mindset|continuous learning|eager to learn|learning agility
Self-Management: work independently|working independently|self directed|independent worker|minimal supervision
Resilience: perseverance|grit|composure under pressure|works well under pressure
Cultural Awareness: cultural competence|cross cultural communication|global teams|multicultural
Customer Empathy: customer empathy|patient empathy|bedside manner
Professionalism: work ethic|dependability|punctuality|dependable
Organizational Skills: highly organized|well organized|organization skills|organisational skills|planning and organizing
`);

  // --- certifications & licences ---
  G('cert', 'c', `
AWS Certified Solutions Architect: aws solutions architect|aws certified solutions architect associate|aws certified solutions architect professional|aws csa|saa c03|aws solutions architect associate|aws solutions architect professional
AWS Certified Developer: aws developer associate|aws certified developer associate
AWS Certified SysOps Administrator: aws sysops|aws sysops administrator
AWS Certified DevOps Engineer: aws devops engineer professional|aws devops professional
AWS Certified Cloud Practitioner: aws cloud practitioner
AWS Certified Machine Learning: aws machine learning specialty|aws ml specialty|aws certified machine learning engineer
AWS Certified Security Specialty: aws security specialty
CKA: certified kubernetes administrator
CKAD: certified kubernetes application developer
CKS: certified kubernetes security specialist
Google Professional Cloud Architect: gcp professional cloud architect|google cloud professional cloud architect|professional cloud architect
Google Professional Data Engineer: gcp professional data engineer|professional data engineer certification
Google Associate Cloud Engineer: associate cloud engineer
Azure Fundamentals (AZ-900): az 900|az900|azure fundamentals
Azure Administrator (AZ-104): az 104|az104|azure administrator associate|azure administrator certification
Azure Solutions Architect (AZ-305): az 305|az305|azure solutions architect expert|azure solutions architect
Azure Developer (AZ-204): az 204|az204|azure developer associate
Azure DevOps Engineer (AZ-400): az 400|az400|azure devops engineer expert
Azure Data Engineer (DP-203): dp 203|dp203|azure data engineer associate
Azure AI Engineer (AI-102): ai 102|azure ai engineer associate
Terraform Associate: hashicorp certified terraform associate|hashicorp terraform associate
CISSP: certified information systems security professional
CISM: certified information security manager
CISA: certified information systems auditor
CompTIA Security+: security+|security plus|sec+
CompTIA Network+: network+|network plus
CompTIA A+: a+ certification|a+ certified
CEH: certified ethical hacker
OSCP: offensive security certified professional|oswe|osep
GIAC: gsec|gcih|gcia|gpen
CCSP: certified cloud security professional
CCNA: cisco certified network associate
CCNP: cisco certified network professional|ccie
PMP: project management professional|pmp certified|pmp certification
CAPM: certified associate in project management
PRINCE2: prince2 practitioner|prince2 foundation|prince 2
CSM (Certified ScrumMaster): csm|certified scrummaster|certified scrum master|csm certified
PSM: professional scrum master|psm i|psm ii
CSPO: certified scrum product owner|pspo|professional scrum product owner
SAFe Agilist: safe agilist|safe 6 agilist|leading safe|safe certified|safe spc
PMI-ACP: pmi acp|pmi agile certified practitioner
CPA: certified public accountant|cpa license|licensed cpa|cpa eligible|cpa candidate
CFA: chartered financial analyst|cfa charterholder|cfa level i|cfa level ii|cfa level iii|cfa level 1|cfa level 2
CMA: certified management accountant
CIA (Certified Internal Auditor): certified internal auditor
Enrolled Agent: ea license|irs enrolled agent
FRM: financial risk manager
FINRA Licenses: series 7|series 63|series 65|series 66|series 79|series 24|finra licensed|finra licenses
CFP: certified financial planner
CAMS: certified anti money laundering specialist
SHRM-CP: shrm certified professional
SHRM-SCP: shrm senior certified professional
PHR: professional in human resources
SPHR: senior professional in human resources
Six Sigma Green Belt: green belt|lean six sigma green belt|lssgb|cssgb|six sigma green belt certified
Six Sigma Black Belt: black belt|lean six sigma black belt|lssbb|cssbb|master black belt
APICS CPIM: cpim|certified in planning and inventory management
APICS CSCP: cscp|certified supply chain professional
CPSM: certified professional in supply management
ITIL: itil v4|itil 4|itil foundation|itil certified|itil v3
RHCSA: red hat certified system administrator|rhce|red hat certified engineer
Salesforce Administrator: salesforce certified administrator|salesforce admin|sfdc admin|salesforce administration|advanced administrator
Salesforce Developer Certification: platform developer i|platform developer ii|salesforce platform developer|salesforce certified developer
Google Analytics Certification: google analytics certified|gaiq|google analytics individual qualification
Google Ads Certification: google ads certified|google ads search certification
HubSpot Certification: hubspot certified|hubspot inbound certification|hubspot inbound marketing certification
Tableau Certification: tableau certified|tableau desktop specialist|tableau certified data analyst
Power BI Certification: pl 300|da 100|power bi data analyst associate
Databricks Certification: databricks certified|databricks certified data engineer associate
SnowPro: snowpro core|snowflake certified
Registered Nurse (RN): registered nurse|rn license|rn|licensed rn|bsn rn|rn bsn|active rn license
NCLEX: nclex rn|nclex pn
Nurse Practitioner: np|aprn|fnp|fnp bc|family nurse practitioner ~ np hard|np complete
LPN: licensed practical nurse|lvn|licensed vocational nurse
CNA: certified nursing assistant|certified nurse aide
BLS: basic life support|bls certification|bls certified
ACLS: advanced cardiac life support|acls certification|acls certified
PALS: pediatric advanced life support
CPR: cpr certified|cpr certification|first aid|first aid certified
CCRN: critical care registered nurse
EMT: emergency medical technician|paramedic|nremt
Certified Medical Assistant: ccma|certified clinical medical assistant
CPC (Certified Professional Coder): certified professional coder|aapc cpc|ccs|certified coding specialist|rhit|rhia
Pharmacy Technician: cpht|certified pharmacy technician
Security Clearance: secret clearance|top secret|ts sci|active clearance|public trust|security clearance required|dod clearance
CDL: commercial driver s license|commercial drivers license|class a cdl|class b cdl
Forklift Certification: forklift|forklift certified|forklift operator|reach truck|pallet jack
ServSafe: servsafe certified|food handler|food handlers card
Teaching License: teaching credential|teaching certificate|certified teacher|state teaching certification|teaching certification
TESOL: tefl|celta|tesol certification|esl certification
Bar Admission: admitted to the bar|admitted to practice law|licensed to practice law|active bar membership|member of the state bar|licensed attorney
PE License: professional engineer license|licensed professional engineer|pe licensed|eit|fe exam
LEED: leed ap|leed green associate
OSHA 30: osha 10|osha 30 hour|osha 10 hour
Real Estate License: licensed real estate agent|real estate salesperson license|realtor
Insurance License: property and casualty license|p&c license|life and health license|insurance producer license
Notary Public: notary|commissioned notary
`);

  // --- spoken languages ---
  ['English', 'French', 'German', 'Japanese', 'Korean', 'Hindi', 'Arabic', 'Russian', 'Italian', 'Dutch', 'Vietnamese', 'Tagalog', 'Polish', 'Turkish', 'Hebrew', 'Bengali', 'Urdu', 'Punjabi', 'Tamil', 'Telugu', 'Swahili', 'Greek', 'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Ukrainian', 'Thai', 'Cantonese', 'Gujarati', 'Marathi', 'Romanian', 'Czech', 'Hungarian'].forEach((n) => L(n));
  L('Spanish', 'espanol|español|bilingual english spanish|bilingual english and spanish');
  L('Mandarin', 'mandarin chinese|chinese mandarin|chinese|putonghua|fluent in chinese');
  L('Portuguese', 'brazilian portuguese');
  L('Indonesian', 'bahasa indonesia');
  L('Persian', 'farsi');
  L('Haitian Creole', 'kreyol');
  S('American Sign Language', 'language', 'l', 'asl|sign language');
  S('Bilingual', 'language', 'l', 'multilingual|bilingual candidates|bilingual preferred|bilingual required');

  // --- transferable-skill families ---
  const families = [];
  const F = (group, credit, members) => families.push({ group: group, members: members.split('|'), credit: credit });
  F('cloud-provider', 0.35, 'AWS|Google Cloud|Microsoft Azure|Oracle Cloud');
  F('relational-db', 0.6, 'PostgreSQL|MySQL|SQL Server|Oracle Database|MariaDB|Amazon Aurora|CockroachDB|SQLite');
  F('nosql-document', 0.5, 'MongoDB|Amazon DynamoDB|Azure Cosmos DB|Couchbase|Firestore');
  F('wide-column', 0.55, 'Apache Cassandra|ScyllaDB|Apache HBase|Cloud Bigtable');
  F('frontend-framework', 0.4, 'React|Vue.js|Angular|Svelte|SolidJS|Ember.js|Preact');
  F('react-meta', 0.7, 'React|Next.js|Remix|Gatsby');
  F('vue-meta', 0.7, 'Vue.js|Nuxt');
  F('svelte-meta', 0.75, 'Svelte|SvelteKit');
  F('python-web', 0.5, 'Django|Flask|FastAPI');
  F('node-web', 0.6, 'Express.js|NestJS|Fastify|Hono');
  F('mvc-web', 0.35, 'Ruby on Rails|Laravel|Django|Spring Boot|ASP.NET|Phoenix Framework|Symfony');
  F('spring', 0.8, 'Spring Boot|Spring Framework');
  F('jvm-lang', 0.5, 'Java|Kotlin|Scala|Groovy');
  F('c-family', 0.6, 'C|C++');
  F('js-ts', 0.8, 'JavaScript|TypeScript');
  F('dotnet', 0.7, 'C#|.NET|ASP.NET');
  F('functional-lang', 0.35, 'Haskell|OCaml|F#|Clojure|Elixir|Erlang|Scala');
  F('shell', 0.6, 'Bash|PowerShell');
  F('sql-dialect', 0.8, 'SQL|T-SQL|PL/SQL');
  F('stats-tools', 0.5, 'R|SAS|Stata|SPSS|MATLAB|Julia');
  F('iac', 0.5, 'Terraform|Pulumi|AWS CloudFormation|AWS CDK|ARM Templates');
  F('config-mgmt', 0.5, 'Ansible|Chef|Puppet|SaltStack');
  F('ci', 0.6, 'Jenkins|GitHub Actions|GitLab CI|CircleCI|Travis CI|TeamCity|Atlassian Bamboo|Buildkite|Azure DevOps');
  F('gitops', 0.6, 'Argo CD|Flux|Spinnaker');
  F('container-orchestration', 0.5, 'Kubernetes|OpenShift|Amazon ECS|HashiCorp Nomad');
  F('serverless', 0.6, 'AWS Lambda|Azure Functions|Google Cloud Functions|Google Cloud Run');
  F('vcs', 0.6, 'Git|SVN|GitHub|GitLab|Bitbucket');
  F('observability', 0.5, 'Datadog|New Relic|Prometheus|Grafana|Dynatrace|AppDynamics|Honeycomb|ELK Stack|OpenTelemetry|Amazon CloudWatch|Sentry');
  F('cache', 0.7, 'Redis|Memcached');
  F('message-broker', 0.5, 'Apache Kafka|RabbitMQ|Amazon SQS|Google Pub/Sub|NATS|ActiveMQ|Amazon Kinesis');
  F('warehouse', 0.55, 'Snowflake|BigQuery|Amazon Redshift|Databricks|Azure Synapse|Microsoft Fabric|ClickHouse|Teradata');
  F('orchestration', 0.6, 'Apache Airflow|Dagster|Prefect|Azure Data Factory');
  F('etl-tool', 0.55, 'Fivetran|Airbyte|Informatica|Talend|SSIS|Matillion|AWS Glue|Azure Data Factory');
  F('stream-processing', 0.5, 'Apache Flink|Apache Spark|Amazon Kinesis|Google Dataflow|Stream Processing');
  F('dataframe', 0.5, 'Pandas|Polars|Dask|Apache Spark');
  F('bi', 0.6, 'Tableau|Power BI|Looker|Looker Studio|Qlik|Metabase|Mode Analytics|Sigma Computing|Apache Superset|Domo|ThoughtSpot|MicroStrategy|Sisense|IBM Cognos|SAP BusinessObjects');
  F('dl-framework', 0.6, 'PyTorch|TensorFlow|JAX|Keras');
  F('classic-ml', 0.6, 'scikit-learn|XGBoost');
  F('ml-platform', 0.5, 'Amazon SageMaker|Vertex AI|Azure Machine Learning|MLflow|Kubeflow');
  F('vector-db', 0.7, 'Pinecone|pgvector|Weaviate|Chroma|Milvus|Qdrant|FAISS|Vector Databases');
  F('llm-framework', 0.6, 'LangChain|LangGraph|LlamaIndex|DSPy|CrewAI|AutoGen');
  F('llm-provider', 0.7, 'OpenAI API|Anthropic Claude|Google Gemini|Azure OpenAI|Amazon Bedrock|Llama|Open-Weight Models');
  F('mobile-cross-platform', 0.5, 'React Native|Flutter|Kotlin Multiplatform|Ionic|Xamarin|.NET MAUI');
  F('ios-lang', 0.6, 'Swift|Objective-C');
  F('ios-ui', 0.6, 'SwiftUI|UIKit');
  F('css-framework', 0.5, 'Tailwind CSS|Bootstrap|Material UI|Chakra UI|shadcn/ui|Styled Components|Sass');
  F('state-mgmt', 0.5, 'Redux|Zustand|TanStack Query');
  F('bundler', 0.6, 'Webpack|Vite|Babel');
  F('js-unit-test', 0.5, 'Jest|Vitest|Mocha|Testing Library');
  F('e2e-test', 0.5, 'Cypress|Playwright|Selenium');
  F('jvm-test', 0.5, 'JUnit|TestNG|Mockito');
  F('identity', 0.5, 'Okta|Microsoft Entra ID|Auth0|Keycloak|Identity & Access Management|SSO');
  F('siem', 0.6, 'Splunk|Microsoft Sentinel|QRadar|SIEM');
  F('compliance-framework', 0.4, 'SOC 2|ISO 27001|NIST|PCI DSS|HITRUST|FedRAMP|CMMC');
  F('privacy-regulation', 0.4, 'GDPR|CCPA|HIPAA|Data Privacy');
  F('crm', 0.6, 'Salesforce|HubSpot|Microsoft Dynamics 365|Zoho CRM|Pipedrive');
  F('marketing-automation', 0.55, 'Marketo|HubSpot|Pardot|Salesforce Marketing Cloud|Braze|Iterable|Klaviyo|Mailchimp|Customer.io|Eloqua|ActiveCampaign');
  F('paid-search', 0.7, 'SEM|Google Ads');
  F('paid-social', 0.6, 'Meta Ads|LinkedIn Ads|TikTok Ads|Paid Social');
  F('seo-tools', 0.7, 'Semrush|Ahrefs|Google Search Console');
  F('cms', 0.5, 'WordPress|Contentful|Drupal|Webflow|Content Management Systems');
  F('product-analytics', 0.6, 'Amplitude|Mixpanel|Heap|Pendo|Google Analytics|Adobe Analytics');
  F('experimentation', 0.5, 'Optimizely|Statsig|Feature Flags|A/B Testing');
  F('sales-engagement', 0.7, 'Outreach|Salesloft|Apollo.io');
  F('sales-methodology', 0.5, 'MEDDIC|Challenger Sale|SPIN Selling|Solution Selling|Value Selling|Sandler Selling');
  F('support-desk', 0.6, 'Zendesk|Intercom|Freshdesk|Salesforce Service Cloud|ServiceNow');
  F('ats', 0.5, 'Greenhouse|Lever|iCIMS|Taleo|Ashby|Applicant Tracking Systems');
  F('hris', 0.5, 'Workday|SuccessFactors|BambooHR|ADP|UKG|Rippling|Gusto|Paylocity|HRIS');
  F('erp', 0.4, 'SAP|Oracle ERP|NetSuite|Microsoft Dynamics 365|JD Edwards|ERP');
  F('accounting-software', 0.6, 'QuickBooks|Xero|NetSuite|Sage Intacct');
  F('fp-tools', 0.6, 'Anaplan|Adaptive Planning|Oracle Hyperion');
  F('financial-data', 0.6, 'Bloomberg Terminal|FactSet|Capital IQ|PitchBook');
  F('spreadsheet', 0.8, 'Microsoft Excel|Google Sheets');
  F('word-processing', 0.8, 'Microsoft Word|Google Docs');
  F('slides', 0.8, 'PowerPoint|Keynote|Google Docs');
  F('office-suite', 0.7, 'Microsoft Office|Google Workspace|Microsoft 365');
  F('team-chat', 0.8, 'Slack|Microsoft Teams');
  F('pm-tools', 0.7, 'Jira|Asana|Trello|Monday.com|ClickUp|Linear|Smartsheet|Wrike|Microsoft Project|Airtable|Basecamp');
  F('wiki', 0.6, 'Confluence|Notion|SharePoint');
  F('agile', 0.6, 'Agile|Scrum|Kanban|SAFe');
  F('design-tool', 0.7, 'Figma|Sketch|Adobe XD|Framer|InVision');
  F('adobe-design', 0.5, 'Photoshop|Illustrator|InDesign|Adobe Creative Suite');
  F('video-editing', 0.6, 'Premiere Pro|Final Cut Pro|DaVinci Resolve|After Effects');
  F('diagramming', 0.7, 'Lucidchart|Microsoft Visio|Miro');
  F('cad', 0.5, 'AutoCAD|SolidWorks|CATIA|Revit|CAD');
  F('ehr', 0.6, 'Epic|Cerner|Meditech|athenahealth|eClinicalWorks|EHR');
  F('life-support', 0.5, 'BLS|ACLS|PALS|CPR');
  F('medical-coding', 0.6, 'ICD-10|CPT Coding|Medical Coding|CPC (Certified Professional Coder)');
  F('nursing-specialty', 0.4, 'Critical Care|Emergency Care|Med-Surg|Pediatrics|Labor & Delivery|Operating Room|Oncology|Long-Term Care');
  F('lean-six-sigma', 0.6, 'Six Sigma|Lean Six Sigma|Six Sigma Green Belt|Six Sigma Black Belt|Lean Manufacturing|Continuous Improvement');
  F('cloud-architect-cert', 0.4, 'AWS Certified Solutions Architect|Google Professional Cloud Architect|Azure Solutions Architect (AZ-305)');
  F('kubernetes-cert', 0.6, 'CKA|CKAD|CKS');
  F('agile-cert', 0.7, 'CSM (Certified ScrumMaster)|PSM|SAFe Agilist|PMI-ACP');
  F('pm-cert', 0.6, 'PMP|CAPM|PRINCE2');
  F('security-cert', 0.4, 'CISSP|CISM|CompTIA Security+|CEH|OSCP|GIAC|CCSP|CISA');
  F('hr-cert', 0.7, 'SHRM-CP|SHRM-SCP|PHR|SPHR');
  F('accounting-cert', 0.4, 'CPA|CMA|CIA (Certified Internal Auditor)|Enrolled Agent');
  F('hosting', 0.6, 'Vercel|Netlify|Heroku|DigitalOcean');
  F('cdn', 0.6, 'Cloudflare|Akamai|Fastly|Amazon CloudFront|CDN');
  F('virtualization', 0.5, 'VMware|Virtualization|OpenStack');
  F('unix-like', 0.6, 'Linux|Unix');
  F('lms', 0.6, 'LMS|Google Classroom');

  // --- role families (title alignment) ---
  const roleFamilies = [];
  const R = (key, label, titles, adjacent) => roleFamilies.push({ key: key, label: label, titles: titles.split('|'), adjacent: adjacent ? adjacent.split('|') : [] });
  R('swe', 'Software Engineering', 'software engineer|software developer|software development engineer|sde|swe|member of technical staff|mts|programmer|application developer|applications engineer|software engineering|developer|engineer i|engineer ii|engineer iii|staff engineer|principal engineer|founding engineer|product engineer', 'backend|frontend|fullstack|platform|mobile');
  R('frontend', 'Frontend Engineering', 'frontend engineer|front end engineer|frontend developer|front end developer|ui engineer|ui developer|web developer|javascript developer|react developer|web engineer|design engineer|ux engineer', 'fullstack|swe|mobile');
  R('backend', 'Backend Engineering', 'backend engineer|back end engineer|backend developer|back end developer|server engineer|api engineer|java developer|python developer|golang developer|go engineer|.net developer|ruby developer|node developer|distributed systems engineer', 'swe|fullstack|platform|data-eng');
  R('fullstack', 'Full-Stack Engineering', 'full stack engineer|fullstack engineer|full stack developer|fullstack developer|full stack software engineer', 'swe|frontend|backend');
  R('mobile', 'Mobile Engineering', 'mobile engineer|mobile developer|ios engineer|ios developer|android engineer|android developer|react native developer|flutter developer|mobile software engineer', 'swe|frontend');
  R('platform', 'Platform & Infrastructure', 'platform engineer|infrastructure engineer|cloud engineer|systems engineer|cloud architect|infrastructure architect|systems administrator|network engineer|production engineer|kubernetes engineer|developer productivity engineer', 'devops|backend|security|swe');
  R('devops', 'DevOps & SRE', 'devops engineer|site reliability engineer|sre|reliability engineer|build engineer|release engineer|devsecops engineer|ci cd engineer|cloud operations engineer', 'platform|backend|security');
  R('security', 'Security', 'security engineer|security analyst|cybersecurity analyst|information security analyst|appsec engineer|application security engineer|penetration tester|security architect|soc analyst|threat analyst|detection engineer|grc analyst|security consultant|ciso', 'platform|devops');
  R('data-eng', 'Data Engineering', 'data engineer|analytics engineer|big data engineer|etl developer|data platform engineer|data architect|database engineer|database administrator|dba|bi engineer|data warehouse engineer', 'backend|data-analyst|data-science|ml-eng');
  R('data-science', 'Data Science', 'data scientist|applied scientist|decision scientist|quantitative analyst|quant researcher|statistician|research analyst|product data scientist', 'data-analyst|ml-eng|ai-research|data-eng');
  R('data-analyst', 'Data & Analytics', 'data analyst|business intelligence analyst|bi analyst|analytics manager|reporting analyst|product analyst|marketing analyst|insights analyst|operations analyst|business data analyst|bi developer', 'data-science|business-analyst|data-eng');
  R('ml-eng', 'ML / AI Engineering', 'machine learning engineer|ml engineer|ai engineer|mlops engineer|applied ml engineer|llm engineer|deep learning engineer|computer vision engineer|nlp engineer|applied ai engineer|forward deployed engineer|ai solutions engineer', 'data-science|ai-research|backend|swe');
  R('ai-research', 'AI Research', 'research scientist|research engineer|ai researcher|machine learning researcher|ml researcher|research scientist ai|member of technical staff research|postdoctoral researcher|applied research scientist', 'ml-eng|data-science');
  R('qa', 'QA & Test', 'qa engineer|quality assurance engineer|test engineer|sdet|software development engineer in test|automation engineer|qa analyst|qa tester|software tester|test automation engineer|quality engineer', 'swe|devops');
  R('eng-manager', 'Engineering Management', 'engineering manager|software engineering manager|director of engineering|head of engineering|vp of engineering|vp engineering|cto|chief technology officer|engineering lead|tech lead manager|development manager', 'swe|tpm|executive');
  R('product-manager', 'Product Management', 'product manager|product owner|senior product manager|group product manager|principal product manager|technical product manager|director of product|head of product|vp of product|chief product officer|product lead|associate product manager|apm', 'tpm|program-manager|product-designer|business-analyst|growth');
  R('tpm', 'Technical Program Management', 'technical program manager|tpm|technical project manager|engineering program manager|release manager', 'program-manager|product-manager|eng-manager');
  R('program-manager', 'Project & Program Management', 'project manager|program manager|project coordinator|program coordinator|delivery manager|scrum master|agile coach|pmo manager|portfolio manager projects|implementation manager|project lead', 'tpm|operations|product-manager|business-analyst');
  R('product-designer', 'Product Design / UX', 'product designer|ux designer|ui designer|ui ux designer|ux ui designer|interaction designer|visual designer|ux researcher|user researcher|design lead|head of design|service designer|content designer|ux writer|graphic designer|brand designer|motion designer', 'product-manager|frontend|marketing');
  R('marketing', 'Marketing', 'marketing manager|product marketing manager|pmm|content marketing manager|brand manager|marketing coordinator|marketing specialist|digital marketing manager|seo specialist|seo manager|social media manager|lifecycle marketing manager|email marketing manager|field marketing manager|marketing director|cmo|chief marketing officer|communications manager|pr manager|events manager', 'growth|content|sales');
  R('growth', 'Growth', 'growth manager|growth marketer|growth marketing manager|performance marketing manager|paid media manager|demand generation manager|user acquisition manager|growth product manager|head of growth|ppc specialist|paid search manager', 'marketing|product-manager|data-analyst');
  R('sales', 'Sales / Account Executive', 'account executive|ae|enterprise account executive|sales executive|sales manager|sales representative|sales rep|account manager|key account manager|regional sales manager|territory manager|sales director|vp of sales|head of sales|business development manager|inside sales representative|outside sales representative|sales consultant|partner manager|channel manager', 'sdr|customer-success|solutions');
  R('sdr', 'Sales Development', 'sales development representative|sdr|business development representative|bdr|lead development representative|market development representative|account development representative', 'sales|customer-success|support');
  R('solutions', 'Solutions / Sales Engineering', 'solutions engineer|sales engineer|solutions architect|solutions consultant|presales engineer|pre sales engineer|customer engineer|technical account manager|field engineer|implementation engineer|integration engineer|developer advocate|developer relations', 'sales|swe|customer-success|platform');
  R('customer-success', 'Customer Success', 'customer success manager|csm|customer success|client success manager|account manager customer success|onboarding specialist|implementation specialist|renewals manager|customer experience manager|client services manager|relationship manager', 'support|sales|solutions');
  R('support', 'Customer & Technical Support', 'customer support|support engineer|technical support engineer|customer service representative|customer support specialist|support specialist|help desk technician|it support specialist|desktop support|customer care|call center representative|service desk analyst|support agent', 'customer-success|qa|platform');
  R('finance', 'Finance / FP&A', 'financial analyst|fp&a analyst|fp&a manager|finance manager|senior financial analyst|finance director|cfo|chief financial officer|vp of finance|investment analyst|investment banking analyst|associate investment banking|private equity associate|corporate development|treasury analyst|credit analyst|equity research analyst|portfolio manager|strategic finance', 'accounting|business-analyst|consultant');
  R('accounting', 'Accounting', 'accountant|staff accountant|senior accountant|accounting manager|controller|assistant controller|bookkeeper|auditor|internal auditor|tax accountant|tax associate|audit associate|accounts payable specialist|accounts receivable specialist|payroll specialist|revenue accountant|billing specialist', 'finance|operations');
  R('recruiting', 'HR & Recruiting', 'recruiter|technical recruiter|talent acquisition partner|talent acquisition specialist|sourcer|recruiting coordinator|hr generalist|hr manager|human resources manager|hr business partner|hrbp|people operations|people partner|hr coordinator|hris analyst|compensation analyst|benefits specialist|head of people|chief people officer|learning and development', 'operations|executive');
  R('operations', 'Operations', 'operations manager|operations analyst|business operations|bizops|operations associate|operations coordinator|office manager|executive assistant|administrative assistant|chief of staff|strategy and operations|revenue operations|sales operations|marketing operations|general manager|facilities manager|operations director|coo', 'supply-chain|business-analyst|program-manager|executive');
  R('supply-chain', 'Supply Chain & Logistics', 'supply chain analyst|supply chain manager|logistics coordinator|logistics manager|procurement specialist|procurement manager|buyer|purchasing agent|purchasing manager|demand planner|inventory analyst|warehouse manager|materials manager|sourcing manager|production planner|manufacturing engineer|quality engineer|process engineer|plant manager', 'operations|business-analyst');
  R('business-analyst', 'Business Analysis', 'business analyst|business systems analyst|systems analyst|requirements analyst|process analyst|it business analyst|functional analyst|salesforce administrator|erp analyst|crm analyst', 'data-analyst|product-manager|program-manager|consultant');
  R('consultant', 'Consulting & Strategy', 'consultant|management consultant|strategy consultant|associate consultant|senior consultant|business consultant|technology consultant|strategy analyst|strategy manager|engagement manager|principal consultant|advisory', 'business-analyst|finance|operations|program-manager');
  R('nurse', 'Nursing & Clinical', 'registered nurse|rn|nurse|charge nurse|staff nurse|nurse practitioner|clinical nurse|icu nurse|er nurse|travel nurse|lpn|licensed practical nurse|cna|certified nursing assistant|medical assistant|physician assistant|physician|pharmacist|therapist|physical therapist|clinician|paramedic|emt|nurse manager|clinical research coordinator|clinical research associate', 'healthcare-admin');
  R('healthcare-admin', 'Healthcare Administration', 'medical biller|medical coder|coding specialist|patient access representative|patient services coordinator|medical receptionist|health information technician|practice manager|clinic manager|healthcare administrator|revenue cycle analyst|utilization review|care coordinator|case manager|health informatics', 'nurse|operations');
  R('teacher', 'Teaching & Education', 'teacher|instructor|lecturer|professor|tutor|teaching assistant|educator|special education teacher|curriculum developer|instructional designer|school counselor|principal|education coordinator|trainer|learning designer|academic advisor', 'content|recruiting');
  R('legal', 'Legal & Compliance', 'attorney|lawyer|counsel|associate attorney|general counsel|legal counsel|corporate counsel|paralegal|legal assistant|contracts manager|contract specialist|compliance analyst|compliance officer|compliance manager|privacy counsel|legal operations', 'consultant|operations');
  R('content', 'Content & Writing', 'content writer|copywriter|technical writer|content strategist|editor|content manager|writer|journalist|communications specialist|content creator|documentation engineer|proposal writer|grant writer|social media coordinator', 'marketing|product-designer');
  R('executive', 'Executive Leadership', 'chief executive officer|ceo|president|founder|co founder|general manager|managing director|vice president|vp|svp|evp|chief operating officer|chief of staff|head of', 'eng-manager|operations|finance');

  // --- resume-language word lists ---
  const W = (s) => s.trim().split(/\s*,\s*/);
  const actionVerbs = W(`led, built, shipped, architected, designed, developed, launched, delivered, created, implemented, engineered, reduced, increased, improved, grew, scaled, optimized, automated, migrated, refactored, modernized, rebuilt, redesigned, streamlined, accelerated, boosted, cut, saved, generated, drove, spearheaded, pioneered, founded, established, initiated, introduced, owned, managed, directed, oversaw, headed, orchestrated, coordinated, mentored, coached, trained, hired, recruited, onboarded, grew, negotiated, closed, secured, won, exceeded, surpassed, achieved, attained, earned, expanded, doubled, tripled, halved, consolidated, standardized, unified, integrated, deployed, released, published, authored, wrote, documented, presented, pitched, influenced, persuaded, advocated, championed, partnered, collaborated, aligned, facilitated, resolved, debugged, diagnosed, troubleshot, fixed, prevented, mitigated, secured, hardened, audited, analyzed, evaluated, assessed, investigated, researched, discovered, identified, uncovered, measured, quantified, forecasted, modeled, benchmarked, tested, validated, verified, prototyped, experimented, iterated, piloted, conceived, envisioned, defined, formulated, strategized, planned, prioritized, scoped, budgeted, allocated, restructured, reorganized, transformed, revamped, overhauled, revitalized, upgraded, enhanced, strengthened, simplified, centralized, decentralized, instrumented, monitored, maintained, supported, administered, operated, executed, completed, produced, curated, edited, translated, converted, captured, acquired, sourced, procured, purchased, reconciled, audited, compiled, reported, visualized, dashboarded, invented, patented, open-sourced, contributed, reviewed, upskilled, empowered, enabled, mobilized, rallied, inspired, cultivated, nurtured, retained, renewed, upsold, cross-sold, converted, monetized, launched, rolled out, stood up, spun up, kicked off, turned around, delivered, sped up, tuned, parallelized, containerized, codified, productionized, operationalized, systematized, programmed, coded, scripted, configured, provisioned, designed, sketched, illustrated, storyboarded, wireframed, interviewed, surveyed, synthesized, distilled, championed, chaired, represented, served`).filter((v, i, a) => a.indexOf(v) === i);
  const weakPhrases = W(`responsible for, helped, helped with, helped to, worked on, worked with, assisted with, assisted in, involved in, duties included, tasked with, participated in, contributed to, in charge of, handled, dealt with, was part of, part of a team, took part in, exposure to, familiar with, familiarity with, knowledge of, some experience, basic knowledge, responsibilities included, my role was, i was responsible, served as a member, supported the team, worked closely with, was involved, attempted to, tried to, various tasks, other duties, as needed, day to day tasks, in charge of managing, oversaw various, utilized, was given, got to`);
  const buzzwords = W(`synergy, synergies, synergize, go-getter, team player, hard worker, hardworking, detail-oriented, results-driven, results-oriented, self-starter, self-motivated, think outside the box, outside the box, rockstar, rock star, ninja, guru, wizard, unicorn, jedi, passionate, dynamic, motivated, proactive, go-to person, best of breed, value add, value-add, move the needle, low-hanging fruit, game changer, game-changer, thought leader, visionary, disruptor, disruptive, innovative thinker, strategic thinker, people person, works well under pressure, fast learner, quick learner, track record, proven track record, seasoned, highly skilled, extensive experience, excellent communication skills, goal-oriented, dedicated, driven, dependable, reliable, enthusiastic, energetic, out-of-the-box, leverage, leveraged, best practices, world-class, cutting-edge, bleeding-edge, next-generation, paradigm shift, circle back, deep dive, bandwidth, wheelhouse, hit the ground running, wear many hats, above and beyond, 110%, perfectionist, multi-tasker, problem-solver`);
  const WS = (s) => s.trim().split(/\s+/).filter((v, i, a) => a.indexOf(v) === i);
  const stopwords = WS(`a about above across after afterwards again against all almost alone along already also although always am among amongst an and another any anyhow anyone anything anyway anywhere are aren't around as at back be became because become becomes becoming been before beforehand behind being below beside besides between beyond both but by can cannot can't could couldn't did didn't do does doesn't doing done don't down during each either else elsewhere enough even ever every everyone everything everywhere except few first for former formerly from further furthermore get gets getting give given gives go goes going gone got had hadn't has hasn't have haven't having he he'd he'll her here hereafter hereby herein hers herself he's him himself his how however i i'd if i'll i'm in indeed into is isn't it its it's itself i've just keep last latter latterly least less let let's like made many may me meanwhile might mine more moreover most mostly much must my myself namely neither never nevertheless next no nobody none noone nor not nothing now nowhere of off often on once one only onto or other others otherwise our ours ourselves out over own per perhaps please put quite rather re really same see seem seemed seeming seems several she she'd she'll she's should shouldn't since so some somehow someone something sometime sometimes somewhere still such than that that's the their theirs them themselves then thence there thereafter thereby therefore therein there's thereupon these they they'd they'll they're they've this those though through throughout thru thus to together too toward towards under unless until up upon us used using very via was wasn't we we'd well we'll were we're weren't we've what whatever what's when whence whenever when's where whereafter whereas whereby wherein where's whereupon wherever whether which while whither who whoever whole whom who's whose why why's will with within without won't would wouldn't yet you you'd you'll your you're yours yourself yourselves you've ago apart away began certain certainly clearly come comes currently despite e.g eg especially et etc everybody exactly far following follows forth fully hence i.e ie kept know known knows later likely little look looks mainly maybe mean merely near nearly need needs new oh ok okay ones ought outside overall particular particularly plus possible probably provides rather regarding regardless relatively respectively right said say says seen shall somebody somewhat soon sure take taken tell than thanks thoroughly tried tries try trying twice unlikely upon usually various want wants way went whereas willing yes zero`);
  const jdFiller = WS(`experience experiences experienced team teams work working works ability abilities able strong skills skill role roles company companies candidate candidates opportunity opportunities responsibilities responsibility requirements requirement qualifications qualification including include includes preferred required require requires years year plus benefits benefit salary salaries equal employer employers employment join help build building etc ideal ideally looking seeking seek successful success excellent great good best highly high level levels position positions job jobs apply applicants applicant hire hiring hired environment culture mission vision values value impact impactful passionate passion love world best-in-class growing grow growth fast-paced fast paced dynamic exciting exciting innovative innovation leading leader leaders industry industries business businesses organization organizations organizational company's customers customer clients client people person individual individuals across within new day days week weeks month months time full-time full part-time part remote hybrid onsite on-site office location locations based us usa united states global globally world-class competitive compensation pay range base bonus equity stock options pto vacation holidays medical dental vision insurance 401k 401(k) retirement parental leave wellness perks stipend learning development career careers growth opportunity diverse diversity inclusion inclusive committed commitment proud background backgrounds regardless race color religion sex gender identity sexual orientation national origin age disability veteran status protected law applicable accommodation accommodations reasonable please note note eeo e-verify visa sponsorship authorization authorized eligible eligibility must minimum degree bachelor's bachelors master's masters phd equivalent related field fields similar relevant demonstrated proven track record solid deep familiarity familiar knowledge understanding understand proficiency proficient expertise expert hands-on hands handson capable capability comfortable willingness willing desire desired eager self start ensure ensuring support supporting supports manage managing provide providing drive driving deliver delivering partner partnering own owning responsible collaborate collaborating closely closely communicate perform performing various other duties assigned tasks task related relevant key core critical important variety wide range multiple complex day-to-day ongoing projects project initiatives initiative across products product services service solutions solution platform platforms tools tool systems system processes process stakeholders internal external cross-functional functional department departments function functions member members report reports reporting directly manager senior junior mid staff lead principal associate entry intern internship contract contractor temporary permanent we're we you'll you're our us join today now ready make making made want needed need needs looking forward thrive thriving fun friendly collaborative supportive amazing awesome incredible unique talented talent smart curious humble hungry`);

  // --- normalization & matching ---
  // Separators that become spaces. Kept on purpose: + # . (c++, c#, .net, node.js) and & (r&d, m&a).
  const SEP = /[\/\-_\u2013\u2014\u00b7\u2022|,;:()[\]{}"'!?]/g;
  const WSP = /\s+/g;
  /** Normalization without lowercasing (for case-sensitive '=' aliases). */
  function normalizeCase(text) {
    return String(text == null ? '' : text).replace(SEP, ' ').replace(WSP, ' ');
  }
  /** Lowercase while keeping string length identical (so positions line up with normalizeCase). */
  function lowerSameLength(s) {
    const l = s.toLowerCase();
    if (l.length === s.length) return l;
    let out = '';
    for (let i = 0; i < s.length; i++) { const lc = s[i].toLowerCase(); out += lc.length === 1 ? lc : s[i]; }
    return out;
  }
  function normalize(text) { return lowerSameLength(normalizeCase(text)); }

  const ESC = /[.*+?^${}()|[\]\\]/g;
  const toSource = (norm) => norm.replace(ESC, '\\$&').replace(/ /g, '\\s+');
  const LB = 'a-z0-9+#', UB = 'A-Za-z0-9+#';
  const mkRe = (norm, cs) => new RegExp('(^|[^' + (cs ? UB : LB) + '])(' + toSource(norm) + ')(?=[^' + (cs ? UB : LB) + ']|$)', 'g');
  let compiled = null;
  let excludes = null; // Map<skillName, [{re, probe}]>

  /** Build (once) one global RegExp per alias: [{skill, re, caseSensitive, alias}]. Pass true to rebuild. */
  function compile(force) {
    if (compiled && !force) return compiled;
    const out = [];
    excludes = new Map();
    for (const skill of T.skills) {
      const seen = new Set();
      const forms = skill.noName ? skill.aliases : [skill.name].concat(skill.aliases);
      for (const raw of forms) {
        const cs = raw.charAt(0) === '=';
        const norm = (cs ? normalizeCase(raw.slice(1)) : normalize(raw)).trim();
        const key = (cs ? '=' : '') + norm;
        if (!norm || seen.has(key)) continue;
        seen.add(key);
        out.push({ skill: skill, re: mkRe(norm, cs), caseSensitive: cs, alias: norm });
      }
      if (skill.exclude && skill.exclude.length) {
        excludes.set(skill.name, skill.exclude.map((e) => { const n = normalize(e).trim(); return { re: mkRe(n, false), probe: n }; }));
      }
    }
    compiled = out;
    return out;
  }

  /**
   * Find every skill in `text`.
   * Returns Map<canonicalName, {skill, count, positions}> — positions are start indices in normalize(text)
   * (identical length to normalizeCase(text)); overlapping matches of one skill count once.
   */
  function find(text) {
    const cased = normalizeCase(text);
    const lower = lowerSameLength(cased);
    const list = compile();
    const hits = new Map();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const hay = c.caseSensitive ? cased : lower;
      if (hay.indexOf(c.alias) === -1) continue; // cheap literal pre-check
      const re = c.re;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(hay)) !== null) {
        const start = m.index + m[1].length;
        let h = hits.get(c.skill.name);
        if (!h) { h = { skill: c.skill, spans: [] }; hits.set(c.skill.name, h); }
        h.spans.push([start, start + m[2].length]);
      }
    }
    const result = new Map();
    hits.forEach((h, name) => {
      let spans = h.spans;
      const ex = excludes.get(name);
      if (ex) {
        const ranges = [];
        for (const x of ex) {
          if (lower.indexOf(x.probe) === -1) continue;
          x.re.lastIndex = 0;
          let m;
          while ((m = x.re.exec(lower)) !== null) { const s = m.index + m[1].length; ranges.push([s, s + m[2].length]); }
        }
        if (ranges.length) spans = spans.filter((sp) => !ranges.some((r) => sp[0] >= r[0] && sp[0] < r[1]));
      }
      if (!spans.length) return;
      spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      const positions = [];
      let end = -1;
      for (const sp of spans) {
        if (sp[0] >= end) { positions.push(sp[0]); end = sp[1]; } else if (sp[1] > end) end = sp[1];
      }
      result.set(name, { skill: h.skill, count: positions.length, positions: positions });
    });
    return result;
  }

  const T = (CB.Taxonomy = {
    version: '2026.11',
    skills: skills,
    families: families,
    roleFamilies: roleFamilies,
    actionVerbs: actionVerbs,
    weakPhrases: weakPhrases,
    buzzwords: buzzwords,
    stopwords: stopwords,
    jdFiller: jdFiller,
  });
  T.normalize = normalize;
  T.normalizeCase = normalizeCase;
  T.byName = new Map(skills.map((s) => [s.name, s]));
  T.compile = compile;
  T.find = find;
})();

const state = { view: document.body.dataset.initialView || 'intra', module: 'solving', flow: 'create-job', runtime: 'all', query: '' };
const runtimeLabels = {
  all: 'الكل', web: 'apps/web', worker: 'apps/worker', application: 'Application', domain: 'Domain', infrastructure: 'Infrastructure', database: 'PostgreSQL', external: 'External', gated: 'Gated/Optional'
};
const registry = new Map();
function reg(item) { registry.set(item.id, item); return item; }
function esc(value) { return String(value ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function list(items) { return `<ul class="mt-2 list-disc space-y-1 pr-5">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`; }
function tech(value) { return `<span class="technical text-sky-200">${esc(value)}</span>`; }

const modules = [
  {
    id: 'identity', name: 'Identity & Access', arabic: 'الهوية والوصول', runtime: 'web', color: 'sky',
    owns: 'Hallili identity context، auth-session lookup، وaccess policy helpers.',
    exposes: ['GetCurrentActor','RequireAuthenticatedActor','ownership context'],
    nodes: [
      reg({ id: 'identity-route-auth', module: 'identity', runtime: 'web', kind: 'Route handler', file: 'apps/web/src/routes/api/auth/$', title: 'Better Auth catch-all route', summary: 'نقطة mounting الخاصة بـ Better Auth وفق النسخة المثبتة؛ تستقبل OAuth/OIDC/session endpoints ولا تضع business rules داخلها.', input: 'OAuth callback أو auth HTTP request مع headers/cookies.', output: 'استجابة Better Auth وSession بعد تسجيل الدخول.', transaction: 'لا transaction خاصة بـ Hallili هنا؛ جداول Better Auth مملوكة لـ Better Auth.', functions: [
        reg({ id:'fn-better-auth-handler', module:'identity', runtime:'web', kind:'Function', title:'betterAuthHandler', file:'apps/web/src/routes/api/auth/$', input:'Microsoft OAuth/OIDC request', output:'Hallili auth session', transaction:'Owned by Better Auth schema/migrations', rules:['لا تُنشئ جداول Better Auth يدوياً خارج مسار schema generation المدعوم.','لا تخلط authentication مع authorization.'] })
      ], rules: ['Better Auth owns the auth schema.', 'Microsoft sign-in يخضع لسياسة tenant/account المعتمدة.'], forbidden: ['لا تستخدم session cookie داخل Domain.', 'لا تعتبر معرف المورد proof of ownership.'] }),
      reg({ id: 'identity-server-actor', module: 'identity', runtime: 'web', kind: 'Server helper', file: 'apps/web/src/server/auth.ts', title: 'Session lookup boundary', summary: 'يحوّل Better Auth session إلى ActorContext صغير قبل دخول Application.', input: 'Request headers/cookies عند Web boundary.', output: 'ActorContext { userId } أو خطأ 401 آمن.', transaction: 'بدون transaction؛ قراءة session فقط.', functions: [
        reg({ id:'fn-get-current-actor', module:'identity', runtime:'web', kind:'Function', title:'GetCurrentActor', file:'packages/application/src/identity/use-cases.ts', input:'session/user identifier من Web boundary', output:'ActorContext { userId }', transaction:'لا يكتب شيئاً', rules:['Worker لا يستخدم browser session؛ يستخدم userId المخزن على job.'] }),
        reg({ id:'fn-require-authenticated-actor', module:'identity', runtime:'web', kind:'Function', title:'RequireAuthenticatedActor', file:'packages/application/src/identity/use-cases.ts', input:'ActorContext محتمل', output:'ActorContext مؤكد أو 401', transaction:'لا يكتب شيئاً', rules:['أي read/mutation user-owned يجب أن يمر عبر actor ownership.'] })
      ], rules: ['authentication يجيب من هو المستخدم.', 'authorization يجيب هل يملك المورد.'], forbidden: ['لا تمرر cookies إلى Domain أو Infrastructure.', 'لا تضع business authorization في UI فقط.'] }),
      reg({ id: 'identity-domain-policy', module: 'identity', runtime: 'domain', kind: 'Domain rule', file: 'packages/domain/src/identity/access-policy.ts', title: 'Ownership/access policy', summary: 'قواعد pure لاتخاذ قرار ownership/authorization دون معرفة Better Auth أو HTTP.', input: 'ActorContext وowner identifier.', output: 'سماح أو رفض typed error.', transaction: 'لا يوجد.', functions: [
        reg({ id:'fn-assert-resource-owner', module:'identity', runtime:'domain', kind:'Function', title:'assertResourceOwner', file:'packages/domain/src/identity/access-policy.ts', input:'actor.userId + resource owner userId', output:'void أو NOT_FOUND/FORBIDDEN semantic failure', transaction:'لا ينطبق', rules:['يفضّل not-found غير المسرّب عند فشل ownership على resources user-owned.'] })
      ], rules: ['Domain isolated من framework/database/integration.', 'Resource ID ليس proof of ownership.'], forbidden: ['استيراد Better Auth أو Drizzle أو TanStack داخل Domain.'] })
    ],
    callOrder: ['Browser → Better Auth auth route', 'Protected route/server helper resolves session', 'Application creates ActorContext', 'Domain ownership policy validates access', 'User-facing use case executes']
  },
  {
    id: 'lms-connections', name: 'LMS Connections', arabic: 'اتصالات LMS', runtime: 'web', color: 'emerald',
    owns: 'دورة حياة LMS connection، التخزين المشفر، validation، rotation persistence، وتسلسل استخدام الحساب.',
    exposes: ['SaveLmsCredential','ValidateLmsConnection','RevokeLmsConnection','LoadCredentialForExecution','PersistRotatedCredential'],
    nodes: [
      reg({ id:'lms-routes', module:'lms-connections', runtime:'web', kind:'Route handlers', file:'apps/web/src/routes/api/v1/lms-connection/*', title:'LMS connection API handlers', summary:'Handlers لـ GET/PUT/validate/DELETE. تعمل validation وorigin/body limits ثم تستدعي use cases فقط.', input:'PUT { cookieValue } أو طلب validate/revoke؛ لا arbitrary Cookie header أو URL.', output:'metadata sanitized أو 204؛ لا credential أبداً.', transaction:'Route لا يملك transaction؛ الاستمرارية داخل repository/use case.', functions:[
        reg({ id:'fn-put-lms-connection', module:'lms-connections', runtime:'web', kind:'Function', title:'PUT /api/v1/lms-connection', file:'apps/web/src/routes/api/v1/lms-connection/index.ts', input:'strict JSON body { cookieValue }', output:'204 No Content', transaction:'يستدعي SaveLmsCredential', rules:['Request body لا يُسجل.','HTTPS وCSRF/origin checks مطلوبة.'] }),
        reg({ id:'fn-validate-lms-connection', module:'lms-connections', runtime:'web', kind:'Function', title:'POST /api/v1/lms-connection/validate', file:'apps/web/src/routes/api/v1/lms-connection/validate.ts', input:'authenticated actor فقط', output:'{ status, checkedAt, message }', transaction:'تحديث status/validation time بعد نتيجة adapter', rules:['403 أو explicit block يعني stop وليس bypass.'] })
      ], rules:['لا تُرجع cookie أو ciphertext أو nonce أو auth tag أو key version.','Strict Zod object keys.'], forbidden:['Direct SQL في route.','إرجاع secret أو prefix/suffix.'] }),
      reg({ id:'lms-usecases', module:'lms-connections', runtime:'application', kind:'Application use cases', file:'packages/application/src/lms/use-cases.ts', title:'LMS connection use cases', summary:'Save/Validate/Revoke/Load/Persist rotation مع actor ownership و typed status mapping.', input:'ActorContext + credential أو connection execution request.', output:'sanitized connection status أو execution-only credential lease.', transaction:'Save/revoke في short DB transaction. validation network خارج transaction.', functions:[
        reg({ id:'fn-save-lms-credential', module:'lms-connections', runtime:'application', kind:'Function', title:'SaveLmsCredential', file:'packages/application/src/lms/use-cases.ts', input:'actor.userId + cookieValue', output:'void/sanitized metadata', transaction:'encrypt أولاً ثم insert/update ciphertext + nonce + tag + key_version في short transaction', rules:['لا plaintext fallback عند فشل encryption.','credential يوجد في memory لأقل وقت ممكن.'] }),
        reg({ id:'fn-validate-lms-usecase', module:'lms-connections', runtime:'application', kind:'Function', title:'ValidateLmsConnection', file:'packages/application/src/lms/use-cases.ts', input:'owned connection', output:'valid | expired | blocked | unknown', transaction:'لا transaction أثناء network call؛ persist النتيجة بعدها', rules:['يستخدم approved validation operation فقط.'] }),
        reg({ id:'fn-revoke-lms', module:'lms-connections', runtime:'application', kind:'Function', title:'RevokeLmsConnection', file:'packages/application/src/lms/use-cases.ts', input:'actor-owned connection', output:'revoked/wiped state', transaction:'short transaction يمسح encrypted material ويطبق policy للـ active jobs', rules:['revoked يعني credential fields null بعد transaction.'] })
      ], rules:['كل user-owned read/mutation owner-scoped.','decrypted credential لا يغادر execution boundary.'], forbidden:['لا log/trace/analytics للقيمة.','لا redirect forwarding إلى host غير approved.'] }),
      reg({ id:'lms-ports', module:'lms-connections', runtime:'application', kind:'Ports', file:'packages/application/src/lms/ports.ts', title:'Narrow LMS connection ports', summary:'واجهات Application-owned تفصل policy عن adapters.', input:' encrypted credential bundle أو validation request.', output:'typed results.', transaction:'لا تعرف الـ ports SQL أو HTTP implementation.', functions:[
        reg({ id:'fn-credential-cipher', module:'lms-connections', runtime:'application', kind:'Port', title:'CredentialCipher', file:'packages/application/src/lms/ports.ts', input:'plaintext credential + AAD user/connection binding', output:'ciphertext + 12-byte nonce + auth tag + key_version', transaction:'لا يوجد', rules:['AES-256-GCM؛ key من secret manager/KMS.'] }),
        reg({ id:'fn-lms-credential-repo', module:'lms-connections', runtime:'application', kind:'Port', title:'LmsCredentialRepository', file:'packages/application/src/lms/ports.ts', input:'encrypted fields only', output:'connection metadata/credential ciphertext', transaction:'يمتلك short persistence transactions', rules:['لا plaintext في DB أو temp table أو log.'] })
      ], rules:['Ports narrow وpurpose-specific.','لا interface لكل table تلقائياً.'], forbidden:['Domain لا يعرف cipher implementation.'] }),
      reg({ id:'lms-infra', module:'lms-connections', runtime:'infrastructure', kind:'Adapters', file:'packages/db + packages/integrations', title:'Encryption/repository/LMS validation adapters', summary:'Drizzle repository، Node crypto AES-GCM، وapproved/fake LMS adapter.', input:'port calls.', output:'typed adapter responses.', transaction:'DB mutations قصيرة؛ network خارجها.', functions:[
        reg({ id:'fn-aes-gcm-adapter', module:'lms-connections', runtime:'infrastructure', kind:'Adapter function', title:'encrypt/decrypt', file:'packages/integrations/src/encryption/*', input:'key version + plaintext/ciphertext + AAD', output:'ciphertext bundle أو plaintext داخل execution boundary', transaction:'لا يوجد', rules:['verify authentication tag قبل إرجاع plaintext.','nonce عشوائي 12-byte لكل encryption.'] }),
        reg({ id:'fn-lms-validation-adapter', module:'lms-connections', runtime:'infrastructure', kind:'Adapter function', title:'validateConnection', file:'packages/integrations/src/lms/*', input:'execution credential lease', output:'valid | expired | blocked | unknown', transaction:'network خارج DB transaction', rules:['fixed allowlisted host وtimeouts/size limits وshared rate limiter.','Unexpected redirect/host => reject.'] })
      ], rules:['cookies لا تمرر خارج host allowlist.','explicit block يوقف integration.'], forbidden:['arbitrary URL من browser أو model output.','WAF/control bypass.'] })
    ],
    callOrder: ['Route validates request shape/origin', 'Use case verifies ActorContext ownership', 'CredentialCipher encrypts before persistence', 'Repository writes ciphertext bundle in short transaction', 'Explicit validate route invokes approved LMS operation after commit/outside transaction', 'Status persists sanitized as valid/expired/blocked/unknown']
  },
  {
    id: 'catalog', name: 'Academic Catalog', arabic: 'الفهرس الأكاديمي', runtime: 'web', color: 'cyan',
    owns: 'subject/assessment snapshots الطبيعية، external IDs، timestamps، وتحويل source status إلى بيانات آمنة.',
    exposes: ['ListSubjects','ListDueAssessments','RefreshSubjects','RefreshAssessments'],
    nodes: [
      reg({ id:'catalog-routes', module:'catalog', runtime:'web', kind:'Route handlers', file:'apps/web/src/routes/api/v1/subjects/*', title:'Subjects/assessments endpoints', summary:'GET reads cached owner-scoped snapshots، وPOST refresh يشغّل approved read operations بشكل bounded.', input:'subjectId/cursor/limit/dueOnly validated.', output:'subject/assessment DTOs أو counts.', transaction:'لا direct SQL؛ use cases فقط.', functions:[
        reg({ id:'fn-refresh-subjects-route', module:'catalog', runtime:'web', kind:'Function', title:'POST /api/v1/subjects/refresh', file:'apps/web/src/routes/api/v1/subjects/refresh/index.ts', input:'actor فقط؛ no body في النسخة الأولى', output:'{ refreshedAt, subjectCount }', transaction:'upsert transaction داخل use case', rules:['GET لا يحمل side effects.','إذا احتاج paging beyond budget يجب ADR/async sync وليس unbounded request.'] }),
        reg({ id:'fn-refresh-assessments-route', module:'catalog', runtime:'web', kind:'Function', title:'POST /api/v1/subjects/:subjectId/assessments/refresh', file:'apps/web/src/routes/api/v1/subjects/$subjectId/assessments/refresh.ts', input:'owned subjectId + optional supported dueOnly', output:'{ refreshedAt, assessmentCount }', transaction:'upsert transaction بعد parse/validate', rules:['لا ترسل parameters غير معروفة إلى LMS.'] })
      ], rules:['لا تكشف lms_connection_id أو credential metadata.'], forbidden:['raw HTML أو CSRF/session internals في DTO.'] }),
      reg({ id:'catalog-usecases', module:'catalog', runtime:'application', kind:'Application use cases', file:'packages/application/src/catalog/use-cases.ts', title:'Catalog use cases', summary:'List operations read DB فقط؛ refresh operations تنسق connection ownership وadapter وnormalize/upsert.', input:'ActorContext + optional subjectId.', output:'user-scoped DTOs/count/refreshedAt.', transaction:'upsert short transaction بعد network/parse.', functions:[
        reg({ id:'fn-list-subjects', module:'catalog', runtime:'application', kind:'Function', title:'ListSubjects', file:'packages/application/src/catalog/use-cases.ts', input:'actor.userId + bounded cursor/limit', output:'items + nextCursor', transaction:'قراءة owner-scoped', rules:['Catalog data belongs to connection owner.'] }),
        reg({ id:'fn-refresh-subjects-usecase', module:'catalog', runtime:'application', kind:'Function', title:'RefreshSubjects', file:'packages/application/src/catalog/use-cases.ts', input:'actor-owned connection', output:'normalized subject list/count', transaction:'network outside transaction ثم upsert by (lms_connection_id, external_subject_id)', rules:['unknown structure => PARSER_MISMATCH ولا guessed inserts.'] }),
        reg({ id:'fn-refresh-assessments-usecase', module:'catalog', runtime:'application', kind:'Function', title:'RefreshAssessments', file:'packages/application/src/catalog/use-cases.ts', input:'owned subject + approved source read', output:'assessment snapshots/count', transaction:'upsert by (subject_id, external_assessment_id)', rules:['timed_quiz_status yes/no/unknown؛ unknown لا تعامل كـ no.'] })
      ], rules:['External IDs preserved as text.','lastSyncedAt منفصل عن sourceStatus.'], forbidden:['fetching LMS لمجرد GET cache list.'] }),
      reg({ id:'catalog-domain', module:'catalog', runtime:'domain', kind:'Domain normalizers/rules', file:'packages/domain/src/catalog/*', title:'Catalog normalization invariants', summary:'Pure rules لتحديد DTO status وtimed policy وshape validity.', input:'normalized adapter output.', output:'validated catalog entities أو PARSER_MISMATCH.', transaction:'لا يوجد.', functions:[
        reg({ id:'fn-normalize-timed-status', module:'catalog', runtime:'domain', kind:'Function', title:'normalizeTimedQuizStatus', file:'packages/domain/src/catalog/*', input:'source value أو غياب value', output:'yes | no | unknown', transaction:'لا ينطبق', rules:['yes/unknown default-deny؛ فقط no explicit غير timed.'] })
      ], rules:['لا fabricated subject/assessment/question.'], forbidden:['استيراد Cheerio/HTML parser أو Drizzle في Domain.'] }),
      reg({ id:'catalog-infra', module:'catalog', runtime:'infrastructure', kind:'Adapters', file:'packages/db/src/repositories/catalog* + packages/integrations/src/lms/*', title:'Catalog persistence + LMS read adapter', summary:'Drizzle upserts وapproved/fake LMS read operations مع timeouts/rate limiting.', input:'validated normalized snapshots.', output:'rows persisted/typed read output.', transaction:'short upsert transactions فقط.', functions:[
        reg({ id:'fn-upsert-catalog', module:'catalog', runtime:'database', kind:'Repository function', title:'upsertSubjects/upsertAssessments', file:'packages/db/src/repositories/catalog-repository.ts', input:'validated snapshots + connection ownership keys', output:'persisted snapshots', transaction:'short DB transaction', rules:['unique external ID keys prevent duplicates.'] }),
        reg({ id:'fn-lms-read-catalog', module:'catalog', runtime:'infrastructure', kind:'Adapter function', title:'fetchSubjects/fetchAssessments', file:'packages/integrations/src/lms/*', input:'execution credential + fixed approved route', output:'typed normalized source data', transaction:'network خارج transaction', rules:['fixed host allowlist وresponse limits وshared global limiter.'] })
      ], rules:['429/Retry-After محترم.','403/explicit block يوقف integration.'], forbidden:['guessing fields عند parser change.'] })
    ],
    callOrder: ['Refresh route authenticates actor and validates path/body', 'Use case loads owned connection metadata', 'Credential decrypts only inside execution boundary', 'LMS adapter performs approved read with timeout/rate limit', 'Normalizer validates typed output', 'Repository upserts snapshots in short transaction', 'Route returns count/timestamp only']
  },
  {
    id: 'solving', name: 'Solving', arabic: 'حل التقييمات في الخلفية', runtime: 'worker', color: 'violet',
    owns: 'job creation/deduplication، states، orchestration، pause/resume/retry، ordering، checkpoints.',
    exposes: ['CreateSolveJobs','GetSolveJob','ListSolveJobs','ResumeSolveJob','ProcessSolveJob'],
    nodes: [
      reg({ id:'solving-routes', module:'solving', runtime:'web', kind:'Route handlers', file:'apps/web/src/routes/api/v1/jobs/*', title:'Job API handlers', summary:'إنشاء/قراءة/استئناف jobs. لا تنفذ AI أو solving داخل request.', input:'attemptIds + Idempotency-Key أو jobId.', output:'202 job receipts أو sanitized progress.', transaction:'Creation inside use case transaction؛ route لا يملك transaction.', functions:[
        reg({ id:'fn-create-jobs-route', module:'solving', runtime:'web', kind:'Function', title:'POST /api/v1/jobs/solve', file:'apps/web/src/routes/api/v1/jobs/solve.ts', input:'{ attemptIds, language, timedAssessmentAcknowledgement } + Idempotency-Key', output:'202 { jobs[] }', transaction:'atomic quota reservation + job insertion داخل CreateSolveJobs', rules:['لا AI inline.','foreign/missing attempts => non-disclosing not-found.','timed acknowledgement alone insufficient.'] }),
        reg({ id:'fn-resume-route', module:'solving', runtime:'web', kind:'Function', title:'POST /api/v1/jobs/:jobId/resume', file:'apps/web/src/routes/api/v1/jobs/$jobId/resume.ts', input:'jobId فقط؛ no client status', output:'202 { jobId, status: queued }', transaction:'short resume transaction', rules:['لا تقبل status: running من browser.'] })
      ], rules:['Validate UUIDs/body bounds.','لا expose locked_by أو lease tokens أو raw upstream details.'], forbidden:['Route sets DB status directly.','Browser supplies raw quiz_id/results_id.'] }),
      reg({ id:'solving-usecases', module:'solving', runtime:'application', kind:'Application use cases', file:'packages/application/src/solving/use-cases.ts', title:'Solving use cases', summary:'Create/List/Get/Resume/Process تطبق ownership وdomain transition policy وتستخدم ports فقط.', input:'ActorContext + attempt IDs أو claimed job.', output:'job receipts/progress/pause result.', transaction:'Create وresume وcheckpoint short؛ network خارج transaction.', functions:[
        reg({ id:'fn-create-solve-jobs', module:'solving', runtime:'application', kind:'Function', title:'CreateSolveJobs', file:'packages/application/src/solving/use-cases.ts', input:'ActorContext + attemptIds + Idempotency-Key', output:'job receipts existing/new', transaction:'single short transaction: ownership check + active tuple + quota row locks + reserve + insert queued jobs', rules:['quota/job insertion atomic.','existing active job لا يحجز quota مرة أخرى.'] }),
        reg({ id:'fn-resume-solve-job', module:'solving', runtime:'application', kind:'Function', title:'ResumeSolveJob', file:'packages/application/src/solving/use-cases.ts', input:'actor-owned paused jobId', output:'queued job receipt', transaction:'verify paused + blocker resolution + quota then status=queued, available_at=now()', rules:['credential change وحدها لا تستأنف؛ explicit user resume مطلوب.'] }),
        reg({ id:'fn-process-solve-job', module:'solving', runtime:'worker', kind:'Function', title:'ProcessSolveJob', file:'packages/application/src/solving/process-solve-job.ts', input:'claimed job id/snapshot', output:'completed | paused | failed/requeued outcome', transaction:'claim/checkpoint/complete transactions قصيرة؛ LMS وAI خارجها', rules:['one question at a time.','completed durable work skipped on resume.','Worker never receives final-submission capability.'] })
      ], rules:['state transitions عبر Domain policy.','لا DB transaction حول network.'], forbidden:['unbounded retries.','guessed answers/options/external IDs.'] }),
      reg({ id:'solving-domain', module:'solving', runtime:'domain', kind:'Domain state machine', file:'packages/domain/src/solving/*', title:'Job/question transition policy', summary:'Pure rules للحالات، timed policy، retry legality، وvalidation constraints.', input:'current state + event/context.', output:'legal transition أو typed rejection.', transaction:'لا يوجد.', functions:[
        reg({ id:'fn-timed-policy', module:'solving', runtime:'domain', kind:'Function', title:'assessTimedQuizPolicy', file:'packages/domain/src/solving/*', input:'timedQuizStatus + policy approval + feature configuration', output:'allow أو POLICY_BLOCKED', transaction:'لا ينطبق', rules:['yes/unknown default-deny.','user acknowledgement is not authorization evidence.'] }),
        reg({ id:'fn-transition-policy', module:'solving', runtime:'domain', kind:'Function', title:'canTransitionJob', file:'packages/domain/src/solving/*', input:'current job status + target event', output:'allowed transition semantics', transaction:'لا ينطبق', rules:['failed terminal retry ليس arbitrary update؛ explicit permitted transition فقط.'] })
      ], rules:['Domain knows no provider SDK types.'], forbidden:['Drizzle/TanStack/LMS parser imports.'] }),
      reg({ id:'solving-queue', module:'solving', runtime:'database', kind:'Queue/lease adapters', file:'packages/db/src/queue/postgres-job-queue.ts + coordination repositories', title:'PostgreSQL queue + leases + rate limiter', summary:'Durable queue في solve_jobs مع FOR UPDATE SKIP LOCKED وheartbeats وaccount leases وglobal token bucket.', input:'workerId/now/lease duration.', output:'claimed job أو defer.', transaction:'claim transaction قصيرة جداً؛ commit قبل أي network.', functions:[
        reg({ id:'fn-claim-next', module:'solving', runtime:'database', kind:'Adapter function', title:'claimNextEligibleJob', file:'packages/db/src/queue/postgres-job-queue.ts', input:'queued rows where available_at <= now()', output:'running job with locked_by/lease/heartbeat', transaction:'BEGIN + SELECT ... FOR UPDATE SKIP LOCKED + acquire account lease + update running + COMMIT', rules:['Multiple workers may claim different jobs.','live LMS account lease cannot be stolen.'] }),
        reg({ id:'fn-recover-stale', module:'solving', runtime:'database', kind:'Adapter function', title:'recoverStaleLeases', file:'packages/db/src/repositories/*', input:'expired running leases', output:'queued/reconciliation-required state', transaction:'short recovery transaction', rules:['lease is recovery mechanism, not proof remote request failed.'] })
      ], rules:['Questions within one attempt sequential.','Jobs sharing rotating LMS account serialized.'], forbidden:['in-memory global rate limiter across workers.','holding row locks during network.'] }),
      reg({ id:'solving-external', module:'solving', runtime:'infrastructure', kind:'LMS/AI adapters', file:'packages/integrations/src/lms/* + packages/integrations/src/ai/*', title:'Narrow external adapters', summary:'LmsReadPort، LmsDraftPort المعطل افتراضياً، AiDraftGenerationPort بدون tools/network arbitrary.', input:'normalized execution request.', output:'normalized question أو structured candidate/typed error.', transaction:'كل network خارج DB transactions.', functions:[
        reg({ id:'fn-ai-generate', module:'solving', runtime:'infrastructure', kind:'Adapter function', title:'AiDraftGenerationPort.generate', file:'packages/integrations/src/ai/*', input:'question content + configured language/model policy', output:'candidate answer/explanation/confidence', transaction:'لا يوجد؛ outside DB transaction', rules:['strict JSON schema + allowed option validation.','bounded retry/fallback only for eligible timeout/429/503.','لا raw prompt أو API key في logs.'] }),
        reg({ id:'fn-lms-draft-save', module:'solving', runtime:'infrastructure', kind:'Gated adapter function', title:'LmsDraftPort.saveDraft', file:'packages/integrations/src/lms/*', input:'approved remote draft payload', output:'saved | ambiguous | failed', transaction:'remote side effect خارج transaction؛ checkpoint داخل transaction بعدها', rules:['disabled/local fake by default.','timeout => ambiguous وreconcile قبل retry؛ no blind repeat.','not final submission.'] })
      ], rules:['AI output untrusted until validated.','LMS explicit blocks respected.'], forbidden:['AI gets browser/LMS/network tools.','remote draft save enabled without permission and semantic tests.'] })
    ],
    callOrder: ['POST validates attempts/key and returns fast 202 after atomic enqueue', 'Worker claims with SKIP LOCKED and account lease', 'Manifest loads/validates if pending then job_questions persist in short transaction', 'Each question processes sequentially: fetch/validate → AI generate/validate → optional gated remote draft → local checkpoint transaction', 'Job completes or pauses/requeues with typed safe reason']
  },
  {
    id: 'draft-review', name: 'Draft Review', arabic: 'مراجعة وتحرير المسودات', runtime: 'web', color: 'amber',
    owns: 'local answer drafts، versioning، user edits، review state، optimistic concurrency.',
    exposes: ['GetJobQuestions','GetDraft','UpdateDraft','MarkDraftReviewed'],
    nodes: [
      reg({ id:'draft-routes', module:'draft-review', runtime:'web', kind:'Route handlers', file:'apps/web/src/routes/api/v1/jobs/:jobId/questions + apps/web/src/routes/api/v1/drafts/:draftId/*', title:'Review API handlers', summary:'قراءة ordered question progress وdraft DTOs ثم PATCH/review مع expectedVersion.', input:'jobId/draftId + expectedVersion + answer.', output:'question list أو latest draft DTO.', transaction:'update transaction داخل use case/repository.', functions:[
        reg({ id:'fn-patch-draft', module:'draft-review', runtime:'web', kind:'Function', title:'PATCH /api/v1/drafts/:draftId', file:'apps/web/src/routes/api/v1/drafts/$draftId/index.ts', input:'{ expectedVersion, answer }', output:'draft DTO with version incremented', transaction:'ownership + version check + update + revision insert في transaction واحدة', rules:['409 VERSION_CONFLICT عند mismatch؛ لا silent overwrite.','local edit لا يكتب LMS implicitly.'] }),
        reg({ id:'fn-review-draft', module:'draft-review', runtime:'web', kind:'Function', title:'POST /api/v1/drafts/:draftId/review', file:'apps/web/src/routes/api/v1/drafts/$draftId/review.ts', input:'{ expectedVersion }', output:'reviewed draft state', transaction:'owner-scoped reviewed_at update', rules:['Hallili review state وليس LMS submission.'] })
      ], rules:['authorize job owner قبل loading question rows.'], forbidden:['تمثيل draft كـ submission.'] }),
      reg({ id:'draft-usecases', module:'draft-review', runtime:'application', kind:'Application use cases', file:'packages/application/src/drafts/use-cases.ts', title:'Draft review use cases', summary:'تحقق ownership وquestion-specific answer validation وoptimistic concurrency.', input:'draftId + owner actor + answer + expectedVersion.', output:'current draft/new version أو conflict.', transaction:'short transaction for update+revision+optional audit.', functions:[
        reg({ id:'fn-update-draft-usecase', module:'draft-review', runtime:'application', kind:'Function', title:'UpdateDraft', file:'packages/application/src/drafts/use-cases.ts', input:'actor + draftId + expectedVersion + answer', output:'updated draft أو 409', transaction:'fetch scoped draft → compare version → update payload/version/actor/time → append revision', rules:['validate answer against normalized question type/options.'] }),
        reg({ id:'fn-get-job-questions', module:'draft-review', runtime:'application', kind:'Function', title:'GetJobQuestions', file:'packages/application/src/drafts/use-cases.ts', input:'actor-owned jobId', output:'ordered question/draft DTOs', transaction:'قراءة فقط', rules:['لا raw upstream data أو secrets.'] })
      ], rules:['confidence ليست proof of correctness.','remote_save_status منفصل عن local readiness.'], forbidden:['write-through إلى LMS عند edit.'] }),
      reg({ id:'draft-domain', module:'draft-review', runtime:'domain', kind:'Domain validation', file:'packages/domain/src/drafts/*', title:'Answer/version invariants', summary:'Pure validation للأنواع والقيم المسموحة وقواعد version.', input:'normalized question + answer payload + versions.', output:'valid أو typed validation/conflict result.', transaction:'لا يوجد.', functions:[
        reg({ id:'fn-validate-answer', module:'draft-review', runtime:'domain', kind:'Function', title:'validateAnswerForQuestion', file:'packages/domain/src/drafts/*', input:'answer payload + question type/options', output:'boolean/typed validation failure', transaction:'لا ينطبق', rules:['reject fabricated/out-of-range option IDs.'] })
      ], rules:['answer shape depends on supported observed/validated question types.'], forbidden:['inventing answer shape before fixtures.'] }),
      reg({ id:'draft-repo', module:'draft-review', runtime:'database', kind:'Repository adapter', file:'packages/db/src/repositories/draft-repository.ts', title:'Draft persistence adapter', summary:'current answer_drafts row واحد لكل job_question وappend-only draft_revisions.', input:'validated payload/version/actor.', output:'persisted draft/revision.', transaction:'single short transaction for edit/review mutation.', functions:[
        reg({ id:'fn-update-draft-repo', module:'draft-review', runtime:'database', kind:'Repository function', title:'updateDraftWithRevision', file:'packages/db/src/repositories/draft-repository.ts', input:'draftId + expectedVersion + payload + actor', output:'updated row or version_conflict', transaction:'UPDATE answer_drafts with version predicate + INSERT draft_revisions atomically', rules:['UNIQUE(job_question_id) current draft.','UNIQUE(draft_id, version) revision history.'] })
      ], rules:['confidence constrained [0,1].','remote timeout ambiguous until reconciliation.'], forbidden:['blind retry of ambiguous remote write.'] })
    ],
    callOrder: ['Browser reads owner-scoped job/questions', 'UI displays prompt/answer/explanation/confidence disclaimer', 'PATCH sends expectedVersion', 'Use case validates ownership and answer', 'Repository transaction updates version and appends revision', 'Conflict reloads current version instead of overwriting']
  },
  {
    id: 'usage', name: 'Usage & Quotas', arabic: 'الاستخدام والحصص', runtime: 'application', color: 'rose',
    owns: 'plan limits، reservations، consumption/release، usage ledger.',
    exposes: ['CheckAndReserveQuota','ConsumeReservedUsage','ReleaseReservation','GetQuotaSummary'],
    nodes: [
      reg({ id:'usage-usecases', module:'usage', runtime:'application', kind:'Application use cases', file:'packages/application/src/usage/use-cases.ts', title:'Quota use cases', summary:'تقرأ limit configuration وتحجز/تستهلك/تحرر وحدات بشكل idempotent.', input:'userId + metric + requested units + reference id.', output:'reservation/consumption result أو QUOTA_EXCEEDED.', transaction:'كل mutation داخل DB transaction وrow lock.', functions:[
        reg({ id:'fn-check-reserve-quota', module:'usage', runtime:'application', kind:'Function', title:'CheckAndReserveQuota', file:'packages/application/src/usage/use-cases.ts', input:'userId + metric + units + reference', output:'reserved أو QUOTA_EXCEEDED', transaction:'lock quota bucket row then enforce consumed + reserved + requested <= limit', rules:['reservation/job insertion atomic in create-job flow.'] }),
        reg({ id:'fn-consume-quota', module:'usage', runtime:'application', kind:'Function', title:'ConsumeReservedUsage', file:'packages/application/src/usage/use-cases.ts', input:'reference id + units', output:'consumed ledger event', transaction:'idempotent quota_events insert + bucket update', rules:['duplicate usage charge prevented by UNIQUE(user_id,idempotency_key).'] })
      ], rules:['exact metric semantics remain product decision.'], forbidden:['floating point quota accounting.'] }),
      reg({ id:'usage-port', module:'usage', runtime:'application', kind:'Port', file:'packages/application/src/usage/ports.ts', title:'QuotaPort', summary:'Application-owned seam used by Solving without exposing Drizzle.', input:'reserve/consume/release commands.', output:'typed quota result.', transaction:'implemented transactionally by adapter.', functions:[], rules:['Solving coordinates when quota is used but Usage owns policy.'], forbidden:['AI provider selection داخل Usage.'] }),
      reg({ id:'usage-db', module:'usage', runtime:'database', kind:'Repository adapter', file:'packages/db/src/repositories/quota-repository.ts', title:'Quota bucket/ledger persistence', summary:'quota_buckets aggregate وquota_events append/idempotent ledger.', input:'quota command.', output:'updated counters/event.', transaction:'row lock + event insert + counter update atomically.', functions:[
        reg({ id:'fn-lock-quota-bucket', module:'usage', runtime:'database', kind:'Repository function', title:'lockBucketForUpdate', file:'packages/db/src/repositories/quota-repository.ts', input:'userId + metric + period', output:'locked bucket row', transaction:'SELECT ... FOR UPDATE inside short transaction', rules:['UNIQUE(user_id, metric, period_start).','non-negative checks.'] })
      ], rules:['quota ledger supports abuse/accounting audit with retention policy.'], forbidden:['double charging under retries/concurrency.'] })
    ],
    callOrder: ['CreateSolveJobs selects attempts', 'Quota bucket rows lock', 'Reservation ledger event inserts idempotently', 'queued job inserts in same transaction', 'Question/job completion consumes reserved units idempotently', 'Cancellation policy releases unused reservations']
  },
  {
    id: 'submission', name: 'Submission (conditional)', arabic: 'الإرسال النهائي المشروط', runtime: 'gated', color: 'red',
    owns: 'لا شيء مفعّل في v0.1؛ أي final action مستقبلي وaudit record فقط بعد gate مستقل.',
    exposes: ['No enabled v0.1 use case','future ConfirmSubmission only after policy gate'],
    nodes: [
      reg({ id:'submission-absent', module:'submission', runtime:'gated', kind:'Absent capability', file:'not enabled in v0.1', title:'No final-submission endpoint or Worker capability', summary:'العقدة المقصودة غير موجودة. UI يجب أن يوضح أن Hallili يخزن local review drafts فقط.', input:'لا يوجد.', output:'لا يوجد.', transaction:'لا يوجد.', functions:[], rules:['written authorization + supported integration method + threat review + fresh confirmation + idempotency/audit + Web-only capability + separated DB permissions.'], forbidden:['Worker import أو privilege.','زر وحده لا يثبت authorization.','تسمية draft completion كـ LMS submission.'] }),
      reg({ id:'submission-future', module:'submission', runtime:'gated', kind:'Future gated shape', file:'future Web-only submission module — not a current contract', title:'Future ConfirmSubmission boundary', summary:'إن وُجد لاحقاً: Web-only use case بصلاحيات منفصلة وتأكيد bound to exact attempt/current versions.', input:'fresh authentication + exact attempt + exact answer versions + explicit confirmation.', output:'idempotent submission result + audit record.', transaction:'يجب تصميمها لاحقاً مع separated permissions؛ ليست part of v0.1.', functions:[], rules:['لا implementation أو enablement عند غياب/غموض authorization.'], forbidden:['apps/worker cannot import this module/port.'] })
    ],
    callOrder: ['v0.1: capability absent/disabled', 'Future only: policy gate passes', 'fresh confirmation bound to exact versions', 'Web-only restricted adapter performs explicitly authorized operation', 'audit/result persists outside Worker privilege']
  },
  {
    id: 'notifications', name: 'Notifications (optional)', arabic: 'الإشعارات الاختيارية', runtime: 'gated', color: 'indigo',
    owns: 'user-owned notification records وdelivery status فقط.',
    exposes: ['NotifyJobFinished','ListNotifications','MarkNotificationRead'],
    nodes: [
      reg({ id:'notifications-usecases', module:'notifications', runtime:'application', kind:'Optional use cases', file:'packages/application/src/notifications/use-cases.ts', title:'Notification use cases', summary:'تقرأ final job outcome وتنشئ notification مملوكة للمستخدم؛ لا تملك ولا تغير job state.', input:'job outcome + userId.', output:'notification record/list/read state.', transaction:'notification persistence مستقلة؛ لا transaction/job-state mutation coupling.', functions:[
        reg({ id:'fn-notify-job-finished', module:'notifications', runtime:'application', kind:'Function', title:'NotifyJobFinished', file:'packages/application/src/notifications/use-cases.ts', input:'final job outcome reference', output:'user-owned notification', transaction:'insert notification only', rules:['implement after durable jobs and polling are stable.','لا تغيّر job state.'] })
      ], rules:['optional table only when FR-10 scheduled.'], forbidden:['Notification module writes job status.'] }),
      reg({ id:'notifications-db', module:'notifications', runtime:'database', kind:'Optional table', file:'packages/db/src/schema/notifications.ts', title:'notifications optional table', summary:'user-owned in-app notification records إن فعّلت.', input:'notification payload/status.', output:'stored notification.', transaction:'short insert/update read state.', functions:[], rules:['DATABASE.md: Add only when FR-10 is scheduled.'], forbidden:['استخدامها كـ job queue أو state owner.'] })
    ],
    callOrder: ['Job reaches final outcome in Solving', 'Notifications reads outcome reference', 'user-owned notification persists independently', 'UI lists/marks read without changing job state']
  }
];

const interEdges = [
  reg({ id:'edge-identity-all', kind:'edge', title:'Identity → كل User-facing modules', modules:['Identity & Access','Catalog/Solving/Draft Review/Usage'], input:'authenticated session', output:'ActorContext + ownership policy', transaction:'لا transaction؛ boundary context', rules:['كل user-owned read/mutation owner-scoped.','Worker uses job.userId rather than browser session.'] }),
  reg({ id:'edge-lms-catalog', kind:'edge', title:'LMS Connections → Catalog', modules:['LMS Connections','Academic Catalog'], input:'owned valid connection execution request', output:'execution-only credential lease for approved read', transaction:'network outside transaction then catalog upsert transaction', rules:['Catalog cannot decrypt/store credentials itself.','only approved read operation.'] }),
  reg({ id:'edge-lms-solving', kind:'edge', title:'LMS Connections → Solving', modules:['LMS Connections','Solving'], input:'connection id scoped to job owner', output:'serialized execution boundary + rotation persistence', transaction:'account lease acquired in claim transaction; network after commit', rules:['shared rotating session serialized.','rotation persists only through LMS Connections ownership.'] }),
  reg({ id:'edge-catalog-solving', kind:'edge', title:'Catalog → Solving', modules:['Academic Catalog','Solving'], input:'assessment_attempts snapshots with external tuple', output:'job creation input identity', transaction:'attempts must already exist from approved source read', rules:['browser never supplies raw quiz_id/results_id.','external IDs are text.'] }),
  reg({ id:'edge-usage-solving', kind:'edge', title:'Usage & Quotas ↔ Solving', modules:['Usage & Quotas','Solving'], input:'userId/metric/units/reference', output:'reserved/consumed/released quota or QUOTA_EXCEEDED', transaction:'row lock + ledger + job/checkpoint transaction', rules:['quota reservation and job insertion atomic.','idempotent ledger prevents double charging.'] }),
  reg({ id:'edge-solving-drafts', kind:'edge', title:'Solving → Draft Review', modules:['Solving','Draft Review'], input:'validated AI candidate + normalized question', output:'local draft + revision/checkpoint', transaction:'short checkpoint transaction', rules:['draft is not submission.','remote save status separate when gated feature exists.'] }),
  reg({ id:'edge-notifications-solving', kind:'edge', title:'Solving → Notifications', modules:['Solving','Notifications'], input:'final job outcome reference', output:'user-owned notification', transaction:'independent notification write', rules:['Notifications never mutate job state.'] }),
  reg({ id:'edge-submission-isolation', kind:'edge', title:'Submission isolation boundary', modules:['Submission','Worker'], input:'none in v0.1', output:'no capability', transaction:'no v0.1 transaction', rules:['Worker has no final-submission import/privilege.','future capability is Web-only after independent gate.'] })
];

const actors = ['Browser','apps/web','Better Auth','PostgreSQL','apps/worker','LMS','AI'];
const flows = {
  'create-job': {
    title: 'Flow C — إنشاء Solve Jobs', runtime: 'web',
    summary: 'POST سريع يعيد 202؛ لا ينتظر AI ولا ينفذ solving inline.',
    steps: [
      { id:'cj1', lane:'Browser', title:'اختيار attempts وإرسال POST', input:'attemptIds + language + Idempotency-Key', output:'HTTP request', transaction:'لا يوجد', detail:'الـ IDs هي UUIDs داخلية لمحاولات موجودة مسبقاً من approved source read؛ لا raw LMS IDs.', rules:['Idempotency-Key bounded ولا secrets.'] },
      { id:'cj2', lane:'apps/web', title:'Route validation/auth', input:'request', output:'ActorContext + validated DTO', transaction:'لا يوجد', detail:'Zod strict body وorigin/body size/session checks.', rules:['malformed/oversized input rejected.'] },
      { id:'cj3', lane:'apps/web', title:'CreateSolveJobs ownership/policy', input:'ActorContext + attemptIds', output:'owned attempts or non-disclosing 404', transaction:'قبل transaction الكتابة', detail:'Domain timed/default-deny policy قبل قبول العمل.', rules:['timed yes/unknown denied unless separate policy+config gate.'] },
      { id:'cj4', lane:'PostgreSQL', title:'Atomic create transaction', input:'new attempts + quota units', output:'queued solve_jobs + quota_events', transaction:'short transaction: verify ownership/active tuple → lock quota buckets → reserve → insert jobs → commit', detail:'Partial unique index هو concurrency backstop.', rules:['existing active job returned existing:true without double quota.','all-or-nothing recommended per FLOWS.'] },
      { id:'cj5', lane:'apps/web', title:'202 Accepted', input:'committed receipts', output:'jobIds/status queued/existing', transaction:'بعد commit', detail:'الاستجابة لا تعني أن AI بدأ أو انتهى.', rules:['Web request must remain fast.'] },
      { id:'cj6', lane:'apps/worker', title:'Worker polls independently', input:'queued rows', output:'future claim', transaction:'منفصل تماماً عن request', detail:'إذا Worker متوقف تبقى jobs queued.', rules:['browser closing does not affect execution.'] }
    ]
  },
  'worker-processing': {
    title: 'Flow D/E — معالجة الأسئلة sequentially وAI retry/fallback', runtime: 'worker',
    summary: 'Claim بقفل قصير، ثم كل الشبكة خارج Transactions، ثم checkpoint durable لكل سؤال.',
    steps: [
      { id:'wp1', lane:'apps/worker', title:'claimNextEligibleJob', input:'workerId + capacity', output:'claim request', transaction:'لم تبدأ بعد', detail:'Worker healthy/polls durable queue.', rules:['no public business API required.'] },
      { id:'wp2', lane:'PostgreSQL', title:'SELECT ... FOR UPDATE SKIP LOCKED', input:'queued + available_at <= now', output:'one skipped-locked candidate', transaction:'short claim transaction', detail:'acquire lms_account_lease ثم set running/locked_by/lease_expires_at/heartbeat_at/attempt_count.', rules:['live account lease cannot be stolen.','commit before network.'] },
      { id:'wp3', lane:'apps/worker', title:'load manifest/questions', input:'claimed job', output:'ordered pending questions', transaction:'read + manifest insert transaction إذا pending', detail:'إذا manifest pending يجلب Worker manifest ثم يدرج job_questions ordered in short transaction.', rules:['OD-24 detail: لا تُبطئ enqueue لمجرد manifest.','unknown identity => PARSER_MISMATCH pause.'] },
      { id:'wp4', lane:'LMS', title:'fetch permitted question data', input:'fixed approved LMS operation', output:'normalized question', transaction:'network outside DB transaction', detail:'timeout/size/parser validation مع rate limiter.', rules:['explicit block/403 => stop, no bypass.'] },
      { id:'wp5', lane:'AI', title:'generate structured candidate', input:'needed question content + configured language/model policy', output:'answer/explanation/confidence', transaction:'network outside DB transaction', detail:'AI adapter has no arbitrary browser/LMS/network tools.', rules:['strict JSON schema + allowed values validation.','bounded schema-correction retry only if configured.'] },
      { id:'wp6', lane:'AI', title:'classify retry/fallback', input:'timeout/429/503/permanent/invalid/unknown', output:'retry/backoff/fallback/pause decision', transaction:'لا يوجد', detail:'Retry-After honored؛ otherwise bounded exponential backoff + jitter؛ fallback only if policy allows.', rules:['لا retries للأخطاء permanent authorization.','لا unbounded retries.'] },
      { id:'wp7', lane:'LMS', title:'optional gated remote draft save', input:'approved draft payload', output:'saved/ambiguous/failed', transaction:'remote side effect outside transaction', detail:'LmsDraftPort disabled/local fake by default؛ remote write ليس final submission.', rules:['timeout => ambiguous وreconcile before retry.'] },
      { id:'wp8', lane:'PostgreSQL', title:'durable checkpoint transaction', input:'validated answer + revision + progress + quota event', output:'question durable outcome', transaction:'short transaction: upsert answer_drafts + append draft_revisions + mark question + update progress + consume quota idempotently', detail:'لا continue للسؤال التالي إلا بعد نجاح checkpoint.', rules:['completed durable work skipped on resume.'] },
      { id:'wp9', lane:'PostgreSQL', title:'final job state', input:'all question outcomes', output:'completed/paused/failed/requeued', transaction:'short final transition transaction', detail:'known blocker => paused typed reason؛ outage => backoff/requeue or exhaustion pause.', rules:['operator diagnostics sanitized.'] }
    ]
  },
  'pause-resume': {
    title: 'Flow F/G — Pause وResume واستعادة stale lease', runtime: 'worker',
    summary: 'Pause يحافظ على completed work؛ Resume explicit؛ lease recovery لا يفترض فشل remote write.',
    steps: [
      { id:'pr1', lane:'apps/worker', title:'اكتشاف blocker', input:'session expired/manual input/parser mismatch/policy/provider outage', output:'typed blocker', transaction:'قبل pause transaction', detail:'أي عمل مكتمل يحفظ أولاً.', rules:['no guessed continuation.'] },
      { id:'pr2', lane:'PostgreSQL', title:'pause transaction', input:'jobId + reason + safe message', output:'status=paused with progress retained', transaction:'short transaction; clear/invalidate lease as appropriate', detail:'UI يرى blocker المحدد.', rules:['user_message safe؛ لا raw provider text.'] },
      { id:'pr3', lane:'Browser', title:'user resolves blocker then presses Resume', input:'user action after fixing credential/input/policy', output:'POST resume', transaction:'لا يوجد', detail:'تغيير credential وحده لا يستأنف.', rules:['explicit resume required.'] },
      { id:'pr4', lane:'apps/web', title:'ResumeSolveJob validation', input:'actor-owned jobId', output:'validated resume command', transaction:'قبل write transaction', detail:'verify owner + current paused + blocker resolution + quota/locks.', rules:['client cannot send running.'] },
      { id:'pr5', lane:'PostgreSQL', title:'resume transaction', input:'valid paused job', output:'status=queued available_at=now()', transaction:'short transaction clears resolved pause/error fields', detail:'Worker يطالب لاحقاً.', rules:['browser never sets running directly.'] },
      { id:'pr6', lane:'PostgreSQL', title:'stale lease recovery', input:'expired heartbeat/lease', output:'queued or reconciliation-required state', transaction:'short recovery transaction after inspecting checkpoint/in-flight marker', detail:'إذا remote write ambiguous لا تكرر blindly.', rules:['lease is not proof remote request failed.'] },
      { id:'pr7', lane:'apps/worker', title:'resume processing safely', input:'durable question state', output:'first incomplete question', transaction:'normal checkpoint transactions', detail:'completed durable questions skipped.', rules:['revalidate blocker before continuing.'] }
    ]
  },
  'draft-edit': {
    title: 'Flow H — مراجعة وتحرير Local Draft', runtime: 'web',
    summary: 'Editing محلي فقط مع optimistic concurrency؛ لا يوجد write-through إلى LMS.',
    steps: [
      { id:'de1', lane:'Browser', title:'قراءة job/questions', input:'owner session + jobId', output:'GET questions', transaction:'قراءة فقط', detail:'route يجب authorize owner قبل تحميل rows.', rules:['لا lease tokens/raw upstream.'] },
      { id:'de2', lane:'apps/web', title:'Review UI يعرض draft', input:'question + answer + explanation + confidence', output:'editable local review screen', transaction:'لا يوجد', detail:'confidence هو model-reported وليس correctness.', rules:['draft not represented as submission.'] },
      { id:'de3', lane:'Browser', title:'PATCH مع expectedVersion', input:'draftId + expectedVersion + answer', output:'mutation request', transaction:'لا يوجد', detail:'browser لا يرسل status أو remote write instruction.', rules:['stale tab لا يجب overwrite.'] },
      { id:'de4', lane:'apps/web', title:'UpdateDraft validation', input:'ActorContext + payload', output:'validated command', transaction:'قبل write transaction', detail:'ownership + question type/allowed values validation.', rules:['fabricated/out-of-range option IDs rejected.'] },
      { id:'de5', lane:'PostgreSQL', title:'draft update transaction', input:'expectedVersion + new answer', output:'version+1 + revision row', transaction:'single transaction: fetch scoped draft → compare version → update payload/version/actor/time → insert revision → optional audit', detail:'mismatch returns 409 without writing.', rules:['no silent overwrite.'] },
      { id:'de6', lane:'apps/web', title:'latest draft DTO أو 409', input:'transaction result', output:'200 draft DTO أو 409 VERSION_CONFLICT', transaction:'بعد commit', detail:'client reloads current revision ويطلب reconcile عند conflict.', rules:['local edit does not implicitly save to LMS.'] }
    ]
  },
  'guardrails': {
    title: 'Failure/redaction guardrails عبر كل النظام', runtime: 'external',
    summary: 'قواعد الفشل الآمن والسرية التي لا يجوز تجاوزها في أي flow.',
    steps: [
      { id:'gr1', lane:'apps/web', title:'central validation/error mapping', input:'path/query/body/business/external errors', output:'stable safe envelope', transaction:'لا ينطبق', detail:'Zod للمدخلات وresponse DTOs في tests؛ route لا يعيد exception.message مباشرة.', rules:['deterministic centralized errors.'] },
      { id:'gr2', lane:'LMS', title:'respect explicit blocks', input:'403/WAF/explicit block/unexpected host', output:'blocked/expired/unknown safe state', transaction:'بعد network، persist status إن لزم', detail:'لا alternate host/proxy tricks/control bypass.', rules:['redirects revalidated hop by hop.'] },
      { id:'gr3', lane:'AI', title:'untrusted AI output', input:'model response', output:'validated candidate أو retry/pause', transaction:'خارج DB transaction', detail:'structured schema + source-derived allowed values.', rules:['لا fabricated option IDs أو guessed answers.'] },
      { id:'gr4', lane:'PostgreSQL', title:'short transaction invariant', input:'all persistence mutations', output:'committed durable checkpoint', transaction:'كل transaction قصيرة ومحددة الغرض', detail:'لا row locks أثناء LMS/AI network.', rules:['external calls after/before commit only.'] },
      { id:'gr5', lane:'apps/worker', title:'secret redaction', input:'logs/metrics/errors', output:'sanitized diagnostics only', transaction:'لا ينطبق', detail:'لا cookies أو CSRF أو API keys أو raw prompts افتراضياً.', rules:['credential plaintext exists only minimum time in execution boundary.'] },
      { id:'gr6', lane:'apps/worker', title:'final action forbidden', input:'any background job', output:'no final-submission operation', transaction:'لا يوجد', detail:'Worker package/DB role/composition root lacks capability/privilege.', rules:['future final action Web-only after separate written authorization.'] }
    ]
  }
};

function panelSection(title, content) { return `<section class="mt-5 rounded-2xl border border-white/10 bg-white/[.045] p-4"><h3 class="text-sm font-bold uppercase tracking-wide text-sky-300">${title}</h3><div class="mt-2">${content}</div></section>`; }
function inspectHtml(item) {
  return `
    <div class="space-y-2">
      ${item.kind ? `<span class="inline-flex rounded-full bg-sky-400/15 px-3 py-1 text-xs font-bold text-sky-200">${esc(item.kind)}</span>` : ''}
      ${item.module ? `<span class="inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-200">${esc(item.module)}</span>` : ''}
      ${item.runtime ? `<span class="inline-flex rounded-full bg-violet-400/15 px-3 py-1 text-xs font-bold text-violet-200 technical">${esc(item.runtime)}</span>` : ''}
    </div>
    ${item.file ? panelSection('File / boundary', `<code class="technical text-sm text-amber-200">${esc(item.file)}</code>`) : ''}
    ${item.summary || item.detail ? panelSection('الوظيفة / الدور', `<p>${esc(item.summary ?? item.detail)}</p>`) : ''}
    ${item.input ? panelSection('Input', `<p>${esc(item.input)}</p>`) : ''}
    ${item.output ? panelSection('Output', `<p>${esc(item.output)}</p>`) : ''}
    ${item.transaction ? panelSection('Transaction boundary', `<p>${esc(item.transaction)}</p>`) : ''}
    ${item.rules?.length ? panelSection('Rules / invariants', list(item.rules.map(esc))) : ''}
    ${item.forbidden?.length ? panelSection('Forbidden shortcuts', list(item.forbidden.map((x) => `<span class="text-rose-200">${esc(x)}</span>`))) : ''}
  `;
}
function showInspector(id) {
  const item = registry.get(id);
  if (!item) return;
  document.getElementById('inspectorTitle').textContent = item.title;
  document.getElementById('inspectorBody').innerHTML = inspectHtml(item);
}
function matchesRuntime(item) { return state.runtime === 'all' || item.runtime === state.runtime || (state.runtime === 'database' && item.runtime === 'database'); }
function matchesQuery(text) { return !state.query || text.toLowerCase().includes(state.query); }
function runtimeBadge(runtime) { return `<span class="technical rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300">${esc(runtime)}</span>`; }

function renderRuntimeFilters() {
  document.getElementById('runtimeFilters').innerHTML = Object.entries(runtimeLabels).map(([key,label]) => `<button data-runtime="${key}" class="rounded-full border px-3 py-1.5 text-xs font-bold transition ${state.runtime===key?'border-sky-300 bg-sky-400/20 text-sky-100':'border-white/10 bg-white/[.04] text-slate-400 hover:bg-white/10'}">${label}</button>`).join('');
}
function renderTabs() {
  document.querySelectorAll('.view-tab').forEach((el) => {
    const active = el.dataset.view === state.view;
    el.className = `view-tab rounded-full border px-4 py-2 font-semibold transition ${active ? 'border-sky-300 bg-sky-400/20 text-white' : 'border-white/10 bg-white/[.04] text-slate-300 hover:bg-white/10'}`;
  });
}
function renderIntra() {
  const mod = modules.find((m) => m.id === state.module) ?? modules[0];
  const filteredNodes = mod.nodes.filter((node) => matchesRuntime(node) && matchesQuery(`${node.title} ${node.file} ${node.summary} ${node.functions?.map((f)=>f.title).join(' ')}`));
  return `
    <div class="mb-5 flex flex-wrap gap-2">${modules.map((m) => `<button data-module="${m.id}" class="rounded-xl border px-4 py-2 text-sm font-bold transition ${m.id===mod.id?'border-sky-300 bg-sky-400/20 text-white':'border-white/10 bg-white/[.045] text-slate-300 hover:bg-white/10'}">${m.arabic}<span class="technical mr-2 text-xs opacity-70">${m.name}</span></button>`).join('')}</div>
    <section class="rounded-3xl border border-white/10 bg-white/[.045] p-5">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><p class="text-sm font-bold text-sky-300 technical">${mod.name}</p><h2 class="mt-1 text-3xl font-black text-white">${mod.arabic}</h2><p class="mt-3 max-w-3xl leading-8 text-slate-300">${mod.owns}</p></div>
        <div class="rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div class="text-xs font-bold text-slate-400">Exposed use cases</div><div class="mt-2 flex flex-wrap gap-2">${mod.exposes.map((x)=>`<span class="technical rounded-lg bg-sky-400/10 px-2.5 py-1 text-xs text-sky-200">${x}</span>`).join('')}</div></div>
      </div>
      <details class="mt-5 rounded-2xl border border-sky-400/20 bg-sky-400/10 p-4" open><summary class="cursor-pointer text-sm font-bold text-sky-100">ترتيب الاستدعاء الدقيق داخل الـ Module <span class="text-slate-400">(انقر للطي/الفتح)</span></summary><ol class="mt-3 grid gap-2 md:grid-cols-2">${mod.callOrder.map((step,i)=>`<li class="rounded-xl bg-slate-950/40 p-3 text-sm leading-6"><b class="text-sky-300">${i+1}.</b> ${esc(step)}</li>`).join('')}</ol></details>
    </section>
    <div class="mt-6 space-y-8">${filteredNodes.map((node, index) => `
      <article class="flow-arrow relative rounded-3xl border border-white/10 bg-slate-900/80 p-5 shadow-xl shadow-black/20 ${matchesRuntime(node)?'':'dimmed'}">
        <button data-inspect="${node.id}" class="block w-full text-right">
          <div class="flex flex-wrap items-center justify-between gap-3"><div><span class="text-xs font-bold text-slate-500">${index+1}</span> ${runtimeBadge(node.runtime)} <span class="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300">${esc(node.kind)}</span><h3 class="mt-2 text-2xl font-black text-white hover:text-sky-200">${esc(node.title)}</h3></div><code class="technical max-w-full rounded-xl bg-black/30 px-3 py-2 text-xs text-amber-200">${esc(node.file)}</code></div>
          <p class="mt-3 leading-8 text-slate-300">${esc(node.summary)}</p>
        </button>
        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <div class="rounded-xl bg-white/[.045] p-3"><b class="text-xs text-sky-300">Input</b><p class="mt-1 text-sm leading-6 text-slate-300">${esc(node.input)}</p></div>
          <div class="rounded-xl bg-white/[.045] p-3"><b class="text-xs text-emerald-300">Output</b><p class="mt-1 text-sm leading-6 text-slate-300">${esc(node.output)}</p></div>
          <div class="rounded-xl bg-white/[.045] p-3"><b class="text-xs text-violet-300">Transaction</b><p class="mt-1 text-sm leading-6 text-slate-300">${esc(node.transaction)}</p></div>
        </div>
        ${node.functions?.length ? `<div class="mt-4"><div class="text-xs font-bold text-slate-400">Key functions / ports — انقر للتفاصيل</div><div class="mt-2 flex flex-wrap gap-2">${node.functions.map((fn)=>`<button data-inspect="${fn.id}" class="technical rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-xs font-bold text-sky-100 transition hover:border-sky-300 hover:bg-sky-400/20">${esc(fn.title)}</button>`).join('')}</div></div>` : ''}
        ${node.forbidden?.length ? `<div class="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3"><b class="text-sm text-rose-200">Forbidden shortcuts</b><ul class="mt-2 list-disc pr-5 text-sm leading-6 text-rose-100/90">${node.forbidden.map((x)=>`<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </article>`).join('') || `<div class="rounded-2xl border border-white/10 bg-white/[.04] p-8 text-center text-slate-400">لا توجد عناصر تطابق الفلتر الحالي.</div>`}
    </div>`;
}
function renderInter() {
  return `
    <section class="rounded-3xl border border-white/10 bg-white/[.045] p-5">
      <h2 class="text-3xl font-black text-white">Inter-Module Communication</h2>
      <p class="mt-3 max-w-4xl leading-8 text-slate-300">التواصل يحدث عبر Application use cases وPorts، وليس باستدعاء SQL أو SDK مباشرة من module آخر. الاتجاه المسموح: <span class="technical">apps/web + apps/worker → Application → Domain</span>، وتستخدم Application منافذها لتصل إلى Infrastructure. انقر أي edge لعرض القواعد والحدود.</p>
      <div class="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/60 p-5" dir="ltr">
        <div class="min-w-[980px] font-mono text-sm leading-8 text-slate-200">
          <div class="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3 text-center">
            <div class="rounded-xl border border-sky-400/30 bg-sky-400/10 p-4">apps/web<br/><span class="text-xs text-slate-400">TanStack Start only HTTP backend</span></div>
            <div class="text-sky-300">──┐</div><div></div><div></div><div></div>
            <div class="rounded-xl border border-violet-400/30 bg-violet-400/10 p-4">apps/worker<br/><span class="text-xs text-slate-400">Node background process</span></div>
            <div class="text-sky-300">──┘</div><div class="text-sky-300">→</div><div class="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">Application<br/><span class="text-xs text-slate-400">use cases + ports</span></div><div class="text-sky-300">→</div><div class="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">Domain<br/><span class="text-xs text-slate-400">pure invariants</span></div>
          </div>
          <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center"><div></div><div></div><div class="text-sky-300">↓ ports</div><div></div><div></div></div>
          <div class="mt-1 grid grid-cols-5 gap-3 text-center text-xs"><div class="rounded-lg bg-white/5 p-3">Drizzle / PostgreSQL</div><div class="rounded-lg bg-white/5 p-3">LMS adapter</div><div class="rounded-lg bg-white/5 p-3">AI adapter</div><div class="rounded-lg bg-white/5 p-3">Encryption adapter</div><div class="rounded-lg bg-white/5 p-3">Logger / Metrics</div></div>
        </div>
      </div>
    </section>
    <div class="mt-6 grid gap-4 lg:grid-cols-2">${interEdges.filter((e)=>matchesQuery(`${e.title} ${e.modules.join(' ')} ${e.rules.join(' ')}`)).map((edge)=>`<button data-inspect="${edge.id}" class="rounded-2xl border border-white/10 bg-slate-900/80 p-5 text-right transition hover:border-sky-400/40 hover:bg-slate-900"><div class="flex items-start justify-between gap-3"><div><h3 class="text-xl font-black text-white">${esc(edge.title)}</h3><p class="mt-2 text-sm text-slate-400">${edge.modules.map(esc).join(' · ')}</p></div><span class="text-sky-300">↔</span></div><div class="mt-4 grid gap-2 text-sm"><div><b class="text-sky-300">Input:</b> <span class="text-slate-300">${esc(edge.input)}</span></div><div><b class="text-emerald-300">Output:</b> <span class="text-slate-300">${esc(edge.output)}</span></div><div><b class="text-violet-300">Boundary:</b> <span class="text-slate-300">${esc(edge.transaction)}</span></div></div></button>`).join('')}</div>
    <section class="mt-6 rounded-3xl border border-rose-400/25 bg-rose-400/10 p-5"><h3 class="text-xl font-black text-rose-100">Forbidden dependency edges</h3><div class="mt-3 grid gap-3 md:grid-cols-2 text-sm leading-7 text-rose-50/90"><div>• Domain → Drizzle/TanStack/AI SDK/LMS parser</div><div>• UI → database package أو integration SDK</div><div>• Route handler → direct SQL/AI provider/LMS HTTP</div><div>• Worker → Submission module/port</div><div>• LMS adapter → arbitrary URLs من request/model output</div><div>• Contracts → Drizzle row types</div></div></section>`;
}
function renderSystem() {
  const flow = flows[state.flow];
  const laneMap = { web: ['apps/web', 'Browser'], worker: ['apps/worker'], database: ['PostgreSQL'], external: ['LMS', 'AI', 'Better Auth'] };
  const activeLanes = laneMap[state.runtime] ?? null;
  return `
    <div class="mb-5 flex flex-wrap gap-2">${Object.entries(flows).map(([id,item])=>`<button data-flow="${id}" class="rounded-xl border px-4 py-2 text-sm font-bold transition ${id===state.flow?'border-sky-300 bg-sky-400/20 text-white':'border-white/10 bg-white/[.045] text-slate-300 hover:bg-white/10'}">${item.title}</button>`).join('')}</div>
    <section class="rounded-3xl border border-white/10 bg-white/[.045] p-5"><h2 class="text-3xl font-black text-white">${flow.title}</h2><p class="mt-3 max-w-4xl leading-8 text-slate-300">${flow.summary}</p></section>
    <section class="mt-6 overflow-x-auto rounded-3xl border border-white/10 bg-slate-950/60 p-5" dir="ltr">
      <div class="grid min-w-[1050px] grid-cols-7 gap-3">${actors.map((actor)=>`<div class="rounded-xl border px-3 py-3 text-center font-mono text-sm font-bold ${activeLanes?.includes(actor)?'border-sky-300 bg-sky-400/20 text-white lane-on':'border-white/10 bg-white/[.04] text-slate-300'}">${actor}</div>`).join('')}</div>
    </section>
    <div class="step-line relative mt-7 space-y-5 pr-12">${flow.steps.filter((s)=>matchesQuery(`${s.title} ${s.detail} ${s.rules.join(' ')}`)).map((step,index)=>{ registry.set(step.id, { ...step, kind:'Flow step', runtime: step.lane === 'PostgreSQL' ? 'database' : step.lane === 'apps/worker' ? 'worker' : step.lane === 'apps/web' || step.lane === 'Browser' ? 'web' : 'external', file: flow.title, summary: step.detail }); return `
      <button data-inspect="${step.id}" class="relative block w-full rounded-2xl border border-white/10 bg-slate-900/85 p-5 text-right shadow-lg shadow-black/20 transition hover:border-sky-400/40 ${activeLanes && !activeLanes.includes(step.lane) ? 'dimmed' : ''}">
        <span class="absolute -right-11 top-5 flex h-8 w-8 items-center justify-center rounded-full border border-sky-300 bg-slate-950 text-sm font-black text-sky-200">${index+1}</span>
        <div class="flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-3"><span class="technical rounded-full bg-sky-400/10 px-3 py-1 text-xs font-bold text-sky-200">${esc(step.lane)}</span><h3 class="text-xl font-black text-white">${esc(step.title)}</h3></div><span class="text-sky-300">Inspect ←</span></div>
        <p class="mt-3 leading-8 text-slate-300">${esc(step.detail)}</p>
        <div class="mt-4 grid gap-3 md:grid-cols-3 text-sm"><div class="rounded-xl bg-white/[.045] p-3"><b class="text-sky-300">Input</b><p class="mt-1 text-slate-300">${esc(step.input)}</p></div><div class="rounded-xl bg-white/[.045] p-3"><b class="text-emerald-300">Output</b><p class="mt-1 text-slate-300">${esc(step.output)}</p></div><div class="rounded-xl bg-white/[.045] p-3"><b class="text-violet-300">Transaction</b><p class="mt-1 text-slate-300">${esc(step.transaction)}</p></div></div>
        <div class="mt-3 flex flex-wrap gap-2">${step.rules.map((rule)=>`<span class="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-100">${esc(rule)}</span>`).join('')}</div>
      </button>`; }).join('')}</div>`;
}
function render() {
  registry.clear();
  // Re-register static module data after registry clear.
  modules.forEach((m) => m.nodes.forEach((n) => { registry.set(n.id,n); n.functions?.forEach((f)=>registry.set(f.id,f)); }));
  interEdges.forEach((e)=>registry.set(e.id,e));
  renderTabs(); renderRuntimeFilters();
  const canvas = document.getElementById('canvas');
  canvas.innerHTML = state.view === 'intra' ? renderIntra() : state.view === 'inter' ? renderInter() : renderSystem();
}
document.addEventListener('click', (event) => {
  const inspect = event.target.closest('[data-inspect]');
  if (inspect) { showInspector(inspect.dataset.inspect); return; }
  const view = event.target.closest('[data-view]');
  if (view) { state.view = view.dataset.view; render(); return; }
  const mod = event.target.closest('[data-module]');
  if (mod) { state.module = mod.dataset.module; render(); return; }
  const flow = event.target.closest('[data-flow]');
  if (flow) { state.flow = flow.dataset.flow; render(); return; }
  const runtime = event.target.closest('[data-runtime]');
  if (runtime) { state.runtime = runtime.dataset.runtime; render(); return; }
});
document.getElementById('searchInput').addEventListener('input', (event) => { state.query = event.target.value.trim().toLowerCase(); render(); });
render();

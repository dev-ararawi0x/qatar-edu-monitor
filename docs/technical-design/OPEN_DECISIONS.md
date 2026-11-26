# Hallili — Open Technical and Product Decisions

**Version:** v0.1  
**Status:** Baseline decisions recorded; real LMS integration remains gated pending live verification

This register prevents unknown external facts from becoming accidental implementation assumptions. Each item needs an owner, evidence, decision, and date. `Accepted (Baseline)` means the safe default is now the working contract for `v0.1`. `Accepted (Baseline / Pending Live LMS Verification)` means the safe default stands, but the real LMS/school/policy fact must still be confirmed before enabling the corresponding live external capability — tests and default paths stay fail-closed (`Fake`/`Mock`) until then. `Deferred` means the item is intentionally postponed.

## 1. Blocking gates

| ID | Question | Why it matters | v0.1 decision / status |
|---|---|---|---|
| OD-01 | Is the proposed LMS integration method explicitly permitted by the LMS/school? | Determines whether a real adapter may be enabled at all | Accepted (Baseline / Pending Live LMS Verification) — live LMS integration stays gated until explicit authorization/policy is verified; tests and default integration paths stay safe and fail-closed with `Fake`/`Mock` adapters |
| OD-02 | Does the LMS provide an official API or documented integration method? | Determines approved access path and reduces reliance on private HTML internals | Accepted (Baseline / Pending Live LMS Verification) — prefer direct authorized HTTP requests + server-rendered HTML parsing (`Cheerio`); LMS pages are SSR, do not invent undocumented endpoints, do not launch a full headless browser per request |
| OD-03 | Which read operations are allowed (subjects, due assessments, question data)? | Defines adapter scope and user data access | Accepted (Baseline / Pending Live LMS Verification) — scope reads to the authenticated student's own subjects, due assessments (`Due`), and attempt/question pages only |
| OD-04 | Is saving a remote draft explicitly supported and allowed? What is its exact meaning? | Determines whether FR-05 can be implemented remotely | Accepted (Baseline / Pending Live LMS Verification) — remote draft saving is part of the `v0.1` workflow (`--apply` draft persistence + `/pause`); after ambiguous network timeouts, reconcile remote state instead of blind retries |
| OD-05 | Is any final submission action allowed/required in v0.1? | Potentially high-impact irreversible action | Accepted (Baseline / Pending Live LMS Verification) — final submission (`/finish`) is completely blocked in the background `Worker`; allow it only via an explicit user-confirmed web review/finish flow after policy and integration checks pass |
| OD-06 | What are the academic-integrity rules for graded and timed assessments? | A user checkbox cannot grant policy permission | Accepted (Baseline / Pending Live LMS Verification) — gate timed or graded assessments behind explicit opt-in and policy checks; default to safe pause/deny unless explicitly enabled with a clear warning |
| OD-07 | What content may be sent to an AI provider, and under what retention/privacy terms? | Question content may be student/school information | Accepted (Baseline / Pending Live LMS Verification) — send only necessary question/option data to configured AI providers; strictly redact secrets/cookies/tokens as `"VALUES"`; avoid storing unnecessary sensitive content |

## 2. External data and identity questions

| ID | Question | Design impact | v0.1 decision / status |
|---|---|---|---|
| OD-08 | What exact stable external IDs identify subject, assessment, quiz, result/attempt, and question? | Uniqueness, resume, idempotency, schema | Accepted (Baseline / Pending Live LMS Verification) — store external identifiers (`quiz_id`, `results_id`, part/question IDs) as `text`; verify reuse/refresh behavior against sanitized fixtures (`"VALUES"`) before relying on them |
| OD-09 | Can a result/attempt ID be reused or change when assessment data refreshes? | Active-job uniqueness and history | Accepted (Baseline / Pending Live LMS Verification) — scope attempts carefully and capture sanitized fixtures (`"VALUES"`) to verify ID reuse/refresh behavior |
| OD-10 | Which Microsoft account types/tenants may sign in? | Better Auth provider and access policy | Accepted (Baseline / Pending Live LMS Verification) — use Better Auth with Microsoft sign-in; keep tenant/account eligibility explicitly configurable and verified before enabling |
| OD-11 | Is one LMS connection per Hallili user sufficient? | Connection schema cardinality | Accepted (Baseline) — start with one active/default LMS connection per user (`1:1` / single active connection) in `v0.1`; revisit if requirements prove otherwise |

## 3. Session and operational questions

| ID | Question | Design impact | v0.1 decision / status |
|---|---|---|---|
| OD-12 | What are cookie expiry and rotation semantics? | `lms_connections`, persistence, job pause/resume | Accepted (Baseline / Pending Live LMS Verification) — track cookies in an isolated per-run `SessionCookieJar`, re-encrypt and persist updated `Set-Cookie` values, pause with `SESSION_EXPIRED` on auth redirects |
| OD-13 | Can multiple attempts share one LMS session safely? | Worker concurrency | Accepted (Baseline / Pending Live LMS Verification) — serialize requests per session/attempt (`1` sequential request per attempt/session) to prevent cookie/token race conditions; do not assume concurrency is safe until proven |
| OD-14 | What global request limit is permitted, and what does `Retry-After` mean? | Shared rate limiter | Accepted (Baseline) — enforce conservative configurable outbound rate limiting, honor `Retry-After` and `429`/`503` backoff + model fallback, and never attempt WAF/anti-abuse bypass |
| OD-15 | What peak simultaneous users/jobs should be supported? | Worker concurrency, DB pool, load tests | Accepted (Baseline) — target small-scale measured concurrency first: `Web` (TanStack Start) + a long-running `Worker` process backed by PostgreSQL + Drizzle (`SELECT ... FOR UPDATE SKIP LOCKED`); measure before raising concurrency |
| OD-16 | Where will Web, Worker, PostgreSQL, and secret storage run? | Deployment and reliability | Accepted (Baseline) — `Web` (TanStack Start) and a long-running `Worker` process (not serverless functions) backed by PostgreSQL + Drizzle, with external secret management |

| ID | Question | Design impact | v0.1 decision / status |
|---|---|---|---|
| OD-24 | Are ordered question IDs/positions available before enqueue (for example from cached attempt data), or must the Worker fetch the manifest after claim? | Resolves the small conflict between System Design's atomic initial-question insertion and the sub-300ms enqueue requirement | Accepted (Baseline / Pending Live LMS Verification) — resolve/materialize attempt identity (`quiz_id`, `results_id`) on the server during catalog/assessment reads; keep job enqueue fast (<300ms); let the `Worker` load/persist ordered questions after claiming the job if not already preloaded |
| OD-25 | At what point are `assessment_attempts` records created, and what approved source provides `lms_quiz_id` and `lms_results_id`? | The API accepts internal `attemptIds`, so the catalog/attempt read path must materialize these rows before job creation | Accepted (Baseline / Pending Live LMS Verification) — never trust raw external IDs from the browser; resolve and persist attempt identity server-side in the approved catalog/assessment read use case |

## 4. Product semantics

| ID | Question | Design impact | v0.1 decision / status |
|---|---|---|---|
| OD-17 | Does quota count one assessment, one question, each model attempt, or some combination? | Reservation, consumption, refunds | Accepted (Baseline) — reserve quota on job enqueue, finalize usage on completed work, release unused reservations on failure/cancellation |
| OD-18 | If a multi-assessment request partly exceeds quota, is the whole request rejected or are some jobs created? | API behavior | Accepted (Baseline) — reject multi-assessment requests atomically (`all-or-nothing`) if quota is exceeded |
| OD-19 | Does a paused job keep its unused reservation? For how long? | Quota accounting | Accepted (Baseline) — keep reservations while a job is actively `paused` until resumed or expired/released |
| OD-20 | What data retention applies to questions, AI drafts, draft history, jobs, logs, and audit events? | DB cleanup and privacy | Accepted (Baseline) — minimize retained data and define retention TTLs before general production rollout; secrets are always hidden/redacted |
| OD-21 | What does account deletion remove versus anonymize? | FK deletion and audit integrity | Accepted (Baseline) — perform coordinated account data deletion/anonymization while preserving safe audit integrity; no ad-hoc cascade |
| OD-22 | Is BYOK required for first public release or acceptable later? | Key management and UI scope | Deferred — defer user BYOK (`per-user API key`) until the core `v0.1` workflow is stable; use server-configured defaults/fallbacks first |
| OD-23 | Which languages and question types are officially supported in v0.1? | AI schemas and validation | Accepted (Baseline / Pending Live LMS Verification) — support Arabic and English and tested question types (single/multiple choice, true/false, supported text inputs); mark file-upload questions as `MANUAL_INPUT_REQUIRED` and pause (`/pause`) for manual student handling |

## 5. Decision record template

Use this when closing each item:

```md
### OD-XX — <short decision title>
- **Status:** Open | Accepted (Baseline) | Accepted (Baseline / Pending Live LMS Verification) | Rejected | Deferred
- **Decision owner:**
- **Date:**
- **Evidence:**
- **Decision:**
- **Affected docs:**
- **Follow-up tasks:**
```

## 6. Release-blocking rule

Do not enable real LMS operations until OD-01 through OD-07 are resolved for the exact operation being enabled. Authorization to read metadata does not automatically authorize reading assessment content, writing drafts, or submitting anything. Treat each capability as a separate permission boundary. The `Accepted (Baseline / Pending Live LMS Verification)` markers in Sections 1–3 record the `v0.1` safe defaults; they do not constitute live LMS/school/policy sign-off — each live external mutation stays disabled until its specific verification is confirmed.

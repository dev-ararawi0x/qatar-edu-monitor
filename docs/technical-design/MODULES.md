# Hallili — Module & Component Design

**Version:** v0.1  
**Status:** Proposed implementation baseline

## 1. Purpose

This document defines who owns each business rule, what each module exposes, what it depends on, and which runtime is allowed to call it. The goal is to avoid the common situation where routes, database code, Worker handlers, and UI components all contain pieces of the same business rule.

## 2. Module map

Hallili is a Modular Monolith with two process entry points:

- **Web:** TanStack Start — the only HTTP backend, plus UI and SSR.
- **Worker:** long-running Node.js process — consumes durable jobs and executes background use cases.

The modules below are logical business boundaries, not separately deployed services.

| Module | Owns | Exposes | Must not own |
|---|---|---|---|
| Identity & Access | Hallili identity context, auth-session lookup, access policy helpers | `GetCurrentActor`, `RequireAuthenticatedActor`, ownership context | LMS credential contents, job processing |
| LMS Connections | LMS connection lifecycle, encrypted credential storage, validation result, rotation persistence, account-level serialization | `SaveLmsCredential`, `ValidateLmsConnection`, `RevokeLmsConnection`, `LoadCredentialForExecution`, `PersistRotatedCredential` | AI prompting, assessment solving, UI |
| Academic Catalog | Normalized subject and assessment snapshots, external IDs, refresh timestamps | `ListSubjects`, `ListDueAssessments`, `RefreshSubjects`, `RefreshAssessments` | Job scheduling, AI generation |
| Solving | Job creation/deduplication, job/question states, execution orchestration, pause/resume/retry policy | `CreateSolveJobs`, `GetSolveJob`, `ListSolveJobs`, `ResumeSolveJob`, `ProcessSolveJob` | HTTP parsing, UI, concrete Drizzle/LMS/AI SDK usage |
| Draft Review | Locally persisted answer drafts, draft versioning, user edits, review state | `GetJobQuestions`, `GetDraft`, `UpdateDraft`, `MarkDraftReviewed` | Queue claiming, remote final submission |
| Usage & Quotas | Plan limits, quota reservations, consumption/release, usage ledger | `CheckAndReserveQuota`, `ConsumeReservedUsage`, `ReleaseReservation`, `GetQuotaSummary` | AI provider selection, HTTP response formatting |
| Submission (conditional) | Any separately authorized final action and its audit record | No enabled v0.1 use case; later `ConfirmSubmission` only after a policy gate | Background job execution; never Worker-accessible |
| Notifications (optional) | In-app notification records and delivery status | `NotifyJobFinished`, `ListNotifications`, `MarkNotificationRead` | Ownership of job state |

## 3. Detailed module responsibilities

### 3.1 Identity & Access

**Responsibilities**
- Integrate Better Auth with the TanStack Start auth route.
- Convert an authenticated Better Auth session into a minimal `ActorContext` used by Application use cases.
- Apply resource ownership checks on every user-owned read and mutation.
- Distinguish authentication (who is signed in?) from authorization (may this actor access this resource?).

**Input:** request headers/cookies at the Web boundary; actor ID for application use cases.  
**Output:** `ActorContext { userId }` or a typed unauthenticated/forbidden error.

**Rules**
- Domain modules must not inspect Better Auth session cookies.
- Worker jobs use the `userId` stored on the job, not a browser session.
- A resource ID is never treated as proof of ownership.

### 3.2 LMS Connections

**Responsibilities**
- Store one default LMS connection per Hallili user in v0.1 (revisit only if multiple LMS accounts become a requirement).
- Encrypt/decrypt the exact credential material using an encryption port.
- Validate a connection through a narrow LMS adapter operation.
- Persist cookie rotation received from an authorized LMS response.
- Serialize jobs that share one LMS account/session where concurrent use may invalidate rotating session state.
- Support explicit revoke/wipe.

**Input:** user ID and credential submitted over HTTPS; execution request scoped to a connection ID.  
**Output:** sanitized connection status; execution-only credential lease; no raw credential in API DTOs.

**Rules**
- Never log or return decrypted credentials.
- Never forward cookies to a host outside the approved host allowlist.
- Redirects must be revalidated hop by hop.
- A `403`, explicit block, or unexpected login flow is not a signal to bypass controls; stop and surface a safe error.

### 3.3 Academic Catalog

**Responsibilities**
- Normalize LMS subjects and assessments into stable internal records.
- Preserve external IDs exactly as strings; do not assume the external system always uses numeric IDs.
- Track `lastSyncedAt` and source status separately from Hallili's derived UI status.
- Refresh only through an explicitly configured LMS read operation.

**Input:** connection ID, optional subject ID, normalized LMS adapter output.  
**Output:** user-scoped subject and assessment DTOs.

**Rules**
- Catalog data belongs to the LMS connection owner.
- Do not expose raw HTML, CSRF tokens, or provider/session internals.
- Unknown page structure becomes `PARSER_MISMATCH`; no fabricated subject/assessment/question is inserted.

### 3.4 Solving

**Responsibilities**
- Create jobs for selected assessment attempts.
- Enforce active-job idempotency for `(user_id, lms_quiz_id, lms_results_id)`.
- Own job and question state transitions.
- Coordinate quota reservation, durable queue state, attempt locks, execution order, retry/backoff, pause and resume.
- Orchestrate one question at a time in the required order.
- Persist checkpoints after each durable unit of work.

**Input:** authenticated user ID, selected attempt IDs, idempotency key; Worker handler receives a claimed job ID.  
**Output:** job receipt, sanitized progress, typed pause/failure result.

**Rules**
- Domain rules decide whether a transition is legal; routes do not set statuses directly.
- Completed question work is skipped on resume.
- The Worker never receives a final-submission capability.
- No database transaction is held while waiting for an LMS or AI network call.

### 3.5 Draft Review

**Responsibilities**
- Persist the AI-generated response locally.
- Maintain draft revision/version metadata.
- Allow the owner to edit and review a response.
- Protect against lost updates through optimistic concurrency (`expectedVersion`).

**Input:** draft ID, owner ID, edited answer, expected version.  
**Output:** current draft and incremented version, or a version-conflict error.

**Rules**
- Editing a local draft does not automatically write to the LMS.
- Only a separately gated LMS draft adapter may perform an authorized remote draft save.
- A draft is not a submission and must never be represented as one.

### 3.6 Usage & Quotas

**Responsibilities**
- Read the user's plan/limit configuration.
- Reserve quota atomically before accepting work.
- Consume reserved units at the defined usage point.
- Release unused reservations when work is safely cancelled or abandoned according to policy.
- Prevent duplicate usage charges with idempotent ledger events.

**Input:** user ID, quota metric, requested units, reference ID (job/question).  
**Output:** reservation/consumption result or `QUOTA_EXCEEDED`.

**Rules**
- All quota mutations use a database transaction and row lock on the relevant bucket.
- Exact quota semantics (assessment vs question vs AI attempt) remain a product decision; see `OPEN_DECISIONS.md`.

### 3.7 Submission (conditional)

No final-submission route or Worker capability is part of the enabled v0.1 design. If a separate policy and authorization review later approves such a feature, it must be a Web-only capability with fresh authentication, explicit confirmation, idempotency, audit, and its own restricted adapter. It must not be imported by `apps/worker`.

### 3.8 Notifications (optional)

Notifications read the final job outcome and create a user-owned notification. They do not change job state. Implement after durable jobs and polling are stable.

## 4. Application ports

Ports are interfaces owned by the Application boundary. Implementations live in Infrastructure. Keep each port narrow and purpose-specific.

| Port | Initial adapter | Consumer | Notes |
|---|---|---|---|
| `LmsCredentialRepository` | Drizzle | LMS Connections | Stores encrypted fields only |
| `CredentialCipher` | Node crypto adapter | LMS Connections | AES-256-GCM; key version and AAD |
| `LmsReadPort` | Authorized HTTP/HTML adapter or official API adapter | Catalog, Solving | Only approved read operations |
| `LmsDraftPort` | Disabled/local fake by default | Solving | Enable remote draft writes only after permission and semantic tests |
| `LmsSessionLockPort` | PostgreSQL lease adapter | Solving/LMS Connections | Serializes shared rotating session use |
| `LmsRateLimitPort` | PostgreSQL coordination adapter | LMS adapter | Shared global host limiter; obey explicit blocks and Retry-After |
| `AiDraftGenerationPort` | Provider adapter / fake | Solving | Returns structured candidate only; no LMS tools/network capability |
| `SolveJobRepository` | Drizzle | Solving | State transitions and progress persistence |
| `JobQueuePort` | PostgreSQL `SKIP LOCKED` adapter | Worker/Solving | Durable queue; hides implementation from use cases |
| `QuotaPort` | Drizzle | Usage/Solving | Reservation, consumption, release |
| `ClockPort` | System/fake clock | Application | Deterministic lease/retry tests |
| `IdGenerator` | UUID implementation | Application | Deterministic tests where useful |
| `AuditWriter` | Drizzle | Sensitive use cases | Sanitized append-only records |
| `Logger` / `Metrics` | Structured logger adapter | All server runtimes | Secret redaction required |

Do not define an interface for every table automatically. Add a port when it marks an external boundary, a meaningful policy boundary, or a test seam.

## 5. Dependency direction

```text
apps/web (TanStack Start) ───────┐
                                 ├──> Application ───> Domain
apps/worker (Node process) ──────┘          │
                                            │ uses ports
                                            ▼
                              Infrastructure adapters
                              ├── Drizzle / PostgreSQL
                              ├── LMS adapter
                              ├── AI provider adapter
                              ├── encryption adapter
                              └── logger / metrics

apps/web ───> Contracts (Zod DTOs)
```

**Allowed dependencies**

- `domain` → no framework, database, or integration package.
- `application` → `domain` and its own port definitions.
- `db` → domain/application port types to implement persistence.
- `integrations` → application ports and external SDKs/HTTP libraries.
- `apps/web` and `apps/worker` → composition roots; may wire adapters into use cases.
- `contracts` → Zod and transport DTOs; must not expose Drizzle row types.

**Forbidden dependencies**

- Domain → Drizzle/TanStack/AI SDK/LMS HTML parser.
- UI → database package or integration SDK.
- Route handler → direct SQL, AI provider, or LMS HTTP call.
- Worker → Submission module/port.
- LMS adapter → arbitrary URLs supplied by request content or model output.

## 6. Suggested monorepo layout

Start with the following logical structure, but do not create empty package shells simply to match the diagram. Create a package when it has a clear responsibility and import boundary.

```text
apps/
  web/                  # TanStack Start UI + SSR + only HTTP backend
    src/routes/         # pages and REST Server Routes
    src/features/       # UI feature composition
    src/server/         # auth, middleware, composition root
  worker/               # long-running Node.js process
    src/main.ts
    src/runtime/        # polling, shutdown, health
    src/handlers/       # queue job handlers
packages/
  domain/               # entities, value objects, state machines
  application/          # use cases + ports
  db/                   # Drizzle schema, migrations, repository/queue adapters
  integrations/         # LMS, AI, encryption adapters
  contracts/            # Zod request/response contracts
  config/               # shared TypeScript/lint/format configuration

docs/
  product/PRD.md
  architecture/SYSTEM_DESIGN.md
  technical-design/...
  implementation/...
```

## 7. Runtime composition rules

### Web composition root

- Build Better Auth integration and session lookup.
- Build DB repositories and Application use cases.
- Mount REST Server Routes and shared request middleware.
- Expose only user-facing use cases.
- Do not run multi-question solving or wait for model inference in a request.

### Worker composition root

- Build queue adapter, repositories, LMS read/draft adapters, AI adapter, cipher, locks, rate limiter, logger, and metrics.
- Register only background use cases such as `ProcessSolveJob`.
- Do not construct or import a Submission adapter/use case.
- Use a dedicated DB role with only the required table privileges where practical.
- Handle `SIGTERM` by stopping claims, finishing or safely checkpointing the current unit, releasing/allowing lease expiry, and closing DB connections.

## 8. Module-level Definition of Done

A module is ready when:

- its responsibility and public use cases are documented;
- its domain invariants are unit-tested;
- its Application use cases depend on ports rather than concrete providers;
- its data ownership and transaction boundaries are explicit;
- routes/Worker handlers call use cases rather than reimplement rules;
- error codes are stable and safe for clients;
- sensitive data is redacted;
- no forbidden dependency edge exists;
- the module's relevant integration and failure tests pass.

# Hallili — Implementation Task Backlog

**Version:** v0.1  
**Status:** Initial backlog — tasks are ready to refine into issues

## How to use this backlog

- Execute tasks in dependency order; a lower task ID is not permission to ignore an unmet dependency.
- Each task should be a focused pull request or a clearly bounded part of one.
- Do not mark a task complete until its Definition of Done is satisfied.
- Update status (`TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`) in the project copy.
- `BLOCKED` tasks must state the missing decision/evidence and link the matching `OD-XX` item.
- Never enable real LMS operations before their policy gate is satisfied.

## Status notes

- `BLOCKED` Phase 0 tasks require external evidence or stakeholder sign-off; the implementation remains fail-closed as required by `OPEN_DECISIONS.md`.
- `DONE` means the local Definition of Done for the implemented baseline is satisfied in this repository copy.
- Gated external capabilities must not be marked `DONE` merely because fake adapters or local safeguards exist.

## Global Definition of Done

A task is done when its code and docs are reviewed; typecheck/lint/tests pass; applicable authorization and ownership checks exist; migrations are included where needed; errors are stable and sanitized; logs contain no secrets; failure paths are tested; no forbidden dependency is introduced; and the task's acceptance criteria below are met.

## Phase 0 — Scope and policy gates

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-001 | BLOCKED | P0 | Confirm LMS integration authorization and allowed methods | — | OD-01/02 recorded with evidence; real adapter remains disabled if unresolved |
| H-002 | BLOCKED | P0 | Confirm allowed LMS read and write capabilities | H-001 | OD-03/04/05 closed per operation; no inferred permission |
| H-003 | BLOCKED | P0 | Confirm academic-integrity and timed-assessment policy | — | OD-06 closed; default-deny feature policy documented |
| H-004 | BLOCKED | P0 | Confirm AI data-processing and retention policy | — | OD-07 closed for selected provider/data types |
| H-005 | BLOCKED | P1 | Confirm external IDs and session rotation semantics | H-001 | OD-08/09/12/13/25 have redacted evidence and approved mapping |
| H-006 | BLOCKED | P1 | Decide quota semantics and retention/deletion policy | — | OD-17/18/19/20/21 recorded and reviewed |

## Phase 1 — Repository foundation

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-010 | DONE | P0 | Initialize pnpm workspace | — | Workspace installs reproducibly from lockfile |
| H-011 | DONE | P1 | Add Turborepo task graph | H-010 | Build/lint/typecheck/test tasks run at correct package boundaries |
| H-012 | DONE | P0 | Create TanStack Start Web application | H-010 | Web starts locally and contains no direct DB/business logic in UI routes |
| H-013 | DONE | P0 | Create separate Node.js Worker application | H-010 | Worker starts/stops as its own process; no HTTP API added |
| H-014 | DONE | P0 | Establish minimal domain/application package boundaries | H-010 | Import rules match `MODULES.md`; no empty abstraction packages added |
| H-015 | DONE | P1 | Add shared contracts package | H-014 | Zod schemas/DTOs are transport-only and do not leak DB models |
| H-016 | DONE | P1 | Add lint/typecheck/format/test CI | H-010 | CI fails on type/lint/test errors and runs on clean checkout |
| H-017 | DONE | P1 | Add architecture dependency checks | H-014 | Tests/lint prevent Domain→Infrastructure and Worker→Submission dependencies |
| H-018 | DONE | P0 | Add local PostgreSQL Docker Compose | H-010 | Fresh developer setup can start DB with documented env vars |
| H-019 | DONE | P1 | Add environment variable validation and secret-safe logger | H-012,H-013 | Missing critical config fails closed; secret redaction tests pass |

## Phase 2 — Database and identity

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-020 | DONE | P0 | Pin compatible TanStack Start and Better Auth versions | H-012 | Versions recorded; integration smoke test passes |
| H-021 | DONE | P0 | Generate Better Auth schema and migrations | H-018,H-020 | Auth tables match pinned adapter; clean DB migration passes |
| H-022 | BLOCKED | P0 | Implement Better Auth Microsoft configuration | H-020,H-021,H-006 | Only approved account types/tenant policy accepted |
| H-023 | DONE | P0 | Implement server-side ActorContext/session helper | H-020,H-022 | Protected route tests cover signed-out and signed-in cases |
| H-024 | DONE | P1 | Implement common API error envelope/request ID | H-012,H-015 | Stable safe error codes; no raw exception returned |
| H-025 | DONE | P1 | Add ownership-scope test helpers | H-023 | Tests prove every user-owned use case scopes by actor ID |

## Phase 3 — LMS connection security and fake adapter

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-030 | DONE | P0 | Implement AES-256-GCM credential cipher | H-014,H-019 | Roundtrip, tamper, nonce, AAD, key-version tests pass |
| H-031 | DONE | P0 | Implement LMS connection repository/schema | H-021,H-030 | Unique owner and all-null/all-present credential checks exist |
| H-032 | DONE | P0 | Implement save/revoke connection use cases | H-030,H-031,H-023 | Owner-scoped; secret never returned; revoke wipes ciphertext |
| H-033 | DONE | P0 | Implement connection API contracts/routes | H-024,H-032 | PUT/GET/DELETE/validate routes tested, request body not logged |
| H-034 | DONE | P1 | Define LMS port and fake adapter | H-014,H-015 | Fake supports success, expired, blocked, timeout, parser mismatch |
| H-035 | DONE | P0 | Implement outbound host/redirect/size/timeout guard | H-034,H-005 | Unit tests reject unapproved host/redirect; no arbitrary URL input |
| H-036 | DONE | P1 | Implement sanitized LMS fixtures and normalizers | H-034,H-005 | Fixtures have known normalized expected values; secrets redacted |

## Phase 4 — Catalog

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-040 | DONE | P1 | Implement Subject and Assessment domain types | H-014,H-005 | External IDs remain strings; source status separated from display status |
| H-041 | DONE | P1 | Add subjects/assessments schema and repositories | H-018,H-040 | FKs, unique external IDs, due-date index and migrations pass |
| H-042 | DONE | P1 | Implement subject list/refresh use cases | H-034,H-041 | Ownership, upsert, parser failure tests pass |
| H-043 | DONE | P1 | Implement assessment list/refresh use cases | H-034,H-041,H-040 | Per-subject data normalized; unknown timed status is safe |
| H-044 | DONE | P1 | Implement catalog API routes and Zod DTOs | H-015,H-042,H-043,H-024 | GET/refresh contracts pass; no side effect occurs in GET |
| H-045 | DONE | P1 | Implement dashboard subject/assessment UI | H-044 | Empty/loading/error/success states; responsive layout; status distinctions correct |

## Phase 5 — Quota and durable jobs

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-050 | DONE | P0 | Implement quota bucket/ledger schema | H-018,H-006 | Unique/idempotency and non-negative constraints migrate successfully |
| H-051 | DONE | P0 | Implement transactional quota reservation/consume/release | H-050,H-014 | Concurrent reservation tests cannot oversubscribe |
| H-052 | DONE | P0 | Implement SolveJob domain state machine | H-014 | Full transition table and typed pause reasons tested |
| H-053 | DONE | P0 | Add attempts/jobs/question schema and indexes | H-018,H-005,H-052 | Active tuple partial unique index and queue indexes are tested |
| H-054 | DONE | P0 | Implement CreateSolveJobs use case | H-051,H-052,H-053,H-025 | Ownership, timed gate, idempotency, atomic reservation tested |
| H-055 | DONE | P0 | Implement job create/list/read API contracts/routes | H-015,H-024,H-054 | POST returns 202 fast; no AI work in route; owner isolation passes |
| H-056 | DONE | P0 | Implement PostgreSQL JobQueuePort claim adapter | H-053 | Concurrent workers do not claim same job; short transaction only |

## Phase 6 — Worker reliability

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-060 | DONE | P0 | Implement Worker runtime and graceful shutdown | H-013,H-056 | Worker starts, stops claiming on SIGTERM, closes resources |
| H-061 | DONE | P0 | Implement job lease and heartbeat | H-056,H-060 | Lease expiry/reclaim and stale worker ownership tests pass |
| H-062 | DONE | P0 | Implement LMS account lease | H-031,H-060,H-005 | Same connection cannot be processed concurrently while lease is valid |
| H-063 | DONE | P1 | Implement shared global rate limiter | H-035,H-060,H-014 | Coordination works across multiple Worker instances; respects blocks |
| H-064 | DONE | P0 | Implement question-manifest initialization and checkpoint processing with fake ports | H-052,H-056,H-060 | Manifest identity is validated and persisted once; processing is sequential; durable question is not repeated on resume; OD-24 is reconciled in System Design |
| H-065 | DONE | P1 | Implement typed pause/resume use cases and endpoint | H-052,H-054,H-064 | Resume returns queued; blocker resolution and ownership validated |
| H-066 | DONE | P1 | Implement stale-job recovery and reconciliation marker | H-061,H-064 | Crash recovery skips durable work and flags ambiguous remote writes |

## Phase 7 — AI and local draft review

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-070 | DONE | P1 | Define supported question/answer schemas | H-036,H-005,H-004 | Schemas versioned and tied to known fixtures |
| H-071 | DONE | P1 | Implement AI generation port and fake provider | H-014,H-070 | Application tests do not call real provider |
| H-072 | DONE | P1 | Implement one configured provider adapter | H-004,H-071 | Timeout/429/503/auth/schema cases tested; secrets redacted |
| H-073 | DONE | P1 | Implement bounded retry/fallback policy | H-071,H-072 | Retry-After, max attempts, fallback eligibility covered |
| H-074 | DONE | P1 | Implement AI output and option-value validator | H-070,H-071 | Invalid/out-of-range values rejected; no guessed answer persisted |
| H-075 | DONE | P1 | Implement answer_drafts and draft_revisions persistence | H-018,H-070 | One current draft per question; revisions unique by version |
| H-076 | DONE | P1 | Implement UpdateDraft optimistic concurrency use case/API | H-075,H-024 | Stale expectedVersion returns 409; every edit creates revision |
| H-077 | DONE | P1 | Implement review UI and progress polling | H-055,H-065,H-076 | User sees sanitized progress, explanation, confidence, and edit state |

## Phase 8 — Authorized external integration

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-080 | BLOCKED | P0/GATE | Enable authorized LMS read adapter | H-001,H-002,H-035,H-036 | Approval evidence recorded; only approved read operations enabled |
| H-081 | BLOCKED | P0/GATE | Validate cookie rotation and session behavior | H-005,H-080,H-062 | Approved test environment demonstrates safe persistence/serialization |
| H-082 | BLOCKED | P0/GATE | Enable remote LMS draft-save adapter, only if approved | H-004,H-080,H-081,H-066 | Written permission, semantic contract, idempotency/reconciliation tests; default remains off otherwise |
| H-083 | BLOCKED | P0/GATE | Validate extraction reliability on approved fixture corpus | H-080,H-036 | Measured result with denominator/version; target ≥98% or release is blocked/limited |

## Phase 9 — Release hardening

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-090 | DONE | P0 | Complete API/DB/Worker/E2E security suite | H-064,H-076,H-077 | Required suites pass; cross-user and Worker capability tests included |
| H-091 | BLOCKED | P1 | Run performance and reliability benchmarks | H-090,H-083 | p50/p95/p99 and workload profile documented for NFR targets |
| H-092 | DONE | P1 | Add Web and Worker health/metrics dashboards | H-060,H-063,H-091 | Separate health checks and queue/provider/parser metrics visible |
| H-093 | DONE | P0 | Verify backups and restore procedure | H-018,H-053,H-075 | Restore to clean instance tested and documented |
| H-094 | BLOCKED | P0 | Complete retention/account deletion implementation | H-006,H-075,H-093 | Approved data map, delete/anonymize tests, no indefinite content retention by default |
| H-095 | DONE | P0 | Prepare deployment and rollback runbook | H-090,H-092,H-093 | Web and Worker deploy separately; secrets and DB roles least-privileged |

## Phase 10 — Deferred capabilities

| ID | Status | Priority | Task | Depends on | Definition of Done |
|---|---|---|---|---|---|
| H-100 | TODO | P2 | Implement BYOK credential lifecycle | H-004,H-072 | Encrypted scoped keys, rotation/revoke, no browser/log leakage |
| H-101 | TODO | P2 | Implement in-app notifications | H-060,H-075 | Notification delivery does not mutate job state |
| H-102 | TODO | P2/GATE | Re-evaluate final-action requirement | H-002,H-003,H-090 | Separate written authorization, security review, Web-only capability, and tests before any implementation |
| H-103 | TODO | P2 | Design v0.3 textbook context pipeline | H-090 | Uses pre-indexed uploaded materials as PRD specifies; no LMS lesson scraping |

## Suggested first coding milestone

Start with **H-010 through H-019**, then **H-020 through H-025**, then build a fixture-backed vertical slice through **H-055, H-060, H-064, H-071, H-075, and H-077**. Keep H-080/H-082 blocked until their gates are satisfied.

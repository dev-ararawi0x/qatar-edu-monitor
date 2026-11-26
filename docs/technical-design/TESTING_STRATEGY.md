# Hallili — Testing Strategy

**Version:** v0.1  
**Status:** Proposed test plan and quality gates

## 1. Testing goals

Testing must prove more than the happy path. Hallili's highest-risk behaviors are ownership isolation, durable job execution, idempotency, safe pause/resume, cookie protection, concurrency around rotating sessions, external parser correctness, quota accounting, and strict separation between local drafts and any final action.

The test strategy follows the architecture:

- Domain logic is tested without databases or network services.
- Application use cases are tested with fake ports.
- Infrastructure adapters are tested against PostgreSQL, sanitized HTML fixtures, and mocked HTTP/provider responses.
- Server Routes are tested as HTTP contracts.
- Playwright validates complete user journeys through the Web UI.
- Real LMS integration tests are not part of ordinary CI; use fixtures and mocks unless an explicitly authorized, isolated test environment is provided.

## 2. Test levels

| Level | Scope | Test dependencies | Suggested tool |
|---|---|---|---|
| Unit | Domain state machines, quota policy, transitions, retry policy, answer validation | None | Vitest |
| Application | Use cases and port orchestration | Fakes/in-memory test doubles | Vitest |
| DB integration | Constraints, transactions, partial unique indexes, queue claims, leases, quota locking | Real PostgreSQL test DB/container | Vitest + PostgreSQL |
| Adapter/contract | LMS normalization, redirects, cookie rotation mapping, AI output validation, error mapping | Redacted fixtures, mock HTTP server, provider mocks | Vitest |
| API integration | Auth, ownership, request validation, status codes, response DTOs | Test app + PostgreSQL | Vitest / HTTP test harness |
| E2E | Login, connect, catalog, create job, polling, pause/resume, review/edit | Web + Worker + PostgreSQL + fake LMS/AI | Playwright |
| Security | Cross-user access, secret redaction, host allowlist, CSRF/origin, Worker capabilities | Automated tests + static checks | Vitest + lint/architecture checks |
| Performance/reliability | Enqueue/status latency, queue throughput, recovery, extraction reliability | Controlled benchmark environment | k6 or equivalent + test harness |

## 3. Unit test suites

### 3.1 Domain state machines

Test the complete allowed transition table.

| Current | Requested | Expected |
|---|---|---|
| `queued` | worker claims | `running` |
| `running` | all required work durable | `completed` |
| `running` | known safe blocker | `paused` |
| `running` | unrecoverable terminal error | `failed` |
| `paused` | explicit resume after blocker check | `queued` |
| `completed` | resume | rejected |
| `failed` | automatic transition to running | rejected |
| `failed` | explicit policy-approved retry | `queued` only if retry policy allows |

Also test:
- completed questions cannot be reset by ordinary resume;
- `completed_questions` never exceeds `total_questions`;
- pause requires a typed reason;
- an unrecognized pause reason is rejected;
- a final-action capability is not part of the solving state machine.

### 3.2 Quota policy

- reserve within limit succeeds;
- reserve beyond available quota fails;
- two concurrent reservations cannot exceed the limit (complemented by DB integration test);
- duplicate idempotency event does not double count;
- consume requires a prior reservation;
- release cannot make reserved/consumed totals negative;
- period boundary selects the correct bucket;
- paused jobs retain/release reservations according to the approved product policy.

### 3.3 Answer validation

- valid output for each supported question type;
- malformed JSON;
- missing required answer field;
- invalid answer type;
- option ID not present in source-derived choices;
- empty value where a response is required;
- confidence outside `[0,1]`;
- unexpected extra fields rejected or stripped according to the strict schema policy.

AI output is untrusted data. It must never select an arbitrary URL, invoke a tool, or modify source-of-truth metadata.

### 3.4 Retry and backoff policy

- `429` honors `Retry-After` when valid;
- `503` uses bounded backoff;
- eligible provider failures may select a configured fallback;
- permanent auth/configuration failures do not loop through fallback providers indefinitely;
- maximum attempt count is enforced;
- retries are scheduled using `available_at`, not busy loops;
- jitter remains bounded and deterministic under an injected fake clock/random source for tests.

## 4. Application use-case tests

Use fake repositories and ports to test orchestration independently from infrastructure.

Minimum suites:

- `SaveLmsCredential` encrypts before persistence and never returns plaintext.
- `ValidateLmsConnection` maps expected statuses to sanitized connection states.
- `RevokeLmsConnection` clears encrypted fields and applies active-job policy.
- `RefreshSubjects` maps normalized subjects and rejects malformed adapter output.
- `CreateSolveJobs` checks ownership, timed-policy gate, active-job idempotency, and quota reservation.
- `ProcessSolveJob` skips durable questions, validates AI output, persists checkpoints, and pauses safely.
- `ResumeSolveJob` checks owner, pause state, resolved blocker, and quota.
- `UpdateDraft` validates answer, checks optimistic version, and writes a revision.
- notification use case (if enabled) cannot mutate job state.

For each use case include at least one happy path and each important failure branch in its responsibility.

## 5. PostgreSQL integration tests

Run against a real PostgreSQL version matching production, not SQLite substitutes. Test the constraints and concurrency guarantees that cannot be faithfully proven by mocks.

### 5.1 Migrations and schema

- clean database migration succeeds;
- upgrade from previous migration succeeds;
- FK delete behavior is intentional;
- `CHECK` constraints reject invalid values;
- all required indexes exist in generated migration SQL;
- Better Auth schema migration remains compatible with the pinned Better Auth version.

### 5.2 Queue and lease concurrency

1. Start two Worker claim transactions against one queued job; only one receives it.
2. Start multiple workers against multiple queued jobs; claims do not overlap.
3. A live lease cannot be stolen.
4. An expired lease can be reclaimed according to recovery policy.
5. A stale worker cannot release a newer worker's lease token.
6. A Worker restart recovers a stale running job without reprocessing durable completed questions.
7. Account-level lock prevents parallel use of the same rotating LMS session.
8. Global rate-limit state is shared across Worker processes.

### 5.3 Idempotency and quota transactions

- simultaneous create-job calls for the same external tuple create one active job;
- a duplicate request returns the existing job and does not reserve quota again;
- concurrent quota reservations never exceed the configured limit;
- a transaction failure rolls back both job insert and reservation;
- repeated usage events with the same idempotency key do not double count;
- consuming/releasing quota remains correct after worker restart.

### 5.4 Draft persistence

- one current draft per job question;
- every update creates a unique revision version;
- stale `expectedVersion` fails without changing the current draft;
- question/job ownership cannot be crossed through FK or use-case logic.

## 6. LMS adapter tests

All regular tests use sanitized saved fixtures and a mock HTTP server. No real account cookie or student assessment content belongs in the test repository.

Test categories:

- supported subject HTML fixtures;
- supported due-assessment fixtures;
- supported question-type fixtures;
- required field missing;
- unexpected DOM structure and `PARSER_MISMATCH`;
- login redirect/session expired detection;
- 403 and explicit block stop behavior;
- 429 and `Retry-After` handling;
- 5-second page fetch budget and request timeout handling;
- redirect to unapproved hostname is rejected before forwarding credential material;
- oversized response is rejected;
- cookie rotation is captured and persisted in encrypted form;
- CSRF/authenticity token is not logged or returned;
- ambiguous remote draft-save timeout triggers reconciliation path, never blind repeat.

Fixtures must be versioned with a `parser_version` and include expected normalized output. When the source changes, add a new fixture and update parser behavior deliberately.

## 7. AI adapter tests

- valid structured candidate;
- invalid JSON;
- schema mismatch;
- allowed-choice mismatch;
- empty or missing answer;
- timeout;
- 429/503 plus Retry-After;
- fallback provider eligible and ineligible cases;
- provider auth/configuration error;
- bounded correction retry;
- sensitive prompt/provider key does not appear in logs;
- adversarial instructions in question text remain untrusted content and cannot request arbitrary tools/network access.

Prefer a provider fake for deterministic tests. Run a small, explicitly controlled smoke test only when provider terms, privacy, and cost controls are approved.

## 8. API integration tests

For every endpoint in `API_CONTRACTS.md`, test:

- expected success status and response schema;
- missing/invalid authentication;
- foreign resource ID / ownership isolation;
- invalid JSON and invalid query/path fields;
- malformed/oversized request body;
- stable error code and safe message;
- no secret-bearing response fields;
- CSRF/origin checks for cookie-authenticated writes;
- request ID appears in logs/response correlation but not sensitive payloads;
- endpoint does not bypass the Application use case.

Specific API invariants:

- create job returns within target and does not call AI inline;
- duplicate create returns one active job;
- resume returns `queued`, never client-selected `running`;
- draft PATCH rejects stale version;
- user A cannot read, edit, resume, or delete user B's records;
- final-submission endpoint is absent/disabled in the v0.1 route tree.

## 9. End-to-end tests with fake external systems

Minimum Playwright journeys:

1. Sign in using a test auth configuration.
2. Add a fake LMS credential and display connection status without exposing the secret.
3. Refresh subjects and due assessments using fixtures.
4. Select one assessment attempt and create a job.
5. Observe progress through TanStack Query polling.
6. Close/reopen the browser context; Worker continues and UI reads latest status.
7. Simulate expired session; job pauses and UI explains the blocker.
8. Update fake credential, explicitly resume, and confirm completed questions are skipped.
9. Simulate a file/manual-input blocker and show the pause state.
10. Review a draft, edit it, and confirm the version increments.
11. Simulate two browser tabs editing the same draft; stale update gets a conflict.
12. Verify there is no final-submit action in the enabled v0.1 UI/API.

E2E tests should not use a real school account or submit real assessments.

## 10. Security and architecture tests

- Secret redaction tests for cookies, CSRF tokens, OAuth access/refresh tokens, and AI keys.
- Redirect/host allowlist tests.
- No arbitrary URL accepted by an LMS-fetch route.
- Request origin/CSRF tests for credential and mutation routes.
- Cross-user resource access tests for every user-owned module.
- Static dependency rule: Domain does not import infrastructure/framework packages.
- Static dependency rule: Web UI does not import DB or integration packages.
- Static dependency rule: Worker does not import Submission module/adapter.
- Worker DB role lacks privileges to write any future submission table if one exists.
- Config validation fails closed when encryption key or required integration policy configuration is missing.
- Logs/metrics contain no credential values or raw sensitive payloads.

## 11. Performance and reliability verification

The PRD targets are acceptance targets, not assumed guarantees. Define a reproducible benchmark profile before reporting them as met.

| Metric | PRD target | Measurement rule |
|---|---:|---|
| Job enqueue latency | `< 300 ms` | Measure from HTTP request receipt to 202 response, excluding AI work; report p50/p95/p99 and concurrency profile |
| Job status response | `< 300 ms` | Measure authenticated read under representative DB and job load; report percentiles |
| Ten-question job | `< 45 seconds` | Define provider/model, prompt size, question type mix, external latency, retry assumptions, and percentile; report measured result, not promise |
| LMS extraction reliability | `≥ 98%` | Use a representative, approved fixture corpus; report denominator, supported page variants, and parser version |
| Single page fetch/parse | `≤ 5 seconds` | Enforce timeout and safe behavior; test under controlled latency |

Also measure:
- queue depth and oldest queued job age;
- stale lease recovery count;
- average and p95 question processing time;
- LMS requests per unit time versus approved limit;
- AI provider failure/fallback rate;
- parser mismatch rate;
- active jobs per LMS connection;
- DB connection pool usage.

Do not load-test the live LMS or attempt to probe its limits. Use a mock server to test Hallili's own concurrency and rate-limiter behavior.

## 12. Definition of Test Readiness

A feature is not ready to merge when only its happy path passes. Before completion:

- [ ] Unit tests cover domain invariants.
- [ ] Application tests cover error and authorization branches.
- [ ] DB tests cover relevant indexes, constraints, and transaction concurrency.
- [ ] API response/request schemas are verified.
- [ ] E2E tests cover the user-visible journey where applicable.
- [ ] Secrets are redacted and ownership is checked.
- [ ] New failure paths are added to the test matrix.
- [ ] Metrics/health checks exist for background behavior.
- [ ] No real external mutation is performed in CI.

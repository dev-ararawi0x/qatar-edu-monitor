# How `qatar-edu-monitor` Works — File Guide & Data Flow

This document is a guided tour of the codebase: what each file does, how a request travels through the layers, and where the safety guardrails live. Read it alongside `docs/architecture.md` (deep reference) and `AGENTS.md` (agent rules).

---

## 1. The Big Picture

The repo is a **pnpm workspace monorepo** with one shared engine (`packages/core`) and three surfaces:

```text
                ┌────────────────────────────────────────────┐
                │  SURFACES (apps/)                         │
                │                                            │
                │  apps/web ── Arabic RTL browser UI        │
                │       │  TanStack Router/Query + RPC        │
                │       ▼                                    │
                │  apps/api ── Hono REST/RPC API             │
                │       │  better-auth (email/password, optional Microsoft OAuth)      │
                │       │  PostgreSQL + Drizzle               │
                │       │  SolveJobWorker (background queue)  │
                │       │                                    │
                │       ▼                                    │
                │  apps/cli ── terminal user (same engine)   │
                └──────────────────┬─────────────────────────┘
                                   │ import @qatar-edu/core
                                   ▼
                ┌────────────────────────────────────────────┐
                │  ENGINE (packages/core)                     │
                │                                            │
                │  types ── domain models                     │
                │  core/ ── HTTP, cookies, sanitize, URLs,    │
                │          finish-capability                  │
                │  parsers/ ── HTML → typed objects          │
                │  llm/ ── AI answer providers                │
                │  services/ ── discovery, inspect, solve,    │
                │             finish                          │
                └──────────────────┬─────────────────────────┘
                                   │ HTTPS
                                   ▼
                        Qatar Education LMS
```

**Key rule**: everything reusable and side-effect-free lives in `packages/core`. `apps/api` owns persistence, auth, encryption, and the job queue. `apps/web` owns all user-facing UI. `apps/cli` remains a fully working standalone terminal surface.

---

## 2. File-by-File Walkthrough

### `packages/core/` — the engine (`@qatar-edu/core`)

#### `src/types/` — the vocabulary
Every other file speaks these types. Start here when you want to know what a "quiz screen" or "parsed class" looks like.

| File | Contains |
| --- | --- |
| `http.types.ts` | `HttpResponse`, `HttpRequestOptions`, `SanitizedHttpTrace`, file-attachment types |
| `lms.types.ts` | `ParsedClass`, `ParsedAssignment`, `ParsedLesson`, `GenericPageInspection`, `LmsSessionCheckResult`, command-facing LMS models |
| `quiz.types.ts` | `ParsedQuizScreen`, `QuizInputType`, `QuizSolveAttemptResult`, summary/question screen models, `QuizPartProgress`, `QuizSolveAbortError` |
| `llm.types.ts` | `LlmProvider` interface, `LlmProviderConfig`, question/answer DTOs |

#### `src/core/` — infrastructure primitives
| File | Role |
| --- | --- |
| `http-client.ts` | `LmsHttpClient` — the **only** place HTTP requests are made. Owns the cookie jar, builds headers, handles redirects manually, stores sanitized traces, fetches binary images, and **hard-blocks `/student_take_quiz_assignment/finish/`** before any packet is sent unless constructed with the finish capability symbol. Console tracing is optional (injectable logger). |
| `cookie-jar.ts` | `SessionCookieJar` — in-memory cookie store. Ingests `Set-Cookie`, emits `Cookie` header, only ever exposes cookie **names**. |
| `sanitizer.ts` | The `"VALUES"` redaction engine — masks any key matching cookie/token/csrf/auth/session/password/secret in text, fields, JSON, HTML previews, and quiz screens. |
| `lms-urls.ts` | URL builders (`buildQuizDisplayUrl`, `buildQuizPauseUrl`, `buildAssignmentsDueUrl`, class URLs, …) and detectors (`isQuizFinishUrl`, `isQuizShowUrl`, `isClassAssignmentsUrl`, …). |
| `finish-capability.ts` | Internal `Symbol` (`QUIZ_FINISH_CAPABILITY`) — the only key that unlocks finish transport in `LmsHttpClient`. Never exported for general use; consumed only by `quiz-finish.service.ts`. |

#### `src/parsers/` — pure HTML → types
Cheerio functions. **No network, no side effects** — input HTML string, output typed object.

| File | Parses |
| --- | --- |
| `classes.parser.ts` | User dashboard / class pages → `ParsedClass[]` (classId, title, teacher, URL) |
| `assignments.parser.ts` | Class assignment pages → `ParsedAssignment[]` (quizzes, offline tasks, linked lessons) |
| `lessons.parser.ts` | Lesson pages → `ParsedLesson[]` with nested sections |
| `quiz.parser.ts` | Quiz show pages, `init_quiz{...}` config, **question screens** (choices, indexed `answer[n]` fields, rich-text/file capabilities, images), and **summary screens** |
| `generic.parser.ts` | Arbitrary pages for `monitor` — title, heading, detected entity kind |
| `shared.ts` / `index.ts` | Shared helpers and barrel exports |

#### `src/llm/` — the AI layer (ports & adapters)
| File | Role |
| --- | --- |
| `registry.ts` | `createLlmProvider(config)` → picks Gemini / OpenAI-compatible / Anthropic / Mock adapter; enforces API-key presence; shared provider helpers (key/model resolution) so CLI and API stay DRY |
| `adapters/*.ts` | One adapter per provider; each calls `fetchWithTransientRetry`, sends multimodal prompts (text + question images), parses JSON answers |
| `prompt-builder.ts` | Builds the structured prompt from a `ParsedQuizScreen` (question text, choices, field schema, target language) |
| `answer-validator.ts` | Validates/normalizes the LLM's JSON answer against the actual DOM schema, with one self-correction retry |
| `language-detector.ts` | Picks `ar`/`en` answer language from subject + question text |
| `http-retry.ts` | Exponential backoff for 429/503/5xx |

#### `src/services/` — domain workflows
| File | Role |
| --- | --- |
| `class-discovery.service.ts` | `verifyLmsSession()` (cookie validity probe → `LmsSessionCheckResult`) and `discoverEnrolledClasses()` — POSTs `/class_lists_widget/default_tab` (AJAX, CSRF, extracted `cell_id` + fallbacks) to get class tiles, merges dashboard-HTML links, SSRF-guarded |
| `quiz-inspector.service.ts` | Resolves a quiz target (show URL / display URL / ID) into an active attempt (`quizId`, `resultsId`, `initConfig`); read-only part fetching via GET |
| `quiz-form.mapper.ts` | Turns an LLM answer into real LMS `formFields`/`files` payloads (incl. multipart file upload) and sanitized previews |
| `quiz-solver.service.ts` | `runQuizSolverWorkflow` — dry-run (GET-only solve + preview) vs apply (POST each part → summary verify → `/pause/`); accepts `onPartProgress` callback and `AbortSignal` for background jobs; emergency pause on error; summary rewind for unanswered parts |
| `quiz-finish.service.ts` | The **only** code path that may call `/finish/`: `overrideQuizPartAnswer()` (re-GET part, merge new answer, POST save) and `submitQuizFinishExplicitly()` (verify summary completeness → single guarded finish POST). Gated by the `QUIZ_FINISH_CAPABILITY` symbol. |

### `apps/api/` — the backend surface (`@qatar-edu/api`)

#### Foundation
| File | Role |
| --- | --- |
| `src/env.ts` | Zod-validated environment schema (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `MICROSOFT_*`, `ENCRYPTION_KEY`, `WEB_ORIGIN`, `PORT`, `ENABLE_EMBEDDED_WORKER`, LLM defaults). All secrets required ≥ minimum entropy; no defaults for secrets. |
| `src/db/client.ts` | Lazy-initialized Drizzle client (Postgres via `DATABASE_URL`, or PGlite for tests). Laziness matters: importing this module must not require env vars to be set. |
| `src/db/schema/*.ts` | Drizzle tables: `auth` (better-auth user/session/account/verification), `credentials` (per-user encrypted LMS cookie), `lms` (synced classes + due quizzes), `jobs` (`solve_batches` + `solve_jobs` with partial unique indexes) |
| `src/db/migrations/` | Generated by `drizzle-kit`; `0000` = auth+credentials+lms schema, `0001` = jobs tables + indexes. Apply with `pnpm --filter @qatar-edu/api db:migrate` |
| `src/lib/crypto-vault.ts` | `encryptSecret`/`decryptSecret` — AES-256-GCM envelope (`iv.tag.ciphertext` base64). Used for LMS cookies and per-user LLM API keys. Never returns plaintext to API responses. |
| `src/lib/auth.ts` | `better-auth` instance — email+password provider (Microsoft Entra ID optional, enabled only when MICROSOFT_CLIENT_ID/SECRET are set), Drizzle adapter, `trustedOrigins` from `WEB_ORIGIN`. |
| `src/lib/errors.ts` | Typed API errors + `appErrorHandler` — returns sanitized `{ error }` bodies, never leaks internals. |
| `src/lib/validate.ts` + `lib/dto.ts` | `zod` request validation wrappers (typed `json` bodies for RPC) and DTO mappers (entity → API response, secrets → `"VALUES"`/omitted). |
| `src/middleware/auth.middleware.ts` | `requireAuth` — reads better-auth session from request context, 401s otherwise; also injects `userId`. |

#### Request-scoped services
| File | Role |
| --- | --- |
| `src/lib/lms-session.factory.ts` | Decrypts the user's stored LMS cookie → `SessionCookieJar` + `LmsHttpClient`; auto-persists rotated `Set-Cookie` values back to DB on every request. Also supports a one-off per-request cookie override (dashboard "paste cookie" flow) without clobbering the stored default. |
| `src/lib/llm-resolver.ts` | Resolves the effective `LlmProviderConfig` for a user: server env defaults, overridden by per-user encrypted settings when present. |

#### Modules (`src/modules/<name>/`) — schema → service → routes
Each module follows the same pattern: `<name>.schema.ts` (zod input validators), `<name>.service.ts` (business logic, DB access, `@qatar-edu/core` calls), `<name>.routes.ts` (Hono route factory returning a chained router for RPC typing). All queries filter by `userId` — no cross-user reads.

| Module | Endpoints (under `/api`) |
| --- | --- |
| `credentials` | `GET/PUT /lms-cookie` — store/replace the default LMS cookie (encrypted); `GET /lms-cookie/status` — validity probe via `verifyLmsSession`, returns cookie **names** only |
| `settings` | `GET/PUT /settings/llm` — per-user LLM provider/key/model; API key write-only (encrypted), `hasApiKey` boolean returned |
| `classes` | `GET /classes` (synced classes + due quizzes), `POST /classes/sync` (trigger `discoverEnrolledClasses`), `POST /classes/manual` (add class by ID when dashboard parsing misses it) |
| `quizzes` | `GET /quizzes/:quizId` (parts + answers + AI reasoning), `PATCH /quizzes/:quizId/parts/:partId/answer` (human override → `overrideQuizPartAnswer`), `GET /quizzes/:quizId/image?url=` (SSRF-guarded image proxy), `POST /quizzes/:quizId/finish` (verify summary → `submitQuizFinishExplicitly`; atomic status claim prevents double-finish) |
| `jobs` | `POST /jobs/batches` (`{ quizIds }` or `{ allDue: true }`), `GET /jobs/batches`, `GET /jobs/batches/:id`, `POST /jobs/batches/:id/cancel`, `POST /jobs/:id/retry` |

#### App & worker entrypoints
| File | Role |
| --- | --- |
| `src/app.ts` | `createApp()` — CORS (`WEB_ORIGIN`, credentials), `/api/auth/*` → better-auth handler, `requireAuth` on everything else, mounts all module routers, exports `AppType` for RPC |
| `src/rpc.ts` | Re-exports `AppType` — the single source of truth for `hc<AppType>` client typing in `apps/web` |
| `src/index.ts` | Production entry: `serve()` on `PORT`. |
| `src/server.ts` | Dev entry: `@hono/node-server` + `ENABLE_EMBEDDED_WORKER` toggle that starts `SolveJobWorker` in-process. |
| `src/worker.ts` | Standalone worker entry (`pnpm api:worker`) — runs `SolveJobWorker` without the HTTP server. |
| `src/lib/jobs/solve-job.worker.ts` | The background engine — see §3. |

### `apps/web/` — the Arabic RTL surface (`@qatar-edu/web`)

| File | Role |
| --- | --- |
| `src/lib/api.ts` | `hc<AppType>` typed RPC client + `better-auth/react` client; single `API_BASE_URL` config, credentialed fetch wrapper |
| `src/lib/jobs.ts` | Smart-polling helpers: decides poll interval (2.5s only while jobs are active), merges batch/job states — unit-tested |
| `src/lib/review.ts` | Review-page helpers: matches stored answers to LMS summary screen rows, part status derivation — unit-tested |
| `src/lib/status.ts`, `src/lib/utils.ts` | Arabic status labels/colors, `cn()` |
| `src/components/app-shell.tsx` | Sidebar layout (nav: لوحة التحكم / المهام / الإعدادات), active-jobs badge, cookie-status banner |
| `src/components/ui/*` | shadcn-style primitives (button, card, badge, input, label, table, progress, skeleton) styled with Tailwind v4 tokens, RTL-aware |
| `src/routes/login.tsx` | email/password auth page (`authClient.signIn.email` / `signUp.email`) |
| `src/routes/_authed.tsx` | Auth guard layout — redirects to `/login` when no session; renders `AppShell` |
| `src/routes/_authed/index.tsx` | Dashboard — synced classes grouped with due quizzes; per-quiz and bulk (selected / all-due) "حل في الخلفية" actions → `POST /jobs/batches` |
| `src/routes/_authed/jobs.tsx` | Jobs center — batch cards with per-quiz progress, cancel/retry, smart polling that stops when idle |
| `src/routes/_authed/quizzes.$quizId.tsx` | Review page — every part's questions, choices, AI reasoning, images (via proxy); inline answer editing → `PATCH`; "مراجعة الملخص" check; confirm dialog → `POST /finish` |
| `src/routes/_authed/settings.tsx` | LMS cookie manager (paste/upload, status probe showing cookie names only) + LLM provider/key/model settings |
| `src/styles.css` | Tailwind v4 theme tokens, Arabic font, RTL direction |
| `src/test/setup.ts` | Vitest setup (jsdom, testing-library matchers) |

### `apps/cli/` — the terminal surface (`@qatar-edu/cli`)

Unchanged architecture from v0.2; now consumes shared LLM helpers from `@qatar-edu/core/src/llm/registry.ts` instead of duplicating them (DRY). See git history / `docs/architecture.md` for the full CLI file map — `cli.ts` → `cli/handlers.ts` → `commands/*.command.ts` → `exporters/*.ts` (Arabic Markdown reports under `reports/`).

---

## 3. The Three Key Flows

### 3.1 Background quiz solving (the headline feature)

```text
WEB                          API                              WORKER            LMS
 │  POST /api/jobs/batches    │                                │                 │
 │  { quizIds: [..] }         │                                │                 │
 │ ─────────────────────────► │ validate quizIds belong to user │                 │
 │                            │ insert solve_batches +          │                 │
 │                            │   solve_jobs(status=pending)    │                 │
 │                            │ mark quizzes status=queued      │                 │
 │  ◄── batch + jobs          │                                │                 │
 │                            │                                │ poll loop       │
 │                            │                                │ FOR UPDATE       │
 │                            │                                │  SKIP LOCKED ──► │ claim one
 │                            │                                │ pending job     │ job
 │                            │                                │ (1 running/user) │
 │                            │                                │ decrypt cookie   │
 │                            │                                │ resolve LLM cfg  │
 │                            │                                │                 │
 │                            │                                │ per part:        │
 │                            │                                │  fetch part (GET)│
 │                            │                                │  solve via LLM   │
 │                            │                                │  POST answer ──► │ save
 │                            │                                │  UPDATE job      │
 │  GET /jobs/batches/:id     │                                │   progress ─────►│ (current_part,
 │  (smart poll while active) │                                │   per-question   │  answers so far)
 │                            │                                │   answers in DB  │
 │                            │                                │ ...              │
 │                            │                                │ reach summary    │
 │                            │                                │ verify complete  │
 │                            │                                │ POST /pause/ ──► │ attempt paused,
 │                            │                                │ quiz →           │ resumable
 │                            │                                │  ready_for_review│
 │                            │                                │ batch → done     │
 │                            │                                │ (never /finish/) │
 │  user returns later ──────►│ sees ready_for_review quiz     │                 │
```

Resilience properties:
- **Progress is durable**: every solved question is written to `solve_jobs.answers` + quiz part rows *before* the next LMS request, so closing the browser loses nothing.
- **Crash recovery**: a `running` job whose `lease_expires_at` passes is requeued by the stale-lease reaper (attempts preserved; max attempts → `failed`).
- **No double-submit**: partial unique index = one active job per quiz; one-running-per-user index prevents LMS session collisions while allowing parallel users.
- **Cancellation**: `AbortSignal` propagates into `runQuizSolverWorkflow`, which emergency-`/pause/`s the attempt before the job is released.

### 3.2 Human review → edit → finish

```text
GET /api/quizzes/:id        → parts + stored answers + AI reasoning + image URLs
PATCH .../parts/:partId     → overrideQuizPartAnswer(): GET part → merge human
                             answer into formFields → POST save (still not finish)
POST /api/quizzes/:id/finish→ claim quiz (status check, atomic) →
                             submitQuizFinishExplicitly():
                               1. fetch summary screen
                               2. verifySummaryScreenCompleteness()
                                  (every part answered — "(غير محدد)" rejected)
                               3. POST /finish/ via capability-gated client
                               4. quiz → finished; on LMS failure, claim reverts
```

The web review page mirrors this: it fetches the quiz, lets the user edit any answer inline (each edit hits `PATCH`), shows the AI justification per question, and only enables the finish button after the user opens the confirm dialog — the API independently re-verifies summary completeness server-side.

### 3.3 Session & secrets lifecycle

```text
Login:  /login → better-auth → email+password → session cookie (httpOnly)
Cookie: settings page paste → PUT /lms-cookie → encryptSecret() → DB
       every LMS call: lms-session.factory decrypts → SessionCookieJar
       → LmsHttpClient auto-persists rotated Set-Cookie back to DB
LLM:    env defaults OR per-user encrypted key (settings page)
        → llm-resolver → createLlmProvider → adapter
Never:  plaintext secrets in API responses, logs, or client bundles.
```

---

## 4. Where the Guardrails Physically Live

| Guardrail | Location |
| --- | --- |
| `/finish/` transport block | `packages/core/src/core/http-client.ts` (requires `QUIZ_FINISH_CAPABILITY` symbol from `finish-capability.ts`) |
| Finish orchestration | `packages/core/src/services/quiz-finish.service.ts` — summary verify + single POST; invoked only by `POST /api/quizzes/:quizId/finish` |
| SSRF protection | `validateAllowedLmsBaseUrl` / `isSameLmsOriginUrl` in `core/lms-urls.ts`; image proxy re-validates every URL; class discovery restricted to `*.edu.gov.qa` |
| Secret masking | `packages/core/src/core/sanitizer.ts` → `"VALUES"`; `lib/crypto-vault.ts` + `lib/dto.ts` ensure encrypted-at-rest, never-in-response |
| Per-user isolation | every module service takes `userId` from `requireAuth` context; all queries `WHERE user_id = ?`; jobs/batches/quizzes 404 (not 403) on foreign IDs |
| Job uniqueness | partial unique index on `solve_jobs(quiz_id) WHERE status IN (pending,running)`; unique partial index one-running-per-user |
| Double-finish prevention | quizzes status state machine (`due_unsolved → queued → solving → ready_for_review → finishing → finished`); finish route claims atomically and reverts on LMS failure |
| Timed-quiz abort | `services/quiz-solver.service.ts` + CLI `--allow-timed` flag |
| Read-only defaults | CLI flags in `apps/cli/src/cli/flags.ts`; solver POSTs only in apply mode; web/API always apply+pause, never finish |

---

## 5. How to Navigate When Changing Something

| I want to… | Go to |
| --- | --- |
| Add/change an API endpoint | `apps/api/src/modules/<name>/<name>.routes.ts` + `.schema.ts` + `.service.ts`; keep the fluent-chain style for RPC types |
| Add an API module | new `modules/<name>/` dir; mount in `src/app.ts`; add schema file under `src/db/schema/` if new tables needed; `drizzle-kit generate` |
| Change auth / OAuth | `apps/api/src/lib/auth.ts`, `middleware/auth.middleware.ts` |
| Change encryption | `apps/api/src/lib/crypto-vault.ts` (rotation = new `ENCRYPTION_KEY` + re-encrypt migration) |
| Change job queue behavior | `apps/api/src/lib/jobs/solve-job.worker.ts`, `modules/jobs/`, `db/schema/jobs.ts` |
| Change LMS solving logic | `packages/core/src/services/quiz-solver.service.ts`, `quiz-finish.service.ts`, `quiz-inspector.service.ts` |
| Add an LMS page type/parser | `packages/core/src/types/` → `packages/core/src/parsers/` |
| Change HTTP behavior / safety blocks | `packages/core/src/core/http-client.ts`, `lms-urls.ts`, `finish-capability.ts` |
| Add an LLM provider | `packages/core/src/llm/adapters/` + `registry.ts` |
| Change web page | `apps/web/src/routes/_authed/*.tsx`; shared logic → `apps/web/src/lib/` (keep it testable) |
| Change web↔API contract | route in `apps/api/src/modules/` → `AppType` flows automatically via `rpc.ts` → `apps/web/src/lib/api.ts` |
| Add CLI flag/command | `apps/cli/src/cli/{flags,handlers,help}.ts`, `commands/`, `exporters/` |
| Add tests | parser/sanitizer/LLM/finish → `packages/core/tests/`; API modules/worker → `apps/api/tests/` (PGlite); web helpers → `apps/web/src/**/*.test.ts` (Vitest) |

---

## 6. v0.3 Status

| Phase | Status |
| --- | --- |
| v0.1 stable CLI | ✅ tagged `v0.1.0` |
| v0.2 monorepo scaffold | ✅ |
| Part 1 — core engine extensions (classes, discovery, solver hooks, finish service) | ✅ |
| Part 2 — API foundation (env, vault, Drizzle schema, better-auth Microsoft OAuth) | ✅ |
| Part 3 — API modules (credentials, settings, classes, quizzes) + RPC | ✅ |
| Part 4 — background job queue + `SolveJobWorker` | ✅ |
| Part 5 — web foundation (RTL shell, auth, settings) | ✅ |
| Part 6 — web workflows (dashboard, jobs monitor, review/edit/finish) | ✅ |
| Part 7 — docs + final gate | ✅ |

Next likely work: production deployment guide (Postgres provisioning, Microsoft app registration, `ENCRYPTION_KEY` rotation runbook), E2E tests against a staging LMS, and quiz-result scraping after finish.

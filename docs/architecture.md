# Qatar Education Monitor — System Architecture (v0.3)

Full-stack platform: CLI + Hono API (better-auth, PostgreSQL/Drizzle, background solve jobs) + Arabic RTL web app (shadcn/ui, TanStack Query/Router, Hono RPC).

---

## 1. Package Map

```text
packages/core/   @qatar-edu/core — LMS domain engine (no I/O framework deps)
apps/cli/        @qatar-edu/cli — terminal commands + Arabic Markdown reports
apps/api/        @qatar-edu/api — Hono API, better-auth, Drizzle PG, job worker
apps/web/        @qatar-edu/web — React 19 + Vite + TanStack Router/Query, RTL Arabic
```

### `packages/core` layout

| Path | Responsibility |
|---|---|
| `types/` | Domain types: LMS, quiz, LLM, HTTP |
| `core/` | `LmsHttpClient` (finish-guarded), `SessionCookieJar`, sanitizer, URL builders, `finish-capability.ts` (Symbol gate) |
| `parsers/` | Pure Cheerio parsers: classes, assignments, lessons, quiz screens, generic pages |
| `llm/` | Provider adapters (gemini/openai/anthropic/mock), registry + shared provider helpers, prompt builder, validator |
| `services/` | `class-discovery`, `quiz-inspector` (read-only parts), `quiz-form.mapper`, `quiz-solver` (apply+pause, `onPartProgress`, `AbortSignal`), `quiz-finish` (human-only finish + answer override) |

### `apps/api` layout

```text
src/
├── app.ts               # Fluent Hono chain — AppType for hc<AppType> RPC
├── rpc.ts               # Re-exports AppType for the web client
├── server.ts            # HTTP server + optional embedded SolveJobWorker
├── worker.ts            # Standalone worker entrypoint (pnpm worker)
├── env.ts               # Zod-validated environment
├── db/
│   ├── client.ts        # Lazy drizzle client (env read on first query)
│   ├── schema/          # auth (better-auth), credentials, lms, jobs tables
│   └── migrations/      # drizzle-kit generated SQL
├── lib/
│   ├── auth.ts          # better-auth (email/password; Microsoft OAuth optional)
│   ├── crypto-vault.ts  # AES-256-GCM encrypt/decrypt for secrets at rest
│   ├── errors.ts        # Typed AppError hierarchy + sanitizing onError
│   ├── validate.ts      # zod parse helper
│   ├── dto.ts           # Row -> API DTO mappers
│   ├── lms-session.factory.ts  # Decrypt cookie -> LmsHttpClient -> persist rotation
│   ├── llm-resolver.ts  # Server defaults + per-user encrypted override
│   └── jobs/solve-job.worker.ts
└── modules/             # credentials, settings, classes, quizzes, jobs
    └── <mod>/{schema,service,routes}.ts   # zod schema / DB+domain logic / Hono routes
```

Route factories (`createXRoutes(db)`) take an explicit `Db` so tests inject PGlite. All routers are fluent chains — required for `AppType` to include sub-routes. Body-accepting routes use `@hono/zod-validator` so request types flow into the RPC client.

### `apps/web` layout

```text
src/
├── lib/api.ts        # hc<AppType> client (credentials:include), authClient, queryClient
├── lib/jobs.ts       # Batch/job DTOs + smart-polling helpers
├── lib/review.ts     # Question DTO helpers: initialAnswerFields, image proxy URL
├── lib/status.ts     # Arabic status labels/colors (single source)
├── components/ui/    # shadcn-style primitives (button, card, badge, table, ...)
├── components/app-shell.tsx  # RTL sidebar + header + sign-out
└── routes/
    ├── login.tsx           # email+password sign-in / sign-up
    ├── _authed.tsx         # Auth guard (beforeLoad -> /login) + AppShell
    ├── _authed/index.tsx   # Classes & due quizzes dashboard (select + solve)
    ├── _authed/jobs.tsx    # Batch/job monitor (smart polling, cancel/retry)
    ├── _authed/settings.tsx# LMS cookie vault + per-user LLM settings
    └── _authed/quizzes.$quizId.tsx  # Review / edit answers / explicit finish
```

---

## 2. Database (PostgreSQL + Drizzle)

| Table | Purpose | Key constraints |
|---|---|---|
| `user`, `session`, `account`, `verification` | better-auth core | standard |
| `user_lms_credentials` | Per-user LMS cookie, AES-256-GCM encrypted | PK `user_id` |
| `user_llm_settings` | Optional per-user LLM override; `encrypted_api_key` | PK `user_id` |
| `lms_classes` | Discovered/manual classes per user | UNIQUE `(user_id, lms_class_id)` |
| `lms_quizzes` | Quiz workflow state machine | UNIQUE `(user_id, lms_quiz_id)` |
| `quiz_attempt_questions` | Per-part question + AI answer + LMS recorded answer | UNIQUE `(quiz_id, part)` |
| `solve_batches` | Job batch (all_due / selected / single) | — |
| `solve_jobs` | One job per quiz attempt | partial UNIQUE active-per-quiz; partial UNIQUE one-`running`-per-user |

Quiz status machine: `due_unsolved → queued → solving → ready_for_review → submitting_finish → finished` (+ `failed`). Sync never resets workflow statuses.

Migrations: `pnpm --filter @qatar-edu/api db:generate` / `db:migrate`.

---

## 3. Background Solve Pipeline

```text
Web POST /api/jobs/batches {quizIds|allDue}
  -> solve_batches + solve_jobs rows (quiz -> 'queued')
SolveJobWorker.tick() (every ~2.5s, embedded or standalone)
  -> reapStaleJobs(): running jobs with expired lease -> pending/failed
  -> claimNextJob(): UPDATE ... FOR UPDATE SKIP LOCKED,
     NOT EXISTS running job for same user (serialized per student)
  -> processJob():
       resolveLlmConfig(user) -> createLlmProvider
       withLmsSession(user, cookieOverride?) -> runQuizSolverWorkflow(apply)
         onPartProgress -> solve_jobs.current_part++ + question upsert (live)
         AbortSignal -> /pause/ on cancel (attempt stays resumable)
       persistSolveResult(): questions + aiAnswer + summary recorded answers
       quiz -> 'ready_for_review'; job -> 'completed'
  -> recomputeBatchStatus()
```

Guarantees:
- **Never finishes**: solver only `apply` + `/pause/`; `/finish/` is Symbol-gated and reachable solely via `POST /api/quizzes/:id/finish` after atomic `ready_for_review → submitting_finish` claim.
- **Crash-safe**: stale-lease reaper requeues dead workers' jobs.
- **Per-user serialization**: one running job per user protects the LMS session; different users run in parallel.
- **Cookie rotation**: `withLmsSession` persists rotated `Set-Cookie` back (encrypted); batch-level `cookieOverride` is ephemeral and wiped semantics kept (`ephemeral: true`).

---

## 4. Security Model

- **Auth**: better-auth email/password (Microsoft OAuth optional); `requireAuth` middleware on all `/api/{credentials,settings,classes,quizzes,jobs}/*`.
- **Isolation**: every query filters `user_id = session.user.id`; cross-user access returns 404 (tested).
- **Secrets**: cookies & LLM keys encrypted AES-256-GCM (`crypto-vault.ts`); API never returns key material (`hasCustomApiKey` boolean only); sanitizer masks `"VALUES"` in errors/logs.
- **SSRF**: `validateAllowedLmsBaseUrl` + `isSameLmsOriginUrl` restrict LMS traffic; question images proxied server-side.
- **Finish guardrail**: `LmsHttpClient` blocks `/student_take_quiz_assignment/finish/` unconditionally; only `submitQuizFinishExplicitly` (Symbol capability) bypasses, invoked solely by the human-confirmed finish route.
- **Validation**: zod schemas on every mutating route; atomic status transitions prevent double-finish/double-queue.

---

## 5. Web Data Flow

- `hc<AppType>` gives end-to-end typed RPC; `credentials: "include"` sends the session cookie.
- TanStack Query keys: `classes`, `jobs`, `quiz/:id`, `credentials`, `settings/llm`.
- Smart polling on `/jobs`: `refetchInterval` returns `2500` only while batches/jobs are active, `false` otherwise.
- Question images are fetched through the authenticated proxy and rendered via blob URLs (session cookie can't ride `<img>` cross-origin).

---

## 6. Commands

```bash
pnpm install
pnpm -r typecheck && pnpm -r test && pnpm -r build
pnpm dev        # everything: .env bootstrap + Postgres container + API (:3001) + web (:5173)
pnpm build && pnpm start   # production-ish: built web (vite preview :5173) + API
pnpm --filter @qatar-edu/api dev        # API (:3001) + embedded worker
pnpm --filter @qatar-edu/api worker     # standalone worker
pnpm --filter @qatar-edu/web dev        # web (:5173)
pnpm db:up        # Postgres container (docker/podman) + generate + migrate
pnpm --filter @qatar-edu/api db:generate && pnpm --filter @qatar-edu/api db:migrate  # after schema changes
```

Env: see `.env.example` (CLI + API vars; secrets are `"VALUES"` placeholders only).

# How `qatar-edu-monitor` Works — File Guide & Data Flow

This document is a guided tour of the codebase: what each file does, how a CLI command travels through the layers, and where the safety guardrails live. Read it alongside `docs/architecture.md` (deep reference) and `AGENTS.md` (agent rules).

---

## 1. The Big Picture

The repo is a **pnpm workspace monorepo**. Think of it as one engine (`packages/core`) with three thin surfaces on top:

```text
                ┌──────────────────────────────────────────┐
                │  SURFACES (apps/)                        │
                │                                          │
                │  apps/cli ── terminal user                │
                │  apps/api ── future HTTP consumers        │
                │  apps/web ── future browser UI            │
                └──────────────────┬───────────────────────┘
                                   │ import @qatar-edu/core
                                   ▼
                ┌──────────────────────────────────────────┐
                │  ENGINE (packages/core)                   │
                │                                          │
                │  types ── domain models                   │
                │  core/ ── HTTP, cookies, sanitize, URLs   │
                │  parsers/ ── HTML → typed objects         │
                │  llm/ ── AI answer providers              │
                │  services/ ── multi-step quiz workflows   │
                └──────────────────┬───────────────────────┘
                                   │ HTTPS
                                   ▼
                        Qatar Education LMS
```

**Key rule**: everything reusable and side-effect-free lives in `packages/core`. Everything user-facing (flags, console output, `.env`, report files) lives in `apps/*`.

---

## 2. File-by-File Walkthrough

### `packages/core/` — the engine (`@qatar-edu/core`)

#### `src/types/` — the vocabulary
Every other file speaks these types. Start here when you want to know what a "quiz screen" or "parsed assignment" looks like.

| File | Contains |
| --- | --- |
| `http.types.ts` | `HttpResponse`, `HttpRequestOptions`, `SanitizedHttpTrace`, file-attachment types |
| `lms.types.ts` | `ParsedAssignment`, `ParsedLesson`, `GenericPageInspection`, command-facing LMS models |
| `quiz.types.ts` | `ParsedQuizScreen`, `QuizInputType`, `QuizSolveAttemptResult`, summary/question screen models |
| `llm.types.ts` | `LlmProvider` interface, `LlmProviderConfig`, question/answer DTOs |

#### `src/core/` — infrastructure primitives
| File | Role |
| --- | --- |
| `http-client.ts` | `LmsHttpClient` — the **only** place HTTP requests are made. Owns the cookie jar, builds headers, handles redirects manually, stores sanitized traces, fetches binary images, and **hard-blocks `/student_take_quiz_assignment/finish/`** before any packet is sent. Console tracing is optional (injectable logger). |
| `cookie-jar.ts` | `SessionCookieJar` — in-memory cookie store. Ingests `Set-Cookie`, emits `Cookie` header, only ever exposes cookie **names**. |
| `sanitizer.ts` | The `"VALUES"` redaction engine — masks any key matching cookie/token/csrf/auth/session/password/secret in text, fields, JSON, HTML previews, and quiz screens. |
| `lms-urls.ts` | URL builders (`buildQuizDisplayUrl`, `buildQuizPauseUrl`, …) and detectors (`isQuizFinishUrl`, `isQuizShowUrl`, …). |

#### `src/parsers/` — pure HTML → types
Cheerio functions. **No network, no side effects** — input HTML string, output typed object.

| File | Parses |
| --- | --- |
| `assignments.parser.ts` | Class assignment pages → `ParsedAssignment[]` (quizzes, offline tasks, linked lessons) |
| `lessons.parser.ts` | Lesson pages → `ParsedLesson[]` with nested sections |
| `quiz.parser.ts` | Quiz show pages, `init_quiz{...}` config, **question screens** (choices, indexed `answer[n]` fields, rich-text/file capabilities, images), and **summary screens** |
| `generic.parser.ts` | Arbitrary pages for `monitor` — title, heading, detected entity kind |
| `shared.ts` / `index.ts` | Shared helpers and barrel exports |

#### `src/llm/` — the AI layer (ports & adapters)
| File | Role |
| --- | --- |
| `registry.ts` | `createLlmProvider(config)` → picks Gemini / OpenAI-compatible / Anthropic / Mock adapter; enforces API-key presence |
| `adapters/*.ts` | One adapter per provider; each calls `fetchWithTransientRetry`, sends multimodal prompts (text + question images), parses JSON answers |
| `prompt-builder.ts` | Builds the structured prompt from a `ParsedQuizScreen` (question text, choices, field schema, target language) |
| `answer-validator.ts` | Validates/normalizes the LLM's JSON answer against the actual DOM schema, with one self-correction retry |
| `language-detector.ts` | Picks `ar`/`en` answer language from subject + question text |
| `http-retry.ts` | Exponential backoff for 429/503/5xx |

#### `src/services/` — domain workflows
| File | Role |
| --- | --- |
| `quiz-inspector.service.ts` | Resolves a quiz target (show URL / display URL / ID) into an active attempt (`quizId`, `resultsId`, `initConfig`); read-only part fetching via GET |
| `quiz-form.mapper.ts` | Turns an LLM answer into real LMS `formFields`/`files` payloads (incl. multipart file upload) and sanitized previews |
| `quiz-solver.service.ts` | `runQuizSolverWorkflow` — the big orchestrator: dry-run (GET-only solve + preview) vs apply/submit (POST each part → summary verify → `/pause/`), emergency pause on error, summary rewind for unanswered parts |

### `apps/cli/` — the terminal surface (`@qatar-edu/cli`)

| File | Role |
| --- | --- |
| `src/cli.ts` | Entrypoint. Reads `process.argv`, routes to handlers, sets `process.exitCode` on errors. The **only** file that touches argv. |
| `src/cli/flags.ts` | `parseArgs` option schemas per command + `createContext()` (loads env config → `CommandContext`) + `printDone()` |
| `src/cli/handlers.ts` | Per-command glue: parse flags → call command → print summary |
| `src/cli/help.ts` | All usage/help text |
| `src/config.ts` | `dotenv/config` import, `loadAppConfig()` (env → `AppConfig`), `buildCommandContext()` (config + flag overrides → `CommandContext`) |
| `src/types/cli.types.ts` | CLI-only types: `CommandContext`, `CommandResult`, `GlobalCliOptions` |
| `src/commands/*.command.ts` | Orchestrators wiring context → `LmsHttpClient` → parsers/services → exporters → `saveMarkdownReport` |
| `src/exporters/*.ts` | Arabic Markdown renderers + timestamped/`latest.md` writer |
| `tests/` | Offline tests for exporters and the solver workflow (CLI-owned concerns) |

### `apps/api/` — future HTTP surface (`@qatar-edu/api`)

- `src/index.ts` — Hono app, currently only `GET /health` → `{ status: "ok" }`.
- `src/server.ts` — `@hono/node-server` bootstrap on `PORT` (default 3001).
- No business routes, no DB, no auth yet — intentionally empty.

### `apps/web/` — future UI (`@qatar-edu/web`)

- `index.html`, `src/main.tsx`, `src/router.ts`, `src/routes/__root.tsx`, `src/routes/index.tsx` — a minimal Vite + React + TanStack Router file-route skeleton rendering a placeholder page.
- `vite.config.ts` uses `@tanstack/router-plugin` to code-generate `src/routeTree.gen.ts` (committed; regenerate via `vite build`/`dev`).

---

## 3. Command Flow — Follow One Request

Example: `pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz scan --class-id 123`

```text
1. cli.ts                 argv → "quiz" → handleQuiz(rest)
2. cli/handlers.ts        subcommand "scan" → parseFlags(QUIZ_SCAN_FLAGS)
3. cli/flags.ts           createContext(values)
                          └─ config.ts: dotenv → loadAppConfig() → AppConfig
                             buildCommandContext() → CommandContext
4. commands/quiz.command  runQuizScanCommand(ctx, opts)
   ├─ core/lms-urls       buildAssignmentsDueUrl(baseUrl, classId)
   ├─ core/http-client    new LmsHttpClient(baseUrl, cookie, quiet)
   │     .request(GET url) ──► isQuizFinishUrl? NO ──► fetch() ──► trace + Set-Cookie ingest
   ├─ parsers/            parseAssignmentsHtml(html) → ParsedAssignment[]
   ├─ services/           quiz-inspector.service resolves each quiz → active attempt
   │     └─ more GETs via LmsHttpClient → parseQuizScreen → ParsedQuizScreen
   └─ exporters/          renderQuizInspectMarkdown(...) → saveMarkdownReport()
                          writes reports/quiz-scan/<ts>.md + latest.md
6. cli/flags.ts           printDone(ctx, summary, reportPath)
```

### Quiz solve flow (`quiz solve`, the deepest path)

```text
handlers → quiz.command → services/quiz-solver.service
   ├─ quiz-inspector.service   resolve target → { displayUrl, showUrl, initConfig }
   ├─ if timed_quiz && !allowTimed → THROW (guardrail)
   ├─ DRY-RUN (default):
   │     fetchAllQuizPartsReadOnly (GET each part)
   │     per question: fetch images → llm/language-detector → llmProvider.solveQuestion
   │       → llm/prompt-builder + answer-validator → services/quiz-form.mapper
   │       → preview payload. ZERO POSTs.
   └─ APPLY/SUBMIT:
         per part: solve → POST questionScreen.action (CSRF token rotated each page)
         → reach summary screen → verifySummaryScreenCompleteness
         → POST /pause/  (attempt stays resumable; /finish/ impossible)
         → on mid-run error: emergency /pause/ then rethrow
```

### Where the guardrails physically live

| Guardrail | Location |
| --- | --- |
| `/finish/` hard block | `packages/core/src/core/http-client.ts` + `lms-urls.ts:isQuizFinishUrl` |
| Read-only defaults | command option flags in `apps/cli/src/cli/flags.ts`; services only POST when `apply`/`submit` |
| `--start-new` opt-in | `services/quiz-inspector.service.ts` |
| Timed-quiz abort | `services/quiz-solver.service.ts` |
| Secret masking | `packages/core/src/core/sanitizer.ts` (used by http-client, exporters, services) |

---

## 4. How to Navigate When Changing Something

| I want to… | Go to |
| --- | --- |
| Add/change a CLI flag or subcommand | `apps/cli/src/cli/flags.ts`, `handlers.ts`, `help.ts`, `cli.ts` |
| Change what a command does end-to-end | `apps/cli/src/commands/<name>.command.ts` |
| Change report formatting | `apps/cli/src/exporters/<name>.exporter.ts` (+ `markdown-helpers.ts`) |
| Change env vars / config loading | `apps/cli/src/config.ts` |
| Add an LMS page type or parser | `packages/core/src/types/` → `packages/core/src/parsers/` |
| Change HTTP behavior / safety blocks | `packages/core/src/core/http-client.ts`, `lms-urls.ts` |
| Add an LLM provider | `packages/core/src/llm/adapters/` + `registry.ts` |
| Change quiz solve/draft logic | `packages/core/src/services/quiz-solver.service.ts` |
| Add API routes | `apps/api/src/index.ts` (import from `@qatar-edu/core`) |
| Add web pages | `apps/web/src/routes/` (TanStack file routes) |
| Add tests | parser/sanitizer/LLM → `packages/core/tests/`; exporter/solver → `apps/cli/tests/` |

---

## 5. Roadmap / v0.2 Status

| Phase | Status |
| --- | --- |
| v0.1 stable CLI (single package) | ✅ tagged `v0.1.0` |
| v0.2 monorepo scaffold (core/cli/api/web) | ✅ `feat/v0.2-monorepo` |
| `apps/api` business routes on top of `@qatar-edu/core` | ⬜ next |
| `apps/web` UI consuming the API | ⬜ after API contracts |
| Shared persistence / job queue for long quiz scans | ⬜ TBD |

When adding API routes, reuse `packages/core` services — never duplicate the `/finish/` block or sanitizer logic.

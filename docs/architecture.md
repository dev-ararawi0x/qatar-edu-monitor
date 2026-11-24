# Qatar Education Monitor — System Architecture & Engineering Guide

This document describes the `v0.2` pnpm-workspace architecture, data flow, session/cookie lifecycle, Cheerio parsing strategy, safety guardrails, and extension guide for `qatar-edu-monitor`.

---

## 1. Architectural Overview

`qatar-edu-monitor` is now a pnpm workspace monorepo with four packages:

```text
qatar-edu-monitor/
├── packages/core/       # @qatar-edu/core — reusable LMS domain + infrastructure
├── apps/cli/            # @qatar-edu/cli — existing CLI, commands, exporters
├── apps/api/            # @qatar-edu/api — minimal Hono /health skeleton
└── apps/web/            # @qatar-edu/web — minimal Vite + React + TanStack Router skeleton
```

The shared core is deliberately CLI-free: it owns domain types, HTTP transport, cookie handling, secret sanitization, URL builders, Cheerio parsers, LLM adapters/services, and quiz workflows. The CLI owns dotenv loading, argument parsing, console orchestration, command context, and Arabic Markdown report generation.

```text
┌─────────────────────────────────────────────────────────────┐
│ apps/cli                                                    │
│ - cli.ts + cli/flags.ts + cli/handlers.ts + cli/help.ts     │
│ - commands/ (assignments, lessons, quiz, monitor)           │
│ - exporters/ (Arabic Markdown reports)                      │
│ - config.ts (dotenv/env -> AppConfig -> CommandContext)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ imports @qatar-edu/core
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ packages/core (@qatar-edu/core)                             │
│ - types/      shared domain & HTTP interfaces               │
│ - core/       LmsHttpClient, SessionCookieJar, sanitizer,   │
│               LMS URL builders                              │
│ - parsers/    pure Cheerio HTML parsers                     │
│ - llm/        provider adapters, prompt builder, validator  │
│ - services/   quiz inspector, form mapper, solver workflow  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
              Qatar Education LMS + LLM Provider APIs
```

`apps/api` currently exposes only `GET /health` and does not yet contain business routes or persistence. `apps/web` is a route skeleton only and does not call the API yet.

---

## 2. Session, Cookie & HTTP Data Flow

1. **CLI Configuration**:
   - `apps/cli/src/config.ts` imports `dotenv/config`, reads `LMS_BASE_URL`, `LMS_CLASS_ID`, `LMS_COOKIE`, `REPORTS_DIR`, and `LLM_*` variables, then builds `AppConfig` and `CommandContext`.
   - If `LMS_COOKIE` is unset or `"VALUES"`, the session starts empty.
2. **HTTP Client (`packages/core/src/core/http-client.ts`)**:
   - `LmsHttpClient` owns a `SessionCookieJar`, resolves URLs against `baseUrl`, and supports manual redirects.
   - Every outgoing URL is checked by `isQuizFinishUrl`; `/student_take_quiz_assignment/finish/` throws before any network request.
   - `POST` bodies support urlencoded and multipart forms, including file attachments.
   - Sanitized traces are stored on `client.traces` for command/exporter use.
   - Console tracing is optional via the `quiet` flag and injectable logger; library consumers are not required to write to stdout.
3. **Cookie Ingestion**:
   - `Set-Cookie` headers update the in-memory jar.
   - Only cookie names and loaded/empty state are reported; values are never logged or exported.
4. **Sanitization Guarantee**:
   - Sensitive keys (`cookie`, `token`, `csrf`, `auth`, `session`, `password`, `secret`) are masked as `"VALUES"` in logs, traces, and Markdown reports.

---

## 3. Cheerio Parsing Strategy

Parsers in `packages/core/src/parsers/` are pure functions:

- **`assignments.parser.ts`**: extracts assignments/quizzes and related lesson links from class assignment HTML.
- **`lessons.parser.ts`**: extracts lessons and nested sections, preserving class/lesson/section identifiers.
- **`quiz.parser.ts`**: parses quiz show pages, `init_quiz` config, question screens, structured/indexed answer fields, choices, rich-text/file capabilities, images, and summary screens.
- **`generic.parser.ts`**: detects page kind and extracts generic inspection data for `monitor`.

---

## 4. Quiz Safety Guardrails

1. **Read-only inspection**: `assignments`, `lessons`, `quiz inspect`, `quiz scan`, `quiz solve` dry-run, and `monitor` issue GET requests only.
2. **Explicit new attempts**: new quiz attempts require `--start-new`.
3. **Draft/solve dry-run**: `quiz draft` and `quiz solve` do not POST unless `--apply` or `--submit` is passed; timed quizzes abort unless `--allow-timed` is passed.
4. **Pause-not-submit**: applied quiz workflows pause via `/student_take_quiz_assignment/pause/` so attempts remain resumable.
5. **Transport block**: `/student_take_quiz_assignment/finish/` is unconditionally blocked by `LmsHttpClient`.

---

## 5. Arabic Markdown Reporting (`العربية`)

CLI commands generate reports under `reports/<command>/` with timestamped files and `latest.md`. Report rendering lives in `apps/cli/src/exporters/`; shared domain data comes from `@qatar-edu/core`. All sensitive values remain masked as `"VALUES"`.

---

## 6. Extensibility Guide

### Adding a New LMS Entity or Command
1. Add domain types in `packages/core/src/types/`.
2. Add a pure parser in `packages/core/src/parsers/`.
3. Add an Arabic Markdown exporter in `apps/cli/src/exporters/`.
4. Add orchestration in `apps/cli/src/commands/`.
5. Register flags/help/routing in `apps/cli/src/cli/` and `apps/cli/src/cli.ts`.

### Adding API Business Routes
1. Add route modules under `apps/api/src/routes/`.
2. Mount them in `apps/api/src/index.ts`.
3. Import shared LMS/domain logic from `@qatar-edu/core`; do not duplicate parsers or HTTP guardrails.

### Adding Web Pages
1. Add TanStack Router file routes under `apps/web/src/routes/`.
2. Keep UI skeleton changes minimal until API contracts are defined.
3. Do not embed secrets or call authenticated LMS endpoints directly from the browser.

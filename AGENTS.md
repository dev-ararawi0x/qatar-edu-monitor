# AGENTS.md — Qatar Education Monitor (`qatar-edu-monitor`)

Guidelines and operational rules for AI coding agents and developers working in this pnpm-workspace monorepo.

---

## 1. Project Overview

`qatar-edu-monitor` is a pnpm workspace monorepo for safely inspecting and monitoring the Qatar Education LMS (`https://qeducation.edu.gov.qa`).

Workspace packages:

- `packages/core` (`@qatar-edu/core`): shared LMS domain types, HTTP client, cookie jar, sanitizer, URL builders, Cheerio parsers, LLM adapters/validator/prompt-builder, and quiz domain services.
- `apps/cli` (`@qatar-edu/cli`): CLI entrypoint, command handlers, environment/report configuration, and Arabic Markdown exporters.
- `apps/api` (`@qatar-edu/api`): minimal Hono + Node.js API skeleton with `/health` only.
- `apps/web` (`@qatar-edu/web`): minimal Vite + React + TypeScript + TanStack Router skeleton with no business UI yet.

---

## 2. Technology Stack & Commands

- **Runtime**: Node.js (v22+), TypeScript (strict mode), ESM (`"type": "module"`), pnpm workspaces.
- **Key Libraries**: `cheerio` in core; `dotenv` in CLI; `hono` + `@hono/node-server` in API; `react`, `react-dom`, `@tanstack/react-router`, Vite in web.
- **Package manager**: pnpm (`pnpm-workspace.yaml`, `packageManager: pnpm@10.12.1`).

### Common Commands

```bash
pnpm install
pnpm -r typecheck
pnpm --filter @qatar-edu/core test
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts --help
pnpm --filter @qatar-edu/cli cli --help
pnpm --filter @qatar-edu/api dev
pnpm --filter @qatar-edu/web dev
pnpm -r build
```

CLI shortcuts remain available through the root package scripts, for example `pnpm quiz:inspect -- <url-or-id>` and `pnpm quiz:draft -- <display-url>`.

---

## 3. Architecture & Directory Map

```text
packages/core/src/
├── types/                 # Shared domain & HTTP interfaces
├── core/                  # config-free primitives: HTTP, cookies, sanitizer, URLs
├── parsers/               # Pure Cheerio HTML parsers
├── llm/                   # Provider adapters, prompt builder, validator, retry
└── services/              # quiz-inspector, quiz-form.mapper, quiz-solver

apps/cli/src/
├── cli.ts                 # CLI entrypoint & top-level router
├── cli/                   # handlers, flags, help
├── commands/              # Command orchestrators
├── exporters/             # Arabic Markdown report generators & writer
├── config.ts              # dotenv/env loading, app config, command context
└── types/                 # CLI-only context/result types

apps/api/src/
└── index.ts, server.ts    # Hono app + /health route and Node server bootstrap

apps/web/src/
├── main.tsx
├── router.ts
├── routes/                # TanStack Router file routes
└── styles.css
```

Generated reports remain under root `reports/` when running the CLI from the repository root.

---

## 4. Critical Safety & Security Rules (NON-NEGOTIABLE)

1. **Never Expose Secrets or Tokens**:
   - **NEVER** read, print, log, commit, or display real values from `.env` (`LMS_COOKIE`, session tokens, CSRF tokens, LLM keys).
   - All sensitive keys (`cookie`, `token`, `csrf`, `auth`, `session`, `password`, `secret`) MUST be sanitized to `"VALUES"` via `@qatar-edu/core` sanitizer utilities.
   - `.env` is gitignored. Use `.env.example` with `"VALUES"` placeholders only.
2. **Read-Only Default (`GET` Only)**:
   - `assignments`, `lessons`, `quiz inspect`, `quiz scan`, `quiz solve` dry-run, and `monitor` must never issue `POST` requests unless the user explicitly opts into draft/solve apply flows.
   - New quiz attempts are skipped by default; never start an attempt unless the user explicitly passes `--start-new`.
3. **Quiz Submission & Draft Safety**:
   - `quiz draft` and `quiz solve` MUST default to dry-run mode (`POST` only when `--apply` or `--submit` is passed).
   - Draft execution MUST pause via `/student_take_quiz_assignment/pause/...` so the attempt stays resumable.
   - **`/student_take_quiz_assignment/finish/` is strictly forbidden**. `LmsHttpClient` blocks this endpoint unconditionally at the transport layer. Never attempt to bypass this guard.
   - Timed quizzes (`timed_quiz: true`) must abort unless `--allow-timed` is explicitly passed.

---

## 5. TypeScript & Coding Conventions

- **Strict TypeScript**: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module: "nodenext"`, `moduleResolution: "nodenext"`.
- Use `.js` extensions in relative imports.
- Use `import type { ... }` when importing only interfaces or types.
- `packages/core` must remain free of CLI-specific dependencies: no `process.argv`, `parseArgs`, CLI flag schemas, `process.exit`, or Markdown report writers.
- `apps/cli` owns dotenv loading, CLI flags, command context, console output orchestration, and Arabic Markdown reports.
- Cheerio parsers must remain pure functions accepting HTML strings and returning typed objects.
- All generated Markdown content must be in Arabic (`العربية`); escape pipes and normalize cells with `escapeMarkdownCell()`.

---

## 6. Extending the Codebase

### Adding a New LMS Entity or Command
1. Add domain types in `packages/core/src/types/`.
2. Add a Cheerio parser in `packages/core/src/parsers/`.
3. Add an Arabic Markdown exporter in `apps/cli/src/exporters/`.
4. Add the orchestrator in `apps/cli/src/commands/`.
5. Register flags, routing, and help in `apps/cli/src/cli/` and `apps/cli/src/cli.ts`.

### Adding a New LLM Provider
1. Implement `LlmProvider` in `packages/core/src/llm/adapters/`.
2. Register it in `packages/core/src/llm/registry.ts`.
3. Keep provider env/default model helpers in `apps/cli/src/config.ts` unless a non-CLI consumer needs them.
4. Add core tests under `packages/core/tests/`.

### Adding a New Quiz Question Type
1. Extend `QuizInputType` in `packages/core/src/types/quiz.types.ts`.
2. Update selector matching/classification in `packages/core/src/parsers/quiz.parser.ts`.
3. Add the localized Arabic label in `apps/cli/src/exporters/quiz.exporter.ts`.
4. Extend validator/mapper/service behavior in `packages/core/src/llm/` and `packages/core/src/services/` when needed.
5. Add parser/core test coverage in `packages/core/tests/parsers.test.ts`.

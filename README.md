# Qatar Education Monitor (`qatar-edu-monitor`)

A safety-first TypeScript / Node.js **pnpm workspace monorepo** for inspecting and monitoring the Qatar Education LMS (`https://qeducation.edu.gov.qa`).

It ships four workspace packages:

| Package | Path | Purpose |
| --- | --- | --- |
| `@qatar-edu/core` | `packages/core` | Shared domain types, `LmsHttpClient` (with transport-level `/finish/` block), `SessionCookieJar`, `"VALUES"` sanitizer, URL builders, Cheerio parsers, LLM adapters, and quiz domain services. Zero CLI dependencies. |
| `@qatar-edu/cli` | `apps/cli` | The existing CLI: entrypoint, command handlers, env config, and Arabic (`العربية`) Markdown report exporters. |
| `@qatar-edu/api` | `apps/api` | Hono API: better-auth (email/password, optional Microsoft OAuth), PostgreSQL + Drizzle, encrypted per-user LMS cookie & LLM settings, modular routes, and a Postgres-backed `SolveJobWorker` for background AI solving (apply + pause — never finish). |
| `@qatar-edu/web` | `apps/web` | Arabic RTL React app (Tailwind v4 + shadcn-style UI, TanStack Router/Query, `hc<AppType>` RPC): dashboard, background-jobs monitor, quiz review/edit/finish, and settings. |

The CLI provides read-only assignment, lesson, and quiz inspection; safe draft-saving with pause/resume protection; LLM-assisted quiz solving (dry-run by default); and automated Arabic Markdown reports. The web platform adds email login, per-user LMS sessions, background solve jobs, and a human review → edit → explicit-finish flow.

---

## Features

- **Read-Only by Default**: `assignments`, `lessons`, `quiz inspect`, `quiz scan`, `quiz solve` (dry-run), and `monitor` issue only `GET` requests.
- **Quiz Safety Guardrails**:
  - New quiz attempts are skipped unless `--start-new` is explicitly passed.
  - `quiz draft` / `quiz solve` run in dry-run mode unless `--apply` / `--submit` is passed.
  - Draft execution pauses via `/pause/` and **never** submits `/finish/` (blocked at transport level).
  - Timed quizzes abort unless `--allow-timed` is passed.
- **Secret Sanitization**: All cookies, CSRF tokens, and sensitive fields are masked as `"VALUES"` in logs, HTTP traces, and reports.
- **Arabic Markdown Reports**: Timestamped reports plus `latest.md` under `reports/<command>/`.
- **LLM Quiz Solver**: Pluggable providers (Gemini, OpenAI-compatible, Anthropic, Mock) with prompt building, answer validation, and transient-error retry/fallback.
- **Zero Hardcoded IDs**: No default class IDs or session cookies are baked into the code; configure via `.env` or CLI flags.

---

## Prerequisites

- **Node.js**: v22+ recommended
- **pnpm**: v10+ (`corepack enable` or `npm install -g pnpm`)

---

## Installation

```bash
# Clone and enter the repository
git clone https://github.com/dev-ararawi0x/qatar-edu-monitor.git qatar-edu-monitor
cd qatar-edu-monitor

# Install all workspace dependencies
pnpm install

# Copy environment template and configure your session
cp .env.example .env
```

On Windows (PowerShell): `copy .env.example .env` instead of `cp`.

---

## Configuration (`.env`)

Create `.env` in the **repository root** (copy from `.env.example`). **Never commit `.env`.**

```env
# REQUIRED: Your authenticated session cookie from the LMS browser session.
# DevTools > Application > Cookies > <your-lms>.edu.gov.qa
# All values are masked as "VALUES" in logs/reports.
LMS_COOKIE="VALUES"

# REQUIRED: Base URL of your LMS portal.
LMS_BASE_URL="https://<your-lms>.edu.gov.qa"

# REQUIRED for class-scoped commands (assignments, lessons, quiz scan):
# Your class / section ID, found in the LMS URL when viewing your class.
LMS_CLASS_ID="YOUR_CLASS_ID"

# Optional: Custom directory for generated reports (defaults to ./reports)
# REPORTS_DIR="reports"

# LLM provider configuration (for `quiz solve`): gemini | openai | anthropic | mock
LLM_PROVIDER="gemini"
LLM_MODEL="gemini-3.8-flash"
LLM_API_KEY="VALUES"
# LLM_FALLBACK_MODELS="gemini-3.6-flash,gemini-3.5-flash-lite"
# LLM_BASE_URL=""   # e.g. OpenRouter, DeepSeek, Groq, or local Ollama
```

**Important**: Replace `"VALUES"` placeholders with your real values locally. The tooling masks them automatically in all outputs.

---

## Usage

### Workspace Commands

```bash
# Type-check every workspace package
pnpm -r typecheck

# Run all workspace tests
pnpm -r test

# Build all packages
pnpm -r build

# Run the CLI help
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts --help

# Or use the root shortcuts (same thing, shorter):
pnpm cli -- --help
pnpm quiz:inspect -- <url-or-id>
pnpm quiz:draft -- <display-url>

# Platform — one command does everything:
# ensures .env API vars, starts the Postgres container (docker or rootless
# podman), generates + applies migrations, then runs API + web together.
pnpm dev         # API http://localhost:3001 (+ embedded worker) + web http://localhost:5173

# Production-ish run (builds web if needed, serves API + built web):
pnpm build && pnpm start

# Individual pieces (when you need them separately):
pnpm setup       # only bootstrap .env + DB container/migrations
pnpm db:up       # Postgres container + generate + migrate
pnpm api:dev     # API + embedded worker only
pnpm api:worker  # standalone worker (set ENABLE_EMBEDDED_WORKER=false to avoid dupes)
pnpm web:dev     # web dev server only
pnpm db:down     # stop the container (data persists in the volume)
# After schema changes against an already-running DB:
pnpm db:generate && pnpm db:migrate
```

### CLI Commands

```bash
# Assignments & lessons (read-only GET; needs --class-id or --url)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts assignments list --class-id <id>
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts assignments due --class-id <id>
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts lessons list --class-id <id>

# Quiz inspection & scanning (read-only GET)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz inspect <showUrl|displayUrl|quizId>
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz scan --class-id <id>
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz scan --class-id <id> --start-new

# Quiz draft saving (dry-run by default; --apply sends draft POSTs + /pause/)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz draft <displayUrl>
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz draft <displayUrl> --apply --answers '{"1":"Answer text"}'

# LLM quiz solving (dry-run by default; --apply saves drafts, --submit walks to summary)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz solve <showUrl|displayUrl|quizId>
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz solve <target> --provider mock   # offline test

# HTTP monitor (read-only GET, auto-detects LMS entities)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts monitor <url...>
```

Global flags: `--quiet`, `--no-report`, `--out-dir <path>`, `--help`.

**Safety**: `quiz draft`/`quiz solve` never call `/student_take_quiz_assignment/finish/` — it is blocked inside `LmsHttpClient` before any packet is sent.

---

## Reports Output

Commands generate Arabic Markdown reports under `reports/<command>/` (timestamped file + `latest.md`):

```text
reports/
├── assignments-list/   ├── quiz-inspect/   ├── quiz-solve/
├── assignments-due/    ├── quiz-scan/      ├── monitor/
├── lessons-list/       └── quiz-draft/
```

Open `reports/<command>/latest.md` for the most recent run.

---

## Repository Layout

```text
qatar-edu-monitor/
├── pnpm-workspace.yaml      # workspace: apps/* + packages/*
├── tsconfig.base.json       # shared strict TS config (nodenext, exactOptionalPropertyTypes, ...)
│
├── packages/core/           # @qatar-edu/core — reusable LMS engine
│   ├── src/types/           #   domain & HTTP interfaces
│   ├── src/core/            #   http-client, cookie-jar, sanitizer, lms-urls
│   ├── src/parsers/         #   pure Cheerio HTML parsers
│   ├── src/llm/             #   provider adapters, prompt-builder, validator, retry
│   ├── src/services/        #   quiz-inspector, quiz-form.mapper, quiz-solver
│   └── tests/               #   offline unit tests
│
├── apps/cli/                # @qatar-edu/cli — the CLI
│   ├── src/cli.ts           #   entrypoint & router
│   ├── src/cli/             #   handlers, flags, help
│   ├── src/commands/        #   command orchestrators
│   ├── src/exporters/       #   Arabic Markdown report generators
│   ├── src/config.ts        #   dotenv/env -> AppConfig -> CommandContext
│   └── tests/               #   exporter & solver integration tests
│
├── apps/api/                # @qatar-edu/api — Hono skeleton (/health only)
├── apps/web/                # @qatar-edu/web — Vite + React + TanStack Router skeleton
├── docs/                    # architecture.md, how-it-works.md
└── reports/                 # generated Arabic reports (gitignored)
```

For a guided walkthrough of how a command flows through these files, see **`docs/how-it-works.md`**. For deep architecture details, see `docs/architecture.md`.

---

## Development & Verification

```bash
pnpm install          # install all workspaces
pnpm -r typecheck     # must pass with 0 errors
pnpm -r build         # compile all packages
pnpm --filter @qatar-edu/core test    # core unit tests
pnpm --filter @qatar-edu/cli test     # CLI exporter/solver tests
```

---

## Safety & Privacy Rules

- **Never commit `.env`**: it contains your real session cookie and LLM keys.
- **All secrets masked**: cookies, CSRF tokens, and sensitive fields always display as `"VALUES"`.
- **Read-only defaults**: no command submits quiz answers or starts attempts without explicit opt-in.
- **`/finish/` blocked**: quiz final submission is structurally impossible via this tooling.

---

## Versioning

- `v0.1.0` — stable single-package CLI baseline (tag on `main`).
- `v0.2.0` — pnpm workspace monorepo (`packages/core`, `apps/cli`, `apps/api`, `apps/web`) on `feat/v0.2-monorepo`.

Agent-facing rules live in `AGENTS.md` / `CLAUDE.md`.

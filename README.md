# Qatar Education Monitor (`qatar-edu-monitor`)

A pnpm-workspace monorepo with a safety-first TypeScript / Node.js CLI, shared LMS core package, minimal API skeleton, and minimal web skeleton for inspecting and monitoring the Qatar Education LMS. It provides read-only assignment, lesson, and quiz inspection, safe draft-saving with pause/resume protection, and automated Arabic (`العربية`) Markdown reports.

---

## Features

- **Unified CLI**: Single entrypoint (`src/cli.ts`) with subcommands for `assignments`, `lessons`, `quiz`, and `monitor`.
- **Read-Only by Default**: `quiz inspect`, `quiz scan`, `assignments`, `lessons`, and `monitor` use only `GET` requests.
- **Quiz Safety Guardrails**:
  - New quiz attempts are skipped unless `--start-new` is explicitly passed.
  - `quiz draft` runs in dry-run mode by default (no `POST` unless `--apply` is passed).
  - Draft execution pauses via `/pause/` and **never** submits `/finish/` (blocked at transport level).
- **Secret Sanitization**: All cookies, CSRF tokens, and sensitive fields are masked as `"VALUES"` in logs and reports.
- **Arabic Markdown Reports**: Automatically generates structured Arabic reports under `reports/<command>/` (`latest.md` + timestamped files).
- **Zero Hardcoded IDs**: No default class IDs or session cookies are baked into the code; configure via `.env` or CLI flags.

---

## Prerequisites

- **Node.js**: v18+ (v22+ recommended)
- **pnpm**: v10+ (`corepack enable` or `pnpm install -g pnpm`)
- **TypeScript**: Included as a dev dependency (no global install needed)

---

## Installation

### Linux / macOS

```bash
# Clone or navigate to the project directory
git clone https://github.com/dev-ararawi0x/qatar-edu-monitor.git qatar-edu-monitor
cd qatar-edu-monitor

# Install dependencies
pnpm install

# Copy environment template and configure your session
cp .env.example .env
```

### Windows (PowerShell / CMD)

```powershell
# Clone or navigate to the project directory
git clone https://github.com/dev-ararawi0x/qatar-edu-monitor.git qatar-edu-monitor
cd qatar-edu-monitor

# Install dependencies
pnpm install

# Copy environment template and configure your session
copy .env.example .env
```

---

## Configuration (`.env`)

Create a `.env` file in the project root (copy from `.env.example`). **Never commit `.env` to version control.**

```env
# REQUIRED: Your authenticated session cookie from the LMS browser session.
# Get this from browser DevTools > Application > Cookies > <your-lms>.edu.gov.qa
# Copy the full Cookie header value here. All values are masked as "VALUES" in logs/reports.
LMS_COOKIE="VALUES"

# REQUIRED: Base URL of your LMS portal.
LMS_BASE_URL="https://<your-lms>.edu.gov.qa"

# REQUIRED for class-scoped commands (assignments, lessons, quiz scan):
# Your class / section ID. Find it in the LMS URL when viewing your class.
# Example: https://<your-lms>.edu.gov.qa/student_assignments/list/123456
LMS_CLASS_ID="YOUR_CLASS_ID"

# Optional: Custom directory for generated reports (defaults to ./reports)
# REPORTS_DIR="reports"
```

**Important**: Replace `"VALUES"` in `LMS_COOKIE` with your real session cookie string. The CLI will automatically mask it in all outputs.

---

## Workspace Layout

- `packages/core`: shared LMS types, HTTP client, cookie jar, sanitizer, URL builders, Cheerio parsers, LLM adapters/services, and quiz domain services.
- `apps/cli`: existing CLI commands, flag parsing, and Arabic Markdown exporters.
- `apps/api`: minimal Hono `/health` API skeleton.
- `apps/web`: minimal Vite + React + TanStack Router placeholder.

## Usage

### Unified CLI Entry Point

```bash
# Show all commands and safety guardrails
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts --help

# Show help for a specific command group
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts assignments --help
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts lessons --help
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz --help
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts monitor --help
```

### Assignments & Lessons (Read-Only `GET`)

These commands require either `--class-id <id>` or `--url <fullUrl>`.

```bash
# List all assignments for a class
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts assignments list --class-id <your-class-id>

# List due assignments / quizzes
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts assignments due --class-id <your-class-id>

# Or use a custom URL directly
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts assignments due --url "https://<your-lms>.edu.gov.qa/student_assignments/due/<your-class-id>"

# List lessons and sections
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts lessons list --class-id <your-class-id>
```

### Quiz Inspection & Scanning (Read-Only `GET`)

```bash
# Inspect a specific quiz by show URL, display URL, or quiz ID
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz inspect "https://<your-lms>.edu.gov.qa/student_quiz_assignment/show/<quiz-id>"
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz inspect "https://<your-lms>.edu.gov.qa/student_take_quiz_assignment/display/<quiz-id>?part=1&results=<results-id>"
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz inspect <quiz-id>

# Scan all due quizzes for a class (skips unstarted attempts by default)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz scan --class-id <your-class-id>

# Opt-in to inspect newly started attempts (still GET only)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz scan --class-id <your-class-id> --start-new
```

### Quiz Draft Saving (Dry-Run by Default)

```bash
# Preview what would be sent (NO POST requests are made)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz draft "https://<your-lms>.edu.gov.qa/student_take_quiz_assignment/display/<quiz-id>?part=1&results=<results-id>"

# Provide custom answers as a JSON string mapping part numbers to answers
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz draft <display-url> --answers '{"1":"Answer text","2":"4"}'

# Actually save draft answers and pause the attempt (requires --apply)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz draft <display-url> --apply --answers '{"1":"Answer text"}'

# Allow timed quizzes (aborts by default if timed_quiz=true)
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz draft <display-url> --apply --allow-timed
```

**Safety**: `quiz draft` never calls `/student_take_quiz_assignment/finish/`. The `/finish/` endpoint is blocked at the HTTP client level.

### HTTP Monitor (Read-Only `GET`)

```bash
# Monitor default dashboard or custom URLs
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts monitor
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts monitor "https://<your-lms>.edu.gov.qa/student_assignments/list/<your-class-id>"
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts monitor "https://<your-lms>.edu.gov.qa/student_quiz_assignment/show/<quiz-id>"

# Custom CSS selector for DOM extraction
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts monitor <url> --selector "#mainContent .question"
```

---

## Reports Output

All commands generate Arabic Markdown reports under `reports/<command>/`:

```text
reports/
├── assignments-list/
│   ├── 2026-11-22_17-00-00.md
│   └── latest.md
├── assignments-due/
│   ├── 2026-11-22_17-05-00.md
│   └── latest.md
├── lessons-list/
│   ├── 2026-11-22_17-10-00.md
│   └── latest.md
├── quiz-inspect/
│   ├── quiz-15479350_2026-11-22_17-15-00.md
│   └── latest.md
├── quiz-scan/
│   ├── 2026-11-22_17-20-00.md
│   └── latest.md
├── quiz-draft/
│   ├── quiz-15479350-draft_2026-11-22_17-25-00.md
│   └── latest.md
└── monitor/
    ├── 2026-11-22_17-30-00.md
    └── latest.md
```

Open `reports/<command>/latest.md` for the most recent run of that command.

---

## Development & Verification

```bash
# Type-check the project (must pass with 0 errors)
pnpm -r typecheck

# Run offline unit tests (sanitizer, parsers, exporters, safety guards)
pnpm --filter @qatar-edu/core test

# Build compiled JavaScript to dist/
pnpm -r build
```

---

## Safety & Privacy Rules

- **Never commit `.env`**: It contains your real session cookie.
- **All secrets masked**: Cookies, CSRF tokens, and sensitive fields are always displayed as `"VALUES"`.
- **Read-only defaults**: No command submits quiz answers or starts attempts without explicit opt-in.
- **`/finish/` blocked**: Quiz final submission is structurally impossible via this CLI.

For detailed architecture and extension guidelines, see:

- `docs/architecture.md`
- `AGENTS.md`
- `CLAUDE.md`

# Qatar Education Monitor (`qatar-edu-monitor`)

A modular, safety-first TypeScript / Node.js CLI tool for inspecting and monitoring the Qatar Education LMS. It provides read-only assignment, lesson, and quiz inspection, safe draft-saving with pause/resume protection, and automated Arabic (`العربية`) Markdown reports.

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
- **npm**: v9+ (comes with Node.js)
- **TypeScript**: Included as a dev dependency (no global install needed)

---

## Installation

### Linux / macOS

```bash
# Clone or navigate to the project directory
git clone https://github.com/dev-ararawi0x/qatar-edu-monitor.git qatar-edu-monitor
cd qatar-edu-monitor

# Install dependencies
npm install

# Copy environment template and configure your session
cp .env.example .env
```

### Windows (PowerShell / CMD)

```powershell
# Clone or navigate to the project directory
git clone https://github.com/dev-ararawi0x/qatar-edu-monitor.git qatar-edu-monitor
cd qatar-edu-monitor

# Install dependencies
npm install

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

## Usage

### Unified CLI Entry Point

```bash
# Show all commands and safety guardrails
npx tsx src/cli.ts --help

# Show help for a specific command group
npx tsx src/cli.ts assignments --help
npx tsx src/cli.ts lessons --help
npx tsx src/cli.ts quiz --help
npx tsx src/cli.ts monitor --help
```

### Assignments & Lessons (Read-Only `GET`)

These commands require either `--class-id <id>` or `--url <fullUrl>`.

```bash
# List all assignments for a class
npx tsx src/cli.ts assignments list --class-id <your-class-id>

# List due assignments / quizzes
npx tsx src/cli.ts assignments due --class-id <your-class-id>

# Or use a custom URL directly
npx tsx src/cli.ts assignments due --url "https://<your-lms>.edu.gov.qa/student_assignments/due/<your-class-id>"

# List lessons and sections
npx tsx src/cli.ts lessons list --class-id <your-class-id>
```

### Quiz Inspection & Scanning (Read-Only `GET`)

```bash
# Inspect a specific quiz by show URL, display URL, or quiz ID
npx tsx src/cli.ts quiz inspect "https://<your-lms>.edu.gov.qa/student_quiz_assignment/show/<quiz-id>"
npx tsx src/cli.ts quiz inspect "https://<your-lms>.edu.gov.qa/student_take_quiz_assignment/display/<quiz-id>?part=1&results=<results-id>"
npx tsx src/cli.ts quiz inspect <quiz-id>

# Scan all due quizzes for a class (skips unstarted attempts by default)
npx tsx src/cli.ts quiz scan --class-id <your-class-id>

# Opt-in to inspect newly started attempts (still GET only)
npx tsx src/cli.ts quiz scan --class-id <your-class-id> --start-new
```

### Quiz Draft Saving (Dry-Run by Default)

```bash
# Preview what would be sent (NO POST requests are made)
npx tsx src/cli.ts quiz draft "https://<your-lms>.edu.gov.qa/student_take_quiz_assignment/display/<quiz-id>?part=1&results=<results-id>"

# Provide custom answers as a JSON string mapping part numbers to answers
npx tsx src/cli.ts quiz draft <display-url> --answers '{"1":"Answer text","2":"4"}'

# Actually save draft answers and pause the attempt (requires --apply)
npx tsx src/cli.ts quiz draft <display-url> --apply --answers '{"1":"Answer text"}'

# Allow timed quizzes (aborts by default if timed_quiz=true)
npx tsx src/cli.ts quiz draft <display-url> --apply --allow-timed
```

**Safety**: `quiz draft` never calls `/student_take_quiz_assignment/finish/`. The `/finish/` endpoint is blocked at the HTTP client level.

### HTTP Monitor (Read-Only `GET`)

```bash
# Monitor default dashboard or custom URLs
npx tsx src/cli.ts monitor
npx tsx src/cli.ts monitor "https://<your-lms>.edu.gov.qa/student_assignments/list/<your-class-id>"
npx tsx src/cli.ts monitor "https://<your-lms>.edu.gov.qa/student_quiz_assignment/show/<quiz-id>"

# Custom CSS selector for DOM extraction
npx tsx src/cli.ts monitor <url> --selector "#mainContent .question"
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
npm run typecheck

# Run offline unit tests (sanitizer, parsers, exporters, safety guards)
npm test

# Build compiled JavaScript to dist/
npm run build
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

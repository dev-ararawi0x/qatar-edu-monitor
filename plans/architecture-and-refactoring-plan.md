# Refactor & Scale `qatar-edu-monitor`: Architecture, CLI, and Arabic Markdown Reporting Plan

> **Summary:** Modularize `qatar-edu-monitor` into a layered TypeScript/ESM CLI architecture with strict secret sanitization (`"VALUES"`), read-only quiz safety guardrails, automated Arabic-language Markdown reporting under `reports/<command>/`, offline unit tests, and full project/agent documentation (`docs/architecture.md`, `AGENTS.md`, `CLAUDE.md`).

---

## 1. Architectural Overview

We will refactor the existing 5 flat scripts (`src/http_logger.ts`, `src/monitor.ts`, `src/parsers.ts`, `src/quiz_inspector.ts`, `src/scan_due_quizzes.ts`) into a clean, layered TypeScript/ESM architecture with:
- Zero duplicated HTTP, cookie-jar, or HTML parsing logic.
- Strict secret redaction (`"VALUES"`) across all console logs, traces, and Markdown outputs.
- Multi-layer quiz safety guardrails (`GET` defaults, `--start-new` opt-in, `--dry-run` default on draft-saving, and a hard transport-level block on `/finish/`).
- Code-generated Arabic-language Markdown reports saved per command under `reports/<command>/` (`<timestamp_or_slug>.md` + `latest.md`).
- Comprehensive developer and AI agent documentation.

### Target Directory Structure

```text
qatar-edu-monitor/
├── .env                          # Local untracked secrets (NEVER read, printed, or committed)
├── .env.example                  # Documented template with "VALUES" placeholders
├── .gitignore                    # Ignores .env, node_modules/, dist/, reports/
├── AGENTS.md                     # Repository conventions, CLI reference, safety & privacy rules, extension guide
├── CLAUDE.md                     # AI assistant rules & architecture quick-reference aligned with AGENTS.md
├── package.json                  # Updated CLI scripts, typecheck, and unit test scripts
├── tsconfig.json                 # Strict NodeNext ESM configuration covering src/ and tests/
├── plans/
│   └── architecture-and-refactoring-plan.md
├── docs/
│   └── architecture.md           # Detailed system design, data flow, session lifecycle, safety guardrails & extension guide
├── reports/                      # Auto-generated Arabic Markdown reports (gitignored)
│   ├── assignments-list/         # <timestamp>.md + latest.md
│   ├── assignments-due/          # <timestamp>.md + latest.md
│   ├── lessons-list/             # <timestamp>.md + latest.md
│   ├── quiz-inspect/             # <slug>_<timestamp>.md + latest.md
│   ├── quiz-scan/                # <timestamp>.md + latest.md
│   ├── quiz-draft/               # <slug>_<timestamp>.md + latest.md
│   └── monitor/                  # <timestamp>.md + latest.md
├── src/
│   ├── cli.ts                    # Unified CLI entrypoint & subcommand router (node:util parseArgs)
│   ├── types/
│   │   ├── index.ts              # Barrel export for shared domain & CLI types
│   │   ├── http.types.ts         # HTTP request/response & sanitized trace interfaces
│   │   ├── lms.types.ts          # Assignment, Lesson, LessonSection, GenericPageInspection interfaces
│   │   ├── quiz.types.ts         # QuizShowInfo, InitQuizConfig, Question/Summary screens, Draft/Scan result types
│   │   └── cli.types.ts          # CLI flags, CommandContext, and CommandResult interfaces
│   ├── core/
│   │   ├── config.ts             # Environment config loader (LMS_BASE_URL, LMS_CLASS_ID, LMS_COOKIE, reports dir)
│   │   ├── sanitizer.ts          # Central masking engine -> replaces cookies, CSRF/authenticity tokens & secrets with "VALUES"
│   │   ├── cookie-jar.ts         # Single SessionCookieJar (deduplicated from monitor.ts & http_logger.ts)
│   │   ├── lms-urls.ts           # URL builders, ID extractors, and route classifiers (including isQuizFinishUrl guard)
│   │   └── http-client.ts        # LmsHttpClient (GET/POST, manual redirects, sanitized console & trace logging, hard /finish block)
│   ├── parsers/
│   │   ├── index.ts              # Parser exports + page auto-detection helper for monitor mode
│   │   ├── shared.ts             # Cheerio text normalization, query/ID helpers
│   │   ├── assignments.parser.ts # parseAssignmentsHtml (quizzes, offline assignments, related lesson links)
│   │   ├── lessons.parser.ts     # parseLessonsHtml (lessons + sections, dynamic classId extraction)
│   │   ├── quiz.parser.ts        # parseQuizShowPage, parseInitQuizConfig, unified parseQuizScreen (merges inspectFormInputs)
│   │   └── generic.parser.ts     # parseGenericHtmlPage (title, main heading, sample elements for monitor)
│   ├── exporters/
│   │   ├── markdown-helpers.ts   # Arabic Markdown builders (escaped tables, metadata headers, badges, sanitized code blocks)
│   │   ├── markdown-writer.ts    # Writes timestamped report + overwrites latest.md under reports/<command>/
│   │   ├── assignments.exporter.ts # Arabic report generator for assignments list / due
│   │   ├── lessons.exporter.ts     # Arabic report generator for lessons list & sections
│   │   ├── quiz.exporter.ts        # Arabic report generator for quiz inspect, quiz scan, and quiz draft
│   │   └── monitor.exporter.ts     # Arabic report generator for sanitized HTTP monitor sessions
│   └── commands/
│       ├── assignments.command.ts  # Handlers for `assignments list` and `assignments due`
│       ├── lessons.command.ts      # Handler for `lessons list`
│       ├── quiz.command.ts         # Handlers for `quiz inspect`, `quiz scan`, and `quiz draft`
│       └── monitor.command.ts      # Handler for `monitor`
└── tests/
    ├── sanitizer.test.ts         # Verifies cookies, tokens, HTML/JSON/form secrets always mask to "VALUES"
    ├── parsers.test.ts           # Verifies assignments, lessons, and quiz question/summary parsers on synthetic HTML
    └── exporters-and-guards.test.ts # Verifies Arabic Markdown output & hard /finish endpoint blocking
```

---

## 2. Layer-by-Layer Design

### 2.1 Core Layer (`src/core/`)
- **`config.ts`**: Loads `dotenv/config` once and exposes `AppConfig`:
  - `baseUrl`: `process.env.LMS_BASE_URL || "https://qeducation.edu.gov.qa"`
  - `defaultClassId`: `process.env.LMS_CLASS_ID || "614062"`
  - `initialCookie`: `process.env.LMS_COOKIE || "VALUES"`
  - `reportsDir`: `process.env.REPORTS_DIR || "reports"`
- **`sanitizer.ts`**: Single source of truth for privacy & secret redaction:
  - `MASK_VALUE = "VALUES"`.
  - `sanitizeHeaders(headers)` & `sanitizeFormFields(fields)`: masks any key matching `cookie`, `token`, `csrf`, `auth`, `session`, `secret`, `password`.
  - `sanitizeHtmlSnippet(html)` & `sanitizeJsonValue(val)`: scrubs `<meta name="csrf-token" content="...">`, `<input name="authenticity_token" value="...">`, and sensitive JSON keys to `"VALUES"` before printing or exporting previews.
  - `sanitizeQuizScreenForOutput(screen)`: returns a safe copy where `hiddenFields.authenticity_token` and `authenticityToken` are `"VALUES"`.
- **`cookie-jar.ts`**: Consolidates the previously duplicated `SessionCookieJar` class. Tracks cookies in memory, ingests `Set-Cookie` headers, reports only cookie **names** (never values) on update, and returns `"VALUES"` if empty.
- **`lms-urls.ts`**: Centralizes LMS route construction and matching:
  - `buildAssignmentsListUrl(classId)`, `buildAssignmentsDueUrl(classId)`, `buildLessonsListUrl(classId)`, `buildQuizShowUrl(quizId)`, `buildQuizDisplayUrl(quizId, part, resultsId)`, `buildQuizPauseUrl(quizId, resultsId)`.
  - `isQuizFinishUrl(url)`: detects `/student_take_quiz_assignment/finish/` so `LmsHttpClient` can reject any accidental submission request at the transport layer.
- **`http-client.ts`**: Evolution of `LoggedLmsClient`:
  - Supports `GET` and `POST` (`urlencoded` and `multipart/form-data`), `redirect: "manual"`, custom `Referer`, `X-Requested-With`, and `X-CSRF-Token`.
  - **Transport-level safety guardrail**: Throws an immediate safety error if any caller attempts a request to `/student_take_quiz_assignment/finish/`.
  - Records structured `SanitizedHttpTrace` entries (timestamp, method, URL, status, elapsedMs, contentType, kind, location, updatedCookieNames, sizeBytes, sanitized form fields) for both console logging and Markdown export.

### 2.2 Parsers Layer (`src/parsers/`)
Pure, stateless functions accepting HTML strings (using `cheerio`) and returning typed domain models:
- **`assignments.parser.ts`**: Extracts `ParsedAssignment[]` (`title`, `href`, `assignmentId`, `kind: "quiz" | "offline" | "other"`, `relatedLessonTitle`, `relatedLessonHref`).
- **`lessons.parser.ts`**: Extracts `ParsedLesson[]` (`title`, `href`, `lessonId`, `sections[]`), deriving `classId` dynamically from the link or caller context instead of hardcoding `"614062"`.
- **`quiz.parser.ts`**:
  - `parseQuizShowPage(html)`: Extracts title, action button text/href, sidebar metadata, `isResumeAttempt` detection, and internal `csrfToken` (kept in runtime memory only when needed, masked in safe view).
  - `parseInitQuizConfig(html)`: Parses `init_quiz({...})` (`quizId`, `resultsId`, `part`, `parts`, `timedQuiz`, `timeLeft`, `resumeRefresh`).
  - `parseQuizScreen(html)`: Unifies `parseQuizScreen` from `quiz_inspector.ts` and `inspectFormInputs` from `scan_due_quizzes.ts` into one complete parser supporting:
    - **Plain and bracketed/array answer field matching**: Captures inputs named either `answer` or bracketed/indexed variants such as `answer[1]`, `answer[]`, and `answer[...]` (`name="answer"` or `name^="answer["`) across radio inputs, checkboxes, text inputs, textareas, and `<select>` dropdowns. This ensures fillable or selectable multi-part questions (such as multi-blank text inputs, matching/dropdown items, or checkbox arrays) are never misclassified as `unknown`, and preserves all indexed/current saved answers (`currentTextAnswer` and `structuredAnswers: Record<string, string | string[]>`).
    - **Question types & capabilities**: Classifies `single_choice`, `multiple_choice`, `free_text`, `structured_input` (multi-field/select/fill-in-the-blank), `file_upload`, or `unknown`, alongside explicit capability flags (`hasPlainTextInput`, `hasRichTextEditor`, `hasFileUpload`, `fileInputNames`, `formFieldNames`, `choices`, `currentTextAnswer`, `imageUrls`, `points`, `enctype`, `action`, `hiddenFields`).
    - **Summary screens (`stage: "summary"`)**: `finishAction` (for display/inspection only, never called), masked token status, and `summaryItems`.
- **`generic.parser.ts`**: Extracts `<title>`, main `<h1>`, element counts, and sample links/headings for `monitor` mode, plus runs registered page detectors (assignments/lessons/quiz) automatically.

### 2.3 Unified CLI & Subcommands (`src/cli.ts` & `src/commands/`)
Uses Node.js built-in `node:util` `parseArgs` (zero extra npm dependencies) with clear usage output (`--help` / `-h`):

| Command | Default HTTP Behavior | Options | Output Folder |
| :--- | :--- | :--- | :--- |
| `assignments list` | Read-only `GET` | `--class-id <id>`, `--url <url>`, `--no-report` | `reports/assignments-list/` |
| `assignments due` | Read-only `GET` | `--class-id <id>`, `--url <url>`, `--no-report` | `reports/assignments-due/` |
| `lessons list` | Read-only `GET` | `--class-id <id>`, `--url <url>`, `--no-report` | `reports/lessons-list/` |
| `quiz inspect <urlOrId>` | Read-only `GET` | `--results-id <id>`, `--start-new`, `--no-report` | `reports/quiz-inspect/` |
| `quiz scan` | Read-only `GET` | `--class-id <id>`, `--url <url>`, `--start-new`, `--no-report` | `reports/quiz-scan/` |
| `quiz draft <displayUrl>` | Dry-run (`GET` only unless `--apply`) | `--answers <jsonOrFile>`, `--apply`, `--no-pause`, `--allow-timed`, `--no-report` | `reports/quiz-draft/` |
| `monitor [urls...]` | Read-only `GET` | `--selector <css>`, `--no-report` | `reports/monitor/` |

#### Subcommand Details
1. **`assignments list`**: `GET /student_assignments/list/<classId>`, parses all assignments, prints summary table, writes Arabic report to `reports/assignments-list/`.
2. **`assignments due`**: `GET /student_assignments/due/<classId>`, parses due assignments, prints summary table, writes Arabic report to `reports/assignments-due/`.
3. **`lessons list`**: `GET /student_lessons/list/<classId>` (or custom `--url`), parses lessons and nested sections, prints summary, writes Arabic report to `reports/lessons-list/`.
4. **`quiz inspect <url-or-id>`**:
   - **100% Read-Only (`GET` only)**.
   - If given a `/student_quiz_assignment/show/<id>` URL or numeric `<quizId>`: fetches the show page via `GET`. If an attempt is already open (detected via the resume button label or `results=` query parameter), follows `GET` across parts `1..parts` to inspect all questions safely. If not started yet, stops at show-page metadata unless `--start-new` is explicitly passed.
   - If given a `/student_take_quiz_assignment/display/<id>?part=1&results=<rid>` URL (or `--results-id`): fetches all parts `1..parts` via `GET` only.
5. **`quiz scan`**:
   - **100% Read-Only (`GET` only)**; skips unstarted quizzes by default (`--start-new` opt-in required to open new attempts).
   - Scans due assignments, inspects each quiz show page, enters open attempts (or new attempts only if `--start-new`), reads all parts `1..parts` via `GET`, and exports a consolidated Arabic report to `reports/quiz-scan/`.
6. **`quiz draft <display-url>`**:
   - **Defaults to `--dry-run`** (`POST` is only executed when `--apply` is explicitly provided).
   - **Timed-quiz protection**: Aborts if `timed_quiz: true` unless `--allow-timed` is explicitly passed.
   - **Draft + Pause only**: Sends question draft `POST`s (`destination: "next"`) and calls `/pause/` afterward so the attempt stays resumable in the browser.
   - **Hard `/finish` separation**: Stops immediately upon reaching the summary screen and NEVER submits `/finish/`.
7. **`monitor [urls...]`**:
   - Performs read-only `GET` inspection of one or more LMS endpoints, logs sanitized HTTP request/response metrics (`"VALUES"` for cookies/tokens), auto-detects known LMS entities (assignments, lessons, quiz show/question pages), extracts generic DOM elements, and saves an Arabic technical inspection report to `reports/monitor/`.

Global CLI options across all commands:
- `--help`, `-h`: Displays command/subcommand usage.
- `--out-dir <path>`: Overrides base `reports/` directory.
- `--no-report`: Skips writing Markdown files if only console output is desired.
- `--quiet`: Suppresses verbose per-request HTTP banners in stdout while keeping summary + report output.

### 2.4 Organized Arabic Markdown Exporters (`src/exporters/`)
- **Directory convention**: Every command writes to `reports/<command-slug>/`:
  1. Timestamped archive file: `YYYY-MM-DD_HH-mm-ss.md` (prefixed with entity ID when applicable, e.g., `quiz-15479350_2026-11-22_17-00-00.md`).
  2. Direct-access file: `latest.md` in the same folder (`reports/<command-slug>/latest.md`), updated on every run so opening `reports/<command-slug>/` immediately shows `latest.md` plus historical runs.
- **Arabic-Language Report Structure**:
  - All generated report text, headings, metadata tables, capability badges, and summaries are emitted in Arabic at runtime.
  - Report header, execution metadata table (timestamp, executed command, target URL, session status, safety mode), executive summary counters, formatted Markdown tables, and detailed per-item sections.
  - **Fast-scan question layout in `quiz.exporter.ts` (`quiz inspect` & `quiz scan`)**: Each question section clearly groups together in a unified, easy-to-scan layout:
    1. **Question Prompt**: Full question text (plus any attached question image URLs).
    2. **Points / Score**: Question grade/points badge alongside the question heading.
    3. **Localized Question Type**: Clear Arabic label for single-choice, multiple-choice, free-text, structured/multi-field input, or file-upload questions.
    4. **Input & Attachment Capabilities**: Explicit indicators showing whether the question supports plain text entry, a rich-text editor, and/or file attachments (including file input field names when present).
    5. **Options & Current Answer**: Clean options table (marking any currently selected option) and/or the currently saved text/indexed answers (`answer`, `answer[1]`, etc.).
  - All tokens and cookies in generated reports are strictly rendered as `"VALUES"`.

### 2.5 Security, Privacy & Documentation Deliverables
- **`.gitignore`**: Ignores `.env`, `.env.*` (except `!.env.example`), `node_modules/`, `dist/`, `reports/`, `*.log`.
- **`.env.example`**: Documents `LMS_COOKIE="VALUES"`, `LMS_BASE_URL="https://qeducation.edu.gov.qa"`, and `LMS_CLASS_ID="614062"`.
- **`docs/architecture.md`**: Documents module boundaries, request/cookie data flow, Cheerio parsing patterns, the 4 quiz safety guardrails, secret redaction rules, report layout, and how to add a new LMS page/command/question type.
- **`AGENTS.md` & `CLAUDE.md`**: Operational guides for coding agents covering TypeScript strictness (`nodenext`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), CLI commands, strict `"VALUES"` redaction rules (never read/cat `.env` or print tokens), quiz safety invariants, and verification commands.

---

## 3. Step-by-Step Implementation Order

1. **Workspace & Security Hygiene**:
   - Create `.gitignore` and `.env.example` (with `"VALUES"` placeholders; never reading or modifying `.env`).
   - Update `tsconfig.json` (`"types": ["node"]`, `include: ["src/**/*.ts", "tests/**/*.ts"]`) and `package.json` scripts (`cli`, `assignments:list`, `assignments:due`, `lessons:list`, `quiz:inspect`, `quiz:scan`, `quiz:draft`, `monitor`, `typecheck`, `test`).
2. **Shared Types (`src/types/`)**:
   - Create `http.types.ts`, `lms.types.ts`, `quiz.types.ts`, `cli.types.ts`, and `index.ts`.
3. **Core Infrastructure (`src/core/`)**:
   - Implement `config.ts`, `sanitizer.ts`, `cookie-jar.ts`, `lms-urls.ts`, and `http-client.ts` (including `/finish/` transport block and sanitized trace collection).
4. **Cheerio Parsers (`src/parsers/`)**:
   - Implement `shared.ts`, `assignments.parser.ts`, `lessons.parser.ts`, unified `quiz.parser.ts`, `generic.parser.ts`, and `index.ts`.
5. **Arabic Markdown Exporters (`src/exporters/`)**:
   - Implement `markdown-helpers.ts`, `markdown-writer.ts`, `assignments.exporter.ts`, `lessons.exporter.ts`, `quiz.exporter.ts`, and `monitor.exporter.ts`.
6. **CLI Commands & Entrypoint (`src/commands/` & `src/cli.ts`)**:
   - Implement `assignments.command.ts`, `lessons.command.ts`, `quiz.command.ts`, `monitor.command.ts`, and unified `src/cli.ts`.
   - Cleanly remove superseded flat files (`src/http_logger.ts`, `src/monitor.ts`, `src/parsers.ts`, `src/quiz_inspector.ts`, `src/scan_due_quizzes.ts`).
7. **Documentation (`docs/architecture.md`, `AGENTS.md`, `CLAUDE.md`)**:
   - Write comprehensive architecture documentation and agent guidelines.
8. **Offline Unit Tests & Verification (`tests/`)**:
   - Add offline unit tests for secret sanitization (`"VALUES"`), HTML parsers (assignments, lessons, quiz question types including `answer[1]` / `answer[...]` bracketed fields, rich-text editor & file upload detection, and quiz summary), fast-scan Arabic Markdown question cards in `quiz.exporter.ts`, and `/finish/` safety blocking.
   - Run `npm run typecheck`, `npm test`, and `npx tsx src/cli.ts --help` (plus subcommand `--help` checks) to verify everything compiles and passes cleanly.

---

## 4. Key Engineering Guardrails

- **Strict TypeScript Compiler Flags**: Respect `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, and `verbatimModuleSyntax: true` across all modules (`import type` where appropriate and `.js` relative import specifiers).
- **Zero Accidental Quiz Consumption or Submission**: Every default path in `quiz inspect` and `quiz scan` uses `GET` only and skips unstarted attempts unless `--start-new` is passed; `quiz draft` defaults to `--dry-run` unless `--apply` is passed; and `LmsHttpClient` blocks `/student_take_quiz_assignment/finish/` unconditionally.
- **RTL Markdown Readability**: Escape pipe characters (`|`) and normalize multi-line prompts in Markdown tables so Arabic reports render cleanly in VS Code, Obsidian, and GitHub Markdown viewers.

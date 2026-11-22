# AGENTS.md — Qatar Education Monitor (`qatar-edu-monitor`)

Guidelines and operational rules for AI coding agents and developers working in this repository.

---

## 1. Project Overview

`qatar-edu-monitor` is a modular TypeScript / Node.js (ESM) CLI tool for inspecting and monitoring the Qatar Education LMS (`https://qeducation.edu.gov.qa`).

It provides:
- Read-only inspection of assignments, due quizzes, lessons, and lesson sections.
- Deep quiz inspection (`quiz inspect`, `quiz scan`) across all question parts via `GET` requests.
- Safe draft-saving flow (`quiz draft`) that defaults to dry-run, pauses attempts via `/pause/`, and hard-blocks `/finish/`.
- Sanitized HTTP request/response monitoring (`monitor`) with strict secret masking.
- Automated Arabic (`العربية`) Markdown reports generated under `reports/<command>/`.

---

## 2. Technology Stack & Commands

- **Runtime**: Node.js (v22+), TypeScript (strict mode), ESM (`"type": "module"`).
- **Key Libraries**: `cheerio` (HTML parsing), `dotenv` (environment variables).
- **CLI Argument Parsing**: Built-in `node:util` `parseArgs` (zero external CLI dependencies).

### Common Commands
```bash
# Unified CLI entrypoint
npx tsx src/cli.ts --help
npx tsx src/cli.ts assignments --help
npx tsx src/cli.ts quiz --help

# Shortcut npm scripts (pass --class-id <id> or --url <url> as needed)
npm run assignments:list -- --class-id <your-class-id>
npm run assignments:due -- --class-id <your-class-id>
npm run lessons:list -- --class-id <your-class-id>
npm run quiz:inspect -- <url-or-id>
npm run quiz:scan -- --class-id <your-class-id>
npm run quiz:draft -- <display-url>
npm run monitor

# Verification & Quality Checks
npm run typecheck      # Run tsc --noEmit (must pass with 0 errors)
npm test               # Run offline unit tests (node:test + tsx)
npm run build          # Compile TypeScript to dist/
```

---

## 3. Architecture & Directory Map

```text
src/
├── cli.ts                  # Single CLI entrypoint & subcommand router
├── types/                  # Shared domain & HTTP interfaces
│   ├── http.types.ts
│   ├── lms.types.ts
│   ├── quiz.types.ts
│   └── cli.types.ts
├── core/                   # Infrastructure primitives (HTTP, cookies, sanitizer, URLs)
│   ├── config.ts           # Env config (LMS_BASE_URL, LMS_CLASS_ID, LMS_COOKIE)
│   ├── sanitizer.ts        # Central "VALUES" redaction engine
│   ├── cookie-jar.ts       # SessionCookieJar (in-memory cookie session)
│   ├── lms-urls.ts         # URL builders & endpoint detectors (incl. isQuizFinishUrl)
│   └── http-client.ts      # LmsHttpClient (GET/POST, manual redirects, /finish/ block, traces)
├── parsers/                # Pure Cheerio HTML parsers (zero side effects)
│   ├── shared.ts
│   ├── assignments.parser.ts
│   ├── lessons.parser.ts
│   ├── quiz.parser.ts      # Unified quiz show, init_quiz, & question/summary screen parser
│   └── generic.parser.ts
├── exporters/              # Arabic Markdown report generators & file writer
│   ├── markdown-helpers.ts
│   ├── markdown-writer.ts  # Writes timestamped file + latest.md in reports/<command>/
│   ├── assignments.exporter.ts
│   ├── lessons.exporter.ts
│   ├── quiz.exporter.ts    # Fast-scan question cards (prompt, points, type, capabilities, choices/answers)
│   └── monitor.exporter.ts
└── commands/               # CLI subcommand orchestrators
    ├── assignments.command.ts
    ├── lessons.command.ts
    ├── quiz.command.ts     # inspect, scan, draft
    └── monitor.command.ts

tests/                      # Offline unit tests (node:test)
├── sanitizer.test.ts
├── parsers.test.ts
└── exporters-and-guards.test.ts

docs/
└── architecture.md         # Full architectural deep-dive
reports/                    # Generated Arabic Markdown reports (gitignored)
```

---

## 4. Critical Safety & Security Rules (NON-NEGOTIABLE)

1. **Never Expose Secrets or Tokens**:
   - **NEVER** read, print, log, commit, or display real values from `.env` (`LMS_COOKIE`, session tokens, CSRF tokens).
   - All sensitive keys (`cookie`, `token`, `csrf`, `auth`, `session`, `password`, `secret`) MUST be sanitized to `"VALUES"` in console logs, HTTP traces, and Markdown reports via `src/core/sanitizer.ts`.
   - `.env` is gitignored. Use `.env.example` with `"VALUES"` placeholders.
2. **Read-Only Default (`GET` Only)**:
   - `assignments`, `lessons`, `quiz inspect`, `quiz scan`, and `monitor` must never issue `POST` requests.
   - New quiz attempts are skipped by default; never start an attempt unless the user explicitly passes `--start-new`.
3. **Quiz Submission & Draft Safety**:
   - `quiz draft` MUST default to **dry-run** mode (`POST` is only allowed when `--apply` is passed).
   - Draft execution MUST pause via `/student_take_quiz_assignment/pause/...` so the attempt stays resumable in the browser.
   - **`/student_take_quiz_assignment/finish/` is strictly forbidden**. `LmsHttpClient` blocks this endpoint unconditionally at the transport layer. Never attempt to bypass this guard.
   - Timed quizzes (`timed_quiz: true`) must abort unless `--allow-timed` is explicitly passed.

---

## 5. TypeScript & Coding Conventions

- **Strict TypeScript**:
  - `tsconfig.json` enables `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, and `module: "nodenext"`.
  - Use `.js` extensions in relative imports (e.g., `import { LmsHttpClient } from "../core/http-client.js"`).
  - Use `import type { ... }` when importing only interfaces or types.
- **Cheerio Parser Rules**:
  - Parsers in `src/parsers/` must be pure functions accepting HTML strings and returning typed objects.
  - In Cheerio `.each()` callbacks, always narrow `el.type === "tag"` before accessing `el.tagName`.
  - When matching answer inputs, handle both `name="answer"` and bracketed/indexed names (`name="answer[1]"`, `name="answer[...]"`).
- **Arabic Markdown Formatting**:
  - All generated Markdown content must be in Arabic (`العربية`).
  - Escape pipe characters (`|`) and normalize multi-line strings in table cells using `escapeMarkdownCell()`.
  - Quiz reports must present each question with: question prompt, score/points, Arabic question type, text/editor/file-upload capability badges, and choices or current answers.

---

## 6. Extending the Codebase

### Adding a New LMS Entity or Command
1. Add domain types in `src/types/lms.types.ts` or `src/types/quiz.types.ts`.
2. Add a Cheerio parser in `src/parsers/<entity>.parser.ts`.
3. Add an Arabic Markdown exporter in `src/exporters/<entity>.exporter.ts`.
4. Add the orchestrator in `src/commands/<entity>.command.ts`.
5. Register subcommand flags and routing in `src/cli.ts`.

### Adding a New Quiz Question Type
1. Extend `QuizInputType` in `src/types/quiz.types.ts`.
2. Update selector matching and classification in `src/parsers/quiz.parser.ts`.
3. Add the localized Arabic label in `getQuestionTypeLabelAr()` in `src/exporters/quiz.exporter.ts`.
4. Add test coverage in `tests/parsers.test.ts`.

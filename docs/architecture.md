# Qatar Education Monitor — System Architecture & Engineering Guide

This document describes the architecture, data flow, session/cookie lifecycle, Cheerio parsing strategy, safety guardrails, and extension guide for `qatar-edu-monitor`.

---

## 1. Architectural Overview

`qatar-edu-monitor` is a modular TypeScript / Node.js (ESM) CLI application designed to interact safely with the Qatar Education LMS (`https://qeducation.edu.gov.qa`).

The codebase is organized into clean, unidirectional layers so that HTTP transport, HTML parsing, domain modeling, report generation, and CLI argument handling remain completely decoupled:

```text
┌─────────────────────────────────────────────────────────────┐
│ CLI Entrypoint (src/cli.ts)                                 │
│ - Parses subcommands & flags via node:util parseArgs        │
│ - Builds CommandContext (baseUrl, classId, cookie, reports) │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Command Handlers (src/commands/)                            │
│ - assignments.command.ts  (list, due)                       │
│ - lessons.command.ts      (list)                            │
│ - quiz.command.ts         (inspect, scan, draft)            │
│ - monitor.command.ts      (monitor)                         │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ Parsers (src/parsers/)       │   │ Exporters (src/exporters/)   │
│ - Cheerio HTML -> Types      │   │ - Arabic Markdown reports    │
│ - Pure, synchronous, testable│   │ - reports/<cmd>/latest.md    │
└──────────────┬───────────────┘   └──────────────▲───────────────┘
               │                                  │
               ▼                                  │
┌─────────────────────────────────────────────────────────────┐
│ Core Infrastructure (src/core/)                             │
│ - http-client.ts  (LmsHttpClient, /finish/ block, traces)   │
│ - cookie-jar.ts   (SessionCookieJar)                        │
│ - sanitizer.ts    ("VALUES" redaction)                      │
│ - lms-urls.ts     (Route builders & detectors)               │
│ - config.ts       (Env config loader)                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
                     Qatar Education LMS (HTTP/HTTPS)
```

### Layer Responsibilities
- **`src/types/`**: Shared TypeScript interfaces and domain models (`ParsedAssignment`, `ParsedLesson`, `ParsedQuizScreen`, `SanitizedHttpTrace`, CLI options). Strictly compatible with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`.
- **`src/core/`**: Infrastructure primitives. Owns HTTP session state, cookie jar updates, secret sanitization, URL generation, and transport-level safety blocks.
- **`src/parsers/`**: Pure functions that accept HTML strings and return strongly typed domain models using Cheerio. Zero side effects or network calls.
- **`src/exporters/`**: Formats typed domain models into clean Arabic (`العربية`) Markdown files and persists timestamped reports plus `latest.md` under `reports/<command>/`.
- **`src/commands/`**: Orchestrates workflow for each CLI command: calls `LmsHttpClient`, feeds HTML into parsers, accumulates domain results, invokes exporters, and logs sanitized console summaries.
- **`src/cli.ts`**: Single entrypoint that routes subcommands and parses CLI flags.

---

## 2. Session, Cookie & HTTP Data Flow

1. **Initialization**:
   - `loadAppConfig()` reads `LMS_BASE_URL`, `LMS_CLASS_ID`, and `LMS_COOKIE` from environment variables (via `dotenv/config`). If `LMS_COOKIE` is unset or `"VALUES"`, the session starts empty.
   - A single `SessionCookieJar` instance is owned by `LmsHttpClient` for the entire duration of a CLI command.
2. **Request Execution (`LmsHttpClient.request`)**:
   - Resolves relative or absolute paths against `baseUrl`.
   - Checks `isQuizFinishUrl(pathOrUrl)`: if the URL targets `/student_take_quiz_assignment/finish/`, it throws an immediate error **before** issuing any network request.
   - Constructs standard browser-like headers (`User-Agent`, `Accept`, `Accept-Language`, `Referer`, `Origin`, `Cookie: cookieJar.toCookieHeader()`).
   - For `POST` requests, serializes `formFields` as `application/x-www-form-urlencoded` or `multipart/form-data` and attaches `X-CSRF-Token` if provided.
   - Uses `redirect: "manual"` so callers can inspect `3xx` responses and `Location` headers explicitly.
3. **Response Handling & Cookie Ingestion**:
   - Reads `Set-Cookie` headers via `response.headers.getSetCookie()`.
   - Updates `SessionCookieJar` in memory and records only the updated cookie **names** (never values).
   - Detects response kind (`Redirect`, `JSON`, `HTML`, `Other`) from status code and `Content-Type`.
   - Captures a `SanitizedHttpTrace` entry with all sensitive keys masked to `"VALUES"`.
4. **Sanitization Guarantee**:
   - Cookie headers are never printed or logged; only `"VALUES (loaded)"` or `"VALUES (empty)"` is displayed.
   - Form fields and URL parameters containing `token`, `csrf`, `auth`, `cookie`, `session`, `password`, or `secret` are masked before console output, trace storage, or Markdown export.

---

## 3. Cheerio Parsing Strategy

Parsers in `src/parsers/` operate on HTML strings without making network requests:

- **`assignments.parser.ts`**:
  - Scans `#mainContent` (and fallback document root) for anchors matching `_assignment/show/`.
  - Classifies items into `quiz`, `offline`, or `other` based on path segments.
  - Extracts numeric `assignmentId` via regex `/student_(?:quiz|offline)_assignment/show/(\d+)/`.
  - Attempts to locate a nearby lesson link (`/student_lesson/show/`) within the closest container (`tr`, `li`, `div`) to link related lessons.
  - Deduplicates results by `href`.

- **`lessons.parser.ts`**:
  - Scans for `/student_lesson/show/` anchors.
  - Extracts `lesson_id`, `section_id`, and `class_id` query parameters or path segments.
  - Groups sections under their parent lesson in a `Map` keyed by `${classId}:${lessonId}`.
  - Cleans lesson titles starting with "ابدأ الدرس ..." by stripping numbering and date prefixes.

- **`quiz.parser.ts`**:
  - **`parseQuizShowPage(html)`**: Extracts quiz title, CSRF meta token, primary action button text/href, resume detection (`results=` or "استئناف"), and sidebar details.
  - **`parseInitQuizConfig(html)`**: Extracts `init_quiz({...})` JavaScript configuration block (`quiz_id`, `results_id`, `part`, `parts`, `timed_quiz`, `time_left`, `resume_refresh`).
  - **`parseQuizScreen(html)`**:
    - **Summary screen detection**: Identifies `form[action*="/finish/"]` or Arabic summary headings (`نهاية الاختبار`), parsing `.materialStyle` blocks into `summaryItems`.
    - **Question screen parsing**:
      - Collects hidden form inputs (`hiddenFields`), including `authenticity_token`.
      - Scans `#question_form` for all input, textarea, and select fields (`fieldDetails`, `formFieldNames`).
      - **Plain and bracketed/array answer field matching**: Recognizes both `name="answer"` and indexed variants `name="answer[1]"`, `name="answer[]"`, `name="answer[...]"` across radio inputs, checkboxes, text inputs, textareas, and `<select>` dropdowns. This prevents fillable or selectable multi-part questions from being misclassified as `unknown`.
      - Detects input capabilities: `hasPlainTextInput`, `hasRichTextEditor` (CKEditor/WYSIWYG classes or containers), `hasFileUpload`, and `fileInputNames`.
      - Extracts choices for single-choice (`radio`) and multiple-choice (`checkbox`) questions, preserving checked states and associated labels.
      - Extracts `currentTextAnswer` and `structuredAnswers` (keyed by field name, including `answer[1]`, etc.).
      - Extracts question images (`imageUrls`) and points badge (`points`).

- **`generic.parser.ts`**:
  - Used by `monitor` mode to extract page title, main heading, sample DOM elements, and auto-detect whether the page is an assignments list, lessons list, quiz show page, or active quiz question screen.

---

## 4. Quiz Safety Guardrails

The system enforces four independent layers of protection to prevent accidental quiz attempt consumption or submission:

1. **Read-Only Default (`quiz inspect` & `quiz scan`)**:
   - Both commands issue **only `GET` requests**.
   - Unstarted quizzes (where `isResumeAttempt` is false and `--start-new` is not passed) are skipped immediately without sending any request to start an attempt.
2. **`--start-new` Explicit Opt-In**:
   - To inspect questions of a brand-new attempt that has never been opened, the user must explicitly pass `--start-new`.
3. **Draft Dry-Run Default & Timed Quiz Protection (`quiz draft`)**:
   - Without `--apply`, `quiz draft` operates strictly in **dry-run mode**: it fetches the first question via `GET`, parses the form, and previews what payload would be sent without issuing any `POST`.
   - If `init_quiz` indicates `timed_quiz: true`, execution aborts immediately unless `--allow-timed` is explicitly provided.
   - When `--apply` is passed, draft answers are submitted via `POST` with `destination: "next"`, followed by a `POST` to `/student_take_quiz_assignment/pause/<quizId>?results=<resultsId>` so the attempt remains paused and resumable in the browser.
4. **Hard Transport-Level `/finish/` Block (`LmsHttpClient`)**:
   - `LmsHttpClient.request()` checks every outgoing URL with `isQuizFinishUrl()`.
   - If a URL contains `/student_take_quiz_assignment/finish/`, the client throws an error before any network packet is sent. Quiz final submission is structurally impossible.

---

## 5. Arabic Markdown Reporting (`العربية`)

Every command that produces structured data generates an Arabic-language Markdown report:

- **Directory Convention**:
  - Reports are saved under `reports/<command-folder>/` (e.g., `reports/quiz-inspect/`, `reports/quiz-scan/`, `reports/assignments-due/`).
  - Each run creates a timestamped file `YYYY-MM-DD_HH-mm-ss.md` (or `<slug>_YYYY-MM-DD_HH-mm-ss.md`) and updates `latest.md` in the same folder.
- **Fast-Scan Question Cards in Quiz Reports**:
  - Each question in `quiz inspect`, `quiz scan`, and `quiz draft` reports is formatted as a dedicated section containing:
    1. **Question Prompt**: Full question text and attached image links.
    2. **Score / Points**: Question grade badge.
    3. **Question Type (Arabic)**: Single-choice, multiple-choice, free-text, structured multi-field, or file-upload.
    4. **Input Capabilities**: Whether plain text, rich text editor, and/or file attachments are supported (including file input field names).
    5. **Options & Current Answer**: Choices table marking the currently selected option, or current/saved text and indexed answers (`answer`, `answer[1]`, etc.).
- **Secret Redaction in Reports**:
  - All cookies, CSRF tokens, authenticity tokens, and sensitive fields are formatted as `"VALUES"`.

---

## 6. Extensibility Guide

### Adding a New LMS Page or Command
1. **Define Types**: Add interfaces in `src/types/lms.types.ts` or `src/types/quiz.types.ts`.
2. **Create Parser**: Add a pure Cheerio parser in `src/parsers/<name>.parser.ts` and export it from `src/parsers/index.ts`.
3. **Create Exporter**: Add an Arabic Markdown renderer in `src/exporters/<name>.exporter.ts`.
4. **Create Command Handler**: Add orchestration logic in `src/commands/<name>.command.ts`.
5. **Wire CLI**: Register the subcommand and flags in `src/cli.ts`.

### Adding a New Quiz Question Type
1. Update `QuizInputType` in `src/types/quiz.types.ts`.
2. Update detection and classification logic in `src/parsers/quiz.parser.ts` (`parseQuizScreen`).
3. Add the Arabic label in `getQuestionTypeLabelAr()` in `src/exporters/quiz.exporter.ts`.
4. Add unit test fixtures in `tests/parsers.test.ts`.

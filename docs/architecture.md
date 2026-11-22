# Qatar Education Monitor — System Architecture & Engineering Guide

This document describes the architecture, data flow, session/cookie lifecycle, Cheerio parsing strategy, safety guardrails, and extension guide for `qatar-edu-monitor`.

---

## 1. Architectural Overview

`qatar-edu-monitor` is a modular TypeScript / Node.js (ESM) CLI application designed to interact safely with the Qatar Education LMS (`https://qeducation.edu.gov.qa`).

The codebase is organized into clean, unidirectional layers so that HTTP transport, HTML parsing, domain modeling, report generation, and CLI argument handling remain completely decoupled:

```text
┌─────────────────────────────────────────────────────────────┐
│ CLI Layer (src/cli.ts + src/cli/)                           │
│ - cli.ts: thin router dispatching to handlers               │
│ - cli/flags.ts: parseArgs option schemas & helpers          │
│ - cli/handlers.ts: per-command orchestration entry points   │
│ - cli/help.ts: usage & help text                            │
│ - Builds CommandContext (baseUrl, classId, cookie, LLM,     │
│   reports) from env + flags                                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Command Handlers (src/commands/)                            │
│ - assignments.command.ts  (list, due)                       │
│ - lessons.command.ts      (list)                            │
│ - quiz.command.ts         (inspect, scan, draft, solve)     │
│ - monitor.command.ts      (monitor)                         │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ Services (src/services/)     │   │ Exporters (src/exporters/)   │
│ - quiz-inspector.service     │   │ - Arabic Markdown reports    │
│ - quiz-form.mapper           │   │ - reports/<cmd>/latest.md    │
│ - quiz-solver.service        │   └──────────────▲───────────────┘
└──────────────┬───────────────┘                  │
               │                                  │
               ▼                                  │
┌──────────────────────────────┐   ┌───────────────┴──────────────┐
│ LLM Layer (src/llm/)         │   │ Parsers (src/parsers/)       │
│ - adapters/ (gemini, openai, │   │ - Cheerio HTML -> Types      │
│   anthropic, mock)           │   │ - Pure, synchronous          │
│ - prompt-builder, validator, │   └──────────────┬───────────────┘
│   language-detector, retry   │                  │
└──────────────┬───────────────┘                  │
               │                                  │
               └──────────────┬───────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Core Infrastructure (src/core/)                             │
│ - http-client.ts  (LmsHttpClient, /finish/ block, traces,   │
│   fetchBinary for question images)                          │
│ - cookie-jar.ts   (SessionCookieJar)                        │
│ - sanitizer.ts    ("VALUES" redaction)                      │
│ - lms-urls.ts     (Route builders & detectors)               │
│ - config.ts       (Env config loader, LLM provider config)  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
              Qatar Education LMS + LLM Provider APIs
```

### Layer Responsibilities
- **`src/types/`**: Shared TypeScript interfaces and domain models (`ParsedAssignment`, `ParsedLesson`, `ParsedQuizScreen`, `SanitizedHttpTrace`, `LlmProvider`, CLI options). Strictly compatible with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`.
- **`src/core/`**: Infrastructure primitives. Owns HTTP session state, cookie jar updates, multi-value & multipart `Blob` file serialization, binary image fetching, secret sanitization, URL generation, and transport-level safety blocks.
- **`src/parsers/`**: Pure functions that accept HTML strings and return strongly typed domain models using Cheerio (including choice `fieldName`, `<select>` `{ value, label }`, and inline `[BLANK]` context snippets). Zero side effects or network calls.
- **`src/llm/`**: Pluggable **Ports & Adapters** AI solver layer (`GeminiLlmAdapter`, `OpenAiCompatibleLlmAdapter`, `AnthropicLlmAdapter`, `MockLlmAdapter`), subject/question Arabic-vs-English language detection (`language-detector.ts`), structured JSON prompt construction, and DOM-grounded answer validation.
- **`src/services/`**: Domain workflow orchestrators (`quiz-inspector.service.ts`, `quiz-form.mapper.ts`, `quiz-solver.service.ts`) decoupled from CLI flags and report files.
- **`src/exporters/`**: Formats typed domain models into clean Arabic (`العربية`) Markdown files and persists timestamped reports plus `latest.md` under `reports/<command>/`.
- **`src/commands/`**: Thin CLI controllers that wire `CommandContext` to services and exporters.
- **`src/cli.ts` + `src/cli/`**: Thin entrypoint (`cli.ts`) that routes top-level commands to handlers in `src/cli/handlers.ts`. Flag schemas live in `src/cli/flags.ts` (shared `parseArgs` option constants + `str`/`flag`/`createContext` helpers), and all usage/help text lives in `src/cli/help.ts`.

---

## 2. Session, Cookie & HTTP Data Flow

1. **Initialization**:
   - `loadAppConfig()` reads `LMS_BASE_URL` (required — throws if missing or still a `<placeholder>`), `LMS_CLASS_ID`, `LMS_COOKIE`, `REPORTS_DIR`, and the `LLM_*` variables (`LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_FALLBACK_MODELS`) from environment variables via `dotenv/config`. If `LMS_COOKIE` is unset or `"VALUES"`, the session starts empty.
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

The system enforces independent layers of protection to prevent accidental quiz attempt consumption or submission:

1. **Read-Only Default (`quiz inspect`, `quiz scan`, `quiz solve` dry-run, `monitor`)**:
   - These commands issue **only `GET` requests** by default. `quiz solve` without `--apply`/`--submit` fetches every part read-only, solves via the LLM, and only previews the mapped form payloads — zero `POST`s.
   - Unstarted quizzes (where `isResumeAttempt` is false and `--start-new` is not passed) are skipped immediately without sending any request to start an attempt.
2. **`--start-new` Explicit Opt-In**:
   - To inspect or solve questions of a brand-new attempt that has never been opened, the user must explicitly pass `--start-new`.
3. **Draft Dry-Run Default & Timed Quiz Protection (`quiz draft`, `quiz solve`)**:
   - Without `--apply`, `quiz draft`/`quiz solve` operate strictly in **dry-run mode**.
   - If `init_quiz` indicates `timed_quiz: true`, execution aborts immediately unless `--allow-timed` is explicitly provided.
   - When `--apply` is passed, answers are submitted via `POST` with `destination: "next"` per part, followed by a `POST` to `/student_take_quiz_assignment/pause/<quizId>?results=<resultsId>` so the attempt remains paused and resumable in the browser.
   - `quiz solve --submit` additionally walks to the summary screen and verifies completeness before pausing — it still never calls `/finish/`.
4. **Hard Transport-Level `/finish/` Block (`LmsHttpClient`)**:
   - `LmsHttpClient.request()` checks every outgoing URL with `isQuizFinishUrl()`.
   - If a URL contains `/student_take_quiz_assignment/finish/`, the client throws an error before any network packet is sent. Quiz final submission is structurally impossible.

### `quiz solve` Workflow (`src/services/quiz-solver.service.ts`)

1. `resolveActiveQuizEntry` resolves the target (show URL / display URL / quiz ID) into an active attempt (`quizId`, `resultsId`, `initConfig`).
2. **Dry-run**: `fetchAllQuizPartsReadOnly` GETs every part; each question screen is parsed, images are fetched inline via `fetchBinary` (max 4), `detectAnswerLanguage` picks `ar`/`en`, the LLM provider returns a structured JSON answer, `validateAndNormalizeLlmAnswer` checks it against the DOM schema (one self-correction retry), and `mapAnswerToFormPayload` renders the LMS form fields — all previewed, nothing POSTed.
3. **Apply/Submit**: parts are solved and POSTed sequentially (each POST returns the next question page + fresh CSRF token). If the attempt is parked on the summary screen with unanswered parts, the solver **rewinds to `part=1`** and fills them. On completion it reaches the summary screen, `verifySummaryScreenCompleteness` checks every item has a recorded answer (treating `لا يوجد`, `(غير محدد)`, `none`, and empty as unanswered), then `/pause/` is called. Any mid-run error triggers an **emergency pause** before rethrowing.
4. **LLM resilience**: adapters retry transient `503`/`429`/`5xx` with exponential backoff (`src/llm/http-retry.ts`) and fall back through `LLM_FALLBACK_MODELS` (or provider defaults) on model-unavailable responses; the last successful model is remembered for subsequent questions.

---

## 5. Arabic Markdown Reporting (`العربية`)

Every command that produces structured data generates an Arabic-language Markdown report:

- **Directory Convention**:
  - Reports are saved under `reports/<command-folder>/` (e.g., `reports/quiz-inspect/`, `reports/quiz-scan/`, `reports/assignments-due/`).
  - Each run creates a timestamped file `YYYY-MM-DD_HH-mm-ss.md` (or `<slug>_YYYY-MM-DD_HH-mm-ss.md`) and updates `latest.md` in the same folder.
- **Fast-Scan Question Cards in Quiz Reports**:
  - Each question in `quiz inspect`, `quiz scan`, `quiz draft`, and `quiz solve` reports is formatted as a dedicated section containing:
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
5. **Wire CLI**: Add a handler in `src/cli/handlers.ts`, register flag options in `src/cli/flags.ts`, add help text in `src/cli/help.ts`, and route the command in `src/cli.ts`.

### Adding a New LLM Provider
1. Implement the `LlmProvider` interface (`solveQuestion`) in `src/llm/adapters/<name>.adapter.ts` (reuse `buildQuestionPrompts`, `validateAndNormalizeLlmAnswer`, `fetchWithTransientRetry`).
2. Register it in `src/llm/registry.ts` and `normalizeProviderName` in `src/core/config.ts`.
3. Add its API-key env mapping and default model in `getDefaultModelForProvider` / `loadAppConfig`.
4. Add unit tests with a mocked `fetchImpl` in `tests/llm-and-mapper.test.ts`.

### Adding a New Quiz Question Type
1. Update `QuizInputType` in `src/types/quiz.types.ts`.
2. Update detection and classification logic in `src/parsers/quiz.parser.ts` (`parseQuizScreen`).
3. Add the Arabic label in `getQuestionTypeLabelAr()` in `src/exporters/quiz.exporter.ts`.
4. Extend `validateAndNormalizeLlmAnswer` / `mapAnswerToFormPayload` in `src/llm/` and `src/services/` if the LLM answer shape changes.
5. Add unit test fixtures in `tests/parsers.test.ts`.

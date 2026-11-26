# Product Requirements Document (PRD): Hallili

- **Status:** Approved Draft — Ready for System Design
- **Version:** `v0.1` (Core MVP)
- **Target Audience:** Public School Students in Qatar

---

## 1. Problem Statement & Context

Public school students in Qatar manage daily assessments and homework across 8 or more subjects alongside regular studying and extracurricular commitments. Solving every assessment manually—or copying questions one by one into AI chat interfaces—is time-consuming and error-prone, especially for multi-step questions or assessments lacking lesson context.

**Hallili** provides a centralized platform that aggregates a student's subjects and due assessments, generates draft answers asynchronously in the background using AI, and allows the student to review, edit, and explicitly approve final submissions in a fraction of the time required for manual work.

---

## 2. Success Metrics

### Product Goals

- Enable students to connect their LMS session, view all enrolled subjects and due assessments, and generate reviewable draft solutions in one place.
- Significantly reduce the daily time spent preparing and reviewing assessments compared to manual solving.
- Deliver a reliable background workflow that lets students monitor progress or close the browser entirely without losing work.

### Engineering Metrics

- **Job Enqueue Latency:** Schedule a background solving job and return an initial status response in **less than 300 ms**.
- **Background Solving Time:** Complete draft generation and saving for a 10-question assessment in **less than 45 seconds** (accounting for LLM response latency and rate-limit retries).
- **Extraction Reliability:** Achieve at least a **98% success rate** when parsing subjects, due assessments, and question structures from the LMS pages.

---

## 3. Non-Goals & Rabbit Holes

### Non-Goals (`v0.1`)

- **Browser Extension (Chrome / Firefox):** Excluded from `v0.1`. Users will input and update session cookies manually through the web UI; an extension will be evaluated for a later release (`v0.2+`).
- **Native Mobile App:** Out of scope for `v0.1` (responsive web application only).
- **Lesson & File Context Sync (`PDF` / `PPTX` / Lesson Pages):** Deferred to `v0.3` so the core web platform and background job engine can ship without delay.

### Rabbit Holes

- **Running a Full Headless Browser per Request:** Launching a headless browser for every page request will exhaust server memory and CPU, whereas the target LMS relies primarily on server-rendered HTML (`SSR`). The default approach must be direct HTTP fetching and HTML parsing, restricting any browser automation to a narrow, isolated scope if ever required.

---

## 4. User Stories & Acceptance Criteria

### Story 1: Connecting an Account & Generating Background Drafts

- **Story:** As a student, I want to connect my LMS session and select one or more due assessments so the system solves them as drafts in the background without submitting them, allowing me to close the site and check progress later.
- **Acceptance Criteria:**
- **Given:** I am logged into Hallili, have available quota for assessments/questions, and have linked a valid LMS session cookie.
- **When:** I browse my due assessments and select one or multiple assessments to solve as drafts.
- **Then:** The system creates asynchronous background jobs that start immediately, continue running even if I close my browser, and automatically reflect updated progress and draft results when I view or return to the dashboard.

### Story 2: Reviewing, Editing, & Approving Final Submission

- **Story:** As a student, I want to clearly review the AI-generated draft answer for each question, edit any answer I wish to change, and manually confirm the final submission myself.
- **Acceptance Criteria:**
- **Given:** A background solving job has completed and draft answers are ready for review.
- **When:** I open the review screen, inspect the proposed answers, edit any responses as needed, and click the final submission confirmation button.
- **Then:** The system applies my edits, executes the final submission strictly upon my explicit confirmation, and clearly displays the completed assessment status.

### Story 3: Resuming a Paused Job

- **Story:** As a student, I want my solving job to pause safely when it hits a blocker (expired LMS cookie or a question requiring manual input) and resume from where it left off after I fix the blocker, without losing or duplicating already-solved answers.
- **Acceptance Criteria:**
- **Given:** A background solving job has entered the `paused` state (e.g., `SESSION_EXPIRED` after question 5, or `MANUAL_INPUT_REQUIRED` on a file-upload question) with previously solved answers persisted as drafts.
- **When:** I update my LMS session cookie in the UI (or answer the flagged question manually) and click "Resume" on the paused job.
- **Then:** The system returns the job to `running`, skips questions already solved, continues from the exact question where it paused, and re-evaluates the blocker before proceeding; final submission remains disabled throughout.

---

## 5. Functional Requirements

| ID        | Requirement                                 | Priority        | Behavioral Details                                                                                                                                                                                                                              |
| --------- | ------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-01** | **User Accounts & Session Auth**            | **Must-Have**   | Authenticate users via Microsoft using Better Auth, manage user sessions, and enforce plan-based usage quotas (e.g., daily/monthly assessment or question limits on the free tier).                                                             |
| **FR-02** | **LMS Session Cookie Management**           | **Must-Have**   | Allow users to manually input, update, or revoke their LMS session cookie (`lms_session_v1`) via the UI; store it encrypted (`AES-256-GCM`) as the user's default session, validate expiry, and persist rotated `Set-Cookie` headers.           |
| **FR-03** | **Subjects & Due Assessments View**         | **Must-Have**   | Fetch the student's enrolled subjects and display due assessments/quizzes per subject along with their current status (`Not Started`, `In Progress`, `Draft Ready`, `Submitted`).                                                               |
| **FR-04** | **Background AI Solving Engine**            | **Must-Have**   | Execute asynchronous solving jobs (`queued` to `running` to `completed` / `failed` / `paused`, with `paused` resumable back to `running` via an explicit Resume action) for one or multiple selected assessments, persisting across browser disconnects, with automatic `Retry` and `Fallback Model` switching on `429/503` errors. |
| **FR-05** | **Draft Saving & Safe Pause Guard**         | **Must-Have**   | Save solved answers strictly as drafts on the LMS and trigger a safe pause state once drafts are saved, keeping final submission completely disabled during background execution.                                                               |
| **FR-06** | **Job Progress & Live UI Updates**          | **Must-Have**   | Display real-time job progress (such as the current question index being solved) and update assessment statuses in the UI automatically without requiring manual full-page reloads.                                                             |
| **FR-07** | **Review, Edit, & Final Submission Screen** | **Must-Have**   | Display each question alongside its proposed answer, reasoning/justification, and confidence score, enabling the student to edit answers before explicitly triggering final submission from the UI.                                             |
| **FR-08** | **AI Model & Language Preferences**         | **Should-Have** | Default to server-managed AI configurations and keys, while allowing users to choose preferred models, supply a custom API key (BYOK), and set output language (`Auto`, `Arabic`, `English`).                                                   |
| **FR-09** | **Assessment History & Logs**               | **Should-Have** | Maintain a historical log of solved and submitted assessments with timestamps and review details for future reference.                                                                                                                          |
| **FR-10** | **Completion Notifications**                | **Could-Have**  | Send an in-app notification (or email/webhook alert) when a background solving job finishes.                                                                                                                                                    |

---

## 6. Non-Functional Requirements

- **Performance & Responsiveness:**
- Job creation (`POST /api/jobs/solve`) and status polling endpoints must respond in **less than 300 ms**, never blocking an HTTP request on LLM inference.
- Fetching and parsing a single subject or question page must not exceed **5 seconds** before triggering a timeout and safe retry.

- **Concurrency & Job Isolation:**
- Process jobs across multiple users concurrently in the background worker, while enforcing **strictly sequential execution per quiz attempt** to preserve question ordering, `lms_session_v1` rotation, and `authenticity_token` validity.
- Ensure slow LLM responses for one user never degrade web UI responsiveness or block other users' jobs.

- **Outbound LMS Traffic Control:**
- Enforce a **global outbound rate limit** on all requests to `qeducation.edu.gov.qa` (max requests per second, shared across all users' jobs) combined with **random jitter** on request timing, so simultaneous job launches (e.g., hundreds of students solving before a deadline) cannot trigger WAF/IP blocking of the server's egress address.

- **Reliability & Idempotency:**
- Prevent duplicate active jobs for the same `(user_id, quiz_id, results_id)` tuple by returning the existing job if it is already `queued`, `running`, or `paused`.
- On mid-job failure, trigger a `pause` state to protect the attempt and persist already-completed question drafts so resuming never duplicates work.

- **Security & Session Protection:**
- Encrypt stored LMS cookies at rest using `AES-256-GCM`, isolate cookie jars per execution (`SessionCookieJar`), and allow users to wipe their stored session data on demand.
- Redact all sensitive values (cookies, CSRF/authenticity tokens, and API keys) in logs, diagnostics, and error reports by replacing them with `"VALUES"`.
- Restrict all outbound LMS HTTP requests strictly to the official domain allowlist (`[https://qeducation.edu.gov.qa](https://qeducation.edu.gov.qa)`) to prevent unauthorized requests or `SSRF`.
- Prohibit the background worker from ever invoking the final submission endpoint; final submission must occur solely through a dedicated endpoint triggered by explicit user confirmation on the review screen.

---

## 7. Edge Cases & Failure Matrix

| Scenario / Failure State                                  | Expected System Behavior                                                                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LMS session cookie (`lms_session_v1`) expires**         | Detect login redirect or unauthorized response, halt the job with status `SESSION_EXPIRED`, and prompt the user to update their cookie in the UI.                                   |
| **AI provider rate limit or outage (`HTTP 429` / `503`)** | Apply `Exponential Backoff`, automatically switch to configured `Fallback Models`, and retain the last healthy model for remaining questions in the job.                            |
| **Question requires a file upload (`file upload`)**       | Skip automated solving for that question, flag it as `MANUAL_INPUT_REQUIRED`, and trigger a `pause` state so the student can upload the file manually via the review screen or LMS. |
| **User closes browser or loses internet mid-job**         | Background worker continues solving and saving drafts; upon reconnecting, the client reads the latest state from the database and displays ready drafts.                            |
| **Timed assessment detected (`timed_quiz: true`)**        | Block automated background execution unless the user explicitly enables the timed-quiz opt-in toggle after acknowledging a clear warning.                                           |
| **LMS HTML structure changes**                            | Never submit empty or guessed values; record `PARSER_MISMATCH`, pause the job to protect the attempt, and log sanitized diagnostics (`"VALUES"`).                                   |
| **Invalid LLM JSON or out-of-range DOM option**           | Reject the output in the `Validator` layer and trigger a constrained `Self-Correction Retry` bounded strictly to the valid option values extracted from the DOM.                    |
| **`lms_session_v1` updated via `Set-Cookie` mid-flow**    | Update the session cookie in memory during execution and re-encrypt/persist the latest cookie value to the database upon job completion or pause.                                   |

---

## 8. Resolved Decisions & Baseline Constraints (`v0.1`)

All open architectural questions for `v0.1` have been resolved and locked as baseline constraints for the System Design phase. These are recorded here as resolved, ADR-style decisions appropriate for a single-project scope; if the system later splits into multiple teams, they should be migrated into standalone Architecture Decision Records:

1.  **Background Job Queue (`Postgres + Drizzle`):** `v0.1` will implement a database-backed job queue using PostgreSQL (`SELECT ... FOR UPDATE SKIP LOCKED`) via Drizzle ORM to minimize infrastructure overhead. The queue interaction must be encapsulated behind a clean repository/service interface so it can be swapped for `BullMQ + Redis` in future versions without altering worker business logic.
2.  **Client State Synchronization (`Dynamic Polling`):** `v0.1` will use `TanStack Query` with a dynamic `refetchInterval` (active only while jobs are `queued` or `running`) rather than `Server-Sent Events (SSE)`, optimizing for faster delivery and simpler deployment.
3.  **Future Knowledge Source (`v0.3` Pre-Indexed Textbooks):** Context injection in `v0.3` will rely exclusively on pre-uploaded textbooks stored on the server and mapped to the student's grade/section metadata—completely avoiding automated scraping of LMS lesson pages or files.

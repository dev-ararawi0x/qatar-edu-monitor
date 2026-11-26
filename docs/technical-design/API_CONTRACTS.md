# Hallili — API & Contract Design

**Version:** v0.1  
**Status:** Proposed HTTP contract; review schemas and error semantics before implementation

## 1. Contract principles

1. **[SYSTEM-DESIGN]** TanStack Start Server Routes are the only browser-facing REST API implementation.
2. Use `/api/v1` for Hallili application endpoints so the external contract can evolve deliberately.
3. Better Auth owns its own auth routes below `/api/auth/*`; do not wrap or duplicate those endpoints.
4. Every request body, query, path parameter, and response DTO is validated at the boundary with Zod (or an equivalent runtime schema).
5. Route handlers remain thin: parse → authenticate → authorize → call Application use case → map result/error to HTTP.
6. Do not expose database row objects or internal domain entities directly to the browser.
7. Do not return cookies, CSRF/authenticity tokens, provider secrets, raw HTML, or unredacted external errors.
8. Use stable error codes; user-facing messages must be safe and actionable.
9. Long-running work returns quickly with `202 Accepted`; the request never waits for AI inference or a complete assessment workflow.
10. All endpoints scoped to a user enforce ownership at the Application layer, even if the UI already filters the resource.

## 2. Authentication and shared HTTP behavior

### Authentication

- Better Auth endpoints: `/api/auth/*`.
- All `/api/v1/*` routes except explicitly public health/status routes require an authenticated Better Auth session.
- Resolve the session on the server and create `ActorContext { userId }`.
- Never accept `userId` from request body as the authority for a user-owned operation.

Better Auth's current TanStack Start integration documentation mounts its handler on a TanStack Server Route (for example `/api/auth/$`) and documents its TanStack Start cookie integration. Match the exact pattern to the pinned versions during project setup. [Reference: Better Auth integration](https://better-auth.com/docs/integrations/tanstack)

### Common headers

| Header | Rule |
|---|---|
| `Content-Type` | `application/json` for JSON mutations |
| `Accept` | JSON expected for `/api/v1/*` |
| `Idempotency-Key` | Required for job creation; bounded length and safe character set |
| `X-Request-Id` | Optional client correlation value; server validates length/characters or generates its own request ID |
| `Origin` | Validate for cookie-authenticated state-changing requests; pair with CSRF protections appropriate to the auth setup |

### Common response envelope

Successful responses are endpoint-specific DTOs. Errors use one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "requestId": "req_...",
    "fieldErrors": {
      "someField": ["Invalid value."]
    }
  }
}
```

`fieldErrors` is optional. Never place raw exception messages, raw HTML, SQL details, provider response bodies, or secrets inside this object.

## 3. Error code catalogue

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `BAD_REQUEST` | Malformed request or invalid path/query representation |
| 400 | `VALIDATION_ERROR` | Request schema failed |
| 401 | `UNAUTHENTICATED` | No valid Hallili session |
| 403 | `FORBIDDEN` | Actor authenticated but policy does not permit operation |
| 404 | `NOT_FOUND` | Resource absent or not owned by actor; do not reveal another user's resource |
| 409 | `CONFLICT` | State transition or uniqueness conflict |
| 409 | `VERSION_CONFLICT` | Draft has changed since the submitted `expectedVersion` |
| 409 | `ACTIVE_JOB_EXISTS` | Existing active job returned or creation conflict handled |
| 422 | `QUOTA_EXCEEDED` | Requested work exceeds configured quota |
| 422 | `BLOCKER_NOT_RESOLVED` | Job cannot resume until its typed blocker is resolved |
| 422 | `POLICY_BLOCKED` | Policy gate blocks this operation, e.g. disallowed timed assessment |
| 429 | `RATE_LIMITED` | Hallili API rate limit reached; include safe retry guidance |
| 502 | `UPSTREAM_FAILURE` | External system returned an unusable response |
| 503 | `SERVICE_UNAVAILABLE` | Required dependency temporarily unavailable |
| 504 | `UPSTREAM_TIMEOUT` | External operation timed out |

Internal stable codes that may appear inside job status (not necessarily direct HTTP errors): `SESSION_EXPIRED`, `MANUAL_INPUT_REQUIRED`, `PARSER_MISMATCH`, `PROVIDER_RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `LMS_ACCESS_DENIED`, `AMBIGUOUS_REMOTE_WRITE`, `WORKER_LEASE_EXPIRED`, `POLICY_BLOCKED`.

## 4. Endpoint catalogue

The routes below are the proposed v0.1 contract. The final-submission route is intentionally omitted from the enabled contract.

| Method | Path | Purpose | Typical success |
|---|---|---|---:|
| `GET` | `/api/v1/lms-connection` | Read connection status only | 200 |
| `PUT` | `/api/v1/lms-connection` | Create/update credential | 204 |
| `POST` | `/api/v1/lms-connection/validate` | Validate stored connection | 200 |
| `DELETE` | `/api/v1/lms-connection` | Revoke and wipe stored credential | 204 |
| `GET` | `/api/v1/subjects` | List cached normalized subjects | 200 |
| `POST` | `/api/v1/subjects/refresh` | Refresh subject list through an approved read operation | 200 |
| `GET` | `/api/v1/subjects/:subjectId/assessments` | List due/known assessments for one subject | 200 |
| `POST` | `/api/v1/subjects/:subjectId/assessments/refresh` | Refresh one subject's assessment list | 200 |
| `POST` | `/api/v1/jobs/solve` | Create one or more asynchronous solve jobs | 202 |
| `GET` | `/api/v1/jobs` | List current user's jobs | 200 |
| `GET` | `/api/v1/jobs/:jobId` | Read sanitized job progress | 200 |
| `GET` | `/api/v1/jobs/:jobId/questions` | Read ordered question progress and draft DTOs | 200 |
| `POST` | `/api/v1/jobs/:jobId/resume` | Explicitly resume a paused job | 202 |
| `PATCH` | `/api/v1/drafts/:draftId` | Edit local draft | 200 |
| `POST` | `/api/v1/drafts/:draftId/review` | Mark the current version reviewed | 200 |

**Refresh endpoint note:** The PRD requires subject/assessment discovery but does not fully define refresh scheduling. The proposed explicit `POST` endpoints avoid side effects in `GET` requests. Keep each synchronous refresh bounded by the PRD's page timeout and a documented request budget; if this proves too slow for a student's full catalog, record an ADR before introducing a catalog-sync job type.

## 5. Detailed request/response contracts

### 5.1 `GET /api/v1/lms-connection`

Returns metadata only.

```json
{
  "connection": {
    "status": "valid",
    "lastValidatedAt": "2026-11-26T18:00:00.000Z",
    "credentialExpiresAt": null,
    "lastRotatedAt": "2026-11-26T18:00:00.000Z"
  }
}
```

Never return the cookie name/value, encrypted blob, nonce, auth tag, key version, raw headers, or a credential prefix/suffix.

### 5.2 `PUT /api/v1/lms-connection`

Request:

```json
{
  "cookieValue": "<user-supplied LMS cookie value>"
}
```

Rules:
- Accept only the intended credential field, not an arbitrary `Cookie` header or arbitrary URL.
- Set strict request-body limits; do not log request bodies for this route.
- Transport must use HTTPS.
- Encrypt server-side before persistence; do not send the value back.
- Use a response such as `204 No Content`.

If the LMS requires a different credential bundle or additional fields, do not guess. Update the contract after confirming the official integration method.

### 5.3 `POST /api/v1/lms-connection/validate`

Response:

```json
{
  "status": "valid",
  "checkedAt": "2026-11-26T18:00:00.000Z",
  "message": "The LMS connection is valid."
}
```

Allowed status values: `valid`, `expired`, `blocked`, `unknown`. A blocked or explicitly denied connection must not trigger alternate hosts, proxy tricks, or control bypass.

### 5.4 `DELETE /api/v1/lms-connection`

Revokes and wipes encrypted credential material for the actor's connection. Also applies the approved policy for active jobs that depend on that connection (normally pause them with `SESSION_EXPIRED` or a dedicated `CONNECTION_REVOKED` reason). Response: `204 No Content`.

### 5.5 `GET /api/v1/subjects`

Query parameters:
- `cursor` — optional opaque pagination cursor.
- `limit` — optional bounded integer; server default and maximum are configuration values.

Response:

```json
{
  "items": [
    {
      "id": "uuid",
      "externalId": "source-id",
      "name": "Mathematics",
      "gradeLabel": null,
      "sectionLabel": null,
      "lastSyncedAt": "2026-11-26T18:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Do not expose `lms_connection_id` or internal credential metadata.

### 5.6 `POST /api/v1/subjects/refresh`

No request body required in the first version. The use case loads the actor's connection, calls only the approved subject-read operation, validates normalized results, upserts snapshots, and returns the refreshed list metadata. If the source needs paging beyond the agreed request budget, stop and change this contract to a durable async sync operation rather than exceeding timeouts; do not silently turn it into an unbounded request.

Response:

```json
{
  "refreshedAt": "2026-11-26T18:00:00.000Z",
  "subjectCount": 8
}
```

### 5.7 `GET /api/v1/subjects/:subjectId/assessments`

Query parameters:
- `dueOnly` — optional boolean, defaults to `true` for the due-assessment screen.
- `cursor`, `limit` — standard bounded pagination.

Each assessment DTO contains `id`, `title`, `type`, `dueAt`, normalized `sourceStatus`, derived Hallili `displayStatus`, `timedQuizStatus` (`yes`, `no`, or `unknown`), and `lastSyncedAt`.

`timedQuizStatus` is `yes | no | unknown`; `yes` and `unknown` are default-deny for solving. `displayStatus` allowed values: `NOT_STARTED`, `IN_PROGRESS`, `DRAFT_READY`, `SUBMITTED`. `SUBMITTED` must only be set when confirmed from the LMS or a valid submission record—not merely because a local draft exists.

### 5.8 `POST /api/v1/subjects/:subjectId/assessments/refresh`

Refresh one subject's assessment list using an approved read operation. Request body may include an optional `dueOnly` filter only if the LMS supports it; do not send unrecognized parameters to the external service.

Response:

```json
{
  "refreshedAt": "2026-11-26T18:00:00.000Z",
  "assessmentCount": 12
}
```

### 5.9 `POST /api/v1/jobs/solve`

Headers:

```text
Idempotency-Key: <opaque client-generated key>
Content-Type: application/json
```

Request:

```json
{
  "attemptIds": ["attempt-uuid-1", "attempt-uuid-2"],
  "language": "auto",
  "timedAssessmentAcknowledgement": false
}
```

Validation:
- At least one attempt ID; maximum is a server-configured bound.
- IDs must be UUIDs and belong to the authenticated user. The corresponding `assessment_attempts` rows must already have been created from an approved source read; the browser never supplies raw `quiz_id` or `results_id`.
- Duplicate IDs in one request are rejected or deduplicated consistently; choose one behavior and test it.
- Language: `auto | ar | en`.
- Timed assessment acknowledgement alone is insufficient: policy gate must also explicitly permit the workflow. Only an explicit `timedQuizStatus: "no"` is treated as non-timed; `yes` and `unknown` are denied by default.
- Idempotency key required and bounded; it must not contain secrets.

Response: `202 Accepted`.

```json
{
  "jobs": [
    {
      "jobId": "job-uuid-1",
      "attemptId": "attempt-uuid-1",
      "status": "queued",
      "existing": false,
      "createdAt": "2026-11-26T18:00:00.000Z"
    },
    {
      "jobId": "job-uuid-2",
      "attemptId": "attempt-uuid-2",
      "status": "running",
      "existing": true,
      "createdAt": "2026-11-26T17:59:00.000Z"
    }
  ]
}
```

An already-active `(user_id, lms_quiz_id, lms_results_id)` job is returned as `existing: true`; it must not reserve quota again. The DB partial unique index is the concurrency backstop.

### 5.10 `GET /api/v1/jobs`

Returns only the actor's jobs. Support bounded pagination and optional status filter. Do not permit unbounded list responses.

### 5.11 `GET /api/v1/jobs/:jobId`

Response:

```json
{
  "job": {
    "id": "job-uuid",
    "status": "paused",
    "pauseReason": "SESSION_EXPIRED",
    "message": "Reconnect your LMS session, then resume this job.",
    "currentQuestionPosition": 5,
    "totalQuestions": 10,
    "completedQuestions": 4,
    "createdAt": "2026-11-26T18:00:00.000Z",
    "updatedAt": "2026-11-26T18:00:12.000Z",
    "pollAfterMs": null
  }
}
```

`pollAfterMs` is a hint only. For `queued`/`running`, return a configured value; for terminal/paused states return `null` or a slower UI-specific value. Do not return `locked_by`, lease tokens, stack traces, or raw upstream details.

### 5.12 `GET /api/v1/jobs/:jobId/questions`

Returns ordered question DTOs with a stable public question ID, position, type, status, safe blocker code, and current draft DTO if available. The route must authorize the job owner before loading question rows.

```json
{
  "items": [
    {
      "id": "job-question-uuid",
      "position": 1,
      "type": "multiple_choice",
      "status": "draft_saved",
      "draft": {
        "id": "draft-uuid",
        "answer": { "kind": "choice", "selectedOptionIds": ["option-a"] },
        "explanation": "Review this explanation before using the answer.",
        "confidence": 0.82,
        "version": 1,
        "reviewedAt": null
      }
    }
  ]
}
```

The example is illustrative. Actual answer shape must match the supported question types observed through the authorized LMS integration and validated with fixtures.

### 5.13 `POST /api/v1/jobs/:jobId/resume`

No status is accepted from the client. The Application use case verifies:
- the job belongs to the actor;
- current status is `paused`;
- blocker is resolved (for example connection revalidated or manual input recorded);
- remaining quota/reservation is valid;
- no active job/attempt lock conflicts with resume.

If valid, update to `queued` with `available_at = now()` and return `202 Accepted`:

```json
{
  "jobId": "job-uuid",
  "status": "queued"
}
```

Never accept `status: "running"` from the browser.

### 5.14 `PATCH /api/v1/drafts/:draftId`

Request:

```json
{
  "expectedVersion": 2,
  "answer": { "kind": "text", "value": "User-edited response" }
}
```

Rules:
- The draft must belong to a job/attempt owned by the actor.
- Validate answer against the normalized question type and allowed values.
- Compare `expectedVersion`; on mismatch return `409 VERSION_CONFLICT` with the latest safe version metadata (not silently overwrite).
- Persist the edit locally; do not implicitly save to the LMS.
- Append a revision record.

Response returns the new draft DTO with `version = expectedVersion + 1`.

### 5.15 `POST /api/v1/drafts/:draftId/review`

Marks the current version as reviewed. Include `expectedVersion` so a stale browser tab cannot mark a newer draft version reviewed by mistake. This is a Hallili review state, not an LMS submission.

## 6. Final-submission boundary — intentionally not enabled

There is no final-submission endpoint in the enabled v0.1 contract. The PRD's concept of user-confirmed final action remains a policy-dependent requirement. Before implementing it, require all of the following:

1. written confirmation that the action is allowed by the LMS/school rules;
2. a documented supported integration method;
3. a separate threat/security review;
4. fresh authenticated user confirmation bound to the exact attempt and answer version;
5. idempotency and an audit record;
6. a Web-only Submission capability that is not imported by the Worker;
7. separate DB/service permissions that prevent the Worker from performing the operation.

A button click is not enough to establish authorization. Until the gate is passed, keep the feature absent or explicitly disabled and make the UI clear that Hallili only stores local review drafts.

## 7. TanStack Start implementation mapping

- Implement each public endpoint as a TanStack Start Server Route handler.
- Centralize JSON parsing, Zod validation, session lookup, request ID, and safe error mapping in reusable server helpers/middleware.
- Route handlers call Application use cases; they do not issue Drizzle queries directly.
- Route loaders may call read use cases for SSR. Do not duplicate the same operation through both a REST route and a Server Function without a documented reason.
- Better Auth handler is mounted at its own auth catch-all route according to the pinned integration version.

TanStack Start documents Server Routes as server-side HTTP endpoints defined alongside file routes, with method handlers and optional route middleware. Keep the concrete file naming convention aligned with the framework version installed. [TanStack Start Server Routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)

## 8. Validation and error-mapping policy

| Boundary | Validation |
|---|---|
| Path/query | Zod schema; parse UUIDs, booleans, cursor, page size |
| Request JSON | Zod schema; strict object keys for credential and job mutation routes |
| Ownership | Application use case queries resource scoped to `ActorContext.userId` |
| Business state | Domain state machine/policy methods |
| External LMS response | LMS adapter schema/normalizer; unknown structure pauses safely |
| AI response | Structured schema + question-specific allowed-value validation |
| Response DTO | Zod response schema in tests; redact internal fields |

Error mapping must be centralized, deterministic, and tested. A route must not return an exception's `message` directly.

## 9. Polling policy

- Use TanStack Query as specified in the PRD.
- Poll `queued` and `running` jobs at a configurable interval; avoid one global aggressive interval for all screens.
- Stop active polling for `completed` and `failed`; for `paused`, show the blocker and wait for user action.
- Add bounded retry/backoff when the API is temporarily unavailable.
- The browser closing has no effect on Worker execution.
- Polling payloads should remain small and exclude large question content unless the review screen explicitly requests it.

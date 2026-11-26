# Hallili — Technical Design & Implementation Planning

**Document set:** v0.1  
**Based on:** Hallili PRD v0.1 and Hallili System Design v0.1  
**Status:** Proposed implementation baseline — review before coding

This folder turns the System Design into implementation-ready module boundaries, database rules, HTTP contracts, runtime flows, tests, and an ordered delivery plan. It is intentionally more detailed than the architecture document, but it does not claim that unknown LMS behavior or policy questions have been resolved.

## 1. How to read this set

Read the documents in this order:

1. `docs/technical-design/MODULES.md` — understand ownership and dependencies before creating folders or packages.
2. `docs/technical-design/DATABASE.md` — agree on the relational model and the invariants that must be enforced by PostgreSQL.
3. `docs/technical-design/API_CONTRACTS.md` — agree on the browser-facing contract and transport-level validation.
4. `docs/technical-design/FLOWS.md` — understand how the pieces collaborate during normal and failure cases.
5. `docs/technical-design/TESTING_STRATEGY.md` — define how correctness will be demonstrated.
6. `docs/implementation/IMPLEMENTATION_PLAN.md` — follow the phase order and dependencies.
7. `docs/implementation/TASKS.md` — execute small reviewable tasks and check each Definition of Done.
8. `docs/technical-design/OPEN_DECISIONS.md` — track facts that must be confirmed rather than guessed.

The System Design remains the higher-level architecture reference. If a technical detail here conflicts with it, stop and reconcile the documents; do not silently implement whichever version is easier.

## 2. Decision labels

The documents use these labels to distinguish requirements from recommendations:

- **[PRD-FIXED]** — directly required or explicitly decided by PRD v0.1.
- **[SYSTEM-DESIGN]** — part of the selected architecture baseline.
- **[PROPOSED]** — a concrete implementation detail proposed here; review it before treating it as immutable.
- **[GATE]** — do not enable the real integration or side effect until the required permission, policy, or external contract is confirmed.
- **[DEFERRED]** — intentionally excluded from the first working slice or postponed to a later release.

## 3. Non-negotiable architecture rules

1. TanStack Start is the only HTTP backend in v0.1. It owns SSR, auth route mounting, middleware, and REST Server Routes.
2. The Worker is a separate long-running Node.js process. It has no public business API and invokes Application use cases directly.
3. Domain and Application code must not depend on TanStack Start, Drizzle, or vendor SDKs.
4. PostgreSQL is the source of truth for jobs and progress. Queue claims use short transactions with `FOR UPDATE SKIP LOCKED`; network calls never run inside a DB transaction.
5. TanStack Query uses dynamic polling for active jobs. Do not add SSE/WebSockets in v0.1.
6. A Worker must never receive a final-submission port, endpoint, permission, or credential.
7. Store LMS credentials encrypted at rest. Never expose them to the browser after receipt or include them in logs/traces/errors.
8. Unknown LMS HTML, CSRF behavior, or write semantics must cause a safe pause—not guessed data or repeated writes.
9. Respect the LMS's published rules and explicit access controls. Rate limiting is for load protection, not bypassing blocks or anti-abuse controls.
10. Use mocks/local fixtures until an authorized integration path is confirmed. Do not test against real student assessments or perform real LMS mutations merely because a technical path appears possible.

## 4. Scope summary

### Core v0.1

- Better Auth + Microsoft sign-in, subject to the allowed account/tenant policy.
- Secure storage, validation, update, and revocation of the LMS session credential.
- Read/display of the student's subjects and due assessments through an authorized integration path.
- Durable solve-job lifecycle: enqueue, claim, process, progress, pause, resume, and recovery.
- AI draft generation behind a provider port, with structured output validation and bounded retry/fallback policy.
- Local draft persistence and review/edit UI.
- Usage quota enforcement with transactional reservations.
- Sanitized history/audit data and operational health/metrics.

### Conditional or deferred

- **[GATE] LMS-side draft saving:** default mode is local-only. Enable remote draft saving only after the LMS/school confirms the method and semantics are permitted and tested.
- **[GATE] Timed assessments:** default deny. A UI opt-in is not permission by itself; the school/LMS policy must allow the workflow.
- **[GATE] Final submission:** excluded from the enabled v0.1 API and Worker. Reconsider only with explicit written authorization and a separate review/approval decision.
- **[DEFERRED] BYOK:** user-provided AI keys require a separate key lifecycle and privacy design; not a prerequisite for the first usable vertical slice.
- **[DEFERRED] Notifications:** completion notifications can follow after core reliability.
- **[DEFERRED] Lesson/file context sync and textbook indexing:** PRD places this in v0.3.
- **[DEFERRED] Browser extension and native mobile application:** outside v0.1.

## 5. PRD traceability

| PRD item | Technical design location |
|---|---|
| FR-01 Identity, auth, quotas | `MODULES.md`, `DATABASE.md`, `API_CONTRACTS.md`, `FLOWS.md` |
| FR-02 LMS session management | `MODULES.md`, `DATABASE.md`, `API_CONTRACTS.md`, `FLOWS.md` |
| FR-03 Subjects and due assessments | `MODULES.md`, `DATABASE.md`, `API_CONTRACTS.md`, `FLOWS.md` |
| FR-04 Background solving jobs | All technical-design documents; implementation phases 4–7 |
| FR-05 Draft saving and safe pause | `FLOWS.md`, `DATABASE.md`, `TESTING_STRATEGY.md`; remote save is gated |
| FR-06 Progress synchronization | `API_CONTRACTS.md`, `FLOWS.md` |
| FR-07 Review and edit | `MODULES.md`, `DATABASE.md`, `API_CONTRACTS.md`, `FLOWS.md` |
| FR-08 Model/language preferences and BYOK | AI module in `MODULES.md`; BYOK deferred in implementation plan |
| FR-09 History and logs | `DATABASE.md`, `TESTING_STRATEGY.md`; retention policy must be confirmed |
| FR-10 Notifications | optional module and deferred implementation phase |
| NFRs and edge cases | All documents, especially `DATABASE.md`, `FLOWS.md`, and `TESTING_STRATEGY.md` |

## 6. What must be approved before real LMS integration

See `docs/technical-design/OPEN_DECISIONS.md`. At minimum, confirm: authorization and acceptable-use rules; whether the LMS offers an official API; which reads/writes are permitted; stable external IDs; cookie/session rotation and concurrency semantics; policy for graded/timed assessments; data sent to AI providers; and retention/deletion requirements.

Until those are answered, the team can safely implement the domain model, UI, database, queue mechanics, fake LMS/AI adapters, security controls, and end-to-end tests against fixtures. Real LMS write operations remain disabled.

## 7. Rules for an AI coding agent

Before working on a task, the agent must read this README, the relevant technical-design file, the matching task entry, and the referenced PRD/System Design section. It must:

- implement only the named task and its dependencies;
- preserve module ownership and dependency direction;
- reuse the agreed contracts and state transitions;
- add tests required by the task's DoD;
- create migrations for schema changes;
- never add a second HTTP backend, a second queue system, or a new infrastructure dependency without an ADR;
- never invent LMS endpoints, HTML fields, or session semantics;
- never add a final-submission capability to the Worker;
- flag contradictions or missing facts instead of silently guessing;
- update docs and task status when implementation changes an agreed detail.

## 8. External technical references

These references support framework integration choices; they do not replace version pinning and a quick compatibility check when implementation begins:

- [TanStack Start — Server Routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)
- [Better Auth — TanStack Start integration](https://better-auth.com/docs/integrations/tanstack)
- [Drizzle ORM — PostgreSQL indexes and constraints](https://orm.drizzle.team/docs/indexes-constraints)
- [PostgreSQL — `SELECT` and row locking](https://www.postgresql.org/docs/current/sql-select.html)

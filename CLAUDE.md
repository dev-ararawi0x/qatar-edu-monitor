# CLAUDE.md — Qatar Education Monitor (`qatar-edu-monitor`)

Project guide and operational rules for Claude and AI coding assistants.

---

## 1. Quick Reference

- **Project**: pnpm workspace monorepo for the Qatar Education LMS (`https://qeducation.edu.gov.qa`).
- **Packages**:
  - `packages/core` (`@qatar-edu/core`): shared domain, HTTP, cookies, sanitizer, URLs, parsers, LLM adapters, quiz services.
  - `apps/cli` (`@qatar-edu/cli`): CLI entrypoint, commands, config, and Arabic Markdown exporters.
  - `apps/api` (`@qatar-edu/api`): minimal Hono `/health` skeleton.
  - `apps/web` (`@qatar-edu/web`): minimal Vite + React + TanStack Router skeleton.
- **Docs**: `docs/architecture.md`, `AGENTS.md`, and `plans/architecture-and-refactoring-plan.md`.

---

## 2. Key Commands

```bash
pnpm install
pnpm -r typecheck
pnpm --filter @qatar-edu/core test
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts --help
pnpm --filter @qatar-edu/api dev
pnpm --filter @qatar-edu/web dev
pnpm -r build
```

CLI examples:

```bash
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts assignments list --class-id <id>
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz inspect <url-or-id>
pnpm --filter @qatar-edu/cli exec tsx src/cli.ts quiz draft <display-url> --apply
```

---

## 3. Safety & Privacy Invariants

1. **Secret Redaction (`"VALUES"`)**:
   - Never read, print, log, or commit `.env` or real cookies/tokens/LLM keys.
   - Always sanitize sensitive fields to `"VALUES"` using `@qatar-edu/core` sanitizer utilities.
2. **Quiz Safety Guardrails**:
   - `quiz inspect`, `quiz scan`, and `quiz solve` dry-run are GET-only.
   - Do not start new quiz attempts unless `--start-new` is explicitly passed.
   - `quiz draft` and `quiz solve` must remain dry-run by default.
   - NEVER call or allow calls to `/student_take_quiz_assignment/finish/`; `LmsHttpClient` blocks it at transport level.

---

## 4. Code Structure

- `packages/core/src/types/`: shared TypeScript interfaces.
- `packages/core/src/core/`: HTTP client, cookie jar, sanitizer, URL builders.
- `packages/core/src/parsers/`: pure Cheerio parsers.
- `packages/core/src/llm/`: provider adapters, prompt builder, answer validator, retry helper.
- `packages/core/src/services/`: quiz inspector, form mapper, solver workflow.
- `apps/cli/src/cli/`: CLI entrypoint, handlers, flags, help.
- `apps/cli/src/commands/`: command orchestrators.
- `apps/cli/src/exporters/`: Arabic Markdown report generators and writer.
- `apps/cli/src/config.ts`: dotenv/env config and command context.
- `apps/api/src/`: Hono API skeleton (`/health`).
- `apps/web/src/`: Vite/React/TanStack Router skeleton.

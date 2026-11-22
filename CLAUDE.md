# CLAUDE.md — Qatar Education Monitor (`qatar-edu-monitor`)

Project guide and operational rules for Claude and AI coding assistants.

---

## 1. Quick Reference

- **Project**: Modular TypeScript/Node.js CLI for Qatar Education LMS (`https://qeducation.edu.gov.qa`).
- **Entry Point**: `src/cli.ts` (run with `npx tsx src/cli.ts <command> [options]`).
- **Architecture Details**: See `docs/architecture.md` and `AGENTS.md`.
- **Plan Document**: See `plans/architecture-and-refactoring-plan.md`.

---

## 2. Key Commands

```bash
# Help & CLI Discovery
npx tsx src/cli.ts --help
npx tsx src/cli.ts quiz --help

# Read-Only Commands (GET only)
npx tsx src/cli.ts assignments list
npx tsx src/cli.ts assignments due
npx tsx src/cli.ts lessons list
npx tsx src/cli.ts quiz inspect <showUrl|displayUrl|quizId>
npx tsx src/cli.ts quiz scan
npx tsx src/cli.ts monitor [urls...]

# Draft Saving (Dry-run by default; pass --apply to execute draft + pause)
npx tsx src/cli.ts quiz draft <displayUrl> [--apply] [--answers '{"1":"..."}']

# Verification
npm run typecheck
npm test
```

---

## 3. Safety & Privacy Invariants

1. **Secret Redaction (`"VALUES"`)**:
   - Never read, print, log, or commit `.env` or real cookies/tokens.
   - Always sanitize sensitive fields (`cookie`, `token`, `csrf`, `auth`, `password`, `secret`) to `"VALUES"` using `src/core/sanitizer.ts`.
2. **Quiz Safety Guardrails**:
   - `quiz inspect` and `quiz scan` are strictly `GET`-only. Do not add `POST` logic to these commands.
   - Do not start new quiz attempts unless `--start-new` is explicitly passed by the user.
   - `quiz draft` MUST remain dry-run by default (requires `--apply` to send draft `POST`s and `/pause/`).
   - NEVER call or allow calls to `/student_take_quiz_assignment/finish/`. `LmsHttpClient` enforces this block at the transport layer.

---

## 4. Code Structure

- `src/types/`: TypeScript interfaces (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` compliant).
- `src/core/`: HTTP client (`LmsHttpClient`), cookie jar (`SessionCookieJar`), secret sanitizer (`sanitizer.ts`), URL utilities (`lms-urls.ts`), and env config (`config.ts`).
- `src/parsers/`: Pure Cheerio parsers for assignments, lessons, quiz show/questions/summaries, and generic pages.
- `src/exporters/`: Arabic Markdown report generators (`assignments`, `lessons`, `quiz`, `monitor`) and timestamped/`latest.md` writer.
- `src/commands/`: Subcommand orchestrators (`assignments`, `lessons`, `quiz`, `monitor`).
- `tests/`: Offline unit tests using `node:test` and `tsx`.

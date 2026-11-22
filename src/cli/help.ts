const HELP_TEXT = `
Qatar Education LMS CLI Monitor (qatar-edu-monitor)

Usage:
  npx tsx src/cli.ts <command> [subcommand] [options]

Commands:
  assignments list --class-id <id> | --url <url> [options]
                                   List all assignments for a class (GET only)
  assignments due --class-id <id> | --url <url> [options]
                                   List due assignments / quizzes for a class (GET only)
  lessons list --class-id <id> | --url <url> [options]
                                   List lessons and sections for a class (GET only)
  quiz inspect <url-or-id> [opts]  Inspect quiz questions & details read-only (GET only)
  quiz scan --class-id <id> | --url <url> [options]
                                   Scan due quizzes and inspect open/resumed attempts (GET only)
  quiz draft <display-url> [opts]  Preview or save quiz drafts + pause (Dry-run by default, /finish BLOCKED)
  quiz solve <url-or-id> [opts]    Solve quiz questions via LLM adapter (Dry-run by default, /finish BLOCKED)
  monitor [urls...] [options]      Inspect HTTP responses & auto-detect LMS entities (GET only)

Global Options:
  --help, -h                       Show help message
  --quiet                          Suppress verbose per-request HTTP logs
  --no-report                      Skip saving Markdown reports to disk
  --out-dir <path>                 Override default reports directory

Safety Guardrails:
  - Read-only GET by default across inspect, scan, and monitor commands.
  - New quiz attempts are skipped by default; pass --start-new to opt in.
  - quiz draft runs in dry-run mode by default; pass --apply to send draft POSTs + /pause/.
  - Requests to /student_take_quiz_assignment/finish/ are strictly blocked at transport level.
  - All cookies, CSRF tokens, and secrets are masked as "VALUES".
`;

const SUBCOMMAND_HELP: Record<string, string> = {
  assignments: `
Usage:
  npx tsx src/cli.ts assignments list --class-id <id> [options]
  npx tsx src/cli.ts assignments list --url <fullUrl> [options]
  npx tsx src/cli.ts assignments due --class-id <id> [options]
  npx tsx src/cli.ts assignments due --url <fullUrl> [options]

Options:
  --class-id <id>    Class / section ID (required unless --url is provided or LMS_CLASS_ID is set in .env)
  --url <url>        Custom full assignments URL (overrides --class-id)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners
  --help, -h         Show this help
`,
  lessons: `
Usage:
  npx tsx src/cli.ts lessons list --class-id <id> [options]
  npx tsx src/cli.ts lessons list --url <fullUrl> [options]

Options:
  --class-id <id>    Class / section ID (required unless --url is provided or LMS_CLASS_ID is set in .env)
  --url <url>        Custom full lessons URL (overrides --class-id)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners
  --help, -h         Show this help
`,
  quiz: `
Usage:
  npx tsx src/cli.ts quiz inspect <showUrl|displayUrl|quizId> [options]
  npx tsx src/cli.ts quiz scan --class-id <id> [options]
  npx tsx src/cli.ts quiz scan --url <fullUrl> [options]
  npx tsx src/cli.ts quiz draft <displayUrl> [options]
  npx tsx src/cli.ts quiz solve <showUrl|displayUrl|quizId> [options]

quiz inspect options:
  --results-id <id>  Attempt results ID (if inspecting display URL directly)
  --start-new        Opt-in to inspect newly started attempts (GET only)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners

quiz scan options:
  --class-id <id>    Class / section ID (required unless --url is provided or LMS_CLASS_ID is set in .env)
  --url <url>        Custom full due assignments URL (overrides --class-id)
  --start-new        Opt-in to inspect newly started attempts (GET only)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners

quiz draft options:
  --answers <json>   JSON string or @path/to/file.json mapping part numbers to answers (e.g. {"1":"..."})
  --apply            Actually send draft POSTs + /pause/ (default is safe dry-run)
  --no-pause         Do not call /pause/ after --apply
  --allow-timed      Allow running on timed quizzes (timed_quiz=true)
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners

quiz solve options:
  --provider <name>  LLM provider: gemini | openai | anthropic | mock (defaults to LLM_PROVIDER)
  --model <name>     Model override (defaults to LLM_MODEL or provider default)
  --fallback-models  Comma-separated fallback models on 503/429 spikes (e.g. gemini-3.6-flash,gemini-3.5-flash-lite)
  --lang <mode>      Answer language: auto | ar | en (default: auto based on subject & question)
  --subject <hint>   Optional subject hint (e.g. "English Language", "الفيزياء")
  --attach <p=path>  Attach local file for part p (repeatable, e.g. --attach 3=./solution.pdf)
  --start-new        Opt-in to open unstarted quiz attempts
  --allow-timed      Allow running on timed quizzes (timed_quiz=true)
  --apply            Save solved answers to LMS via POST + /pause/ (default is GET-only dry-run)
  --submit           Save all parts, verify summary screen completeness, and pause ready for browser submit
  --no-pause         Do not call /pause/ after --apply / --submit
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners
`,
  monitor: `
Usage:
  npx tsx src/cli.ts monitor [url1 url2 ...] [options]

Options:
  --selector <css>   Custom CSS selector for DOM extraction (default: "#mainContent a, #mainContent h1, #mainContent h2, #mainContent li")
  --no-report        Skip writing Markdown report
  --quiet            Suppress verbose HTTP request banners
  --help, -h         Show this help
`,
};

export function printHelp(command?: string): void {
  if (command && SUBCOMMAND_HELP[command]) {
    console.log(SUBCOMMAND_HELP[command]);
  } else {
    console.log(HELP_TEXT);
  }
}

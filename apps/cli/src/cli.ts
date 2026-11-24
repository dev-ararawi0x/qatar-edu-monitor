#!/usr/bin/env node
import { printHelp } from "./cli/help.js";
import {
  handleAssignments,
  handleLessons,
  handleMonitor,
  handleQuiz,
} from "./cli/handlers.js";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "assignments":
      return handleAssignments(rest);
    case "lessons":
      return handleLessons(rest);
    case "quiz":
      return handleQuiz(rest);
    case "monitor":
      return handleMonitor(rest);
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

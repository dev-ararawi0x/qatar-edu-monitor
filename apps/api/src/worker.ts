import "dotenv/config";
import { getEnv } from "./env.js";
import { db } from "./db/client.js";
import { SolveJobWorker } from "./lib/jobs/solve-job.worker.js";

/**
 * Standalone background worker process (`pnpm --filter @qatar-edu/api worker`).
 * When ENABLE_EMBEDDED_WORKER=true the API server also runs one in-process.
 */
const env = getEnv();
const worker = new SolveJobWorker(db, {
  workerId: `standalone-${process.pid}`,
});

worker.start();
console.log(
  `[worker] SolveJobWorker started (embedded=${env.ENABLE_EMBEDDED_WORKER}, pid=${process.pid})`,
);

const shutdown = async () => {
  console.log("[worker] shutting down...");
  await worker.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

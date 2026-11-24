import { serve } from "@hono/node-server";
import app from "./index.js";
import { getEnv } from "./env.js";
import { db } from "./db/client.js";
import { SolveJobWorker } from "./lib/jobs/solve-job.worker.js";

const env = getEnv();
const port = env.PORT;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@qatar-edu/api listening on http://localhost:${info.port}`);
});

// Embedded background worker (disable with ENABLE_EMBEDDED_WORKER=false when
// running a dedicated `pnpm --filter @qatar-edu/api worker` process instead).
let worker: SolveJobWorker | null = null;
if (env.ENABLE_EMBEDDED_WORKER) {
  worker = new SolveJobWorker(db, { workerId: `api-${process.pid}` });
  worker.start();
  console.log("[worker] embedded SolveJobWorker started");
}

const shutdown = async () => {
  if (worker) await worker.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

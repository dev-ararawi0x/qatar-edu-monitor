import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Db } from "../../db/client.js";
import type { AuthVariables } from "../../middleware/auth.middleware.js";
import { createBatchSchema } from "./jobs.schema.js";
import {
  cancelBatch,
  cancelJob,
  createSolveBatch,
  getBatch,
  listBatches,
  retryJob,
} from "./jobs.service.js";

export function createJobsRoutes(db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .post("/batches", zValidator("json", createBatchSchema), async (c) => {
      const user = c.get("user");
      return c.json(await createSolveBatch(db, user.id, c.req.valid("json")), 201);
    })
    .get("/batches", async (c) => {
      const user = c.get("user");
      return c.json({ batches: await listBatches(db, user.id) });
    })
    .get("/batches/:batchId", async (c) => {
      const user = c.get("user");
      return c.json(await getBatch(db, user.id, c.req.param("batchId")));
    })
    .post("/batches/:batchId/cancel", async (c) => {
      const user = c.get("user");
      return c.json(await cancelBatch(db, user.id, c.req.param("batchId")));
    })
    .post("/jobs/:jobId/cancel", async (c) => {
      const user = c.get("user");
      return c.json(await cancelJob(db, user.id, c.req.param("jobId")));
    })
    .post("/jobs/:jobId/retry", async (c) => {
      const user = c.get("user");
      return c.json(await retryJob(db, user.id, c.req.param("jobId")));
    });
}

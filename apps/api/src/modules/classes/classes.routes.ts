import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Db } from "../../db/client.js";
import type { AuthVariables } from "../../middleware/auth.middleware.js";
import { addManualClassSchema } from "./classes.schema.js";
import {
  addManualClass,
  deleteClass,
  listClassesWithQuizzes,
  syncClassesAndQuizzes,
} from "./classes.service.js";

export function createClassesRoutes(db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .get("/", async (c) => {
      const user = c.get("user");
      return c.json({ classes: await listClassesWithQuizzes(db, user.id) });
    })
    .post("/sync", async (c) => {
      const user = c.get("user");
      return c.json(await syncClassesAndQuizzes(db, user.id));
    })
    .post("/manual", zValidator("json", addManualClassSchema), async (c) => {
      const user = c.get("user");
      return c.json(await addManualClass(db, user.id, c.req.valid("json")));
    })
    .delete("/:classId", async (c) => {
      const user = c.get("user");
      return c.json(await deleteClass(db, user.id, c.req.param("classId")));
    });
}

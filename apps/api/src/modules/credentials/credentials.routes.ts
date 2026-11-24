import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Db } from "../../db/client.js";
import type { AuthVariables } from "../../middleware/auth.middleware.js";
import { saveCookieSchema } from "./credentials.schema.js";
import {
  deleteLmsCookie,
  getCredentialsStatus,
  saveLmsCookie,
  verifyStoredCookie,
} from "./credentials.service.js";

export function createCredentialsRoutes(db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .get("/status", async (c) => {
      const user = c.get("user");
      return c.json(await getCredentialsStatus(db, user.id));
    })
    .put("/cookie", zValidator("json", saveCookieSchema), async (c) => {
      const user = c.get("user");
      return c.json(await saveLmsCookie(db, user.id, c.req.valid("json")));
    })
    .post("/verify", async (c) => {
      const user = c.get("user");
      return c.json(await verifyStoredCookie(db, user.id));
    })
    .delete("/cookie", async (c) => {
      const user = c.get("user");
      return c.json(await deleteLmsCookie(db, user.id));
    });
}

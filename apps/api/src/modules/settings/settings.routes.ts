import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Db } from "../../db/client.js";
import type { AuthVariables } from "../../middleware/auth.middleware.js";
import { updateLlmSettingsSchema } from "./settings.schema.js";
import { getLlmSettings, updateLlmSettings } from "./settings.service.js";

export function createSettingsRoutes(db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .get("/llm", async (c) => {
      const user = c.get("user");
      return c.json(await getLlmSettings(db, user.id));
    })
    .put("/llm", zValidator("json", updateLlmSettingsSchema), async (c) => {
      const user = c.get("user");
      return c.json(await updateLlmSettings(db, user.id, c.req.valid("json")));
    });
}

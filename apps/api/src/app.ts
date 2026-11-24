import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./lib/auth.js";
import { appErrorHandler } from "./lib/errors.js";
import { getEnv } from "./env.js";
import { db } from "./db/client.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { createCredentialsRoutes } from "./modules/credentials/credentials.routes.js";
import { createSettingsRoutes } from "./modules/settings/settings.routes.js";
import { createClassesRoutes } from "./modules/classes/classes.routes.js";
import { createQuizzesRoutes } from "./modules/quizzes/quizzes.routes.js";
import { createJobsRoutes } from "./modules/jobs/jobs.routes.js";

/**
 * NOTE: routes are registered in a single fluent chain — `app.route()` only
 * contributes to the exported `AppType` when chained, which is what makes
 * `hc<AppType>` end-to-end typed on the web client.
 */
const app = new Hono()
  .onError(appErrorHandler)
  .use(
    "*",
    cors({
      origin: getEnv().WEB_ORIGIN,
      credentials: true,
    }),
  )
  .get("/health", (c) =>
    c.json({ status: "ok", service: "@qatar-edu/api" }),
  )
  // better-auth handler: /api/auth/sign-in/social, /api/auth/callback/*, etc.
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  // Authenticated feature modules (Hono RPC – types flow to the web client).
  .use("/api/credentials/*", requireAuth)
  .use("/api/settings/*", requireAuth)
  .use("/api/classes/*", requireAuth)
  .use("/api/quizzes/*", requireAuth)
  .use("/api/jobs/*", requireAuth)
  .route("/api/credentials", createCredentialsRoutes(db))
  .route("/api/settings", createSettingsRoutes(db))
  .route("/api/classes", createClassesRoutes(db))
  .route("/api/quizzes", createQuizzesRoutes(db))
  .route("/api/jobs", createJobsRoutes(db));

export default app;

export type AppType = typeof app;

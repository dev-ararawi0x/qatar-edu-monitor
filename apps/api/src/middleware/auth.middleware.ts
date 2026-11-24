import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth.js";
import { UnauthorizedError } from "../lib/errors.js";

export interface AuthVariables {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  };
  session: {
    id: string;
    expiresAt: Date;
  };
}

/**
 * Requires a valid better-auth session. Injects `user` and `session` into
 * the Hono context variables for downstream handlers.
 */
export const requireAuth = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session?.user || !session.session) {
    throw new UnauthorizedError("Authentication required.");
  }

  c.set("user", {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    ...(session.user.image !== undefined
      ? { image: session.user.image }
      : {}),
  });
  c.set("session", {
    id: session.session.id,
    expiresAt: session.session.expiresAt,
  });

  await next();
});

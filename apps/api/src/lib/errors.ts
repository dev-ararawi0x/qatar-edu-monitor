import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sanitizeText } from "@qatar-edu/core";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required.") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found.") {
    super(404, "NOT_FOUND", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, "VALIDATION_ERROR", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, "CONFLICT", message);
  }
}

export class LmsSessionExpiredError extends AppError {
  constructor(
    message = "Your LMS session cookie is missing or expired. Please update it in Settings.",
  ) {
    super(401, "LMS_SESSION_EXPIRED", message);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(502, "UPSTREAM_ERROR", message);
  }
}

/**
 * Centralized Hono onError handler. Never leaks stack traces or secrets —
 * all messages pass through the core sanitizer so accidental cookie/token
 * values are masked as "VALUES".
 */
export function appErrorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: sanitizeText(err.message),
        },
      },
      err.statusCode as ContentfulStatusCode,
    );
  }

  if (err instanceof HTTPException) {
    return c.json(
      {
        error: {
          code: `HTTP_${err.status}`,
          message: sanitizeText(err.message),
        },
      },
      err.status,
    );
  }

  // Unknown errors: log sanitized server-side, return generic message.
  console.error("[api] unhandled error:", sanitizeText(err.message));
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    },
    500,
  );
}

import type { z } from "zod";
import { ValidationError } from "./errors.js";

/** Parses `data` with a zod schema, throwing ValidationError on failure. */
export function parseWith<T extends z.ZodType>(
  schema: T,
  data: unknown,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    throw new ValidationError(message || "Invalid request payload");
  }
  return result.data;
}

import { z } from "zod";

export const saveCookieSchema = z.object({
  cookie: z
    .string()
    .min(10, "Cookie header is too short")
    .refine((v) => v.trim() !== "VALUES", {
      message: "Cookie must be a real session value, not the VALUES placeholder",
    }),
  lmsBaseUrl: z.string().optional(),
});

export type SaveCookieInput = z.infer<typeof saveCookieSchema>;

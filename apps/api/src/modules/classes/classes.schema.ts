import { z } from "zod";

export const addManualClassSchema = z.object({
  classId: z.string().min(1, "classId is required"),
  title: z.string().optional(),
});

export type AddManualClassInput = z.infer<typeof addManualClassSchema>;

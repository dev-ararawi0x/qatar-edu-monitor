import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Db } from "../../db/client.js";
import type { AuthVariables } from "../../middleware/auth.middleware.js";
import { finishQuizSchema, overrideAnswerSchema } from "./quizzes.schema.js";
import {
  finishQuiz,
  getQuestionImage,
  getQuizDetail,
  overridePartAnswer,
  reverifyQuiz,
} from "./quizzes.service.js";

export function createQuizzesRoutes(db: Db) {
  return new Hono<{ Variables: AuthVariables }>()
    .get("/:quizId", async (c) => {
      const user = c.get("user");
      return c.json(await getQuizDetail(db, user.id, c.req.param("quizId")));
    })
    .get("/:quizId/questions/:part/image/:imageIndex", async (c) => {
      const user = c.get("user");
      const part = Number(c.req.param("part"));
      const imageIndex = Number(c.req.param("imageIndex"));
      if (
        !Number.isInteger(part) ||
        part < 1 ||
        !Number.isInteger(imageIndex) ||
        imageIndex < 0
      ) {
        return c.json({ error: "Invalid part or image index" }, 400);
      }
      const image = await getQuestionImage(
        db,
        user.id,
        c.req.param("quizId"),
        part,
        imageIndex,
      );
      return c.body(new Uint8Array(image.data), 200, {
        "content-type": image.contentType,
        "cache-control": "private, max-age=300",
      });
    })
    .patch(
      "/:quizId/questions/:part",
      zValidator("json", overrideAnswerSchema),
      async (c) => {
        const user = c.get("user");
        const part = Number(c.req.param("part"));
        if (!Number.isInteger(part) || part < 1) {
          return c.json({ error: "Invalid part number" }, 400);
        }
        return c.json(
          await overridePartAnswer(
            db,
            user.id,
            c.req.param("quizId"),
            part,
            c.req.valid("json"),
          ),
        );
      },
    )
    .post("/:quizId/reverify", async (c) => {
      const user = c.get("user");
      return c.json(await reverifyQuiz(db, user.id, c.req.param("quizId")));
    })
    .post(
      "/:quizId/finish",
      zValidator("json", finishQuizSchema),
      async (c) => {
        const user = c.get("user");
        return c.json(
          await finishQuiz(db, user.id, c.req.param("quizId"), c.req.valid("json")),
        );
      },
    );
}

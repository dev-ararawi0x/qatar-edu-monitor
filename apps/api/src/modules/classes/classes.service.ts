import { and, eq, inArray } from "drizzle-orm";
import {
  buildAssignmentsListUrl,
  buildAssignmentsDueUrl,
  discoverEnrolledClasses,
  parseAssignmentsHtml,
  parseGenericHtmlPage,
  sanitizeText,
  type ParsedAssignment,
} from "@qatar-edu/core";
import type { Db } from "../../db/client.js";
import { lmsClasses, lmsQuizzes } from "../../db/schema/index.js";
import { withLmsSession } from "../../lib/lms-session.factory.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import {
  toClassDto,
  toQuizDto,
  type ClassDto,
  type ClassWithQuizzesDto,
} from "../../lib/dto.js";
import type { AddManualClassInput } from "./classes.schema.js";

const SYNC_CONCURRENCY = 3;

/** Returns all classes for the user with their due/known quizzes attached. */
export async function listClassesWithQuizzes(
  db: Db,
  userId: string,
): Promise<ClassWithQuizzesDto[]> {
  const classes = await db.query.lmsClasses.findMany({
    where: eq(lmsClasses.userId, userId),
  });
  if (classes.length === 0) return [];

  const quizzes = await db.query.lmsQuizzes.findMany({
    where: and(
      eq(lmsQuizzes.userId, userId),
      inArray(
        lmsQuizzes.classId,
        classes.map((c) => c.id),
      ),
    ),
  });

  const byClass = new Map<string, typeof quizzes>();
  for (const q of quizzes) {
    const list = byClass.get(q.classId) ?? [];
    list.push(q);
    byClass.set(q.classId, list);
  }

  return classes
    .map((cls) => ({
      ...toClassDto(cls),
      quizzes: (byClass.get(cls.id) ?? [])
        .map(toQuizDto)
        .sort((a, b) => a.title.localeCompare(b.title, "ar")),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "ar"));
}

/**
 * Syncs enrolled classes + due quiz assignments from the LMS.
 * Existing quiz rows keep their workflow status (queued/solving/etc.).
 */
export async function syncClassesAndQuizzes(
  db: Db,
  userId: string,
): Promise<{ classes: number; quizzes: number }> {
  return withLmsSession(db, userId, async (client) => {
    const discovered = await discoverEnrolledClasses(client);
    const now = new Date();
    let quizCount = 0;

    // Upsert classes first so quizzes can reference them.
    const classIdMap = new Map<string, string>(); // lmsClassId -> row id
    for (const cls of discovered) {
      const [row] = await db
        .insert(lmsClasses)
        .values({
          userId,
          lmsClassId: cls.classId,
          title: sanitizeText(cls.title) || cls.title,
          teacherName: cls.teacherName ?? null,
          href: cls.href ?? null,
          isManual: false,
          lastSyncedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [lmsClasses.userId, lmsClasses.lmsClassId],
          set: {
            title: sanitizeText(cls.title) || cls.title,
            teacherName: cls.teacherName ?? null,
            href: cls.href ?? null,
            lastSyncedAt: now,
            updatedAt: now,
          },
        })
        .returning({ id: lmsClasses.id });
      if (row) classIdMap.set(cls.classId, row.id);
    }

    // Fetch due assignments per class with bounded concurrency.
    const queue = [...discovered];
    const workers = Array.from(
      { length: Math.min(SYNC_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          const cls = queue.shift();
          if (!cls) return;
          const classRowId = classIdMap.get(cls.classId);
          if (!classRowId) continue;

          const dueUrl = buildAssignmentsDueUrl(client.baseUrl, cls.classId);
          const res = await client.request({
            method: "GET",
            pathOrUrl: dueUrl,
            referer: `${client.baseUrl}/`,
          });
          if (res.status !== 200 || res.kind !== "HTML") continue;

          const assignments = parseAssignmentsHtml(res.body).filter(
            (a) => a.kind === "quiz" && a.assignmentId,
          );
          for (const a of assignments) {
            await upsertQuizFromAssignment(db, userId, classRowId, a, now);
            quizCount += 1;
          }
        }
      },
    );
    await Promise.all(workers);

    return { classes: discovered.length, quizzes: quizCount };
  });
}

async function upsertQuizFromAssignment(
  db: Db,
  userId: string,
  classRowId: string,
  assignment: ParsedAssignment,
  now: Date,
): Promise<void> {
  const quizId = assignment.assignmentId;
  if (!quizId) return;

  await db
    .insert(lmsQuizzes)
    .values({
      userId,
      classId: classRowId,
      lmsQuizId: quizId,
      title: sanitizeText(assignment.title) || assignment.title,
      showUrl: assignment.href ?? null,
      relatedLessonTitle: assignment.relatedLessonTitle
        ? sanitizeText(assignment.relatedLessonTitle)
        : null,
      status: "due_unsolved",
      lastSyncedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [lmsQuizzes.userId, lmsQuizzes.lmsQuizId],
      // Never reset workflow status on re-sync; only refresh metadata.
      set: {
        title: sanitizeText(assignment.title) || assignment.title,
        showUrl: assignment.href ?? null,
        relatedLessonTitle: assignment.relatedLessonTitle
          ? sanitizeText(assignment.relatedLessonTitle)
          : null,
        lastSyncedAt: now,
        updatedAt: now,
      },
    });
}

/** Adds a class manually by LMS class id (or full class URL). */
export async function addManualClass(
  db: Db,
  userId: string,
  input: AddManualClassInput,
): Promise<ClassDto> {
  const raw = input.classId.trim();
  // Accept either a bare id or a URL containing /classes/<id> or trailing digits.
  const match = raw.match(/(\d{3,})(?:[/?#]|$)/) ?? raw.match(/(\d+)$/);
  const lmsClassId = match?.[1] ?? raw;
  if (!/^\d+$/.test(lmsClassId)) {
    throw new ValidationError(
      "Could not extract a numeric class id. Provide the class id or its LMS URL.",
    );
  }

  return withLmsSession(db, userId, async (client) => {
    const listUrl = buildAssignmentsListUrl(client.baseUrl, lmsClassId);
    const res = await client.request({
      method: "GET",
      pathOrUrl: listUrl,
      referer: `${client.baseUrl}/`,
    });
    if (res.status === 404) {
      throw new NotFoundError(`Class ${lmsClassId} was not found on the LMS.`);
    }
    if (res.status !== 200 || res.kind !== "HTML") {
      throw new ValidationError(
        `Could not load class ${lmsClassId} (HTTP ${res.status}).`,
      );
    }

    const page = parseGenericHtmlPage(res.body);
    const title =
      input.title?.trim() ||
      page.mainHeading ||
      page.pageTitle ||
      `Class ${lmsClassId}`;

    const now = new Date();
    const [row] = await db
      .insert(lmsClasses)
      .values({
        userId,
        lmsClassId,
        title: sanitizeText(title) || title,
        isManual: true,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [lmsClasses.userId, lmsClasses.lmsClassId],
        set: {
          title: sanitizeText(title) || title,
          isManual: true,
          updatedAt: now,
        },
      })
      .returning();

    if (!row) throw new Error("Failed to upsert class");
    return toClassDto(row);
  });
}

export async function deleteClass(
  db: Db,
  userId: string,
  classRowId: string,
): Promise<{ deleted: boolean }> {
  const existing = await db.query.lmsClasses.findFirst({
    where: and(eq(lmsClasses.id, classRowId), eq(lmsClasses.userId, userId)),
  });
  if (!existing) throw new NotFoundError("Class not found");

  await db
    .delete(lmsClasses)
    .where(and(eq(lmsClasses.id, classRowId), eq(lmsClasses.userId, userId)));
  return { deleted: true };
}

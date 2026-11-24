/**
 * Module-private capability token. Passing this symbol in
 * `HttpRequestOptions` is the ONLY way `LmsHttpClient` will allow a request
 * to `/student_take_quiz_assignment/finish/`.
 *
 * It is intentionally not part of any JSON/CLI surface: it cannot arrive via
 * HTTP bodies, CLI flags, or user input. Only trusted in-process services
 * (currently `quiz-finish.service.ts`'s `submitQuizFinishExplicitly`) may
 * import and use it — and only after explicit human confirmation upstream.
 */
export const ALLOW_EXPLICIT_HUMAN_FINISH: unique symbol = Symbol(
  "ALLOW_EXPLICIT_HUMAN_FINISH",
);

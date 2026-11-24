export type AssignmentKind = "quiz" | "offline" | "other";

export interface ParsedAssignment {
  title: string;
  href: string;
  assignmentId: string | null;
  kind: AssignmentKind;
  relatedLessonTitle?: string;
  relatedLessonHref?: string;
}

export interface ParsedLessonSection {
  title: string;
  href: string;
  sectionId: string | null;
}

export interface ParsedLesson {
  title: string;
  href: string;
  lessonId: string | null;
  classId?: string;
  sections: ParsedLessonSection[];
}

export interface ExtractedDomElement {
  tag: string;
  text: string;
  href?: string;
}

export interface GenericPageInspection {
  url: string;
  status: number;
  statusText: string;
  contentType: string;
  kind: "Redirect" | "JSON" | "HTML" | "Other";
  location?: string;
  elapsedMs: number;
  pageTitle?: string;
  mainHeading?: string;
  extractedElements: ExtractedDomElement[];
  assignments: ParsedAssignment[];
  lessons: ParsedLesson[];
  quizShowInfo?: import("./quiz.types.js").QuizShowInfo;
  quizScreen?: import("./quiz.types.js").ParsedQuizScreen;
}

import type {
  AnswerLanguage,
  LanguagePreference,
  ParsedQuestionScreen,
} from "../types/index.js";

const ARABIC_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g;
const LATIN_CHAR_REGEX = /[A-Za-z]/g;

const EXPLICIT_ENGLISH_DIRECTIVE =
  /(?:\banswer\s+in\s+english\b|\bwrite\s+(?:your\s+answer\s+)?in\s+english\b|\btranslate\s+(?:into|to)\s+english\b|باللغة\s+الإنجليزي[ةه]|اكتب\s+بالإنجليزي[ةه]|ترجم\s+إلى\s+(?:اللغة\s+)?الإنجليزي[ةه])/i;

const EXPLICIT_ARABIC_DIRECTIVE =
  /(?:\banswer\s+in\s+arabic\b|\bwrite\s+(?:your\s+answer\s+)?in\s+arabic\b|\btranslate\s+(?:into|to)\s+arabic\b|باللغة\s+العربي[ةه]|أجب\s+بالعربي[ةه]|اكتب\s+بالعربي[ةه]|ترجم\s+إلى\s+(?:اللغة\s+)?العربي[ةه])/i;

const ENGLISH_SUBJECT_KEYWORDS =
  /(?:\benglish\s+language\b|\benglish\b|\befl\b|\besl\b|\bielts\b|اللغة\s+الإنجليزي[ةه]|اللغه\s+الانجليزيه|انجليزي|إنجليزي)/i;

const ARABIC_SUBJECT_KEYWORDS =
  /(?:اللغة\s+العربي[ةه]|التربية\s+الإسلامي[ةه]|العلوم\s+الشرعي[ةه]|تاريخ\s+قطر|الدراسات\s+الاجتماعي[ةه])/i;

const ARABIC_INSTRUCTION_STARTERS =
  /(?:^|\s)(?:اشرح|وضح|اذكر|عدد|علل|فسر|قارن|ما\s+هو|ما\s+هي|ماذا|كيف|لماذا|أكمل|اكمل|اختر|اكتب|صِل|صل|عرف|حدد|احسب|استنتج|بين|دلّل|برهن)(?:\s|:|$)/;

function countMatches(text: string, regex: RegExp): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function stripGenericQuestionPrefix(header: string): string {
  return header
    .replace(/^(?:السؤال\s*(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)\s*[:\-–]?)/i, "")
    .replace(/^(?:question\s*\d+\s*[:\-–]?)/i, "")
    .trim();
}

export interface DetectLanguageInput {
  preference?: LanguagePreference;
  subjectHint?: string;
  quizTitle?: string;
  lessonTitle?: string;
  screen: ParsedQuestionScreen;
}

export function detectAnswerLanguage(input: DetectLanguageInput): AnswerLanguage {
  const { preference = "auto", subjectHint = "", quizTitle = "", lessonTitle = "", screen } = input;

  if (preference === "ar" || preference === "en") {
    return preference;
  }

  const cleanedHeader = stripGenericQuestionPrefix(screen.questionHeader);
  const fullQuestionText = `${cleanedHeader}\n${screen.promptText}`.trim();

  // 1. Explicit per-question language instruction always wins (e.g., translation prompts)
  if (EXPLICIT_ENGLISH_DIRECTIVE.test(fullQuestionText)) {
    return "en";
  }
  if (EXPLICIT_ARABIC_DIRECTIVE.test(fullQuestionText)) {
    return "ar";
  }

  // 2. Subject-level context (e.g., English Language course vs Arabic/Islamic Studies)
  const subjectMeta = `${subjectHint} ${quizTitle} ${lessonTitle}`.trim();
  if (ENGLISH_SUBJECT_KEYWORDS.test(subjectMeta)) {
    return "en";
  }
  if (ARABIC_SUBJECT_KEYWORDS.test(subjectMeta)) {
    return "ar";
  }

  // 3. Question body + choices + blank contexts script analysis
  const choiceText = screen.choices.map((c) => c.label).join(" ");
  const fieldContextText = screen.fieldDetails
    .map((f) => [f.contextLabel || "", ...(f.options || [])].join(" "))
    .join(" ");

  const coreBody = `${screen.promptText} ${choiceText} ${fieldContextText}`.trim();
  const bodyArabic = countMatches(coreBody, ARABIC_CHAR_REGEX);
  const bodyLatin = countMatches(coreBody, LATIN_CHAR_REGEX);

  // Check if Arabic instructional verbs appear in the prompt or meaningful header
  // (e.g., "اشرح Green Computing:" is an Arabic question about an English technical term)
  if (ARABIC_INSTRUCTION_STARTERS.test(fullQuestionText) && bodyArabic > 0) {
    return "ar";
  }

  if (bodyArabic === 0 && bodyLatin > 0) {
    return "en";
  }
  if (bodyLatin === 0 && bodyArabic > 0) {
    return "ar";
  }

  if (bodyArabic > 0 && bodyLatin > 0) {
    return bodyArabic >= bodyLatin * 0.4 ? "ar" : "en";
  }

  // 4. Fallback to cleaned header or subject metadata script
  const fallbackText = `${cleanedHeader} ${subjectMeta}`;
  const fallbackArabic = countMatches(fallbackText, ARABIC_CHAR_REGEX);
  const fallbackLatin = countMatches(fallbackText, LATIN_CHAR_REGEX);

  if (fallbackLatin > fallbackArabic && fallbackArabic === 0) {
    return "en";
  }

  return "ar";
}

import path from "node:path";
import { readFile } from "node:fs/promises";
import type {
  HttpFileAttachment,
  HttpFormFieldValue,
  LlmSolvedAnswer,
  ParsedQuestionScreen,
  SanitizedFileAttachmentMeta,
} from "../types/index.js";
import { sanitizeFields, sanitizeText } from "../core/sanitizer.js";
import { getFillableAnswerFields } from "../llm/prompt-builder.js";

export interface MappedQuestionFormPayload {
  formFields: Record<string, HttpFormFieldValue>;
  files: HttpFileAttachment[];
  asMultipart: boolean;
  formattedSummary: string;
  sanitizedFieldsPreview: Record<string, string>;
  sanitizedFilesPreview: SanitizedFileAttachmentMeta[];
}

export function inferMimeTypeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".zip":
      return "application/zip";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    default:
      return "text/plain; charset=utf-8";
  }
}

export interface ParsedPartAttachment {
  part: number;
  fileName: string;
  mimeType: string;
  content: Uint8Array;
}

/**
 * Parses CLI `--attach <part=filepath>` specifications into binary attachments.
 */
export async function loadPartAttachments(
  specs: string[],
): Promise<Map<number, ParsedPartAttachment[]>> {
  const map = new Map<number, ParsedPartAttachment[]>();

  for (const rawSpec of specs) {
    const eqIdx = rawSpec.indexOf("=");
    if (eqIdx <= 0 || eqIdx === rawSpec.length - 1) {
      throw new Error(
        `[Error] Invalid --attach format "${rawSpec}". Expected <partNumber>=<filePath>, e.g. --attach 3=./answer.pdf`,
      );
    }

    const partStr = rawSpec.slice(0, eqIdx).trim();
    const rawFilePath = rawSpec.slice(eqIdx + 1).trim();
    const part = Number(partStr);
    if (!Number.isInteger(part) || part < 1) {
      throw new Error(
        `[Error] Invalid part number "${partStr}" in --attach "${rawSpec}". Must be a positive integer.`,
      );
    }

    const resolvedPath = path.resolve(rawFilePath);
    const buf = await readFile(resolvedPath);
    const fileName = path.basename(resolvedPath);
    const mimeType = inferMimeTypeFromFileName(fileName);

    const existing = map.get(part) ?? [];
    existing.push({
      part,
      fileName,
      mimeType,
      content: new Uint8Array(buf),
    });
    map.set(part, existing);
  }

  return map;
}

function truncatePreview(text: string, maxLen = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}...` : clean;
}

export function mapAnswerToFormPayload(
  screen: ParsedQuestionScreen,
  solved: LlmSolvedAnswer,
  userAttachments?: ParsedPartAttachment[],
): MappedQuestionFormPayload {
  const formFields: Record<string, HttpFormFieldValue> = {
    ...screen.hiddenFields,
    destination: "next",
  };
  const files: HttpFileAttachment[] = [];
  let formattedSummary = "";

  if (solved.kind === "single_choice") {
    const matched = screen.choices.find((c) => c.value === solved.selectedValue);
    const fieldName = matched?.fieldName || "answer";
    formFields[fieldName] = solved.selectedValue;
    formattedSummary = matched
      ? `${matched.label} (value=${solved.selectedValue})`
      : solved.selectedValue;
  } else if (solved.kind === "multiple_choice") {
    const groupedByField = new Map<string, string[]>();
    const summaryLabels: string[] = [];

    for (const val of solved.selectedValues) {
      const matched = screen.choices.find((c) => c.value === val);
      const fieldName = matched?.fieldName || "answer[]";
      const list = groupedByField.get(fieldName) ?? [];
      list.push(val);
      groupedByField.set(fieldName, list);
      summaryLabels.push(matched ? `${matched.label} (${val})` : val);
    }

    for (const [fieldName, values] of groupedByField.entries()) {
      formFields[fieldName] = values.length === 1 && !fieldName.endsWith("[]")
        ? (values[0] ?? "")
        : values;
    }

    formattedSummary = summaryLabels.join(" | ");
  } else if (solved.kind === "structured_input") {
    const pairs: string[] = [];
    for (const [fieldName, val] of Object.entries(solved.fields)) {
      formFields[fieldName] = val;
      const fieldMeta = screen.fieldDetails.find((f) => f.name === fieldName);
      const optLabel = fieldMeta?.selectOptions?.find((o) => o.value === val)?.label;
      pairs.push(optLabel && optLabel !== val ? `${fieldName}: ${optLabel} (${val})` : `${fieldName}: ${val}`);
    }
    formattedSummary = pairs.join(" | ");
  } else if (solved.kind === "file_upload") {
    const fillable = getFillableAnswerFields(screen.fieldDetails);
    const textFieldName = fillable[0]?.name || "answer";
    if (screen.hasPlainTextInput || solved.accompanyingText) {
      formFields[textFieldName] = solved.accompanyingText;
    }

    const defaultFileInputName = screen.fileInputNames[0] || "answer_file";

    if (userAttachments && userAttachments.length > 0) {
      userAttachments.forEach((att, idx) => {
        const inputName = screen.fileInputNames[idx] || defaultFileInputName;
        files.push({
          fieldName: inputName,
          fileName: att.fileName,
          mimeType: att.mimeType,
          content: att.content,
        });
      });
    } else if (solved.generatedFile) {
      files.push({
        fieldName: defaultFileInputName,
        fileName: solved.generatedFile.fileName,
        mimeType: solved.generatedFile.mimeType,
        content: solved.generatedFile.content,
      });
    }

    const fileNamesLabel = files.map((f) => f.fileName).join(", ");
    formattedSummary = [
      solved.accompanyingText ? truncatePreview(solved.accompanyingText, 90) : "",
      fileNamesLabel ? `[ملف مرفق: ${fileNamesLabel}]` : "",
    ]
      .filter(Boolean)
      .join(" — ");
  } else {
    // free_text
    const fillable = getFillableAnswerFields(screen.fieldDetails);
    const textFieldName = fillable[0]?.name || "answer";
    formFields[textFieldName] = solved.text;
    formattedSummary = truncatePreview(solved.text, 140);
  }

  // Also attach user-supplied files if passed for a non-file_upload question that supports file attachments
  if (
    solved.kind !== "file_upload" &&
    userAttachments &&
    userAttachments.length > 0 &&
    screen.hasFileUpload
  ) {
    const defaultFileInputName = screen.fileInputNames[0] || "answer_file";
    userAttachments.forEach((att, idx) => {
      const inputName = screen.fileInputNames[idx] || defaultFileInputName;
      files.push({
        fieldName: inputName,
        fileName: att.fileName,
        mimeType: att.mimeType,
        content: att.content,
      });
    });
  }

  const asMultipart =
    files.length > 0 ||
    screen.enctype.toLowerCase().includes("multipart/form-data");

  const sanitizedFieldsPreview = sanitizeFields(formFields) ?? {};
  const sanitizedFilesPreview: SanitizedFileAttachmentMeta[] = files.map((f) => ({
    fieldName: f.fieldName,
    fileName: sanitizeText(f.fileName),
    mimeType: f.mimeType,
    sizeBytes:
      typeof f.content === "string"
        ? Buffer.byteLength(f.content, "utf8")
        : f.content.byteLength,
  }));

  return {
    formFields,
    files,
    asMultipart,
    formattedSummary,
    sanitizedFieldsPreview,
    sanitizedFilesPreview,
  };
}

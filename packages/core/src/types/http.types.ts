import type { ALLOW_EXPLICIT_HUMAN_FINISH } from "../core/finish-capability.js";

export type HttpMethod = "GET" | "POST";

export type HttpContentKind = "Redirect" | "JSON" | "HTML" | "Other";

export type HttpFormFieldValue = string | string[];

export interface HttpFileAttachment {
  fieldName: string;
  fileName: string;
  mimeType: string;
  content: string | Uint8Array;
}

export interface SanitizedFileAttachmentMeta {
  fieldName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface HttpRequestOptions {
  method: HttpMethod;
  pathOrUrl: string;
  referer?: string;
  isAjax?: boolean;
  csrfHeaderToken?: string;
  formFields?: Record<string, HttpFormFieldValue>;
  files?: HttpFileAttachment[];
  asMultipart?: boolean;
  /**
   * Internal-only capability: permits POSTing to the quiz /finish/ endpoint.
   * Never set this from CLI flags, HTTP handlers, or user input — only the
   * trusted `submitQuizFinishExplicitly` service may pass it after explicit
   * human confirmation.
   */
  [ALLOW_EXPLICIT_HUMAN_FINISH]?: true;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  contentType: string;
  location: string | null;
  kind: HttpContentKind;
  body: string;
  elapsedMs: number;
}

export interface BinaryHttpResponse {
  status: number;
  statusText: string;
  contentType: string;
  base64: string;
  sizeBytes: number;
  elapsedMs: number;
}

export interface SanitizedHttpTrace {
  timestamp: string;
  method: HttpMethod;
  url: string;
  referer?: string;
  status: number;
  statusText: string;
  elapsedMs: number;
  contentType: string;
  kind: HttpContentKind;
  location?: string;
  updatedCookieNames: string[];
  sizeBytes: number;
  hasCookies: boolean;
  formFields?: Record<string, string>;
  fileAttachments?: SanitizedFileAttachmentMeta[];
}

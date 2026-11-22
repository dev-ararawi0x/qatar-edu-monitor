export type HttpMethod = "GET" | "POST";

export type HttpContentKind = "Redirect" | "JSON" | "HTML" | "Other";

export interface HttpRequestOptions {
  method: HttpMethod;
  pathOrUrl: string;
  referer?: string;
  isAjax?: boolean;
  csrfHeaderToken?: string;
  formFields?: Record<string, string>;
  asMultipart?: boolean;
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
}

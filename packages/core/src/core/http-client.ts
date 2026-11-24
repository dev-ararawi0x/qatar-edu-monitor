import type {
  BinaryHttpResponse,
  HttpContentKind,
  HttpRequestOptions,
  HttpResponse,
  SanitizedFileAttachmentMeta,
  SanitizedHttpTrace,
} from "../types/index.js";
import { SessionCookieJar } from "./cookie-jar.js";
import { ALLOW_EXPLICIT_HUMAN_FINISH } from "./finish-capability.js";
import { isQuizFinishUrl } from "./lms-urls.js";
import {
  MASK_VALUE,
  sanitizeFields,
  sanitizeText,
} from "./sanitizer.js";

export function detectKind(
  status: number,
  contentType: string,
  location: string | null,
): HttpContentKind {
  if (status >= 300 && status < 400 && location) return "Redirect";
  if (
    contentType.includes("application/json") ||
    contentType.includes("+json")
  ) {
    return "JSON";
  }
  if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml")
  ) {
    return "HTML";
  }
  return "Other";
}

function getAttachmentByteLength(content: string | Uint8Array): number {
  return typeof content === "string"
    ? Buffer.byteLength(content, "utf8")
    : content.byteLength;
}

export class LmsHttpClient {
  public readonly cookieJar: SessionCookieJar;
  public readonly baseUrl: string;
  public readonly traces: SanitizedHttpTrace[] = [];
  private readonly quiet: boolean;
  private readonly logger: LmsHttpLogger | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl: string,
    initialCookie = "VALUES",
    quiet = false,
    logger?: LmsHttpLogger,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cookieJar = new SessionCookieJar(initialCookie);
    this.quiet = quiet;
    this.logger = logger;
    this.fetchImpl = fetchImpl;

  }

  resolveUrl(pathOrUrl: string): string {
    return new URL(pathOrUrl, this.baseUrl).toString();
  }

  private logInfo(...args: unknown[]): void {
    const sink = this.logger?.info ?? (this.quiet ? undefined : console.log);
    sink?.(...args);
  }

  private logError(...args: unknown[]): void {
    const sink = this.logger?.error ?? (this.quiet ? undefined : console.error);
    sink?.(...args);
  }

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const {
      method,
      pathOrUrl,
      referer = `${this.baseUrl}/user_dashboard`,
      isAjax = false,
      csrfHeaderToken,
      formFields,
      files,
      asMultipart = false,
    } = options;

    if (
      isQuizFinishUrl(pathOrUrl) &&
      options[ALLOW_EXPLICIT_HUMAN_FINISH] !== true
    ) {
      throw new Error(
        `[Safety Guardrail] Blocked request to quiz finish endpoint: ${pathOrUrl}. Quiz submission is disabled unless explicitly authorized by a human-confirmed service.`,
      );
    }

    const fullUrl = this.resolveUrl(pathOrUrl);
    const timestamp = new Date().toISOString();
    const start = performance.now();

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0",
      Accept: isAjax
        ? "*/*;q=0.5, text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      Referer: referer,
      Origin: this.baseUrl,
      Cookie: this.cookieJar.toCookieHeader(),
    };

    if (isAjax) {
      headers["X-Requested-With"] = "XMLHttpRequest";
    }
    if (csrfHeaderToken) {
      headers["X-CSRF-Token"] = csrfHeaderToken;
    }

    const hasFiles = Boolean(files && files.length > 0);
    const useMultipart = asMultipart || hasFiles;

    let bodyPayload: BodyInit | undefined;
    if (method === "POST" && (formFields || hasFiles)) {
      if (useMultipart) {
        const fd = new FormData();
        if (formFields) {
          for (const [k, v] of Object.entries(formFields)) {
            if (Array.isArray(v)) {
              for (const item of v) {
                fd.append(k, item);
              }
            } else {
              fd.append(k, v);
            }
          }
        }
        if (files) {
          for (const f of files) {
            const blobPart =
              typeof f.content === "string"
                ? f.content
                : new Uint8Array(f.content);
            const blob = new Blob([blobPart], { type: f.mimeType });
            fd.append(f.fieldName, blob, f.fileName);
          }
        }
        bodyPayload = fd;
      } else if (formFields) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(formFields)) {
          if (Array.isArray(v)) {
            for (const item of v) {
              params.append(k, item);
            }
          } else {
            params.append(k, v);
          }
        }
        headers["Content-Type"] =
          "application/x-www-form-urlencoded; charset=UTF-8";
        bodyPayload = params.toString();
      }
    }

    const sanitizedFiles: SanitizedFileAttachmentMeta[] | undefined =
      files && files.length > 0
        ? files.map((f) => ({
            fieldName: f.fieldName,
            fileName: sanitizeText(f.fileName),
            mimeType: f.mimeType,
            sizeBytes: getAttachmentByteLength(f.content),
          }))
        : undefined;

    if (!this.quiet) {
      this.logInfo("========================================");
      this.logInfo(`[Time]       ${timestamp}`);
      this.logInfo(`[Request]    ${method} ${sanitizeText(fullUrl)}`);
      this.logInfo(
        `[Cookie]     ${this.cookieJar.hasRealCookies() ? "VALUES (loaded)" : "VALUES (empty)"}`,
      );
      if (csrfHeaderToken) {
        this.logInfo(`[CSRF-Hdr]   ${MASK_VALUE}`);
      }
      if (formFields) {
        this.logInfo(
          `[Form Body]  (${useMultipart ? "multipart/form-data" : "urlencoded"}):`,
          sanitizeFields(formFields),
        );
      }
      if (sanitizedFiles) {
        this.logInfo(`[Files]     `, sanitizedFiles);
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(fullUrl, {
        method,
        headers,
        body: bodyPayload ?? null,
        redirect: "manual",
      });
    } catch (err) {
      const elapsedMs = Math.round(performance.now() - start);
      if (!this.quiet) {
        this.logError(`[Network Error] ${method} ${sanitizeText(fullUrl)} (${elapsedMs}ms)`);
        this.logError(err instanceof Error ? sanitizeText(err.message) : String(err));
        this.logInfo("========================================\n");
      }
      throw err;
    }

    const elapsedMs = Math.round(performance.now() - start);
    const rawSetCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    const updatedCookies = this.cookieJar.ingestSetCookieHeaders(rawSetCookies);

    const contentType = response.headers.get("content-type") || "unknown";
    const location = response.headers.get("location");
    const kind = detectKind(response.status, contentType, location);
    const body = await response.text();

    const sanitizedLocation = location ? sanitizeText(location) : undefined;
    const sanitizedFields = sanitizeFields(formFields);

    const trace: SanitizedHttpTrace = {
      timestamp,
      method,
      url: sanitizeText(fullUrl),
      referer: sanitizeText(referer),
      status: response.status,
      statusText: response.statusText,
      elapsedMs,
      contentType,
      kind,
      ...(sanitizedLocation ? { location: sanitizedLocation } : {}),
      updatedCookieNames: updatedCookies,
      sizeBytes: Buffer.byteLength(body, "utf8"),
      hasCookies: this.cookieJar.hasRealCookies(),
      ...(sanitizedFields ? { formFields: sanitizedFields } : {}),
      ...(sanitizedFiles ? { fileAttachments: sanitizedFiles } : {}),
    };
    this.traces.push(trace);

    if (!this.quiet) {
      this.logInfo(
        `[Status]     ${response.status} ${response.statusText} (${elapsedMs}ms)`,
      );
      this.logInfo(`[Kind]       ${kind} (${contentType})`);
      if (location) {
        this.logInfo(`[Location]   ${sanitizeText(location)}`);
      }
      if (updatedCookies.length > 0) {
        this.logInfo(`[Set-Cookie] Updated: ${updatedCookies.join(", ")}`);
      }
      this.logInfo(`[Size]       ${trace.sizeBytes} bytes`);
      this.logInfo("========================================\n");
    }

    return {
      status: response.status,
      statusText: response.statusText,
      contentType,
      location,
      kind,
      body,
      elapsedMs,
    };
  }

  async fetchBinary(
    pathOrUrl: string,
    referer = `${this.baseUrl}/user_dashboard`,
  ): Promise<BinaryHttpResponse | null> {
    if (isQuizFinishUrl(pathOrUrl)) {
      throw new Error(
        `[Safety Guardrail] Blocked request to quiz finish endpoint: ${pathOrUrl}. Quiz submission is disabled.`,
      );
    }

    const fullUrl = this.resolveUrl(pathOrUrl);
    const timestamp = new Date().toISOString();
    const start = performance.now();

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0",
      Accept: "image/*,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      Referer: referer,
      Origin: this.baseUrl,
      Cookie: this.cookieJar.toCookieHeader(),
    };

    try {
      const response = await this.fetchImpl(fullUrl, {
        method: "GET",
        headers,
        redirect: "follow",
      });
      const elapsedMs = Math.round(performance.now() - start);
      const rawSetCookies =
        typeof response.headers.getSetCookie === "function"
          ? response.headers.getSetCookie()
          : [];
      const updatedCookies = this.cookieJar.ingestSetCookieHeaders(rawSetCookies);
      const contentType = response.headers.get("content-type") || "application/octet-stream";

      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      this.traces.push({
        timestamp,
        method: "GET",
        url: sanitizeText(fullUrl),
        referer: sanitizeText(referer),
        status: response.status,
        statusText: response.statusText,
        elapsedMs,
        contentType,
        kind: "Other",
        updatedCookieNames: updatedCookies,
        sizeBytes: buffer.byteLength,
        hasCookies: this.cookieJar.hasRealCookies(),
      });

      if (response.status < 200 || response.status >= 300) {
        return null;
      }

      return {
        status: response.status,
        statusText: response.statusText,
        contentType,
        base64: buffer.toString("base64"),
        sizeBytes: buffer.byteLength,
        elapsedMs,
      };
    } catch {
      return null;
    }
  }
}

export interface LmsHttpLogger {
  info?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}


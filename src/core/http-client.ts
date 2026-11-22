import type {
  HttpContentKind,
  HttpRequestOptions,
  HttpResponse,
  SanitizedHttpTrace,
} from "../types/index.js";
import { SessionCookieJar } from "./cookie-jar.js";
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

export class LmsHttpClient {
  public readonly cookieJar: SessionCookieJar;
  public readonly baseUrl: string;
  public readonly traces: SanitizedHttpTrace[] = [];
  private readonly quiet: boolean;

  constructor(
    baseUrl: string,
    initialCookie = "VALUES",
    quiet = false,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cookieJar = new SessionCookieJar(initialCookie);
    this.quiet = quiet;
  }

  resolveUrl(pathOrUrl: string): string {
    return new URL(pathOrUrl, this.baseUrl).toString();
  }

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const {
      method,
      pathOrUrl,
      referer = `${this.baseUrl}/user_dashboard`,
      isAjax = false,
      csrfHeaderToken,
      formFields,
      asMultipart = false,
    } = options;

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

    let bodyPayload: BodyInit | undefined;
    if (method === "POST" && formFields) {
      if (asMultipart) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(formFields)) {
          fd.append(k, v);
        }
        bodyPayload = fd;
      } else {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(formFields)) {
          params.append(k, v);
        }
        headers["Content-Type"] =
          "application/x-www-form-urlencoded; charset=UTF-8";
        bodyPayload = params.toString();
      }
    }

    if (!this.quiet) {
      console.log("========================================");
      console.log(`[Time]       ${timestamp}`);
      console.log(`[Request]    ${method} ${fullUrl}`);
      console.log(
        `[Cookie]     ${this.cookieJar.hasRealCookies() ? "VALUES (loaded)" : "VALUES (empty)"}`,
      );
      if (csrfHeaderToken) {
        console.log(`[CSRF-Hdr]   ${MASK_VALUE}`);
      }
      if (formFields) {
        console.log(
          `[Form Body]  (${asMultipart ? "multipart/form-data" : "urlencoded"}):`,
          sanitizeFields(formFields),
        );
      }
    }

    let response: Response;
    try {
      response = await fetch(fullUrl, {
        method,
        headers,
        body: bodyPayload ?? null,
        redirect: "manual",
      });
    } catch (err) {
      const elapsedMs = Math.round(performance.now() - start);
      if (!this.quiet) {
        console.error(`[Network Error] ${method} ${fullUrl} (${elapsedMs}ms)`);
        console.error(err);
        console.log("========================================\n");
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
      url: fullUrl,
      referer,
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
    };
    this.traces.push(trace);

    if (!this.quiet) {
      console.log(
        `[Status]     ${response.status} ${response.statusText} (${elapsedMs}ms)`,
      );
      console.log(`[Kind]       ${kind} (${contentType})`);
      if (location) {
        console.log(`[Location]   ${sanitizeText(location)}`);
      }
      if (updatedCookies.length > 0) {
        console.log(`[Set-Cookie] Updated: ${updatedCookies.join(", ")}`);
      }
      console.log(`[Size]       ${trace.sizeBytes} bytes`);
      console.log("========================================\n");
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
}

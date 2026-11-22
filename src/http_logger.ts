import "dotenv/config";

export class SessionCookieJar {
  private cookies = new Map<string, string>();

  constructor(rawCookieHeader: string) {
    this.parseAndMerge(rawCookieHeader);
  }

  private parseAndMerge(cookieStr: string) {
    if (!cookieStr || cookieStr.trim() === "VALUES") return;

    for (const part of cookieStr.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;

      const name = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      this.cookies.set(name, value);
    }
  }

  ingestSetCookieHeaders(setCookieList: string[]): string[] {
    const updatedNames: string[] = [];

    for (const raw of setCookieList) {
      const firstPair = raw.split(";")[0]?.trim();
      if (!firstPair) continue;
      const eqIdx = firstPair.indexOf("=");
      if (eqIdx <= 0) continue;

      const name = firstPair.slice(0, eqIdx).trim();
      const value = firstPair.slice(eqIdx + 1).trim();
      if (this.cookies.get(name) !== value) {
        this.cookies.set(name, value);
        updatedNames.push(name);
      }
    }

    return updatedNames;
  }

  toCookieHeader(): string {
    if (this.cookies.size === 0) return "VALUES";
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  hasRealCookies(): boolean {
    return this.cookies.size > 0;
  }
}

export interface LoggedHttpResponse {
  status: number;
  statusText: string;
  contentType: string;
  location: string | null;
  kind: "Redirect" | "JSON" | "HTML" | "Other";
  body: string;
  elapsedMs: number;
}

function detectKind(
  status: number,
  contentType: string,
  location: string | null,
): LoggedHttpResponse["kind"] {
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

function sanitizeFieldsForLog(
  fields: Record<string, string>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("cookie")
    ) {
      safe[key] = "VALUES";
    } else {
      safe[key] = val;
    }
  }
  return safe;
}

export class LoggedLmsClient {
  public readonly cookieJar: SessionCookieJar;
  public readonly baseUrl: string;

  constructor(
    baseUrl = "https://qeducation.edu.gov.qa",
    initialCookie = process.env.LMS_COOKIE || "VALUES",
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cookieJar = new SessionCookieJar(initialCookie);
  }

  resolveUrl(pathOrUrl: string): string {
    return new URL(pathOrUrl, this.baseUrl).toString();
  }

  async request(options: {
    method: "GET" | "POST";
    pathOrUrl: string;
    referer?: string | undefined;
    isAjax?: boolean | undefined;
    csrfHeaderToken?: string | undefined;
    formFields?: Record<string, string> | undefined;
    asMultipart?: boolean | undefined;
  }): Promise<LoggedHttpResponse> {
    const {
      method,
      pathOrUrl,
      referer = `${this.baseUrl}/user_dashboard`,
      isAjax = false,
      csrfHeaderToken,
      formFields,
      asMultipart = false,
    } = options;

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

    console.log("========================================");
    console.log(`[Time]       ${timestamp}`);
    console.log(`[Request]    ${method} ${fullUrl}`);
    console.log(
      `[Cookie]     ${this.cookieJar.hasRealCookies() ? "VALUES (loaded)" : "VALUES (empty)"}`,
    );
    if (csrfHeaderToken) {
      console.log(`[CSRF-Hdr]   VALUES`);
    }
    if (formFields) {
      console.log(
        `[Form Body]  (${asMultipart ? "multipart/form-data" : "urlencoded"}):`,
        sanitizeFieldsForLog(formFields),
      );
    }

    const response = await fetch(fullUrl, {
      method,
      headers,
      body: bodyPayload ?? null,
      redirect: "manual",
    });

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

    console.log(
      `[Status]     ${response.status} ${response.statusText} (${elapsedMs}ms)`,
    );
    console.log(`[Kind]       ${kind} (${contentType})`);
    if (location) {
      console.log(`[Location]   ${location}`);
    }
    if (updatedCookies.length > 0) {
      console.log(`[Set-Cookie] Updated: ${updatedCookies.join(", ")}`);
    }
    console.log(`[Size]       ${Buffer.byteLength(body, "utf8")} bytes`);
    console.log("========================================\n");

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

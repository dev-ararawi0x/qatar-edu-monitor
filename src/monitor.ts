import "dotenv/config";
import * as cheerio from "cheerio";
import { parseAssignmentsHtml, parseLessonsHtml } from "./parsers.js";

class SessionCookieJar {
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

  // يقرأ هيدر Set-Cookie من استجابة السيرفر (يأخذ الجزء الأول قبل أول ;)
  ingestSetCookieHeaders(setCookieList: string[]) {
    const updatedNames: string[] = [];

    for (const raw of setCookieList) {
      const firstPair = raw.split(";")[0]?.trim();
      if (!firstPair) continue;
      const eqIdx = firstPair.indexOf("=");
      if (eqIdx <= 0) continue;

      const name = firstPair.slice(0, eqIdx).trim();
      const value = firstPair.slice(eqIdx + 1).trim();
      const prev = this.cookies.get(name);

      if (prev !== value) {
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

interface MonitorOptions {
  url: string;
  cookieJar: SessionCookieJar;
  referer?: string;
  itemSelector?: string;
}

function detectResponseKind(
  status: number,
  contentType: string,
  locationHeader: string | null,
): "Redirect" | "JSON" | "HTML" | "Other" {
  if (status >= 300 && status < 400 && locationHeader) {
    return "Redirect";
  }
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

async function inspectGetEndpoint(options: MonitorOptions) {
  const {
    url,
    cookieJar,
    referer = "https://qeducation.edu.gov.qa/user_dashboard",
    itemSelector = "#mainContent a, #mainContent h1, #mainContent h2, #mainContent li",
  } = options;

  const timestamp = new Date().toISOString();
  const start = performance.now();

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    Referer: referer,
    Cookie: cookieJar.toCookieHeader(),
  };

  console.log("========================================");
  console.log(`[Time]      ${timestamp}`);
  console.log(`[Request]   GET ${url}`);
  console.log(
    `[Session]   ${cookieJar.hasRealCookies() ? "Cookies loaded" : "Placeholder only (VALUES)"}`,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    console.log(`[Status]    Network Error (${elapsed}ms)`);
    console.error(err);
    console.log("========================================\n");
    return;
  }

  // التقاط أي Set-Cookie يرسلها السيرفر
  const rawSetCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const updatedCookies = cookieJar.ingestSetCookieHeaders(rawSetCookies);

  const elapsed = Math.round(performance.now() - start);
  const contentType = response.headers.get("content-type") || "unknown";
  const location = response.headers.get("location");
  const kind = detectResponseKind(response.status, contentType, location);
  const rawBody = await response.text();

  console.log(
    `[Status]    ${response.status} ${response.statusText} (${elapsed}ms)`,
  );
  console.log(`[Kind]      ${kind} (${contentType})`);
  if (location) {
    console.log(`[Location]  ${location}`);
  }
  if (updatedCookies.length > 0) {
    console.log(`[Set-Cookie Updated]: ${updatedCookies.join(", ")}`);
  }
  console.log(`[Size]      ${Buffer.byteLength(rawBody, "utf8")} bytes`);

  if (kind === "JSON") {
    try {
      const parsed = JSON.parse(rawBody);
      console.log("[JSON Preview]:");
      console.dir(parsed, { depth: 3, colors: true });
    } catch {
      console.log("[JSON Preview (raw slice)]:", rawBody.slice(0, 500));
    }
  } else if (kind === "HTML") {
    const $ = cheerio.load(rawBody);
    const pageTitle = $("title").text().trim();
    const heading = $("#mainContent h1, .section_header_wrap h1")
      .first()
      .text()
      .trim();

    console.log(`[HTML Title]   ${pageTitle || "(none)"}`);
    console.log(`[Main Heading] ${heading || "(none)"}`);

    const extracted: Array<{ tag: string; text: string; href?: string }> = [];
    $(itemSelector).each((_, el) => {
      if (el.type !== "tag") return;

      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!text) return;

      const href = $(el).attr("href");
      extracted.push({
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 120),
        ...(href ? { href } : {}),
      });
    });

    console.log(`[Cheerio Extracted Count] ${extracted.length}`);
    console.log("[Sample Extracted Items (first 15)]:");
    console.table(extracted.slice(0, 15));

    // Auto-parse known page types
    const assignments = parseAssignmentsHtml(rawBody);
    if (assignments.length > 0) {
      console.log(`\n[Parsed Assignments] ${assignments.length} found:`);
      console.table(assignments);
    }

    const lessons = parseLessonsHtml(rawBody);
    if (lessons.length > 0) {
      console.log(`\n[Parsed Lessons] ${lessons.length} found:`);
      console.table(
        lessons.map((l) => ({
          title: l.title,
          lessonId: l.lessonId,
          sections: l.sections.length,
          href: l.href,
        })),
      );
      for (const lesson of lessons) {
        if (lesson.sections.length > 0) {
          console.log(`  Sections of "${lesson.title}":`);
          console.table(lesson.sections);
        }
      }
    }
  } else {
    console.log("[Body Preview]:", rawBody.slice(0, 400));
  }

  console.log("========================================\n");
}

async function run() {
  const cookieJar = new SessionCookieJar(process.env.LMS_COOKIE || "VALUES");
  const urls = process.argv.slice(2);
  const targets =
    urls.length > 0
      ? urls
      : ["https://qeducation.edu.gov.qa/student_assignments/list/614062"];

  for (const targetUrl of targets) {
    await inspectGetEndpoint({
      url: targetUrl,
      cookieJar,
    });
  }
}

run();

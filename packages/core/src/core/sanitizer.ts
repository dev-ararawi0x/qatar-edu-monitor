import type { HttpFormFieldValue, ParsedQuizScreen } from "../types/index.js";

export const MASK_VALUE = "VALUES";

export function isSensitiveKeyName(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("cookie") ||
    k.includes("token") ||
    k.includes("csrf") ||
    k.includes("auth") ||
    k.includes("session") ||
    k.includes("secret") ||
    k.includes("password") ||
    k.includes("jwt") ||
    k.includes("credential") ||
    k.includes("api_key") ||
    k.includes("apikey") ||
    k.includes("x-api-key") ||
    k.includes("private_key") ||
    k.includes("bearer")
  );
}

export function maskIfSensitiveKey(key: string, val: string): string {
  if (isSensitiveKeyName(key)) {
    return MASK_VALUE;
  }
  return val;
}

export function sanitizeFields(
  fields?: Record<string, HttpFormFieldValue>,
): Record<string, string> | undefined {
  if (!fields) return undefined;
  const safe: Record<string, string> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (Array.isArray(val)) {
      safe[key] = isSensitiveKeyName(key)
        ? MASK_VALUE
        : val.map((item) => sanitizeText(item)).join(", ");
    } else {
      safe[key] = maskIfSensitiveKey(key, val);
    }
  }
  return safe;
}

export function sanitizeRecordValues(
  record: Record<string, string>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, val] of Object.entries(record)) {
    safe[key] = maskIfSensitiveKey(key, val);
  }
  return safe;
}

export function sanitizeText(text: string): string {
  let result = text;
  // Mask common HTML meta / input token attributes
  result = result.replace(
    /(<meta[^>]*name=["'](?:csrf-token|csrf_token|authenticity_token)["'][^>]*content=["'])([^"']*)(["'][^>]*>)/gi,
    `$1${MASK_VALUE}$3`,
  );
  result = result.replace(
    /(<input[^>]*name=["'](?:authenticity_token|csrf_token|csrf-token)["'][^>]*value=["'])([^"']*)(["'][^>]*>)/gi,
    `$1${MASK_VALUE}$3`,
  );
  // Mask Authorization and API-key headers
  result = result.replace(
    /((?:Authorization|Proxy-Authorization|X-Auth-Token|X-CSRF-Token|X-XSRF-Token|X-API-Key|x-goog-api-key|anthropic-api-key)\s*[:=]\s*)([^\n]+)/gi,
    `$1${MASK_VALUE}`,
  );
  // Mask Cookie header values
  result = result.replace(
    /((?:Cookie|Set-Cookie)\s*[:=]\s*)([^\n]+)/gi,
    `$1${MASK_VALUE}`,
  );
  // Mask sensitive key=value pairs in strings and query strings (including ?key= for Gemini REST URLs)
  result = result.replace(
    /((?:authenticity_token|csrf_token|csrf-token|access_token|refresh_token|session_token|[a-z0-9_]*api_key|apikey|secret_key|password)=)([^\s;&"']+)/gi,
    `$1${MASK_VALUE}`,
  );
  result = result.replace(
    /([?&]key=)([^\s&#"']+)/gi,
    `$1${MASK_VALUE}`,
  );
  return result;
}

export function sanitizeHtmlPreview(html: string, maxLength = 1000): string {
  const cleaned = sanitizeText(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}... [truncated]`
    : cleaned;
}

export function sanitizeJsonValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    return sanitizeText(val);
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeJsonValue);
  }
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        out[k] = sanitizeJsonValue(v);
      } else if (isSensitiveKeyName(k)) {
        out[k] = MASK_VALUE;
      } else {
        out[k] = sanitizeJsonValue(v);
      }
    }
    return out;
  }
  return val;
}

export function sanitizeQuizScreenForOutput(
  screen: ParsedQuizScreen,
): ParsedQuizScreen {
  if (screen.stage === "summary") {
    return {
      ...screen,
      authenticityToken: screen.authenticityToken ? MASK_VALUE : null,
    };
  }

  const safeHidden: Record<string, string> = {};
  for (const [k, v] of Object.entries(screen.hiddenFields)) {
    safeHidden[k] = maskIfSensitiveKey(k, v);
  }

  const safeStructured: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(screen.structuredAnswers)) {
    safeStructured[k] = maskIfSensitiveKey(k, typeof v === "string" ? v : v.join(","));
  }

  return {
    ...screen,
    hiddenFields: safeHidden,
    promptText: sanitizeText(screen.promptText),
    currentTextAnswer: maskIfSensitiveKey("answer", screen.currentTextAnswer),
    structuredAnswers: safeStructured,
  };
}

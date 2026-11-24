const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

export function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP_STATUSES.has(status);
}

export function isFallbackEligibleStatus(status: number): boolean {
  return isTransientHttpStatus(status) || status === 404;
}

export function parseRetryAfterMs(
  retryAfterHeader: string | null,
  maxCapMs = 15000,
): number | null {
  if (!retryAfterHeader) return null;
  const trimmed = retryAfterHeader.trim();
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), maxCapMs);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? Math.min(diff, maxCapMs) : 0;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TransientRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: {
    attempt: number;
    maxRetries: number;
    status?: number;
    delayMs: number;
  }) => void;
}

export async function fetchWithTransientRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options?: TransientRetryOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 1200;
  const maxDelayMs = options?.maxDelayMs ?? 12000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(url, init);
      if (!isTransientHttpStatus(response.status) || attempt === maxRetries) {
        return response;
      }

      const headerDelay = parseRetryAfterMs(
        response.headers.get("retry-after"),
        maxDelayMs,
      );
      const expDelay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * Math.max(1, Math.floor(baseDelayMs * 0.25))),
        maxDelayMs,
      );
      const delayMs = headerDelay ?? expDelay;

      options?.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        status: response.status,
        delayMs,
      });

      await sleep(delayMs);
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) {
        throw err;
      }
      const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      options?.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("[HTTP Retry] Request failed after retries.");
}

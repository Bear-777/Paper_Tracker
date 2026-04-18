import { SourceRequestError } from "@/lib/errors";

const DEFAULT_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 15000);
const DEFAULT_MAX_RETRIES = Number(process.env.REQUEST_MAX_RETRIES ?? 2);
const DEFAULT_BACKOFF_MS = Number(process.env.REQUEST_BACKOFF_BASE_MS ?? 500);
const DEFAULT_USER_AGENT = process.env.REQUEST_USER_AGENT ?? "physics-paper-hub/1.0 (+https://example.com)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

interface FetchRetryOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export async function fetchWithRetry(url: string, init?: RequestInit, options?: FetchRetryOptions): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    const timeout = withTimeoutSignal(timeoutMs);

    try {
      const headers = new Headers(init?.headers ?? {});

      if (!headers.has("User-Agent")) {
        headers.set("User-Agent", DEFAULT_USER_AGENT);
      }

      if (!headers.has("Accept")) {
        headers.set("Accept", "*/*");
      }

      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers,
        signal: timeout.signal
      });

      if (response.ok) {
        return response;
      }

      const retryable = isRetryableStatus(response.status);

      if (!retryable) {
        throw new SourceRequestError({
          kind: "source_fetch_failed",
          message: `Request failed (${response.status})`,
          url,
          statusCode: response.status,
          retryCount: attempt
        });
      }

      throw new SourceRequestError({
        kind: "source_temporarily_unavailable",
        message: `Temporary upstream status (${response.status})`,
        url,
        statusCode: response.status,
        retryCount: attempt
      });
    } catch (error) {
      lastError = error;
      const isAbort = error instanceof Error && error.name === "AbortError";
      const retryableError =
        isAbort ||
        (error instanceof SourceRequestError && error.kind === "source_temporarily_unavailable") ||
        (error instanceof TypeError && /fetch|network/i.test(error.message));

      if (attempt >= maxRetries || !retryableError) {
        if (error instanceof SourceRequestError) {
          throw error;
        }

        if (isAbort) {
          throw new SourceRequestError({
            kind: "source_temporarily_unavailable",
            message: `Request timeout (${timeoutMs}ms)`,
            url,
            retryCount: attempt,
            cause: error
          });
        }

        throw new SourceRequestError({
          kind: "source_fetch_failed",
          message: `Fetch failed: ${toErrorMessage(error)}`,
          url,
          retryCount: attempt,
          cause: error
        });
      }

      const backoff = DEFAULT_BACKOFF_MS * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 200);
      await sleep(backoff + jitter);
      attempt += 1;
    } finally {
      timeout.clear();
    }
  }

  throw new SourceRequestError({
    kind: "source_fetch_failed",
    message: `Request failed after retries: ${toErrorMessage(lastError)}`,
    url,
    retryCount: maxRetries,
    cause: lastError
  });
}

export async function fetchText(url: string, init?: RequestInit, options?: FetchRetryOptions): Promise<string> {
  const response = await fetchWithRetry(url, init, options);

  return response.text();
}

export async function fetchJson<T>(url: string, init?: RequestInit, options?: FetchRetryOptions): Promise<T> {
  const response = await fetchWithRetry(url, init, options);

  return response.json() as Promise<T>;
}

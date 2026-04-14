const DEFAULT_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 15000);

export async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout (${DEFAULT_TIMEOUT_MS}ms): ${url}`);
    }

    throw new Error(`Fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetchWithTimeout(url, init);

  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }

  return response.text();
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, init);

  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }

  return response.json() as Promise<T>;
}

import { SourceRequestError } from "@/lib/errors";
import { fetchWithRetry } from "@/lib/http";
import { normalizeDoi } from "@/lib/utils";

function extractDoiFromUrl(url: string | null): string | undefined {
  if (!url) {
    return undefined;
  }

  const match = url.match(/doi\.org\/(10\.[^?#]+)/i);

  if (!match?.[1]) {
    return undefined;
  }

  return normalizeDoi(match[1]);
}

function extractDoiFromText(text: string): string | undefined {
  const match = text.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/i);

  return normalizeDoi(match?.[0]);
}

export async function resolveToCanonicalDoi(doi: string): Promise<string | undefined> {
  const normalized = normalizeDoi(doi);

  if (!normalized) {
    return undefined;
  }

  const url = `https://doi.org/${normalized}`;

  try {
    const headResponse = await fetchWithRetry(
      url,
      {
        method: "HEAD",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      },
      { maxRetries: 1 }
    );
    const fromLocation = extractDoiFromUrl(headResponse.headers.get("location"));

    if (fromLocation) {
      return fromLocation;
    }
  } catch {
    // Fallback to GET below.
  }

  try {
    const getResponse = await fetchWithRetry(
      url,
      {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      },
      { maxRetries: 1 }
    );
    const finalDoi = extractDoiFromUrl(getResponse.url);

    if (finalDoi) {
      return finalDoi;
    }

    const body = await getResponse.text();

    return extractDoiFromText(body) ?? normalized;
  } catch (error) {
    if (error instanceof SourceRequestError) {
      return normalized;
    }

    return normalized;
  }
}

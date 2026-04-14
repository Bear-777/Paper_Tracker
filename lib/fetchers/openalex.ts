import { fetchWithTimeout } from "@/lib/http";
import { normalizeDoi, stripHtml } from "@/lib/utils";

interface OpenAlexAuthorship {
  author?: {
    display_name?: string;
  };
}

interface OpenAlexWork {
  doi?: string;
  display_name?: string;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: OpenAlexAuthorship[];
  primary_location?: {
    landing_page_url?: string;
  };
}

export interface OpenAlexMetadata {
  title?: string;
  abstract?: string;
  authors?: string[];
  doi?: string;
  url?: string;
}

function invertedIndexToText(invertedIndex: Record<string, number[]> | undefined): string {
  if (!invertedIndex) {
    return "";
  }

  let maxPosition = -1;

  for (const positions of Object.values(invertedIndex)) {
    for (const position of positions) {
      if (position > maxPosition) {
        maxPosition = position;
      }
    }
  }

  if (maxPosition < 0) {
    return "";
  }

  const words = new Array<string>(maxPosition + 1).fill("");

  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) {
      if (!words[position]) {
        words[position] = word;
      }
    }
  }

  return stripHtml(words.join(" ").replace(/\s+/g, " ").trim());
}

export async function fetchOpenAlexByDoi(doi: string): Promise<OpenAlexMetadata | null> {
  const queryDoi = normalizeDoi(doi);

  if (!queryDoi) {
    return null;
  }

  const mailto = process.env.OPENALEX_MAILTO || process.env.CROSSREF_MAILTO;
  const params = new URLSearchParams();

  if (mailto) {
    params.set("mailto", mailto);
  }

  const querySuffix = params.toString();
  const endpoint =
    `https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${queryDoi}`)}` +
    (querySuffix ? `?${querySuffix}` : "");
  const response = await fetchWithTimeout(endpoint, {
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`OpenAlex fetch failed (${response.status}) for DOI ${queryDoi}`);
  }

  const work = (await response.json()) as OpenAlexWork;
  const authors =
    work.authorships
      ?.map((item) => item.author?.display_name?.trim() ?? "")
      .filter(Boolean)
      .filter((author) => !/^anonymous$/i.test(author)) ?? [];

  return {
    title: work.display_name ? stripHtml(work.display_name) : undefined,
    abstract: invertedIndexToText(work.abstract_inverted_index),
    authors,
    doi: normalizeDoi(work.doi),
    url: work.primary_location?.landing_page_url
  };
}

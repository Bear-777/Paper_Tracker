import { fetchJson } from "@/lib/http";
import type { FetchedPaper, SourceConfig } from "@/lib/types";
import { normalizeDoi, stripHtml, toIsoDate } from "@/lib/utils";

interface CrossrefDateNode {
  "date-parts"?: number[][];
}

interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
}

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  abstract?: string;
  URL?: string;
  author?: CrossrefAuthor[];
  "published-print"?: CrossrefDateNode;
  "published-online"?: CrossrefDateNode;
  issued?: CrossrefDateNode;
  created?: CrossrefDateNode;
}

interface CrossrefResponse {
  message?: {
    items?: CrossrefItem[];
  };
}

interface CrossrefSingleResponse {
  message?: CrossrefItem;
}

interface CrossrefFetchOptions {
  issn: string;
  rows: number;
  fromDate: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: "crossref" | "rss" | "arxiv";
}

interface CrossrefSourceMeta {
  sourceId: string;
  sourceLabel: string;
  sourceType: "crossref" | "rss" | "arxiv";
}

function datePartsToIso(parts: number[] | undefined): string | undefined {
  if (!parts || parts.length === 0) {
    return undefined;
  }

  const [year, month = 1, day = 1] = parts;

  if (!year) {
    return undefined;
  }

  return toIsoDate(new Date(Date.UTC(year, month - 1, day)));
}

function pickPublishedAt(item: CrossrefItem): string | undefined {
  const dateNodes = [item["published-online"], item["published-print"], item.issued, item.created];

  for (const node of dateNodes) {
    const parts = node?.["date-parts"]?.[0];
    const iso = datePartsToIso(parts);

    if (iso) {
      return iso;
    }
  }

  return undefined;
}

function parseCrossrefAuthors(authors: CrossrefAuthor[] | undefined): string[] {
  if (!authors || authors.length === 0) {
    return [];
  }

  return authors
    .map((author) => {
      if (author.name) {
        return author.name.trim();
      }

      return `${author.given ?? ""} ${author.family ?? ""}`.trim();
    })
    .filter(Boolean);
}

function toPaperFromCrossrefItem(item: CrossrefItem, sourceMeta: CrossrefSourceMeta): FetchedPaper | null {
  const title = stripHtml(item.title?.[0]?.trim() ?? "");
  const doi = normalizeDoi(item.DOI);
  const publishedAt = pickPublishedAt(item);

  if (!title || !publishedAt) {
    return null;
  }

  const abstract = item.abstract ? stripHtml(item.abstract) : "";
  const url = item.URL || (doi ? `https://doi.org/${doi}` : "");

  return {
    title,
    authors: parseCrossrefAuthors(item.author),
    abstract,
    sourceId: sourceMeta.sourceId,
    sourceLabel: sourceMeta.sourceLabel,
    sourceType: sourceMeta.sourceType,
    publishedAt,
    doi,
    url
  };
}

export async function fetchCrossrefByIssn(options: CrossrefFetchOptions): Promise<FetchedPaper[]> {
  const params = new URLSearchParams({
    filter: `issn:${options.issn},from-pub-date:${options.fromDate}`,
    rows: String(options.rows),
    sort: "published",
    order: "desc"
  });
  const endpoint = `https://api.crossref.org/works?${params.toString()}`;
  const mailto = process.env.CROSSREF_MAILTO;
  const headers: HeadersInit = {};

  if (mailto) {
    headers["User-Agent"] = `physics-paper-hub/0.1 (mailto:${mailto})`;
  }

  const response = await fetchJson<CrossrefResponse>(endpoint, { headers });
  const items = response.message?.items ?? [];

  return items
    .map((item) =>
      toPaperFromCrossrefItem(item, {
        sourceId: options.sourceId,
        sourceLabel: options.sourceLabel,
        sourceType: options.sourceType
      })
    )
    .filter((paper): paper is FetchedPaper => paper !== null);
}

export async function fetchCrossrefByDoi(
  doi: string,
  sourceMeta: CrossrefSourceMeta
): Promise<FetchedPaper | null> {
  const endpoint = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const mailto = process.env.CROSSREF_MAILTO;
  const headers: HeadersInit = {};

  if (mailto) {
    headers["User-Agent"] = `physics-paper-hub/0.1 (mailto:${mailto})`;
  }

  const response = await fetchJson<CrossrefSingleResponse>(endpoint, { headers });

  if (!response.message) {
    return null;
  }

  return toPaperFromCrossrefItem(response.message, sourceMeta);
}

export async function fetchCrossrefPapers(source: SourceConfig, fromDate: string): Promise<FetchedPaper[]> {
  if (!source.issn) {
    return [];
  }

  return fetchCrossrefByIssn({
    issn: source.issn,
    rows: source.rows ?? 100,
    fromDate,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: "crossref"
  });
}

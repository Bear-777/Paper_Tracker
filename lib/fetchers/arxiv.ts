import { XMLParser } from "fast-xml-parser";

import { cleanAbstractText } from "@/lib/abstract";
import { SourceRequestError } from "@/lib/errors";
import { fetchText } from "@/lib/http";
import type { FetchedPaper, SourceConfig } from "@/lib/types";
import { extractArxivId, normalizeDoi, normalizeWhitespace, stripHtml, toArray, toIsoDate, xmlValueToText } from "@/lib/utils";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false
});

function pickArxivLink(linkNode: unknown, arxivId?: string): string {
  const links = toArray(linkNode as Record<string, unknown> | Record<string, unknown>[] | undefined);

  for (const link of links) {
    const href = xmlValueToText((link as Record<string, unknown>)?.["@_href"]);
    const rel = xmlValueToText((link as Record<string, unknown>)?.["@_rel"]);

    if (href && (!rel || rel === "alternate")) {
      return href;
    }
  }

  if (arxivId) {
    return `https://arxiv.org/abs/${arxivId}`;
  }

  return "";
}

function parseArxivEntry(entry: Record<string, unknown>, source: SourceConfig): FetchedPaper | null {
  const title = stripHtml(xmlValueToText(entry.title));
  const abstract = cleanAbstractText(xmlValueToText(entry.summary));
  const publishedAt = toIsoDate(xmlValueToText(entry.published) || xmlValueToText(entry.updated));

  const authors = toArray(entry.author as unknown[]).map((author) => {
    if (!author || typeof author !== "object") {
      return "";
    }

    return normalizeWhitespace(xmlValueToText((author as Record<string, unknown>).name));
  });

  const arxivId = extractArxivId(xmlValueToText(entry.id));
  const doi = normalizeDoi(xmlValueToText(entry["arxiv:doi"]));
  const url = pickArxivLink(entry.link, arxivId);

  return {
    title: title || "Untitled",
    authors: authors.filter(Boolean),
    abstract,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    publishedAt: publishedAt ?? new Date().toISOString(),
    doi,
    arxivId,
    url
  };
}

export async function fetchArxivPapers(source: SourceConfig): Promise<FetchedPaper[]> {
  const rowCount = source.rows ?? 120;
  const search = new URLSearchParams({
    search_query: `cat:${source.category}`,
    sortBy: "submittedDate",
    sortOrder: "descending",
    max_results: String(rowCount)
  });

  const url = `https://export.arxiv.org/api/query?${search.toString()}`;
  const xml = await fetchText(url);
  let parsed: Record<string, unknown>;

  try {
    parsed = xmlParser.parse(xml) as Record<string, unknown>;
  } catch (error) {
    throw new SourceRequestError({
      kind: "source_parsing_failed",
      message: `arXiv feed parsing failed: ${error instanceof Error ? error.message : String(error)}`,
      url,
      cause: error
    });
  }

  const entries = toArray((parsed.feed as Record<string, unknown>)?.entry as unknown[]);

  return entries
    .map((entry) => parseArxivEntry(entry as Record<string, unknown>, source))
    .filter((paper): paper is FetchedPaper => paper !== null);
}

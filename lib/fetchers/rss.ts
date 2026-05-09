import { XMLParser } from "fast-xml-parser";

import { SourceRequestError } from "@/lib/errors";
import { fetchText } from "@/lib/http";
import type { FetchedPaper, SourceConfig } from "@/lib/types";
import {
  extractDoi,
  normalizeDoi,
  normalizeWhitespace,
  stripHtml,
  toArray,
  toIsoDate,
  xmlValueToText
} from "@/lib/utils";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  // APS RSS may include many entity references; disable entity expansion to avoid parser hard limit errors.
  processEntities: false
});

function parseAuthorList(raw: unknown): string[] {
  const values = toArray(raw as string | string[]).flatMap((entry) =>
    normalizeWhitespace(xmlValueToText(entry))
      .split(/\s+and\s+|;/i)
      .map((name) => normalizeWhitespace(name))
      .filter(Boolean)
  );

  return values.filter((name) => !/^anonymous$/i.test(name));
}

function parseRssItem(item: Record<string, unknown>, source: SourceConfig): FetchedPaper {
  const title = stripHtml(xmlValueToText(item.title));
  const abstract = stripHtml(
    xmlValueToText(item.description) || xmlValueToText(item["content:encoded"]) || xmlValueToText(item.summary)
  );
  const publishedAt = toIsoDate(
    xmlValueToText(item.pubDate) || xmlValueToText(item["dc:date"]) || xmlValueToText(item.updated)
  );

  const link = normalizeWhitespace(xmlValueToText(item.link) || xmlValueToText(item.guid));
  const doi =
    normalizeDoi(xmlValueToText(item["prism:doi"]) || xmlValueToText(item.doi)) ||
    extractDoi(`${title} ${link} ${abstract}`);
  const authors = parseAuthorList(item["dc:creator"] || item.author);

  return {
    title: title || "Untitled",
    authors,
    abstract,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    publishedAt: publishedAt ?? new Date().toISOString(),
    doi,
    url: link || (doi ? `https://doi.org/${doi}` : "")
  };
}

function parseAtomItem(entry: Record<string, unknown>, source: SourceConfig): FetchedPaper {
  const title = stripHtml(xmlValueToText(entry.title));
  const abstract = stripHtml(
    xmlValueToText(entry.summary) || xmlValueToText(entry.content) || xmlValueToText(entry.description)
  );
  const publishedAt = toIsoDate(xmlValueToText(entry.published) || xmlValueToText(entry.updated));

  const links = toArray(entry.link as unknown[]);
  let link = "";

  for (const candidate of links) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const href = xmlValueToText((candidate as Record<string, unknown>)["@_href"]);

    if (href) {
      link = href;
      break;
    }
  }

  const doi =
    normalizeDoi(xmlValueToText(entry["prism:doi"]) || xmlValueToText(entry.doi)) ||
    extractDoi(`${title} ${link} ${abstract}`);
  const authors = toArray(entry.author as unknown[]).map((author) => {
    if (!author || typeof author !== "object") {
      return "";
    }

    return normalizeWhitespace(xmlValueToText((author as Record<string, unknown>).name));
  });

  return {
    title: title || "Untitled",
    authors: authors.filter(Boolean),
    abstract,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    publishedAt: publishedAt ?? new Date().toISOString(),
    doi,
    url: link || (doi ? `https://doi.org/${doi}` : "")
  };
}

function extractRssItems(parsed: Record<string, unknown>): unknown[] {
  const rssChannel = (parsed.rss as Record<string, unknown>)?.channel as Record<string, unknown> | undefined;
  const rssItems = toArray(rssChannel?.item as unknown[]);

  if (rssItems.length > 0) {
    return rssItems;
  }

  // Nature family feeds may publish RSS 1.0 / RDF instead of RSS 2.0.
  const rdfRoot = (parsed["rdf:RDF"] as Record<string, unknown>) ?? (parsed.RDF as Record<string, unknown>);
  const rdfItems = toArray(rdfRoot?.item as unknown[]);

  if (rdfItems.length > 0) {
    return rdfItems;
  }

  return [];
}

export async function fetchRssPapers(source: SourceConfig): Promise<FetchedPaper[]> {
  if (!source.url) {
    return [];
  }

  const xml = await fetchText(source.url);
  let parsed: Record<string, unknown>;

  try {
    parsed = xmlParser.parse(xml) as Record<string, unknown>;
  } catch (error) {
    throw new SourceRequestError({
      kind: "source_parsing_failed",
      message: `RSS parsing failed: ${error instanceof Error ? error.message : String(error)}`,
      url: source.url,
      cause: error
    });
  }

  const rssItems = extractRssItems(parsed)
    .map((item) => parseRssItem(item as Record<string, unknown>, source))
    .filter((paper): paper is FetchedPaper => paper !== null);

  if (rssItems.length > 0) {
    return rssItems;
  }

  const atomEntries = toArray((parsed.feed as Record<string, unknown>)?.entry as unknown[])
    .map((entry) => parseAtomItem(entry as Record<string, unknown>, source))
    .filter((paper): paper is FetchedPaper => paper !== null);

  return atomEntries;
}

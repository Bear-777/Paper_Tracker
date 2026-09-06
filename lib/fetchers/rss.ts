import { XMLParser } from "fast-xml-parser";

import { cleanAbstractText, pickBestAbstract } from "@/lib/abstract";
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
  const abstractCandidate = (value: unknown): string => {
    let text = cleanAbstractText(xmlValueToText(value));
    // Nature RDF often provides a publication notice plus repeated title, not an abstract.
    if (text.startsWith(`${source.label}, Published online:`)) {
      text = text.replace(/^.*?\bdoi:\s*10\.\d{4,9}\/\S+\s*/i, "").trim();
    }
    return text.toLowerCase() === title.toLowerCase() ? "" : text;
  };
  const abstract = pickBestAbstract(
    [
      { strategy: "rss:description", value: item.description },
      { strategy: "rss:content-encoded", value: item["content:encoded"] },
      { strategy: "rss:summary", value: item.summary },
      { strategy: "rss:dc-description", value: item["dc:description"] },
      { strategy: "rss:atom-content", value: item.content },
      { strategy: "rss:prism-teaser", value: item["prism:teaser"] }
    ].map((candidate) => ({ ...candidate, value: abstractCandidate(candidate.value) })),
    "rss:item"
  ).abstract;
  const publishedAt = toIsoDate(
    xmlValueToText(item.pubDate) || xmlValueToText(item["dc:date"]) || xmlValueToText(item.updated)
  );

  const link = normalizeWhitespace(xmlValueToText(item.link) || xmlValueToText(item.guid));
  const doi =
    normalizeDoi(xmlValueToText(item["prism:doi"]) || xmlValueToText(item.doi)) ||
    extractDoi(`${title} ${link} ${abstract}`);
  const authorText = item["dc:creator"] || item.author;
  const authors = source.id === "quantum"
    ? parseAuthorList(xmlValueToText(authorText).replace(/,\s*(?:and\s+)?/g, ";"))
    : parseAuthorList(authorText);

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
  const abstract = pickBestAbstract(
    [
      { strategy: "atom:summary", value: entry.summary },
      { strategy: "atom:content", value: entry.content },
      { strategy: "atom:description", value: entry.description },
      { strategy: "atom:dc-description", value: entry["dc:description"] }
    ],
    "atom:entry"
  ).abstract;
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
  return parseRssFeed(xml, source);
}

export function parseRssFeed(xml: string, source: SourceConfig): FetchedPaper[] {
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
    return rssItems.filter((paper) => !source.articleUrlPrefix || paper.url.startsWith(source.articleUrlPrefix));
  }

  const atomEntries = toArray((parsed.feed as Record<string, unknown>)?.entry as unknown[])
    .map((entry) => parseAtomItem(entry as Record<string, unknown>, source))
    .filter((paper): paper is FetchedPaper => paper !== null);

  return atomEntries.filter((paper) => !source.articleUrlPrefix || paper.url.startsWith(source.articleUrlPrefix));
}

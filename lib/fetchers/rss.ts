import { XMLParser } from "fast-xml-parser";

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

function parseRssItem(item: Record<string, unknown>, source: SourceConfig): FetchedPaper | null {
  const title = stripHtml(xmlValueToText(item.title));
  const abstract = stripHtml(
    xmlValueToText(item.description) || xmlValueToText(item["content:encoded"]) || xmlValueToText(item.summary)
  );
  const publishedAt = toIsoDate(
    xmlValueToText(item.pubDate) || xmlValueToText(item["dc:date"]) || xmlValueToText(item.updated)
  );

  if (!title || !publishedAt) {
    return null;
  }

  const link = normalizeWhitespace(xmlValueToText(item.link) || xmlValueToText(item.guid));
  const doi =
    normalizeDoi(xmlValueToText(item["prism:doi"]) || xmlValueToText(item.doi)) ||
    extractDoi(`${title} ${link} ${abstract}`);
  const authors = parseAuthorList(item["dc:creator"] || item.author);

  return {
    title,
    authors,
    abstract,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    publishedAt,
    doi,
    url: link || (doi ? `https://doi.org/${doi}` : "")
  };
}

function parseAtomItem(entry: Record<string, unknown>, source: SourceConfig): FetchedPaper | null {
  const title = stripHtml(xmlValueToText(entry.title));
  const abstract = stripHtml(
    xmlValueToText(entry.summary) || xmlValueToText(entry.content) || xmlValueToText(entry.description)
  );
  const publishedAt = toIsoDate(xmlValueToText(entry.published) || xmlValueToText(entry.updated));

  if (!title || !publishedAt) {
    return null;
  }

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
    title,
    authors: authors.filter(Boolean),
    abstract,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    publishedAt,
    doi,
    url: link || (doi ? `https://doi.org/${doi}` : "")
  };
}

export async function fetchRssPapers(source: SourceConfig): Promise<FetchedPaper[]> {
  if (!source.url) {
    return [];
  }

  const xml = await fetchText(source.url);
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;

  const rssItems = toArray(
    ((parsed.rss as Record<string, unknown>)?.channel as Record<string, unknown>)?.item as unknown[]
  )
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

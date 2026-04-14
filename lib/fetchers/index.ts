import type { FetchedPaper, SourceConfig } from "@/lib/types";

import { fetchArxivPapers } from "@/lib/fetchers/arxiv";
import { fetchCrossrefByDoi, fetchCrossrefByIssn, fetchCrossrefPapers } from "@/lib/fetchers/crossref";
import { fetchOpenAlexByDoi, type OpenAlexMetadata } from "@/lib/fetchers/openalex";
import { fetchRssPapers } from "@/lib/fetchers/rss";
import { hasMarkupArtifacts, normalizeDoi, normalizeTitleForMatch, stripHtml } from "@/lib/utils";

interface DoiMetadataBundle {
  crossref: FetchedPaper | null;
  openalex: OpenAlexMetadata | null;
}

function hasUsableAuthors(authors: string[]): boolean {
  if (authors.length === 0) {
    return false;
  }

  return authors.some((author) => author.trim() && !/^anonymous$/i.test(author.trim()));
}

function hasUsableAbstract(abstractText: string): boolean {
  return abstractText.trim().length >= 60;
}

function needsTitleCleanup(title: string): boolean {
  return hasMarkupArtifacts(title) || title.length > 220;
}

function isLikelyShortDoi(doi: string | undefined): boolean {
  const normalized = normalizeDoi(doi);

  if (!normalized) {
    return false;
  }

  const suffix = normalized.split("/")[1] ?? "";

  return suffix.length <= 12 || /^[a-z0-9]{3,6}-[a-z0-9]{3,6}$/i.test(suffix);
}

function mergePaperWithBundle(paper: FetchedPaper, bundle: DoiMetadataBundle | undefined): FetchedPaper {
  if (!bundle) {
    return {
      ...paper,
      title: stripHtml(paper.title)
    };
  }

  const fromCrossref = bundle.crossref;
  const fromOpenAlex = bundle.openalex;
  const merged: FetchedPaper = {
    ...paper
  };

  if (fromCrossref) {
    if (!hasUsableAbstract(merged.abstract) && hasUsableAbstract(fromCrossref.abstract)) {
      merged.abstract = fromCrossref.abstract;
    }

    if (!hasUsableAuthors(merged.authors) && hasUsableAuthors(fromCrossref.authors)) {
      merged.authors = fromCrossref.authors;
    }

    if (needsTitleCleanup(merged.title) && fromCrossref.title) {
      merged.title = fromCrossref.title;
    }

    if (!merged.url && fromCrossref.url) {
      merged.url = fromCrossref.url;
    }

    if (fromCrossref.doi) {
      merged.doi = fromCrossref.doi;
    }
  }

  if (fromOpenAlex) {
    if (!hasUsableAbstract(merged.abstract) && hasUsableAbstract(fromOpenAlex.abstract ?? "")) {
      merged.abstract = fromOpenAlex.abstract ?? merged.abstract;
    }

    if (!hasUsableAuthors(merged.authors) && hasUsableAuthors(fromOpenAlex.authors ?? [])) {
      merged.authors = fromOpenAlex.authors ?? merged.authors;
    }

    if (needsTitleCleanup(merged.title) && fromOpenAlex.title) {
      merged.title = fromOpenAlex.title;
    }

    if (!merged.url && fromOpenAlex.url) {
      merged.url = fromOpenAlex.url;
    }

    if (!merged.doi || isLikelyShortDoi(merged.doi)) {
      merged.doi = fromOpenAlex.doi ?? merged.doi;
    }
  }

  merged.title = stripHtml(merged.title);

  return merged;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const workers = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let index = 0;

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const currentIndex = index;
        index += 1;

        if (currentIndex >= items.length) {
          break;
        }

        results[currentIndex] = await mapper(items[currentIndex]);
      }
    })
  );

  return results;
}

function mergeRssWithCrossref(rssPapers: FetchedPaper[], crossrefPapers: FetchedPaper[]): FetchedPaper[] {
  const crossrefByDoi = new Map<string, { paper: FetchedPaper; index: number }>();
  const crossrefByTitle = new Map<string, { paper: FetchedPaper; index: number }>();

  crossrefPapers.forEach((paper, index) => {
    const doi = normalizeDoi(paper.doi);
    const titleKey = normalizeTitleForMatch(paper.title);

    if (doi) {
      crossrefByDoi.set(doi, { paper, index });
    }

    if (titleKey) {
      crossrefByTitle.set(titleKey, { paper, index });
    }
  });

  const matchedCrossrefIndexes = new Set<number>();
  const enrichedRss = rssPapers.map((paper) => {
    const doi = normalizeDoi(paper.doi);
    const titleKey = normalizeTitleForMatch(paper.title);
    const byDoi = doi ? crossrefByDoi.get(doi) : undefined;
    const byTitle = !byDoi && titleKey ? crossrefByTitle.get(titleKey) : undefined;
    const crossrefMatch = byDoi ?? byTitle;

    if (!crossrefMatch) {
      return {
        ...paper,
        title: stripHtml(paper.title)
      };
    }

    matchedCrossrefIndexes.add(crossrefMatch.index);

    return {
      ...paper,
      title: needsTitleCleanup(paper.title) ? crossrefMatch.paper.title : stripHtml(paper.title),
      abstract: hasUsableAbstract(paper.abstract) ? paper.abstract : crossrefMatch.paper.abstract || paper.abstract,
      authors: hasUsableAuthors(paper.authors) ? paper.authors : crossrefMatch.paper.authors,
      url: paper.url || crossrefMatch.paper.url,
      doi: crossrefMatch.paper.doi || paper.doi
    };
  });
  const crossrefOnlyPapers = crossrefPapers.filter((_, index) => !matchedCrossrefIndexes.has(index));

  return [...enrichedRss, ...crossrefOnlyPapers];
}

async function enrichMissingMetadataByDoi(source: SourceConfig, papers: FetchedPaper[]): Promise<FetchedPaper[]> {
  const candidateDois = Array.from(
    new Set(
      papers
        .filter(
          (paper) => (!hasUsableAbstract(paper.abstract) || !hasUsableAuthors(paper.authors) || needsTitleCleanup(paper.title)) && paper.doi
        )
        .map((paper) => normalizeDoi(paper.doi))
        .filter((doi): doi is string => Boolean(doi))
    )
  );

  if (candidateDois.length === 0) {
    return papers.map((paper) => ({
      ...paper,
      title: stripHtml(paper.title)
    }));
  }

  const lookupResults = await mapWithConcurrency(candidateDois, 6, async (doi) => {
    const sourceMeta = {
      sourceId: source.id,
      sourceLabel: source.label,
      sourceType: "crossref" as const
    };
    let fromCrossref: FetchedPaper | null = null;
    let fromOpenAlex: OpenAlexMetadata | null = null;

    try {
      fromCrossref = await fetchCrossrefByDoi(doi, sourceMeta);
    } catch {
      fromCrossref = null;
    }

    const stillMissing =
      !fromCrossref || !hasUsableAbstract(fromCrossref.abstract) || !hasUsableAuthors(fromCrossref.authors);

    if (stillMissing) {
      try {
        fromOpenAlex = await fetchOpenAlexByDoi(doi);
      } catch {
        fromOpenAlex = null;
      }
    }

    return {
      doi,
      bundle: {
        crossref: fromCrossref,
        openalex: fromOpenAlex
      } satisfies DoiMetadataBundle
    };
  });

  const bundleByDoi = new Map<string, DoiMetadataBundle>();

  for (const result of lookupResults) {
    bundleByDoi.set(result.doi, result.bundle);
  }

  return papers.map((paper) => {
    const doi = normalizeDoi(paper.doi);

    if (!doi) {
      return {
        ...paper,
        title: stripHtml(paper.title)
      };
    }

    return mergePaperWithBundle(paper, bundleByDoi.get(doi));
  });
}

export async function fetchBySource(source: SourceConfig, fromDate: string): Promise<FetchedPaper[]> {
  if (source.type === "arxiv") {
    const papers = await fetchArxivPapers(source);

    return papers.map((paper) => ({
      ...paper,
      title: stripHtml(paper.title)
    }));
  }

  if (source.type === "rss") {
    if (!source.fallbackCrossrefIssn) {
      const rssPapers = await fetchRssPapers(source);

      return enrichMissingMetadataByDoi(source, rssPapers);
    }

    const [rssResult, crossrefResult] = await Promise.allSettled([
      fetchRssPapers(source),
      fetchCrossrefByIssn({
        issn: source.fallbackCrossrefIssn,
        rows: Math.max(source.rows ?? 100, 250),
        fromDate,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceType: "crossref"
      })
    ]);

    const rssPapers = rssResult.status === "fulfilled" ? rssResult.value : [];
    const crossrefPapers = crossrefResult.status === "fulfilled" ? crossrefResult.value : [];
    let combined: FetchedPaper[] = [];

    if (rssPapers.length > 0 && crossrefPapers.length > 0) {
      combined = mergeRssWithCrossref(rssPapers, crossrefPapers);
    } else if (rssPapers.length > 0) {
      combined = rssPapers;
    } else if (crossrefPapers.length > 0) {
      combined = crossrefPapers;
    }

    if (combined.length > 0) {
      return enrichMissingMetadataByDoi(source, combined);
    }

    if (rssResult.status === "rejected") {
      throw rssResult.reason;
    }

    if (crossrefResult.status === "rejected") {
      throw crossrefResult.reason;
    }

    return [];
  }

  if (source.type === "crossref") {
    return fetchCrossrefPapers(source, fromDate);
  }

  return [];
}

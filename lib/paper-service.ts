import { dedupePapers } from "@/lib/dedupe";
import { fetchBySource } from "@/lib/fetchers";
import { ENABLED_SOURCES } from "@/lib/sources";
import type { FetchResult, FetchedPaper, SourceError } from "@/lib/types";
import { buildFromDate, isWithinLast7Days, toErrorMessage } from "@/lib/utils";

function sortByPublishedAtDesc(papers: FetchedPaper[]): FetchedPaper[] {
  return papers.sort((left, right) => {
    return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
  });
}

export async function fetchLatestPapers(): Promise<FetchResult> {
  const fromDate = buildFromDate();
  const sourceErrors: SourceError[] = [];
  const allPapers: FetchedPaper[] = [];
  const tasks = ENABLED_SOURCES.map(async (source) => {
    try {
      const papers = await fetchBySource(source, fromDate);

      return { sourceId: source.id, sourceLabel: source.label, papers };
    } catch (error) {
      sourceErrors.push({
        sourceId: source.id,
        sourceLabel: source.label,
        message: toErrorMessage(error)
      });

      return { sourceId: source.id, sourceLabel: source.label, papers: [] as FetchedPaper[] };
    }
  });

  const settled = await Promise.all(tasks);

  for (const sourceResult of settled) {
    allPapers.push(...sourceResult.papers);
  }

  const withinLast7Days = allPapers.filter((paper) => isWithinLast7Days(paper.publishedAt));
  const deduped = dedupePapers(sortByPublishedAtDesc(withinLast7Days));

  return {
    papers: deduped,
    sourceErrors,
    totalFetched: allPapers.length
  };
}

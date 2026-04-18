import { dedupePapers } from "@/lib/dedupe";
import { SourceRequestError } from "@/lib/errors";
import { fetchBySource } from "@/lib/fetchers";
import { ENABLED_SOURCES } from "@/lib/sources";
import type {
  AggregatedResult,
  FetchedPaper,
  SourceCacheRecord,
  SourceCacheState,
  SourceConfig,
  SourceErrorInfo,
  SourceStatus,
  SourceType,
  SourceView
} from "@/lib/types";
import { buildFromDate, isWithinLast7Days, normalizeWhitespace, stripHtml, toErrorMessage, toIsoDate } from "@/lib/utils";

const SOURCE_REFRESH_CONCURRENCY = Number(process.env.SOURCE_REFRESH_CONCURRENCY ?? 3);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 30 * 60 * 1000);

declare global {
  var __sourceCacheState: SourceCacheState | undefined;
  var __sourceRefreshPromise: Promise<SourceCacheState> | undefined;
}

function createDefaultSourceRecord(source: SourceConfig): SourceCacheRecord {
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    articles: [],
    sourceStatus: "failed_no_cache",
    usingStaleCache: false
  };
}

function createInitialState(): SourceCacheState {
  const sources: Record<string, SourceCacheRecord> = {};

  for (const source of ENABLED_SOURCES) {
    sources[source.id] = createDefaultSourceRecord(source);
  }

  return {
    refreshVersion: 0,
    sources
  };
}

function getState(): SourceCacheState {
  if (!global.__sourceCacheState) {
    global.__sourceCacheState = createInitialState();
  }

  return global.__sourceCacheState;
}

function hasUsableCache(record: SourceCacheRecord | undefined): boolean {
  return Boolean(record && record.lastSuccessAt && record.articles.length > 0);
}

function hasMeaningfulAbstract(abstractText: string): boolean {
  return normalizeWhitespace(abstractText).length >= 60;
}

function hasMeaningfulAuthors(authors: string[]): boolean {
  return authors.some((author) => normalizeWhitespace(author).length > 0 && !/^anonymous$/i.test(author.trim()));
}

function normalizeArticle(paper: FetchedPaper, source: SourceConfig, refreshAttemptAt: string): FetchedPaper | null {
  const normalizedPublished = toIsoDate(paper.publishedAt) ?? refreshAttemptAt;
  const normalizedTitle = normalizeWhitespace(stripHtml(paper.title)) || "Untitled";
  const normalizedAuthors = (paper.authors ?? [])
    .map((author) => normalizeWhitespace(author))
    .filter((author) => author.length > 0);
  const normalizedUrl = normalizeWhitespace(paper.url || "");
  const normalizedAbstract = normalizeWhitespace(stripHtml(paper.abstract || ""));

  if (!normalizedPublished) {
    return null;
  }

  return {
    ...paper,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    title: normalizedTitle,
    authors: normalizedAuthors,
    abstract: normalizedAbstract,
    publishedAt: normalizedPublished,
    url: normalizedUrl
  };
}

function toSourceErrorInfo(
  source: SourceConfig,
  error: unknown,
  fallbackKind: SourceErrorInfo["kind"],
  retryCount: number
): SourceErrorInfo {
  if (error instanceof SourceRequestError) {
    return {
      kind: error.kind,
      message: error.message,
      url: error.url,
      statusCode: error.statusCode,
      retryCount: error.retryCount,
      stack: error.stack,
      at: new Date().toISOString()
    };
  }

  return {
    kind: fallbackKind,
    message: toErrorMessage(error),
    url: source.url,
    retryCount,
    stack: error instanceof Error ? error.stack : undefined,
    at: new Date().toISOString()
  };
}

function logSourceIssue(
  source: SourceConfig,
  sourceUrl: string | undefined,
  statusCode: number | undefined,
  error: SourceErrorInfo
): void {
  const payload = {
    sourceId: source.id,
    sourceLabel: source.label,
    url: sourceUrl,
    statusCode,
    errorKind: error.kind,
    message: error.message,
    retryCount: error.retryCount ?? 0,
    stack: error.stack
  };

  if (error.kind === "source_returned_empty") {
    console.info("[source-refresh-info]", payload);

    return;
  }

  if (error.kind === "source_temporarily_unavailable") {
    console.warn("[source-refresh-warning]", payload);

    return;
  }

  console.error("[source-refresh-error]", payload);
}

function getSourceStatusFromArticles(articles: FetchedPaper[]): SourceStatus {
  if (articles.length === 0) {
    return "success";
  }

  const incompleteCount = articles.filter(
    (paper) => !hasMeaningfulAbstract(paper.abstract) || !hasMeaningfulAuthors(paper.authors)
  ).length;

  if (incompleteCount === 0) {
    return "success";
  }

  const incompleteRatio = incompleteCount / articles.length;

  return incompleteRatio >= 0.1 ? "partial_data" : "success";
}

function stableSortArticles(articles: FetchedPaper[]): FetchedPaper[] {
  return [...articles].sort((left, right) => {
    const publishedDiff = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();

    if (publishedDiff !== 0) {
      return publishedDiff;
    }

    const sourceDiff = left.sourceLabel.localeCompare(right.sourceLabel);

    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    return left.title.localeCompare(right.title);
  });
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const size = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: size }, async () => {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;

        if (current >= items.length) {
          return;
        }

        await worker(items[current]);
      }
    })
  );
}

async function refreshSingleSource(
  state: SourceCacheState,
  source: SourceConfig,
  refreshTimestampMs: number,
  refreshAttemptAt: string
): Promise<void> {
  const previous = state.sources[source.id] ?? createDefaultSourceRecord(source);
  const nextRecord: SourceCacheRecord = {
    ...previous,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    lastAttemptAt: refreshAttemptAt
  };
  const fromDate = buildFromDate(refreshTimestampMs);

  try {
    const fetched = await fetchBySource(source, fromDate);
    const normalized = fetched
      .map((paper) => normalizeArticle(paper, source, refreshAttemptAt))
      .filter((paper): paper is FetchedPaper => paper !== null);
    const withinWindow = normalized.filter((paper) => isWithinLast7Days(paper.publishedAt, refreshTimestampMs));

    if (withinWindow.length === 0) {
      const emptyError: SourceErrorInfo = {
        kind: "source_returned_empty",
        message: `Source returned no articles in UTC 7-day window (${fromDate} ~ ${refreshAttemptAt.slice(0, 10)}).`,
        url: source.url,
        at: refreshAttemptAt
      };

      if (hasUsableCache(previous)) {
        state.sources[source.id] = {
          ...nextRecord,
          articles: previous.articles,
          sourceStatus: "stale_cache",
          usingStaleCache: true,
          lastSuccessAt: previous.lastSuccessAt,
          lastError: emptyError
        };
      } else {
        state.sources[source.id] = {
          ...nextRecord,
          articles: [],
          sourceStatus: "success",
          usingStaleCache: false,
          lastSuccessAt: refreshAttemptAt,
          lastError: emptyError
        };
      }

      logSourceIssue(source, source.url, undefined, emptyError);

      return;
    }

    const sorted = stableSortArticles(withinWindow);
    state.sources[source.id] = {
      ...nextRecord,
      articles: sorted,
      sourceStatus: getSourceStatusFromArticles(sorted),
      usingStaleCache: false,
      lastSuccessAt: refreshAttemptAt,
      lastError: undefined
    };
  } catch (error) {
    const errorInfo = toSourceErrorInfo(source, error, "source_fetch_failed", 0);
    const statusCode = error instanceof SourceRequestError ? error.statusCode : undefined;

    logSourceIssue(source, errorInfo.url ?? source.url, statusCode, errorInfo);

    if (hasUsableCache(previous)) {
      state.sources[source.id] = {
        ...nextRecord,
        articles: previous.articles,
        sourceStatus: "stale_cache",
        usingStaleCache: true,
        lastSuccessAt: previous.lastSuccessAt,
        lastError: errorInfo
      };

      return;
    }

    state.sources[source.id] = {
      ...nextRecord,
      articles: [],
      sourceStatus: "failed_no_cache",
      usingStaleCache: false,
      lastError: errorInfo
    };
  }
}

function toSourceViews(state: SourceCacheState): SourceView[] {
  return Object.values(state.sources)
    .map((source) => ({
      sourceId: source.sourceId,
      sourceLabel: source.sourceLabel,
      sourceType: source.sourceType,
      sourceStatus: source.sourceStatus,
      usingStaleCache: source.usingStaleCache,
      articleCount: source.articles.length,
      lastSuccessAt: source.lastSuccessAt,
      lastAttemptAt: source.lastAttemptAt,
      lastError: source.lastError
    }))
    .sort((left, right) => left.sourceLabel.localeCompare(right.sourceLabel));
}

function aggregateFromState(state: SourceCacheState): AggregatedResult {
  const allArticles = Object.values(state.sources).flatMap((source) => source.articles);
  const papers = dedupePapers(allArticles);

  return {
    papers,
    totalBeforeDedupe: allArticles.length,
    sourceViews: toSourceViews(state),
    currentRefreshAttemptAt: state.currentRefreshAttemptAt,
    lastSuccessfulRefreshAt: state.lastSuccessfulRefreshAt
  };
}

function shouldAutoRefresh(state: SourceCacheState): boolean {
  if (!state.lastSuccessfulRefreshAt) {
    return true;
  }

  const lastSuccessMs = new Date(state.lastSuccessfulRefreshAt).getTime();

  if (Number.isNaN(lastSuccessMs)) {
    return true;
  }

  return Date.now() - lastSuccessMs > CACHE_TTL_MS;
}

export async function softRefreshSources(): Promise<SourceCacheState> {
  if (global.__sourceRefreshPromise) {
    return global.__sourceRefreshPromise;
  }

  global.__sourceRefreshPromise = (async () => {
    const state = getState();
    const refreshTimestampMs = Date.now();
    const refreshAttemptAt = new Date(refreshTimestampMs).toISOString();

    state.refreshVersion += 1;
    state.currentRefreshAttemptAt = refreshAttemptAt;

    const orderedSources = [...ENABLED_SOURCES].sort((left, right) => left.id.localeCompare(right.id));

    await runWithConcurrency(orderedSources, SOURCE_REFRESH_CONCURRENCY, async (source) => {
      await refreshSingleSource(state, source, refreshTimestampMs, refreshAttemptAt);
    });

    const succeeded = Object.values(state.sources).some((source) => source.lastSuccessAt === refreshAttemptAt);

    if (succeeded) {
      state.lastSuccessfulRefreshAt = refreshAttemptAt;
    }

    global.__sourceCacheState = state;

    return state;
  })().finally(() => {
    global.__sourceRefreshPromise = undefined;
  });

  return global.__sourceRefreshPromise;
}

export async function getAggregatedPapers(): Promise<AggregatedResult> {
  const state = getState();

  if (shouldAutoRefresh(state) || !state.currentRefreshAttemptAt) {
    await softRefreshSources();
  }

  return aggregateFromState(getState());
}

export async function refreshAndGetAggregatedPapers(): Promise<AggregatedResult> {
  await softRefreshSources();

  return aggregateFromState(getState());
}
